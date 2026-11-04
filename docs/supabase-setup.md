# 雲端設定（Supabase）

未設定雲端時，系統是「本機模式」：白板、教材、題目、本機任務連結都能用，學生繳交時下載結果檔交給老師。
設定雲端後增加：教師多裝置同步、任務代碼自動收作業、學生看得到老師回饋。

## 一、建立專案與資料表

1. Supabase → **New project**（Region 選 Northeast Asia (Tokyo)）。
2. **SQL Editor → New query**，貼上 `supabase/migrations/20261105000000_phase2_teaching_platform.sql` 全部內容 → **Run**。
   - 可重複執行（使用 `if not exists`／`drop policy if exists`），之後的版本更新也用同樣方式。
3. **Authentication → Sign In / Providers**
   - 開啟 **Allow anonymous sign-ins**（學生免帳號繳交）。
   - Email 登入保持開啟；建議關閉 **Confirm email**（否則老師註冊後要先收確認信）。
4. **Authentication → URL Configuration → Site URL**：`https://<帳號>.github.io/basketball-tactics-lab/`

## 二、讓網站連上雲端（擇一）

- **方式 A（建議）**：把 Project URL 與 anon／publishable key 填進 `apps/web/src/features/cloud/defaultConfig.ts`，推送到 GitHub 即自動部署。
- **方式 B**：GitHub repo → Settings → Secrets and variables → Actions → **Variables**，新增 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`，再重新執行部署。
- **方式 C（只有這台電腦）**：網站右上角「☁ 雲端」貼上兩個值。學生手機不會套用，只適合老師測試。

> anon／publishable key 本來就會出現在前端程式中，可以公開；資料由 RLS 保護。**絕對不要**把 `service_role`／secret key 放進前端或貼給任何人。

## 三、權限規則摘要（RLS）

| 資料 | 教師（Email 登入） | 學生（匿名登入） | 未登入 |
| --- | --- | --- | --- |
| projects（教師戰術） | 只能讀寫自己的；修訂版只能 +1 | 不可讀寫 | 不可 |
| assignments（任務） | 只能管理自己的 | 只能用代碼讀取（`get_assignment`），不能列出、修改、刪除 | 只能用代碼讀取 |
| attempts（作答） | 只能讀自己任務的作答；只能改「回饋」欄位 | 只能新增自己的、只能讀自己的；不能改分數或回饋；任務關閉後不能交 | 不可 |

這些規則以 `supabase/tests/rls.test.ts`（PGlite 執行同一份 SQL）自動測試，共 17 項。

## 已知限制

- 分數由學生端計算後上傳；教師可在作答明細看到每題答案以核對。若需防作弊，未來可改由資料庫函式重新評分。
- 匿名學生換手機或清除瀏覽器資料後，會變成新的匿名身分，看不到舊的回饋（教師端紀錄不受影響）。
