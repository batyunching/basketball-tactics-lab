import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 4 端到端：影片 → 教師標記球權/出手 → 規則式 AI 分析 → 教師審核/修改
 * → 轉成學生教材 → 發布本機連結 → 學生作答；以及竄改連結、刪除影片/教材的清除。
 * 球員軌跡用「人工關鍵影格」直接寫入（與 tactic-ai 單元測試的傳切情境相同，時間 +2 秒），
 * 只驗證流程，不代表真實影片辨識準確度。
 */
const FIX = join(import.meta.dirname, 'fixtures');
const OFF = 2000;
type Key = [number, number, number];
const PATHS: Record<string, Key[]> = {
  'red-1': [[0, 19.7, 7.5], [1200, 19.7, 7.5], [2600, 26.0, 6.6], [3400, 26.3, 7.0], [4000, 26.3, 7.0]],
  'red-2': [[0, 22.5, 2.0], [4000, 22.5, 2.0]],
  'red-3': [[0, 22.5, 13.0], [4000, 22.5, 13.0]],
  'blue-1': [[0, 20.9, 7.4], [1200, 20.9, 7.0], [2600, 24.2, 6.3], [4000, 25.2, 6.8]],
  'blue-2': [[0, 23.4, 2.8], [4000, 23.4, 2.8]],
  'blue-3': [[0, 23.4, 12.2], [4000, 23.4, 12.2]],
};
function at(keys: Key[], t: number) {
  if (t <= keys[0]![0]) return { x: keys[0]![1], y: keys[0]![2] };
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (t <= b[0]) {
      const k = (t - a[0]) / (b[0] - a[0]);
      return { x: a[1] + (b[1] - a[1]) * k, y: a[2] + (b[2] - a[2]) * k };
    }
  }
  const l = keys[keys.length - 1]!;
  return { x: l[1], y: l[2] };
}
const KF_TIMES = [0, 1200, 1900, 2600, 3400, 4000];
const keyframes = [
  { id: 'kf-pre', timeMs: 0, players: Object.fromEntries(Object.entries(PATHS).map(([id, k]) => [id, at(k, 0)])) },
  ...KF_TIMES.map((t) => ({ id: `kf-${t}`, timeMs: t + OFF, players: Object.fromEntries(Object.entries(PATHS).map(([id, k]) => [id, at(k, t)])) })),
  { id: 'kf-end', timeMs: 12_000, players: Object.fromEntries(Object.entries(PATHS).map(([id, k]) => [id, at(k, 4000)])) },
];

async function idb<T>(page: Page, fn: string, arg?: unknown): Promise<T> {
  return page.evaluate(
    async ([body, a]) => {
      const req = indexedDB.open('basketball-tactics-lab');
      const db: IDBDatabase = await new Promise((r) => (req.onsuccess = () => r(req.result)));
      const all = (store: string) =>
        new Promise<any[]>((r) => {
          const q = db.transaction(store).objectStore(store).getAll();
          q.onsuccess = () => r(q.result);
        });
      const put = (store: string, v: unknown) =>
        new Promise<void>((r) => {
          const tx = db.transaction(store, 'readwrite');
          tx.objectStore(store).put(v);
          tx.oncomplete = () => r();
        });
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const out = await new Function('all', 'put', 'arg', `return (async () => { ${body} })()`)(all, put, a);
      db.close();
      return out;
    },
    [fn, arg] as const,
  ) as Promise<T>;
}

async function seedClip(page: Page) {
  await page.goto('/#/video');
  await page.getByTestId('video-consent').check();
  await page.getByTestId('video-file').setInputFiles(join(FIX, 'test-3v3.webm'));
  await expect(page.getByTestId('video-workspace')).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => idb<number>(page, `return (await all('analyses')).length`)).toBe(1);
  await idb(page, `const a = (await all('analyses'))[0]; a.keyframes = arg; await put('analyses', a);`, keyframes);
  await page.reload();
  await expect(page.getByTestId('video-workspace')).toBeVisible();
}

async function markAt(page: Page, ms: number, fn: () => Promise<void>) {
  await page.getByTestId('video-scrub').fill(String(ms));
  await expect(page.getByTestId('video-time')).not.toHaveText('');
  await fn();
}

test.describe.configure({ mode: 'serial' });

test('教師確認球權與得分 → AI 分析 → 審核修改 → 轉成教材 → 發布 → 學生作答', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await seedClip(page);
  await page.getByTestId('vstep-7').click();

  // 尚未標記球權就分析：AI 明確說無法確認，不會猜傳球/得分
  await page.getByTestId('ai-run').click();
  await expect(page.getByTestId('ai-notes')).toContainText('尚未標記球權');
  await expect(page.getByTestId('ai-event-pass')).toHaveCount(0);
  await expect(page.getByTestId('ai-scoring-key')).toHaveCount(0);

  // 教師標記：紅1 持球 → 紅2 → 紅1，紅1 出手進球
  await markAt(page, OFF, async () => {
    await page.getByTestId('ai-holder').selectOption('red-1');
    await page.getByTestId('ai-add-possession').click();
  });
  await markAt(page, OFF + 1000, async () => {
    await page.getByTestId('ai-holder').selectOption('red-2');
    await page.getByTestId('ai-add-possession').click();
  });
  await markAt(page, OFF + 2800, async () => {
    await page.getByTestId('ai-holder').selectOption('red-1');
    await page.getByTestId('ai-add-possession').click();
  });
  await markAt(page, OFF + 3400, async () => {
    await page.getByTestId('ai-shooter').selectOption('red-1');
    await page.getByTestId('ai-add-shot').click();
  });
  await expect(page.getByTestId('ai-marks').locator('li')).toHaveCount(4);

  await page.getByTestId('ai-run').click();
  await expect(page.getByTestId('ai-event-pass')).toHaveCount(2);
  await expect(page.getByTestId('ai-event-cut')).toHaveCount(1);
  await expect(page.getByTestId('ai-scoring-key')).toContainText('紅1');
  const cut = page.getByTestId('ai-event-cut');
  for (const label of ['可見證據', '戰術推論', '教學建議', '信心']) await expect(cut).toContainText(label);
  await expect(cut).toContainText('紅1');

  // 教師修改空切的推論，並確認所有可確認的事件
  await cut.getByTestId('ai-edit').click();
  await cut.getByTestId('ai-edit-inference').fill('紅1 傳球後立刻往籃下空切（教師修改）');
  await cut.getByTestId('ai-edit-save').click();
  await expect(cut).toContainText('已修改');
  const cards = page.getByTestId('ai-events').locator('li.ai-event');
  const n = await cards.count();
  for (let i = 0; i < n; i++) {
    const btn = cards.nth(i).getByTestId('ai-confirm');
    if (await btn.isEnabled()) await btn.click();
  }
  // 否決一個（若有協防/掩護等誤報就否決第一個非傳切事件；否則不動）
  await expect(page.getByTestId('ai-quality')).toContainText('已審核');

  // 手動補一個 AI 漏掉的事件
  await page.getByTestId('ai-add-manual').click();
  await page.getByTestId('ai-manual-inference').fill('紅3 留在弱邊拉開空間');
  await page.getByTestId('ai-manual-save').click();
  await expect(page.getByTestId('ai-events')).toContainText('教師新增');

  // 重新整理：分析與審核結果都保存在本機
  await page.waitForTimeout(600);
  await page.reload();
  await page.getByTestId('vstep-7').click();
  const aiCut = page.getByTestId('ai-event-cut').filter({ hasNotText: '教師新增' });
  await expect(aiCut).toHaveAttribute('data-status', 'confirmed');
  await expect(aiCut).toContainText('教師修改');

  // 轉成教材
  await page.getByTestId('ai-lesson-title').fill('E2E 傳切教材');
  await page.getByTestId('ai-to-lesson').click();
  await expect(page).toHaveURL(/#\/lessons\/video-/);
  await expect(page.locator('body')).toContainText('E2E 傳切教材');
  await expect(page.locator('body')).toContainText('跑位預測');

  // 教材庫列出；教材不含影片追蹤原始資料
  await page.goto('/#/lessons');
  await expect(page.getByTestId('custom-lessons')).toContainText('E2E 傳切教材');
  const stored = await idb<any[]>(page, `return all('customLessons')`);
  const raw = JSON.stringify(stored[0]);
  for (const k of ['trackId', 'detectionConfidence', '"box"', 'insufficientReason']) expect(raw).not.toContain(k);
  expect(raw).toContain('教師修改');

  // 發布本機連結（教材內容壓縮在連結內）
  await page.getByTestId('custom-lessons').getByRole('button', { name: /發布/ }).first().click();
  await page.getByTestId('asg-title').fill('803 傳切');
  await page.getByTestId('asg-publish').click();
  await expect(page.getByTestId('share-link')).toHaveValue(/#\/p\/custom.*d=/);
  const link = await page.getByTestId('share-link').inputValue();
  expect(link).toContain('#/p/custom');
  expect(link).toContain('d=');

  // 學生在另一台裝置開啟（沒有這份教材的本機資料）
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const stu = await ctx.newPage();
  await stu.goto(link);
  await stu.getByTestId('stu-class').fill('803');
  await stu.getByTestId('stu-seat').fill('5');
  await stu.getByTestId('stu-name').fill('林同學');
  await stu.getByTestId('stu-start').click();
  await expect(stu.getByTestId('student-page')).toBeVisible();
  await expect(stu.getByTestId('student-page')).toContainText('E2E 傳切教材');
  let answered = false;
  for (let i = 1; i <= 6 && !answered; i++) {
    const tab = stu.getByTestId(`stu-tab-${i}`);
    if (!(await tab.count())) break;
    await tab.click();
    if (await stu.getByText('這時最好的傳球對象是誰').count()) {
      await stu.getByRole('button', { name: '紅2', exact: true }).or(stu.getByLabel('紅2', { exact: true })).or(stu.getByText('紅2', { exact: true })).first().click();
      await stu.getByTestId('check-answer').click();
      await expect(stu.getByTestId('challenge-result')).toContainText('答對了');
      answered = true;
    }
  }
  expect(answered).toBe(true);

  // 竄改連結內容 → 拒絕
  const bad = link.replace(/d=([A-Za-z0-9_-]{20})/, (_m, s: string) => `d=${s.split('').reverse().join('')}`);
  const stu2 = await ctx.newPage();
  await stu2.goto(bad);
  await expect(stu2.getByTestId('student-error')).toContainText('教材資料無法驗證');
  await ctx.close();

  // 刪除：自訂教材、影片（連同 AI 分析）
  await page.goto('/#/lessons');
  await expect.poll(() => idb<number>(page, `return (await all('aiStates')).length`)).toBeGreaterThan(0);

  await page.getByTestId('custom-lesson-delete').first().click();
  await page.getByTestId('custom-lesson-delete').first().click();
  await expect.poll(() => idb<number>(page, `return (await all('customLessons')).length`)).toBe(0);

  await page.goto('/#/video');
  await page.getByTestId('video-delete').first().click();
  await page.getByTestId('video-delete').first().click();
  await expect(page.getByTestId('video-list')).toHaveCount(0);
  await expect.poll(() => idb<number>(page, `return (await all('aiStates')).length`)).toBe(0);
  await expect.poll(() => idb<number>(page, `return (await all('analyses')).length`)).toBe(0);
});
