import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getCloudConfig } from './config';

let client: SupabaseClient | null = null;
let clientKey = '';

/** 取得 Supabase 連線；未設定雲端時回傳 null（系統以純本機模式運作） */
export function getSupabase(): SupabaseClient | null {
  const cfg = getCloudConfig();
  if (!cfg) return null;
  const key = `${cfg.url}|${cfg.anonKey}`;
  if (!client || key !== clientKey) {
    client = createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'btl-auth' },
    });
    clientKey = key;
  }
  return client;
}

export function resetSupabase(): void {
  client = null;
  clientKey = '';
}

/** 將 Supabase／Postgres 錯誤轉成老師看得懂的訊息 */
export function friendlyError(err: unknown): string {
  const e = err as { message?: string; code?: string; status?: number } | null;
  const msg = e?.message ?? String(err);
  if (/Invalid login credentials/i.test(msg)) return '帳號或密碼錯誤';
  if (/Email not confirmed/i.test(msg)) return '請先到信箱點擊確認信，再登入';
  if (/User already registered/i.test(msg)) return '這個 Email 已註冊，請直接登入';
  if (/Anonymous sign-ins are disabled/i.test(msg)) return '雲端尚未開啟「匿名登入」，請老師到 Supabase 開啟 Anonymous Sign-ins';
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return '無法連線到雲端，請檢查網路';
  if (/row-level security|permission denied/i.test(msg)) return '沒有權限執行這個動作';
  if (/password/i.test(msg) && /6/.test(msg)) return '密碼至少需要 6 個字元';
  return msg;
}
