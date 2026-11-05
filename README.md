# 籃球戰術教學平台（Basketball Tactics Lab）— Phase 1～4

國中體育課用的籃球戰術教學平台。

- **Phase 1 戰術白板**：半場／全場、1v1～5v5、紅藍編號球員拖曳、籃球與球權、戰術畫筆、預設隊形、多步驟動畫、復原重做、本機自動儲存、JSON 匯入匯出。
- **Phase 2 教學平台**：六套戰術教材（M07）、三類互動題（M08：站位挑戰、跑位預測、戰術選擇）、教師發布任務連結／QR Code、學生唯讀作答與查看回饋、Supabase 雲端同步（離線佇列、修訂版衝突處理）、RLS 資料權限。

- **Phase 3 影片重建**：匯入 3v3 半場短片、片段選擇、球場校正、瀏覽器端 YOLOX 偵測＋多目標追蹤＋隊色判斷、老師指派身分、不確定標記、人工關鍵影格、原影片與虛擬球場同步回放、轉成戰術動畫。
- **籃球追蹤**：判別籃球、追蹤籃球移動與持球者、偵測出手並判斷進球／沒進／無法判定（需標記籃框），結果可匯入 AI 戰術分析由老師確認。

- **Phase 4 AI 戰術分析**：教師確認球權與出手 → 規則式分析傳球、空切、掩護、突破、協防、失誤、得分關鍵（繁中：時間點、相關球員、可見證據、戰術推論、教學建議、信心；證據不足明確說無法確認）→ 教師確認／否決／修改／補漏 → 一鍵轉成學生互動教材（可用本機連結或雲端任務發布）。不需 API 金鑰，資料不離開電腦。

網址：https://batyunching.github.io/basketball-tactics-lab/

## 快速開始

需要 Node.js 20 以上。

```bash
npm install
npm run dev        # 開發模式 http://localhost:5173
npm test           # 單元／元件測試＋RLS 權限測試（Vitest＋PGlite）
npm run build      # 型別檢查 + 正式版建置 → apps/web/dist
npm run e2e        # 端對端驗收測試（Playwright，桌機＋觸控平板）
```

第一次跑 e2e 前若沒有瀏覽器：`cd apps/web && npx playwright install chromium`。

## 專案結構

```
apps/web/                     React + TypeScript + Vite 前端
  src/app/                    App 版面、Zustand 狀態（歷史紀錄、播放）
  src/features/court/         M01 球場 SVG、座標轉換、拖曳／繪圖／縮放手勢、設定面板
  src/features/players/       M02/M03 球員、籃球、球員屬性與球權事件面板
  src/features/tactics/       M04 畫筆幾何與標註圖形
  src/features/formations/    M05 預設隊形
  src/features/animation/     M06 步驟編輯、播放列、播放迴圈
  src/features/storage/       IndexedDB 儲存庫、自動儲存、JSON／PNG 匯入匯出
  e2e/                        Playwright 驗收測試（附錄 B 情境）
  public/sw.js                離線快取（斷網重新整理仍可開啟）
  src/features/lessons/       M07 教材庫、教材播放器
  src/features/challenges/    M08 三類互動題
  src/features/assignments/   任務發布、連結／QR、成績與回饋
  src/features/student/       學生端（唯讀作答）
  src/features/cloud/         Supabase 連線、登入、同步控制
  src/features/sync/          同步引擎（離線佇列、衝突處理）
  src/features/video/         Phase 3 影片管理、校正、追蹤、關鍵影格、同步回放
packages/tactic-ai/           Phase 4 規則式戰術分析、品質評估、事件轉教材
packages/video-engine/        單應性校正、YOLOX 解碼、追蹤、隊色、軌跡與不確定標記
packages/lesson-library/      六套教材與題目資料
supabase/migrations/          資料表與 RLS（在 Supabase SQL Editor 執行）
supabase/tests/               RLS 權限測試（PGlite）
packages/shared-types/        共用資料型別（戰術 JSON 格式）
packages/tactic-engine/       純邏輯：FIBA 球場幾何、座標轉換、動畫插值、戰術操作、隊形、歷史
packages/data-schemas/        zod 驗證、版本遷移、匯出格式
docs/                         需求、架構、資料模型、驗收測試、部署、教師操作說明
```

核心原則：**所有位置以球場公尺座標儲存**（x 0～28、y 0～15），畫面像素只是顯示；縮放、旋轉半場、全螢幕都不會讓球員偏移。

## 文件

- [教師操作說明](docs/teacher-guide.md)
- [需求與完成狀態](docs/requirements.md)
- [架構](docs/architecture.md)
- [資料模型](docs/data-model.md)
- [驗收測試](docs/acceptance-tests.md)
- [部署（GitHub Pages）](docs/deployment.md)
- [雲端設定（Supabase）](docs/supabase-setup.md)
- [影片重建（Phase 3）](docs/video-analysis.md)
- [AI 戰術分析品質評估（Phase 4）](docs/quality-evaluation.md)
- [5v5 擴充規劃](docs/5v5-plan.md)
