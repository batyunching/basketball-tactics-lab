# 部署到 GitHub Pages

專案已附 `.github/workflows/deploy-pages.yml`：推送到 `main` 分支時自動測試、建置並發布 `apps/web/dist`。

## 一次性設定

1. 在 GitHub 建立 repository（例如 `basketball-tactics-lab`），把本資料夾推上去：
   ```bash
   git init
   git add .
   git commit -m "Phase 1 tactics whiteboard"
   git branch -M main
   git remote add origin https://github.com/<帳號>/basketball-tactics-lab.git
   git push -u origin main
   ```
2. GitHub repo → **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**。
3. 到 **Actions** 分頁等待「Deploy to GitHub Pages」完成，網址為 `https://<帳號>.github.io/basketball-tactics-lab/`。

## 說明

- `vite.config.ts` 使用 `base: './'`（相對路徑），不需依 repo 名稱修改；若要絕對路徑可設環境變數 `VITE_BASE=/repo名稱/`。
- 本系統為單頁、無路由，GitHub Pages 不需 404 轉址設定。
- `public/sw.js` 會快取頁面，斷網仍可開啟；更新版本後學生若看到舊版，重新整理一次即可（網路優先載入頁面）。
- 資料存在各裝置瀏覽器的 IndexedDB，不會上傳到 GitHub；不同裝置之間請用 JSON 匯出／匯入。
- `ci.yml` 會在 PR 時跑單元測試、建置與 Playwright e2e。
