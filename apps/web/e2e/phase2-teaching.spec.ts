import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/** Phase 2 驗收：教材、三類互動題、發布連結、學生唯讀作答、教師收作業與回饋 */

/** 把球場公尺座標轉成螢幕座標（半場：紅隊攻右邊籃框，畫面旋轉） */
async function courtPoint(page: Page, testId: string, x: number, y: number) {
  return page.getByTestId(testId).evaluate(
    (svg, [cx, cy]) => {
      const el = svg as SVGSVGElement;
      const vb = el.viewBox.baseVal;
      // 半場（攻右）：view = (y, 28 − x)；全場：view = (x, y)
      const half = vb.width < 20;
      const v = half ? { x: cy, y: 28 - cx } : { x: cx, y: cy };
      const pt = new DOMPoint(v.x, v.y).matrixTransform(el.getScreenCTM()!);
      return { x: pt.x, y: pt.y };
    },
    [x, y] as const,
  );
}

async function dragPlayerTo(page: Page, courtTestId: string, playerId: string, x: number, y: number) {
  const box = (await page.getByTestId(courtTestId).locator(`[data-player-id="${playerId}"] circle`).nth(2).boundingBox())!;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const to = await courtPoint(page, courtTestId, x, y);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

test('教材庫有六套教材，可播放動畫', async ({ page }) => {
  await page.goto('/#/lessons');
  const cards = page.getByTestId('lesson-grid').locator('li');
  await expect(cards).toHaveCount(6);
  await page.getByTestId('lesson-fast-break').click();
  await expect(page.getByTestId('viewer-step')).toContainText('搶下籃板');
  await page.getByTestId('viewer-next').click();
  await expect(page.getByTestId('viewer-step')).toContainText('第一傳', { timeout: 4000 });
});

test('三類互動題：站位挑戰（多個合理解）、跑位預測、戰術選擇', async ({ page }) => {
  await page.goto('/#/lessons/give-and-go');
  // 站位挑戰：紅2 拉到左底角（另一個合理解）、紅3 拉到右側翼
  await page.getByTestId('tab-challenge-1').click();
  await dragPlayerTo(page, 'challenge-court', 'red-2', 27, 1.0);
  await dragPlayerTo(page, 'challenge-court', 'red-3', 22.5, 13);
  await page.getByTestId('check-answer').click();
  await expect(page.getByTestId('challenge-result')).toContainText('答對了');
  await expect(page.getByTestId('challenge-result')).toContainText('10 / 10');

  // 跑位預測：故意答錯 → 再試一次 → 答對
  await page.getByTestId('tab-challenge-2').click();
  await dragPlayerTo(page, 'challenge-court', 'red-1', 18, 13);
  await page.getByTestId('check-answer').click();
  await expect(page.getByTestId('challenge-result')).toContainText('再想想看');
  await page.getByTestId('retry').click();
  await dragPlayerTo(page, 'challenge-court', 'red-1', 25.6, 8.6);
  await page.getByTestId('check-answer').click();
  await expect(page.getByTestId('challenge-result')).toContainText('答對了');

  // 戰術選擇（多選）：只選一個正確 → 部分正確
  await page.getByTestId('tab-challenge-3').click();
  await page.getByText('立刻把球回傳給空切的紅1').click();
  await page.getByTestId('check-answer').click();
  await expect(page.getByTestId('challenge-result')).toContainText('部分正確');
});

test('教師發布本機連結 → 學生用手機作答繳交 → 教師匯入結果並回饋', async ({ page, browser }) => {
  // 教師發布
  await page.goto('/#/teach?lesson=man-to-man-help');
  await page.getByTestId('asg-title').fill('802 人盯人');
  await page.getByTestId('asg-publish').click();
  const link = await page.getByTestId('share-link').inputValue();
  const code = (await page.getByTestId('share-code').textContent())!.trim();
  expect(link).toContain('#/p/man-to-man-help');

  // 學生（另一個瀏覽器環境 = 另一台手機）
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, acceptDownloads: true });
  const stu = await ctx.newPage();
  await stu.goto(link);
  await stu.getByTestId('stu-class').fill('802');
  await stu.getByTestId('stu-seat').fill('7');
  await stu.getByTestId('stu-name').fill('陳小美');
  await stu.getByTestId('stu-start').click();

  // 學生端沒有任何編輯教材的工具
  await expect(stu.getByTestId('student-page')).toBeVisible();
  for (const id of ['undo', 'add-step', 'export-json', 'lesson-to-board', 'asg-publish']) await expect(stu.getByTestId(id)).toHaveCount(0);
  await expect(stu.locator('nav.navbar')).toHaveCount(0);

  await stu.getByTestId('stu-tab-3').click();
  await stu.getByText('退到禁區附近，同時看得到球和紅3').click();
  await stu.getByTestId('check-answer').click();
  await expect(stu.getByTestId('challenge-result')).toContainText('答對了');

  await stu.getByTestId('stu-tab-submit').click();
  const dl = stu.waitForEvent('download');
  await stu.getByTestId('stu-submit').click();
  // 路徑避免中文字元（部分平台的檔案上傳不支援）
  const file = join(tmpdir(), `btl-result-${Date.now()}.json`);
  await (await dl).saveAs(file);
  await expect(stu.getByTestId('submitted')).toContainText('10 / 30');
  const json = JSON.parse(readFileSync(file, 'utf8'));
  expect(json.attempts[0].assignmentCode).toBe(code);

  // 重新整理後作答進度仍在（同一台手機）
  await stu.reload();
  await stu.getByTestId('stu-tab-submit').click();
  await expect(stu.getByTestId('submit-box')).toContainText('已完成 1 / 3 題');
  await ctx.close();

  // 教師匯入學生結果檔並回饋
  await page.bringToFront();
  await page.getByTestId('view-results').first().click();
  await page.getByTestId('import-results-file').setInputFiles(file);
  await expect(page.getByTestId('attempt-table')).toContainText('陳小美');
  await page.getByLabel('給 陳小美 的回饋').fill('弱邊站位正確，下次注意跳向球');
  await page.getByTestId('attempt-table').getByRole('button', { name: '儲存' }).click();
  await expect(page.getByTestId('toast')).toContainText('已儲存給 陳小美 的回饋');
});

test('不同任務的結果檔不能匯入到別的任務', async ({ page }) => {
  await page.goto('/#/teach?lesson=zone-2-3');
  await page.getByTestId('asg-publish').click();
  await page.getByTestId('view-results').first().click();
  const fake = {
    format: 'basketball-tactics-lab/attempts',
    schemaVersion: 1,
    attempts: [
      {
        id: 'x',
        assignmentId: 'y',
        assignmentCode: 'ZZZZZZ',
        lessonId: 'zone-2-3',
        student: { className: '1', seatNo: '1', name: '別班' },
        results: [],
        score: 0,
        maxScore: 0,
        submittedAt: new Date().toISOString(),
        teacherFeedback: '',
        feedbackAt: null,
        source: 'local',
      },
    ],
  };
  await page.getByTestId('import-results-file').setInputFiles({ name: 'other.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fake)) });
  await expect(page.getByTestId('toast')).toContainText('不是這個任務的結果檔');
});

test('雲端任務連結在未設定雲端時給出清楚說明；錯誤教材 id 顯示錯誤', async ({ page }) => {
  await page.goto('/#/s/ABC123');
  await expect(page.getByTestId('student-error')).toContainText('網站還沒設定雲端');
  await page.goto('/#/p/not-a-lesson');
  await expect(page.getByTestId('student-error')).toContainText('教材不存在');
});

test('教材複製到白板後可修改，原教材不受影響', async ({ page }) => {
  await page.goto('/#/lessons/pick-and-roll');
  await page.getByTestId('lesson-to-board').click();
  await expect(page.getByTestId('project-title')).toHaveValue('擋拆（教材副本）');
  await expect(page.getByTestId('step-indicator')).toContainText('1 / 6');
  await page.getByTestId('remove-step').click();
  await expect(page.getByTestId('step-indicator')).toContainText('1 / 5');
  await page.goto('/#/lessons/pick-and-roll');
  await expect(page.locator('.viewer-steps li')).toHaveCount(6);
});
