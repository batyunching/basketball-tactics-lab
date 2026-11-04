/**
 * 網站預設的雲端連線（學生手機打開任務連結時使用）。
 * Supabase 的 Project URL 與 anon／publishable key 本來就會出現在前端程式中，
 * 屬於可公開的金鑰；資料安全由資料庫的 RLS 規則保護（見 supabase/migrations）。
 * 留空 = 純本機模式。也可改用 GitHub Variables：VITE_SUPABASE_URL、VITE_SUPABASE_ANON_KEY。
 */
export const DEFAULT_SUPABASE_URL = '';
export const DEFAULT_SUPABASE_ANON_KEY = '';
