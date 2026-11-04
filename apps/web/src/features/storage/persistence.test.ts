import { beforeEach, describe, expect, it } from 'vitest';
import { createBuiltInFormations, movePlayer } from '@btl/tactic-engine';
import { useStore } from '../../app/store';
import { IndexedDbRepository } from './db';
import { bootstrap, flushSave, importJsonText, resetPersistenceForTests, setRepository } from './persistence';
import { buildExportBundle } from '@btl/data-schemas';

let n = 0;
beforeEach(() => {
  setRepository(new IndexedDbRepository(`test-db-${++n}`));
  resetPersistenceForTests();
});

describe('IndexedDB 自動儲存', () => {
  it('首次啟動建立專案與內建五組隊形', async () => {
    await bootstrap();
    const s = useStore.getState();
    expect(s.formations).toHaveLength(5);
    expect(s.history.present.title).toBe('我的第一個戰術');
    expect(s.saveStatus).toBe('saved');
  });

  it('修改後重新啟動（模擬重新整理）可以恢復', async () => {
    const name = `test-db-${++n}`;
    setRepository(new IndexedDbRepository(name));
    resetPersistenceForTests();
    await bootstrap();
    useStore.getState().commit((p) => movePlayer(p, 0, 'red-1', { x: 21.5, y: 4.25 }));
    await flushSave();
    const id = useStore.getState().history.present.id;

    // 模擬重新整理：新的儲存連線、清空記憶體狀態
    useStore.setState({ formations: [] });
    setRepository(new IndexedDbRepository(name));
    resetPersistenceForTests();
    await bootstrap();
    const s = useStore.getState();
    expect(s.history.present.id).toBe(id);
    expect(s.history.present.steps[0]!.players['red-1']).toEqual({ x: 21.5, y: 4.25 });
    expect(s.history.present.revision).toBeGreaterThan(1);
  });

  it('匯入 JSON 會成為新專案，不覆蓋目前專案', async () => {
    await bootstrap();
    const original = useStore.getState().history.present;
    const text = JSON.stringify(buildExportBundle(original, createBuiltInFormations()));
    const r = await importJsonText(text);
    expect(r.ok).toBe(true);
    const now = useStore.getState().history.present;
    expect(now.id).not.toBe(original.id);
    expect(now.title).toContain('匯入');
    expect(now.steps).toEqual(original.steps);
  });

  it('匯入壞檔案回報錯誤', async () => {
    await bootstrap();
    const r = await importJsonText('{"format":"x"}');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/匯入失敗/);
  });
});
