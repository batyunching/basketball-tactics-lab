import { expect, test, type Page } from '@playwright/test';

/** 附錄 B：首輪教師驗收情境 */

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('save-status')).toContainText('已自動儲存');
}

async function center(page: Page, testId: string) {
  const box = await page.getByTestId(testId).locator('circle').nth(2).boundingBox();
  if (!box) throw new Error(`找不到 ${testId}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** 依專案是否支援觸控，用滑鼠或觸控（CDP touch events）拖曳 */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, touch: boolean) {
  if (!touch) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
    await page.mouse.move(to.x, to.y, { steps: 5 });
    await page.mouse.up();
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  const tp = (p: { x: number; y: number }) => [{ x: p.x, y: p.y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(from) });
  for (let i = 1; i <= 8; i++) {
    const p = { x: from.x + ((to.x - from.x) * i) / 8, y: from.y + ((to.y - from.y) * i) / 8 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(p) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

const playerPos = (page: Page, id: string) =>
  page.evaluate((pid) => document.querySelector(`[data-player-id="${pid}"]`)?.getAttribute('transform'), id);

test('情境 1＋2：拖曳紅 1 到側翼、設定持球、藍 1 跟防；保存隊形 1 → 套用隊形 2 → 載入隊形 1 完整還原', async ({ page }, info) => {
  const touch = info.project.name === 'tablet-touch';
  await ready(page);
  const r1 = await center(page, 'player-red-1');
  const r2 = await center(page, 'player-red-2');
  await drag(page, r1, { x: r2.x, y: r2.y + 60 }, touch);
  const b1 = await center(page, 'player-blue-1');
  await drag(page, b1, { x: r2.x + 30, y: r2.y + 30 }, touch);
  const movedRed = await playerPos(page, 'red-1');
  const movedBlue = await playerPos(page, 'blue-1');
  expect(movedRed).not.toBeNull();

  // 設定持球：點選紅 3 → 設為持球
  await page.getByTestId('player-red-3').locator('circle').first().click();
  await page.getByTestId('give-ball').click();
  await expect(page.getByTestId('holder-label')).toHaveText('紅 3 號');

  // 保存到隊形 1（兩段式確認）
  await page.getByTestId('formation-save-1').click();
  await page.getByTestId('formation-save-1').click();
  await expect(page.getByTestId('toast')).toContainText('保存');

  await page.getByTestId('formation-quick-2').click();
  expect(await playerPos(page, 'red-1')).not.toBe(movedRed);

  await page.getByTestId('formation-quick-1').click();
  expect(await playerPos(page, 'red-1')).toBe(movedRed);
  expect(await playerPos(page, 'blue-1')).toBe(movedBlue);
  await expect(page.getByTestId('holder-label')).toHaveText('紅 3 號');
});

test('情境 3：六個連續步驟，逐步與 0.5 倍速播放', async ({ page }) => {
  await ready(page);
  const titles = ['站位', '掩護', '突破', '空切', '傳球', '投籃'];
  await page.getByTestId('step-title').fill(titles[0]!);
  await page.getByTestId('step-title').blur();
  for (let i = 1; i < 6; i++) {
    await page.getByTestId('add-step').click();
    await page.getByTestId('step-title').fill(titles[i]!);
    await page.getByTestId('step-title').blur();
    const p = await center(page, `player-red-${(i % 3) + 1}`);
    await drag(page, p, { x: p.x + 25, y: p.y - 35 }, false);
  }
  // 第 6 步投籃
  // 紅 1 與防守者重疊，直接對紅 1 送出 pointerdown 選取
  await page.getByTestId('player-red-1').dispatchEvent('pointerdown', { pointerId: 7, button: 0, isPrimary: true });
  await page.getByTestId('shoot').click();
  await expect(page.getByTestId('step-indicator')).toHaveText('步驟 6 / 6');

  // 回到第 1 步，逐步播放
  await page.getByTestId('step-list').getByRole('button').first().click();
  await page.getByTestId('next-step').click();
  await expect(page.getByTestId('step-indicator')).toHaveText('步驟 2 / 6', { timeout: 4000 });
  await expect(page.getByTestId('board-step-title')).toContainText('掩護');
  await expect(page.getByTestId('exit-playback')).toHaveCount(0, { timeout: 4000 });

  // 0.5 倍速整段播放
  await page.getByTestId('speed-0.5').click();
  await page.getByTestId('play').click();
  await page.waitForTimeout(1200);
  const mid = await page.evaluate(() => document.querySelector('[data-testid="ball"]')?.getAttribute('transform'));
  expect(mid).toBeTruthy();
  await expect(page.getByTestId('step-indicator')).toHaveText('步驟 6 / 6', { timeout: 15_000 });
  await expect(page.getByTestId('exit-playback')).toHaveCount(0, { timeout: 15_000 });
});

test('情境 4：修改後重新整理仍在；匯出 JSON 後在新專案匯入', async ({ page }) => {
  await ready(page);
  await page.getByTestId('project-title').fill('驗收用戰術');
  await page.getByTestId('project-title').press('Enter');
  const r1 = await center(page, 'player-red-1');
  await drag(page, r1, { x: r1.x - 80, y: r1.y - 40 }, false);
  const pos = await playerPos(page, 'red-1');
  await expect(page.getByTestId('save-status')).toContainText('已自動儲存');
  await page.waitForTimeout(800);

  // 離線後重新整理（service worker 快取頁面，資料來自 IndexedDB）
  await page.reload();
  await expect(page.getByTestId('save-status')).toContainText('已自動儲存');
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByTestId('project-title')).toHaveValue('驗收用戰術');
  expect(await playerPos(page, 'red-1')).toBe(pos);
  await page.context().setOffline(false);

  // 匯出
  const dl = page.waitForEvent('download');
  await page.getByTestId('export-json').click();
  const file = await (await dl).path();

  // 新專案後匯入
  await page.getByTestId('open-projects').click();
  await page.getByTestId('new-project').click();
  await expect(page.getByTestId('project-title')).toHaveValue(/新戰術/);
  await page.getByTestId('import-file').setInputFiles(file!);
  await expect(page.getByTestId('project-title')).toHaveValue('驗收用戰術（匯入）');
  expect(await playerPos(page, 'red-1')).toBe(pos);
});

test('復原／重做、畫筆與全螢幕按鈕', async ({ page }) => {
  await ready(page);
  const before = await playerPos(page, 'red-2');
  const r2 = await center(page, 'player-red-2');
  await drag(page, r2, { x: r2.x + 60, y: r2.y + 60 }, false);
  expect(await playerPos(page, 'red-2')).not.toBe(before);
  await page.getByTestId('undo').click();
  expect(await playerPos(page, 'red-2')).toBe(before);
  await page.getByTestId('redo').click();
  expect(await playerPos(page, 'red-2')).not.toBe(before);

  // 繪圖：跑動線
  await page.getByRole('radio', { name: /繪圖/ }).click();
  const box = (await page.getByTestId('court').boundingBox())!;
  await drag(page, { x: box.x + box.width * 0.4, y: box.y + box.height * 0.6 }, { x: box.x + box.width * 0.6, y: box.y + box.height * 0.3 }, false);
  await expect(page.locator('[data-annotation="run"]')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-annotation="run"]')).toHaveCount(0);

  await expect(page.getByTestId('fullscreen')).toBeEnabled();
});
