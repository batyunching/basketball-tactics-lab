import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Assignment, Attempt, Formation, TacticProject } from '@btl/shared-types';
import type { VideoAnalysis, VideoAsset } from '@btl/video-engine';

/**
 * 可替換的儲存介面：本機為 IndexedDB 實作；雲端同步由 SyncEngine 透過
 * LocalSyncStore（本機）＋ RemoteProjectStore（Supabase）完成。
 */
export interface ProjectSummary {
  id: string;
  title: string;
  updatedAt: string;
  revision: number;
  courtMode: TacticProject['court']['mode'];
  teamSize: number;
  stepCount: number;
}

export interface TacticRepository {
  listProjects(): Promise<ProjectSummary[]>;
  getProject(id: string): Promise<TacticProject | undefined>;
  /** 寫入並由儲存層遞增 revision，回傳實際保存的版本 */
  saveProject(project: TacticProject): Promise<TacticProject>;
  deleteProject(id: string): Promise<void>;
  listFormations(): Promise<Formation[]>;
  replaceFormations(list: Formation[]): Promise<void>;
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta<T>(key: string, value: T): Promise<void>;
}

/** 待同步操作（離線時累積，連線後依序送出） */
export interface SyncOperation {
  operationId: string;
  deviceId: string;
  entity: 'project';
  entityId: string;
  kind: 'upsert' | 'delete';
  /** 送出時預期的雲端修訂版；null = 雲端還沒有這筆 */
  baseRevision: number | null;
  syncStatus: 'pending' | 'conflict';
  createdAt: string;
  /** 被合併掉的舊操作 id：用來辨識「之前其實已送達」的寫入 */
  priorOperationIds?: string[];
}

/** 本機記住「上次同步時雲端的修訂版」 */
export interface SyncMeta {
  entityId: string;
  remoteRevision: number;
  syncedAt: string;
}

export interface RemoteRecord {
  id: string;
  title: string;
  data: TacticProject;
  revision: number;
  lastOperationId: string | null;
  deleted: boolean;
  updatedAt: string;
}

/** 同步衝突：兩份都保留，等老師選擇（不靜默覆寫） */
export interface SyncConflict {
  entityId: string;
  local: TacticProject | null;
  remote: RemoteRecord | null;
  reason: 'both-changed' | 'remote-deleted' | 'local-deleted' | 'unsynced-duplicate';
  detectedAt: string;
}

export interface LocalSyncStore {
  getProject(id: string): Promise<TacticProject | undefined>;
  /** 寫入雲端版本（不遞增本機 revision、不觸發同步） */
  putProjectRaw(p: TacticProject): Promise<void>;
  deleteProjectRaw(id: string): Promise<void>;
  listOps(): Promise<SyncOperation[]>;
  putOp(op: SyncOperation): Promise<void>;
  deleteOpsFor(entityId: string): Promise<void>;
  getSyncMeta(id: string): Promise<SyncMeta | undefined>;
  setSyncMeta(m: SyncMeta): Promise<void>;
  deleteSyncMeta(id: string): Promise<void>;
  listConflicts(): Promise<SyncConflict[]>;
  putConflict(c: SyncConflict): Promise<void>;
  deleteConflict(id: string): Promise<void>;
}

interface BtlDB extends DBSchema {
  projects: { key: string; value: TacticProject; indexes: { updatedAt: string } };
  formations: { key: string; value: Formation };
  meta: { key: string; value: unknown };
  syncQueue: { key: string; value: SyncOperation };
  syncMeta: { key: string; value: SyncMeta };
  conflicts: { key: string; value: SyncConflict };
  attempts: { key: string; value: Attempt; indexes: { assignmentCode: string } };
  assignments: { key: string; value: Assignment };
  /** Phase 3：影片只存在這台電腦（學生影片預設私人） */
  videos: { key: string; value: VideoAsset };
  videoBlobs: { key: string; value: Blob };
  analyses: { key: string; value: VideoAnalysis };
}

export const DB_NAME = 'basketball-tactics-lab';
export const DB_VERSION = 3;

export class IndexedDbRepository implements TacticRepository, LocalSyncStore {
  private dbp: Promise<IDBPDatabase<BtlDB>> | null = null;

  constructor(private readonly name = DB_NAME) {}

  private db(): Promise<IDBPDatabase<BtlDB>> {
    if (!this.dbp) {
      this.dbp = openDB<BtlDB>(this.name, DB_VERSION, {
        upgrade(db, oldVersion) {
          if (oldVersion < 1) {
            const projects = db.createObjectStore('projects', { keyPath: 'id' });
            projects.createIndex('updatedAt', 'updatedAt');
            db.createObjectStore('formations', { keyPath: 'id' });
            db.createObjectStore('meta');
            db.createObjectStore('syncQueue', { keyPath: 'operationId' });
          }
          if (oldVersion < 2) {
            db.createObjectStore('syncMeta', { keyPath: 'entityId' });
            db.createObjectStore('conflicts', { keyPath: 'entityId' });
            const attempts = db.createObjectStore('attempts', { keyPath: 'id' });
            attempts.createIndex('assignmentCode', 'assignmentCode');
            db.createObjectStore('assignments', { keyPath: 'id' });
          }
          if (oldVersion < 3) {
            db.createObjectStore('videos', { keyPath: 'id' });
            db.createObjectStore('videoBlobs');
            db.createObjectStore('analyses', { keyPath: 'videoId' });
          }
        },
      });
    }
    return this.dbp;
  }

  // ─────────── 戰術 ───────────
  async listProjects(): Promise<ProjectSummary[]> {
    const all = await (await this.db()).getAll('projects');
    return all
      .map((p) => ({
        id: p.id,
        title: p.title,
        updatedAt: p.updatedAt,
        revision: p.revision,
        courtMode: p.court.mode,
        teamSize: p.teamSize,
        stepCount: p.steps.length,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getProject(id: string): Promise<TacticProject | undefined> {
    return (await this.db()).get('projects', id);
  }

  async saveProject(project: TacticProject): Promise<TacticProject> {
    const db = await this.db();
    const tx = db.transaction('projects', 'readwrite');
    const existing = await tx.store.get(project.id);
    const saved: TacticProject = {
      ...project,
      revision: Math.max(existing?.revision ?? 0, project.revision) + 1,
      updatedAt: new Date().toISOString(),
    };
    await tx.store.put(saved);
    await tx.done;
    return saved;
  }

  async deleteProject(id: string): Promise<void> {
    await (await this.db()).delete('projects', id);
  }

  async putProjectRaw(p: TacticProject): Promise<void> {
    await (await this.db()).put('projects', p);
  }

  async deleteProjectRaw(id: string): Promise<void> {
    await (await this.db()).delete('projects', id);
  }

  // ─────────── 隊形、偏好 ───────────
  async listFormations(): Promise<Formation[]> {
    const list = await (await this.db()).getAll('formations');
    return list.sort((a, b) => a.order - b.order);
  }

  async replaceFormations(list: Formation[]): Promise<void> {
    const db = await this.db();
    const tx = db.transaction('formations', 'readwrite');
    await tx.store.clear();
    for (const f of list) await tx.store.put(f);
    await tx.done;
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await (await this.db()).get('meta', key)) as T | undefined;
  }

  async setMeta<T>(key: string, value: T): Promise<void> {
    await (await this.db()).put('meta', value, key);
  }

  // ─────────── 同步佇列 ───────────
  async listOps(): Promise<SyncOperation[]> {
    const ops = await (await this.db()).getAll('syncQueue');
    return ops.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async putOp(op: SyncOperation): Promise<void> {
    await (await this.db()).put('syncQueue', op);
  }

  async deleteOpsFor(entityId: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction('syncQueue', 'readwrite');
    for (const op of await tx.store.getAll()) if (op.entityId === entityId) await tx.store.delete(op.operationId);
    await tx.done;
  }

  async getSyncMeta(id: string): Promise<SyncMeta | undefined> {
    return (await this.db()).get('syncMeta', id);
  }

  async setSyncMeta(m: SyncMeta): Promise<void> {
    await (await this.db()).put('syncMeta', m);
  }

  async deleteSyncMeta(id: string): Promise<void> {
    await (await this.db()).delete('syncMeta', id);
  }

  async listConflicts(): Promise<SyncConflict[]> {
    return (await this.db()).getAll('conflicts');
  }

  async putConflict(c: SyncConflict): Promise<void> {
    await (await this.db()).put('conflicts', c);
  }

  async deleteConflict(id: string): Promise<void> {
    await (await this.db()).delete('conflicts', id);
  }

  // ─────────── 本機任務與作答（未設定雲端時使用） ───────────
  async listAttempts(): Promise<Attempt[]> {
    const list = await (await this.db()).getAll('attempts');
    return list.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  }

  async putAttempt(a: Attempt): Promise<void> {
    await (await this.db()).put('attempts', a);
  }

  async deleteAttempt(id: string): Promise<void> {
    await (await this.db()).delete('attempts', id);
  }

  async listLocalAssignments(): Promise<Assignment[]> {
    const list = await (await this.db()).getAll('assignments');
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async putLocalAssignment(a: Assignment): Promise<void> {
    await (await this.db()).put('assignments', a);
  }

  async deleteLocalAssignment(id: string): Promise<void> {
    await (await this.db()).delete('assignments', id);
  }

  // ─────────── 影片（Phase 3） ───────────
  async listVideos(): Promise<VideoAsset[]> {
    const list = await (await this.db()).getAll('videos');
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getVideo(id: string): Promise<VideoAsset | undefined> {
    return (await this.db()).get('videos', id);
  }

  async getVideoBlob(id: string): Promise<Blob | undefined> {
    return (await this.db()).get('videoBlobs', id);
  }

  async saveVideo(meta: VideoAsset, blob?: Blob): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(['videos', 'videoBlobs'], 'readwrite');
    await tx.objectStore('videos').put(meta);
    if (blob) await tx.objectStore('videoBlobs').put(blob, meta.id);
    await tx.done;
  }

  /** 刪除影片、影片檔、追蹤軌跡與分析結果 */
  async deleteVideo(id: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(['videos', 'videoBlobs', 'analyses'], 'readwrite');
    await tx.objectStore('videos').delete(id);
    await tx.objectStore('videoBlobs').delete(id);
    await tx.objectStore('analyses').delete(id);
    await tx.done;
  }

  async getAnalysis(videoId: string): Promise<VideoAnalysis | undefined> {
    return (await this.db()).get('analyses', videoId);
  }

  async saveAnalysis(a: VideoAnalysis): Promise<void> {
    await (await this.db()).put('analyses', { ...a, updatedAt: new Date().toISOString() });
  }

  async deleteAnalysis(videoId: string): Promise<void> {
    await (await this.db()).delete('analyses', videoId);
  }
}

export const repository = new IndexedDbRepository();
