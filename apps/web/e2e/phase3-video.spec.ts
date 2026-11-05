import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 3 流程測試。測試影片為程式產生：透視繪製的半場＋三個移動人形
 * （e2e/fixtures/make_clip.py），只用來驗證瀏覽器端流程與幾何換算，
 * 不代表真實籃球影片的辨識準確度。
 */
const FIX = join(import.meta.dirname, 'fixtures');
const meta = JSON.parse(readFileSync(join(FIX, 'clip-meta.json'), 'utf8')) as {
  landmarks: Record<string, [number, number]>;
  truth: Record<string, { t: number; x: number; y: number }[]>;
};

async function overlayPoint(page: Page, x: number, y: number) {
  return page.getByTestId('video-overlay').evaluate(
    (svg, [px, py]) => {
      const pt = new DOMPoint(px, py).matrixTransform((svg as SVGSVGElement).getScreenCTM()!);
      return { x: pt.x, y: pt.y };
    },
    [x, y] as const,
  );
}

async function importClip(page: Page) {
  await page.goto('/#/video');
  await page.getByTestId('video-consent').check();
  await page.getByTestId('video-file').setInputFiles(join(FIX, 'test-3v3.webm'));
  await expect(page.getByTestId('video-workspace')).toBeVisible({ timeout: 15_000 });
}

async function calibrate(page: Page) {
  await page.getByTestId('vstep-2').click();
  for (const [id, [x, y]] of Object.entries(meta.landmarks)) {
    await page.getByTestId(`lm-${id}`).click();
    const p = await overlayPoint(page, x, y);
    await page.mouse.click(p.x, p.y);
  }
  await expect(page.getByTestId('cal-status')).toContainText('準確');
  await expect(page.getByTestId('projected-court')).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test('匯入影片 → 片段 → 球場校正（誤差 < 0.3m）→ 人工關鍵影格 → 同步回放 → 轉成戰術 → 刪除', async ({ page }) => {
  await importClip(page);
  await expect(page.getByTestId('trim-length')).toHaveText('12.0 秒');

  await calibrate(page);

  // 人工關鍵影格（自動追蹤失敗時的備援流程）
  await page.getByTestId('vstep-5').click();
  await page.getByTestId('kf-create').click();
  await expect(page.getByTestId('kf-editor')).toBeVisible();
  // 點影片放置紅 1：腳底位置由球場座標換算
  await page.getByTestId('arm-red-1').click();
  const t0 = meta.truth['red-1']![0]!;
  const foot = await page.getByTestId('video-overlay').evaluate(
    (_svg, [x, y]) => {
      // 與產生影片相同的透視矩陣
      const C = [-26, 36, 760, 21, 4, -112, -0.002, 0.012, 1];
      const w = C[6]! * x + C[7]! * y + C[8]!;
      return { x: (C[0]! * x + C[1]! * y + C[2]!) / w, y: (C[3]! * x + C[4]! * y + C[5]!) / w };
    },
    [t0.x, t0.y] as const,
  );
  const fp = await overlayPoint(page, foot.x, foot.y);
  await page.mouse.click(fp.x, fp.y);
  await page.getByTestId('kf-holder').selectOption('red-1');

  // 第二個關鍵影格
  await page.getByTestId('video-scrub').fill('6000');
  await page.getByTestId('kf-create').click();
  await expect(page.getByTestId('kf-list').locator('li')).toHaveCount(2);

  // 同步回放：球場上有紅 1，且位置接近真實（點擊換算誤差）
  await page.getByTestId('vstep-6').click();
  await page.getByTestId('video-scrub').fill('0');
  await expect(page.getByTestId('video-court').locator('[data-player-id="red-1"]')).toBeVisible();
  const readKf = () =>
    page.evaluate(async () => {
      const req = indexedDB.open('basketball-tactics-lab');
      const db: IDBDatabase = await new Promise((r) => (req.onsuccess = () => r(req.result)));
      const all: { keyframes: { timeMs: number; players: Record<string, { x: number; y: number }> }[] }[] = await new Promise((r) => {
        const q = db.transaction('analyses').objectStore('analyses').getAll();
        q.onsuccess = () => r(q.result);
      });
      return all[0]?.keyframes[0]?.players['red-1'] ?? null;
    });
  // 自動儲存有 0.4 秒延遲
  await expect.poll(readKf).not.toBeNull();
  const kf = (await readKf())!;
  expect(Math.hypot(kf.x - t0.x, kf.y - t0.y)).toBeLessThan(0.3);

  await page.getByTestId('to-tactic').click();
  await expect(page.getByTestId('project-title')).toHaveValue(/影片重建/);
  await expect(page.getByTestId('step-indicator')).toContainText('1 / 2');

  // 刪除影片（含軌跡與分析）
  await page.goto('/#/video');
  await page.getByTestId('video-delete').click();
  await page.getByTestId('video-delete').click();
  await expect(page.getByTestId('video-list')).toHaveCount(0);
});

test('瀏覽器端 YOLOX 自動偵測＋追蹤：產生軌跡、指派後位置接近真實路徑並標示不確定', async ({ page }) => {
  test.setTimeout(240_000);
  await importClip(page);
  await calibrate(page);
  await page.getByTestId('vstep-3').click();
  await page.getByTestId('track-fps').selectOption('2');
  await page.getByTestId('track-run').click();
  // 完成後自動跳到「④ 身分校正」
  await expect(page.getByTestId('track-table')).toBeVisible({ timeout: 200_000 });
  const rows = page.getByTestId('track-table').locator('tbody tr');
  await expect.poll(async () => rows.count()).toBeGreaterThanOrEqual(2);

  // 取最長的一條軌跡，指派給紅 1，檢查與「最接近的真實路徑」的誤差
  await page.getByLabel(/指派給/).first().selectOption('red-1');
  const err = await page.evaluate(async (truth) => {
    const req = indexedDB.open('basketball-tactics-lab');
    const db: IDBDatabase = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    await new Promise((r) => setTimeout(r, 800)); // 等自動儲存
    const all: any[] = await new Promise((r) => {
      const q = db.transaction('analyses').objectStore('analyses').getAll();
      q.onsuccess = () => r(q.result);
    });
    const a = all[all.length - 1];
    const tid = Object.keys(a.assignments)[0];
    const tr = a.tracks.find((t: any) => t.trackId === tid);
    const pts = tr.points.filter((p: any) => p.source === 'observed' && p.court);
    let best = Infinity;
    for (const path of Object.values(truth) as any[]) {
      let sum = 0;
      for (const p of pts) {
        const g = path.reduce((m: any, q: any) => (Math.abs(q.t - p.timeMs) < Math.abs(m.t - p.timeMs) ? q : m));
        sum += Math.hypot(g.x - p.court.x, g.y - p.court.y);
      }
      best = Math.min(best, sum / pts.length);
    }
    return { best, n: pts.length };
  }, meta.truth);
  expect(err.n).toBeGreaterThan(5);
  expect(err.best).toBeLessThan(1.0);

  await page.getByTestId('vstep-6').click();
  await page.getByTestId('video-scrub').fill('3000');
  await expect(page.getByTestId('video-court').locator('[data-player-id="red-1"]')).toBeVisible();
});

test('格式不符的檔案被拒絕；未勾選授權不能匯入', async ({ page }) => {
  await page.goto('/#/video');
  await expect(page.getByTestId('video-import')).toBeDisabled();
  await page.getByTestId('video-consent').check();
  await page.getByTestId('video-file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.getByTestId('toast')).toContainText('只接受 MP4');
});
