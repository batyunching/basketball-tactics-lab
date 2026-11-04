import { DEFAULT_SUPABASE_ANON_KEY, DEFAULT_SUPABASE_URL } from './defaultConfig';

/** 雲端設定：優先使用建置時的環境變數（GitHub Actions Variables），其次是教師在介面輸入並存在本機的設定 */
export interface CloudConfig {
  url: string;
  anonKey: string;
  source: 'build' | 'local';
}

const KEY = 'btl.cloudConfig';

function safeGet(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function getCloudConfig(): CloudConfig | null {
  const envUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  // VITE_SUPABASE_URL=off：強制本機模式（自動化測試用）
  if (envUrl === 'off') return null;
  const url = envUrl || DEFAULT_SUPABASE_URL;
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || DEFAULT_SUPABASE_ANON_KEY;
  if (url && anonKey) return { url, anonKey, source: 'build' };
  const raw = safeGet();
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { url?: string; anonKey?: string };
    if (v.url && v.anonKey) return { url: v.url, anonKey: v.anonKey, source: 'local' };
  } catch {
    /* 忽略 */
  }
  return null;
}

export function saveLocalCloudConfig(url: string, anonKey: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ url: url.trim(), anonKey: anonKey.trim() }));
  } catch {
    /* 無痕模式等 */
  }
}

export function clearLocalCloudConfig(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 忽略 */
  }
}

export function isValidSupabaseUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return u.protocol === 'https:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}
