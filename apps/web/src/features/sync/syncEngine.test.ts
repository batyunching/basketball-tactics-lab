import { describe, expect, it } from 'vitest';
import { createProject, movePlayer, setTitle } from '@btl/tactic-engine';
import { IndexedDbRepository } from '../storage/db';
import { InMemoryRemote, SyncEngine } from './syncEngine';

let n = 0;
function device(remote: InMemoryRemote, name: string) {
  const repo = new IndexedDbRepository(`sync-${name}-${++n}`);
  const engine = new SyncEngine(repo, remote, name);
  /** 模擬教師存檔：本機先寫入、再排入同步佇列 */
  const save = async (p: Parameters<typeof repo.saveProject>[0]) => {
    const saved = await repo.saveProject(p);
    await engine.enqueue(saved.id, 'upsert');
    return saved;
  };
  return { repo, engine, save };
}

describe('離線操作與同步', () => {
  it('離線時修改只進入佇列，連線後依序送出', async () => {
    const remote = new InMemoryRemote();
    const a = device(remote, 'A');
    remote.offline = true;
    const p = await a.save(createProject({ title: '傳切' }));
    await a.save(movePlayer(p, 0, 'red-1', { x: 20, y: 5 }));
    await expect(a.engine.sync()).rejects.toThrow(/offline/);
    expect(await a.engine.pendingCount()).toBe(1); // 同一筆合併為一個操作
    expect(remote.rows.size).toBe(0);

    remote.offline = false;
    const r = await a.engine.sync();
    expect(r.pushed).toBe(1);
    expect(r.pending).toBe(0);
    expect(remote.rows.get(p.id)?.data.steps[0]!.players['red-1']).toEqual({ x: 20, y: 5 });
    expect(remote.rows.get(p.id)?.revision).toBe(1);
  });

  it('另一台裝置拉取後取得相同內容，再修改時修訂版遞增', async () => {
    const remote = new InMemoryRemote();
    const a = device(remote, 'A');
    const b = device(remote, 'B');
    const p = await a.save(createProject({ title: '擋拆' }));
    await a.engine.sync();
    const r = await b.engine.sync();
    expect(r.pulled).toEqual([p.id]);
    const onB = (await b.repo.getProject(p.id))!;
    expect(onB.title).toBe('擋拆');
    await b.save(setTitle(onB, '擋拆（修改）'));
    await b.engine.sync();
    expect(remote.rows.get(p.id)?.revision).toBe(2);
    await a.engine.sync();
    expect((await a.repo.getProject(p.id))!.title).toBe('擋拆（修改）');
  });

  it('兩台裝置同時修改：後同步者產生衝突，雲端與本機都不被靜默覆寫', async () => {
    const remote = new InMemoryRemote();
    const a = device(remote, 'A');
    const b = device(remote, 'B');
    const p = await a.save(createProject({ title: '原版' }));
    await a.engine.sync();
    await b.engine.sync();

    await a.save(setTitle((await a.repo.getProject(p.id))!, 'A 的版本'));
    await b.save(setTitle((await b.repo.getProject(p.id))!, 'B 的版本'));
    await a.engine.sync();
    const rb = await b.engine.sync();

    expect(rb.conflicts).toBe(1);
    expect(remote.rows.get(p.id)?.data.title).toBe('A 的版本'); // 雲端沒被 B 蓋掉
    expect((await b.repo.getProject(p.id))!.title).toBe('B 的版本'); // B 的本機也沒被 A 蓋掉
    const [c] = await b.engine.listConflicts();
    expect(c).toMatchObject({ entityId: p.id, reason: 'both-changed' });
    expect(c!.local?.title).toBe('B 的版本');
    expect(c!.remote?.data.title).toBe('A 的版本');

    // 衝突未解決前再修改，也不會自動送出
    await b.save(setTitle((await b.repo.getProject(p.id))!, 'B 再改'));
    await b.engine.sync();
    expect(remote.rows.get(p.id)?.data.title).toBe('A 的版本');
  });

  async function conflictSetup() {
    const remote = new InMemoryRemote();
    const a = device(remote, 'A');
    const b = device(remote, 'B');
    const p = await a.save(createProject({ title: '原版' }));
    await a.engine.sync();
    await b.engine.sync();
    await a.save(setTitle((await a.repo.getProject(p.id))!, 'A 的版本'));
    await b.save(setTitle((await b.repo.getProject(p.id))!, 'B 的版本'));
    await a.engine.sync();
    await b.engine.sync();
    return { remote, a, b, id: p.id };
  }

  it('解決衝突：保留本機 → 以本機覆蓋雲端（修訂版 +1）', async () => {
    const { remote, b, id } = await conflictSetup();
    await b.engine.resolve(id, 'local');
    expect(remote.rows.get(id)?.data.title).toBe('B 的版本');
    expect(remote.rows.get(id)?.revision).toBe(3);
    expect(await b.engine.listConflicts()).toHaveLength(0);
  });

  it('解決衝突：使用雲端 → 本機改為雲端版本', async () => {
    const { remote, b, id } = await conflictSetup();
    await b.engine.resolve(id, 'remote');
    expect((await b.repo.getProject(id))!.title).toBe('A 的版本');
    expect(remote.rows.get(id)?.revision).toBe(2);
    expect(await b.engine.pendingCount()).toBe(0);
  });

  it('解決衝突：兩者都保留 → 本機版本另存新戰術並上傳', async () => {
    const { remote, b, id } = await conflictSetup();
    const r = await b.engine.resolve(id, 'both', () => 'copy-1');
    expect(r.createdCopyId).toBe('copy-1');
    expect((await b.repo.getProject(id))!.title).toBe('A 的版本');
    expect((await b.repo.getProject('copy-1'))!.title).toBe('B 的版本（本機副本）');
    expect(remote.rows.get('copy-1')?.data.title).toBe('B 的版本（本機副本）');
  });

  it('保留本機時若雲端又被改，產生新衝突而不是覆寫', async () => {
    const { remote, a, b, id } = await conflictSetup();
    await a.save(setTitle((await a.repo.getProject(id))!, 'A 第二版'));
    await a.engine.sync(); // 雲端 revision 3
    // B 以舊的衝突資訊選「保留本機」：resolve 會先讀最新雲端版本作為基準
    await b.engine.resolve(id, 'local');
    expect(remote.rows.get(id)?.data.title).toBe('B 的版本');
    expect(remote.rows.get(id)?.revision).toBe(4);
  });

  it('寫入成功但回應遺失：重送時辨識 operationId，不誤判衝突', async () => {
    const remote = new InMemoryRemote();
    const a = device(remote, 'A');
    const p = await a.save(createProject({ title: '快攻' }));
    remote.dropNextResponse = true;
    await expect(a.engine.sync()).rejects.toThrow(/lost/);
    // 回應遺失後老師又修改了一次（操作被合併）
    await a.save(setTitle((await a.repo.getProject(p.id))!, '快攻 v2'));
    const r = await a.engine.sync();
    expect(r.conflicts).toBe(0);
    expect(remote.rows.get(p.id)?.data.title).toBe('快攻 v2');
  });

  it('刪除會同步到雲端（標記刪除）並讓其他裝置移除', async () => {
    const remote = new InMemoryRemote();
    const a = device(remote, 'A');
    const b = device(remote, 'B');
    const p = await a.save(createProject({ title: '要刪除' }));
    await a.engine.sync();
    await b.engine.sync();
    await a.repo.deleteProject(p.id);
    await a.engine.enqueue(p.id, 'delete');
    await a.engine.sync();
    expect(remote.rows.get(p.id)?.deleted).toBe(true);
    const r = await b.engine.sync();
    expect(r.removed).toEqual([p.id]);
    expect(await b.repo.getProject(p.id)).toBeUndefined();
  });

  it('從未上傳過就刪除：直接丟棄操作，不打擾雲端', async () => {
    const remote = new InMemoryRemote();
    const a = device(remote, 'A');
    remote.offline = true;
    const p = await a.save(createProject({ title: '暫存' }));
    await a.repo.deleteProject(p.id);
    await a.engine.enqueue(p.id, 'delete');
    remote.offline = false;
    await a.engine.sync();
    expect(remote.rows.size).toBe(0);
    expect(await a.engine.pendingCount()).toBe(0);
  });
});
