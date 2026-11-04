import type { TacticProject } from '@btl/shared-types';
import type { LocalSyncStore, RemoteRecord, SyncConflict, SyncOperation } from '../storage/db';

/** 雲端端的戰術存取（Supabase 或測試用記憶體實作） */
export interface RemoteProjectStore {
  list(): Promise<RemoteRecord[]>;
  get(id: string): Promise<RemoteRecord | null>;
  /** 新增；雲端已有同 id 時回傳 ok:false */
  insert(input: RemoteWrite): Promise<{ ok: true; revision: number } | { ok: false }>;
  /** 只有雲端修訂版等於 baseRevision 才寫入（compare-and-swap） */
  update(id: string, baseRevision: number, input: RemoteWrite): Promise<{ ok: true; revision: number } | { ok: false }>;
}

export interface RemoteWrite {
  id: string;
  title: string;
  data: TacticProject;
  deleted: boolean;
  operationId: string;
  deviceId: string;
}

export interface SyncSummary {
  pushed: number;
  pulled: string[];
  removed: string[];
  conflicts: number;
  pending: number;
}

export type ConflictChoice = 'local' | 'remote' | 'both';

function newOpId(): string {
  const r = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `op-${r}`;
}

/** 比較內容（忽略本機 revision／時間戳） */
export function sameContent(a: TacticProject | null | undefined, b: TacticProject | null | undefined): boolean {
  if (!a || !b) return false;
  const pick = (p: TacticProject) => JSON.stringify([p.title, p.court, p.teamSize, p.teams, p.players, p.steps]);
  return pick(a) === pick(b);
}

/**
 * 同步引擎
 * - 本機先寫入，操作進入佇列（離線也能用）
 * - 連線後 push：以雲端修訂版做 compare-and-swap；不符即為衝突，兩份都保留等老師選擇
 * - pull：雲端較新、且本機沒有待送出的修改時，才更新本機
 * - 每筆操作有唯一 operationId；重送時若雲端已套用同一 operationId，視為成功（冪等）
 */
export class SyncEngine {
  private running: Promise<SyncSummary> | null = null;

  constructor(
    private readonly local: LocalSyncStore,
    private readonly remote: RemoteProjectStore,
    private readonly deviceId: string,
  ) {}

  /** 本機存檔後呼叫：合併同一筆的舊操作，保留最早的基準修訂版 */
  async enqueue(entityId: string, kind: SyncOperation['kind']): Promise<void> {
    const ops = (await this.local.listOps()).filter((o) => o.entityId === entityId);
    const conflicted = ops.find((o) => o.syncStatus === 'conflict');
    const meta = await this.local.getSyncMeta(entityId);
    const first = ops[0];
    const base = first ? first.baseRevision : (meta?.remoteRevision ?? null);
    const prior = ops.flatMap((o) => [o.operationId, ...(o.priorOperationIds ?? [])]).slice(-20);
    await this.local.deleteOpsFor(entityId);
    await this.local.putOp({
      ...(prior.length ? { priorOperationIds: prior } : {}),
      operationId: newOpId(),
      deviceId: this.deviceId,
      entity: 'project',
      entityId,
      kind,
      baseRevision: base,
      // 已在衝突中的資料繼續等老師處理，不自動送出
      syncStatus: conflicted ? 'conflict' : 'pending',
      createdAt: new Date().toISOString(),
    });
  }

  async pendingCount(): Promise<number> {
    return (await this.local.listOps()).filter((o) => o.syncStatus === 'pending').length;
  }

  sync(): Promise<SyncSummary> {
    if (!this.running) {
      this.running = this.doSync().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async doSync(): Promise<SyncSummary> {
    const pushed = await this.push();
    const { pulled, removed } = await this.pull();
    return {
      pushed,
      pulled,
      removed,
      conflicts: (await this.local.listConflicts()).length,
      pending: await this.pendingCount(),
    };
  }

  private write(p: TacticProject, op: SyncOperation, deleted: boolean): RemoteWrite {
    return { id: p.id, title: p.title, data: p, deleted, operationId: op.operationId, deviceId: this.deviceId };
  }

  private async markSynced(entityId: string, revision: number): Promise<void> {
    await this.local.setSyncMeta({ entityId, remoteRevision: revision, syncedAt: new Date().toISOString() });
    await this.local.deleteOpsFor(entityId);
  }

  private async raiseConflict(op: SyncOperation, local: TacticProject | null, remote: RemoteRecord | null, reason: SyncConflict['reason']) {
    await this.local.putConflict({ entityId: op.entityId, local, remote, reason, detectedAt: new Date().toISOString() });
    await this.local.putOp({ ...op, syncStatus: 'conflict' });
  }

  async push(): Promise<number> {
    let pushed = 0;
    for (const op of await this.local.listOps()) {
      if (op.syncStatus !== 'pending') continue;
      const local = (await this.local.getProject(op.entityId)) ?? null;
      if (op.kind === 'upsert' && !local) {
        await this.local.deleteOpsFor(op.entityId);
        continue;
      }
      if (op.kind === 'delete' && op.baseRevision === null) {
        await this.local.deleteOpsFor(op.entityId); // 從未上傳過，直接丟棄
        continue;
      }
      const data = local ?? (await this.remote.get(op.entityId))?.data;
      if (!data) {
        await this.local.deleteOpsFor(op.entityId);
        continue;
      }
      const input = this.write(data, op, op.kind === 'delete');
      const res = op.baseRevision === null ? await this.remote.insert(input) : await this.remote.update(op.entityId, op.baseRevision, input);
      if (res.ok) {
        await this.markSynced(op.entityId, res.revision);
        pushed++;
        continue;
      }
      // 寫入失敗：先確認是不是上一次其實已成功（回應遺失後重送）
      const current = await this.remote.get(op.entityId);
      if (current && current.lastOperationId === op.operationId) {
        await this.markSynced(op.entityId, current.revision);
        pushed++;
        continue;
      }
      if (current?.lastOperationId && op.priorOperationIds?.includes(current.lastOperationId)) {
        // 之前合併掉的那次寫入其實已送達：以目前雲端版本為基準再送一次
        const retry = await this.remote.update(op.entityId, current.revision, input);
        if (retry.ok) {
          await this.markSynced(op.entityId, retry.revision);
          pushed++;
          continue;
        }
      }
      if (current && !current.deleted && op.kind === 'upsert' && sameContent(current.data, local)) {
        await this.markSynced(op.entityId, current.revision);
        continue;
      }
      if (current && current.deleted && op.kind === 'delete') {
        await this.markSynced(op.entityId, current.revision);
        continue;
      }
      const reason: SyncConflict['reason'] =
        op.baseRevision === null ? 'unsynced-duplicate' : current?.deleted ? 'remote-deleted' : op.kind === 'delete' ? 'local-deleted' : 'both-changed';
      await this.raiseConflict(op, local, current, reason);
    }
    return pushed;
  }

  async pull(): Promise<{ pulled: string[]; removed: string[] }> {
    const pulled: string[] = [];
    const removed: string[] = [];
    const ops = await this.local.listOps();
    const conflicts = new Set((await this.local.listConflicts()).map((c) => c.entityId));
    for (const r of await this.remote.list()) {
      if (conflicts.has(r.id) || ops.some((o) => o.entityId === r.id)) continue; // 本機有未送出的修改：交給 push 判斷
      const meta = await this.local.getSyncMeta(r.id);
      const local = await this.local.getProject(r.id);
      if (!meta) {
        if (r.deleted) continue;
        if (!local) {
          await this.local.putProjectRaw(r.data);
          await this.local.setSyncMeta({ entityId: r.id, remoteRevision: r.revision, syncedAt: new Date().toISOString() });
          pulled.push(r.id);
        } else if (sameContent(local, r.data)) {
          await this.local.setSyncMeta({ entityId: r.id, remoteRevision: r.revision, syncedAt: new Date().toISOString() });
        } else {
          await this.local.putConflict({ entityId: r.id, local, remote: r, reason: 'unsynced-duplicate', detectedAt: new Date().toISOString() });
        }
        continue;
      }
      if (r.revision <= meta.remoteRevision) continue;
      if (r.deleted) {
        await this.local.deleteProjectRaw(r.id);
        await this.local.deleteSyncMeta(r.id);
        removed.push(r.id);
      } else {
        await this.local.putProjectRaw(r.data);
        await this.local.setSyncMeta({ entityId: r.id, remoteRevision: r.revision, syncedAt: new Date().toISOString() });
        pulled.push(r.id);
      }
    }
    return { pulled, removed };
  }

  async listConflicts(): Promise<SyncConflict[]> {
    return this.local.listConflicts();
  }

  /**
   * 解決衝突
   *  local：以本機版本覆蓋雲端
   *  remote：改用雲端版本（本機修改捨棄）
   *  both：本機版本另存為新戰術，原 id 改用雲端版本
   * 回傳本機被替換或新增的戰術 id（介面需要重新載入）
   */
  async resolve(entityId: string, choice: ConflictChoice, makeCopyId: () => string = () => `proj-copy-${Date.now().toString(36)}`): Promise<{ changed: string[]; createdCopyId?: string }> {
    const conflict = (await this.local.listConflicts()).find((c) => c.entityId === entityId);
    if (!conflict) return { changed: [] };
    const current = await this.remote.get(entityId);
    const local = (await this.local.getProject(entityId)) ?? conflict.local;
    const changed: string[] = [];
    let createdCopyId: string | undefined;

    if (choice === 'local') {
      const op: SyncOperation = {
        operationId: newOpId(),
        deviceId: this.deviceId,
        entity: 'project',
        entityId,
        kind: local ? 'upsert' : 'delete',
        baseRevision: current?.revision ?? null,
        syncStatus: 'pending',
        createdAt: new Date().toISOString(),
      };
      await this.local.deleteOpsFor(entityId);
      await this.local.deleteConflict(entityId);
      await this.local.putOp(op);
      await this.push(); // 若雲端在這期間又被改，會產生新的衝突，不會覆寫
      return { changed };
    }

    if (choice === 'both' && local) {
      createdCopyId = makeCopyId();
      const copy: TacticProject = { ...local, id: createdCopyId, title: `${local.title}（本機副本）`, revision: 0 };
      await this.local.putProjectRaw(copy);
      await this.enqueue(createdCopyId, 'upsert');
      changed.push(createdCopyId);
    }

    // remote 或 both：原 id 改用雲端版本
    await this.local.deleteOpsFor(entityId);
    if (current && !current.deleted) {
      await this.local.putProjectRaw(current.data);
      await this.local.setSyncMeta({ entityId, remoteRevision: current.revision, syncedAt: new Date().toISOString() });
    } else {
      await this.local.deleteProjectRaw(entityId);
      if (current) await this.local.setSyncMeta({ entityId, remoteRevision: current.revision, syncedAt: new Date().toISOString() });
      else await this.local.deleteSyncMeta(entityId);
    }
    await this.local.deleteConflict(entityId);
    changed.push(entityId);
    if (createdCopyId) await this.push();
    return { changed, ...(createdCopyId ? { createdCopyId } : {}) };
  }
}

/** 測試與示範用的雲端（行為與 Supabase 的修訂版規則相同） */
export class InMemoryRemote implements RemoteProjectStore {
  rows = new Map<string, RemoteRecord>();
  /** 模擬網路中斷 */
  offline = false;
  /** 模擬「寫入成功但回應遺失」 */
  dropNextResponse = false;

  private check() {
    if (this.offline) throw new Error('network offline');
  }

  private respond<T>(v: T): T {
    if (this.dropNextResponse) {
      this.dropNextResponse = false;
      throw new Error('response lost');
    }
    return v;
  }

  async list(): Promise<RemoteRecord[]> {
    this.check();
    return [...this.rows.values()].map((r) => structuredClone(r));
  }

  async get(id: string): Promise<RemoteRecord | null> {
    this.check();
    const r = this.rows.get(id);
    return r ? structuredClone(r) : null;
  }

  async insert(w: RemoteWrite) {
    this.check();
    if (this.rows.has(w.id)) return { ok: false as const };
    this.rows.set(w.id, { id: w.id, title: w.title, data: structuredClone(w.data), revision: 1, lastOperationId: w.operationId, deleted: w.deleted, updatedAt: new Date().toISOString() });
    return this.respond({ ok: true as const, revision: 1 });
  }

  async update(id: string, base: number, w: RemoteWrite) {
    this.check();
    const r = this.rows.get(id);
    if (!r || r.revision !== base) return { ok: false as const };
    const revision = base + 1;
    this.rows.set(id, { ...r, title: w.title, data: structuredClone(w.data), revision, lastOperationId: w.operationId, deleted: w.deleted, updatedAt: new Date().toISOString() });
    return this.respond({ ok: true as const, revision });
  }
}
