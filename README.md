# 籃球戰術教學白板（Basketball Tactics Lab）— Phase 1

國中體育課用的 2D 籃球戰術白板：半場／全場、1v1～5v5、紅藍編號球員拖曳、籃球與球權、戰術畫筆、預設隊形、多步驟動畫、復原重做、本機自動儲存與 JSON 匯入匯出。
本階段**不含** AI 影片分析（Phase 3、4）。

## 快速開始

需要 Node.js 20 以上。

```bash
npm install
npm run dev        # 開發模式 http://localhost:5173
npm test           # 單元／元件測試（Vitest）
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
