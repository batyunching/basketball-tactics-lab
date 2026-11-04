/**
 * 網站預設的雲端連線（學生手機打開任務連結時使用）。
 * Supabase 的 Project URL 與 publishable（anon）key 本來就會出現在前端程式中，
 * 屬於可公開的金鑰；資料安全由資料庫的 RLS 規則保護（見 supabase/migrations）。
 * 絕對不要把 secret／service_role key 放在這裡。
 * 也可改用 GitHub Variables：VITE_SUPABASE_URL、VITE_SUPABASE_ANON_KEY（優先）。
 */
export const DEFAULT_SUPABASE_URL = 'https://ujknsrngcexarjwrutmw.supabase.co';
export const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_D7tLZYGSzwTFsb35_sz0WQ_6I5L8KLO';
