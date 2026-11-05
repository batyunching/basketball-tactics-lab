import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * 籃球追蹤端到端：示範短片（程式繪製）＝ 紅1 上籃進球 ＋ 紅3 三分沒進。
 * 校正 → 標記籃框 → 自動追蹤（球員＋籃球）→ 指派背號 → 檢查持球、出手、進球判定
 * → 影片疊圖 → ⑦ 匯入成待確認標記 → 確認 → AI 分析使用。
 */
const FIX = join(import.meta.dirname, 'fixtures');
const meta = JSON.parse(readFileSync(join(FIX, 'ball-meta.json'), 'utf8')) as {
  landmarks: Record<string, [number, number]>;
  hoop: { x: number; y: number; w: number };
  paths: Record<string, [number, number, number][]>;
};

async function overlayPoint(page: Page, x: number, y: number) {
  return page.getByTestId('video-overlay').evaluate(
    (svg, [px, py]) => {
      const q = new DOMPoint(px!, py!).matrixTransform((svg as SVGSVGElement).getScreenCTM()!);
      return { x: q.x, y: q.y };
    },
    [x, y],
  );
}

async function readAnalysis(page: Page): Promise<any> {
  return page.evaluate(async () => {
    const req = indexedDB.open('basketball-tactics-lab');
    const db: IDBDatabase = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    const all: any[] = await new Promise((r) => {
      const q = db.transaction('analyses').objectStore('analyses').getAll();
      q.onsuccess = () => r(q.result);
    });
    db.close();
    return all[all.length - 1];
  });
}

test('籃球偵測、持球、出手與進球判定，匯入 AI 分析', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', '真實模型推論較久，只在桌機專案跑一次');
  test.setTimeout(600_000);
  await page.goto('/#/video');
  await page.getByTestId('video-consent').check();
  await page.getByTestId('video-file').setInputFiles(join(FIX, 'ball-3v3.webm'));
  await expect(page.getByTestId('video-workspace')).toBeVisible({ timeout: 15_000 });

  // ② 校正＋標記籃框
  await page.getByTestId('vstep-2').click();
  for (const [id, [x, y]] of Object.entries(meta.landmarks)) {
    await page.getByTestId(`lm-${id}`).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    const q = await overlayPoint(page, x, y);
    await page.mouse.click(q.x, q.y);
  }
  await expect(page.getByTestId('cal-status')).toContainText('準確');
  await page.getByTestId('hoop-pick').click();
  await page.evaluate(() => window.scrollTo(0, 0));
  const h = await overlayPoint(page, meta.hoop.x, meta.hoop.y);
  await page.mouse.click(h.x, h.y);
  await expect(page.getByTestId('hoop-status')).toContainText('已標記籃框');
  await expect(page.getByTestId('hoop-mark')).toBeVisible();

  // ③ 自動追蹤（含籃球）
  await page.getByTestId('vstep-3').click();
  await expect(page.getByTestId('track-ball')).toBeChecked();
  await page.getByTestId('track-fps').selectOption('5');
  await page.getByTestId('track-run').click();
  await expect(page.getByTestId('track-table')).toBeVisible({ timeout: 540_000 });

  // ④ 依真實路徑把每條軌跡指派給最近的球員（模擬老師看背號指派）
  await expect.poll(async () => (await readAnalysis(page)).tracks.length, { timeout: 10_000 }).toBeGreaterThan(0);
  const a0 = await readAnalysis(page);
  for (const tr of a0.tracks as any[]) {
    const pts = tr.points.filter((p: any) => p.court && p.source === 'observed');
    if (pts.length < 3) continue;
    let best = '';
    let bestD = Infinity;
    for (const [pid, keys] of Object.entries(meta.paths)) {
      const at = (t: number) => {
        if (t <= keys[0]![0]) return keys[0]!;
        for (let i = 0; i < keys.length - 1; i++) if (t <= keys[i + 1]![0]) {
          const [t0, x0, y0] = keys[i]!;
          const [t1, x1, y1] = keys[i + 1]!;
          const k = (t - t0) / (t1 - t0);
          return [t, x0 + (x1 - x0) * k, y0 + (y1 - y0) * k];
        }
        return keys[keys.length - 1]!;
      };
      const d = pts.reduce((s: number, p: any) => {
        const q = at(p.timeMs / 1000);
        return s + Math.hypot(q[1]! - p.court.x, q[2]! - p.court.y);
      }, 0) / pts.length;
      if (d < bestD) {
        bestD = d;
        best = pid;
      }
    }
    if (bestD < 2.5) await page.getByLabel(`${tr.trackId} 指派給`).selectOption(best);
  }

  // ③ 籃球結果：2 次出手（進、沒進），出手者為紅1、紅3
  await page.getByTestId('vstep-3').click();
  const summary = page.getByTestId('ball-summary');
  await expect(summary).toBeVisible();
  const coverage = Number((await page.getByTestId('ball-coverage').innerText()).replace('%', ''));
  expect(coverage).toBeGreaterThanOrEqual(70);
  await expect(page.getByTestId('ball-shot-count')).toHaveText('2');
  const shots = page.getByTestId('ball-shots').locator('li');
  await expect(shots.nth(0)).toHaveAttribute('data-result', 'made');
  await expect(shots.nth(0)).toContainText('紅1');
  await expect(shots.nth(1)).toHaveAttribute('data-result', 'missed');
  await expect(shots.nth(1)).toContainText('紅3');

  // 球的位置精度：與真實位置相差不到 1.5 個球的直徑（看得到的點）
  const a1 = await readAnalysis(page);
  expect(a1.ball.frames.length).toBeGreaterThan(100);

  // 影片疊圖：球圈、進球文字
  await page.getByTestId('video-scrub').fill('5900');
  await expect(page.getByTestId('ball-now')).toBeVisible();
  await expect(page.getByTestId('shot-label')).toHaveText('進球！');
  await page.getByTestId('video-scrub').fill('9800');
  await expect(page.getByTestId('shot-label')).toHaveText('沒進');
  // 虛擬球場的持球者來自籃球追蹤（4.0 秒時紅2 持球）
  await page.getByTestId('vstep-6').click();
  await page.getByTestId('video-scrub').fill('4000');
  await expect(page.getByTestId('video-court')).toHaveAttribute('data-holder', 'red-2');

  // ⑦ 匯入成待確認標記 → 確認 → AI 分析
  await page.getByTestId('vstep-7').click();
  await page.getByTestId('ai-import-ball').click();
  const marks = page.getByTestId('ai-marks').locator('li');
  await expect.poll(() => marks.count()).toBeGreaterThanOrEqual(5);
  await expect(page.getByTestId('ai-marks')).toContainText('系統偵測');
  const results = page.getByTestId('ai-shot-result');
  await expect(results).toHaveCount(2);
  await expect(results.nth(0)).toHaveValue('made');
  await expect(results.nth(1)).toHaveValue('missed');
  // 未確認前：AI 不採用
  await page.getByTestId('ai-run').click();
  await expect(page.getByTestId('ai-scoring-key')).toHaveCount(0);
  // 確認全部系統標記
  const boxes = page.getByTestId('ai-marks').getByLabel('教師確認');
  for (let i = 0; i < (await boxes.count()); i++) if (!(await boxes.nth(i).isChecked())) await boxes.nth(i).check();
  await page.getByTestId('ai-run').click();
  await expect(page.getByTestId('ai-scoring-key')).toContainText('紅1');
  await expect(page.getByTestId('ai-events')).toContainText('籃球追蹤偵測');
  await expect(page.getByTestId('ai-events')).toContainText('籃球軌跡');
});
