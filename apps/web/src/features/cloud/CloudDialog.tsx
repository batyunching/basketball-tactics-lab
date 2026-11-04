import { useEffect, useState } from 'react';
import { useStore } from '../../app/store';
import { clearLocalCloudConfig, getCloudConfig, isValidSupabaseUrl, saveLocalCloudConfig } from './config';
import { isTeacherUser, useCloud } from './cloudStore';
import { resolveConflict, restartCloud, signIn, signOut, signUp, syncNow } from './controller';

const SYNC_TEXT = {
  disabled: '未設定雲端（本機模式）',
  'signed-out': '未登入',
  idle: '已同步',
  syncing: '同步中…',
  offline: '離線：修改會在連線後自動上傳',
  error: '同步發生錯誤',
} as const;

/** 上方導覽列的雲端狀態按鈕 */
export function CloudButton() {
  const c = useCloud();
  const label =
    c.sync === 'disabled'
      ? '☁ 雲端'
      : !isTeacherUser(c.user)
        ? '☁ 登入'
        : c.conflicts.length
          ? `⚠ 衝突 ${c.conflicts.length}`
          : c.sync === 'offline'
            ? `☁ 離線${c.pending ? `（${c.pending} 待傳）` : ''}`
            : c.sync === 'syncing'
              ? '☁ 同步中…'
              : c.sync === 'error'
                ? '☁ 錯誤'
                : `☁ 已同步${c.pending ? `（${c.pending}）` : ''}`;
  return (
    <button type="button" className={`btn cloud-btn ${c.conflicts.length ? 'warn' : ''}`} onClick={() => c.set({ dialogOpen: true })} data-testid="cloud-button">
      {label}
    </button>
  );
}

function ConfigForm({ onDone }: { onDone: () => void }) {
  const cfg = getCloudConfig();
  const [url, setUrl] = useState(cfg?.source === 'local' ? cfg.url : '');
  const [key, setKey] = useState(cfg?.source === 'local' ? cfg.anonKey : '');
  const [err, setErr] = useState('');
  return (
    <form
      className="cloud-config"
      onSubmit={(e) => {
        e.preventDefault();
        if (!isValidSupabaseUrl(url) || key.trim().length < 20) {
          setErr('請貼上正確的 Project URL（https://xxxx.supabase.co）與 anon public key');
          return;
        }
        saveLocalCloudConfig(url, key);
        restartCloud();
        onDone();
      }}
    >
      <p className="muted small">
        在 Supabase 專案的 <b>Project Settings → API</b> 複製這兩個值。這裡的設定只存在這台電腦；要讓學生的手機也能用雲端任務，請依說明文件把它們設定到 GitHub（部署時帶入）。
      </p>
      <label className="field">
        <span>Project URL</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" />
      </label>
      <label className="field">
        <span>anon public key</span>
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="eyJhbGciOi…" />
      </label>
      {err && <p className="form-error">{err}</p>}
      <div className="btn-row">
        <button type="submit" className="btn primary">
          儲存並連線
        </button>
        {cfg?.source === 'local' && (
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              clearLocalCloudConfig();
              restartCloud();
              onDone();
            }}
          >
            移除設定
          </button>
        )}
      </div>
    </form>
  );
}

function AuthForm() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setMsg('');
    try {
      await fn();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="auth-form"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => signIn(email, pw));
      }}
    >
      <p className="muted small">教師以 Email 登入後，戰術會在多台裝置間同步，發布的任務也會自動收集學生作答。學生不需要帳號。</p>
      <label className="field">
        <span>Email</span>
        <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label className="field">
        <span>密碼（至少 6 碼）</span>
        <input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={6} />
      </label>
      {msg && <p className="form-error">{msg}</p>}
      <div className="btn-row">
        <button type="submit" className="btn primary" disabled={busy}>
          登入
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || !email || pw.length < 6}
          onClick={() =>
            void run(async () => {
              const r = await signUp(email, pw);
              setMsg(r === 'confirm-email' ? '已寄出確認信，請到信箱點擊連結後再登入。' : '');
            })
          }
        >
          註冊教師帳號
        </button>
      </div>
    </form>
  );
}

function ConflictList() {
  const conflicts = useCloud((s) => s.conflicts);
  const [busy, setBusy] = useState<string | null>(null);
  if (!conflicts.length) return null;
  return (
    <section className="conflicts" data-testid="conflicts">
      <h3>⚠ 需要你決定的版本（{conflicts.length}）</h3>
      <p className="muted small">同一份戰術在兩個地方都被修改。系統沒有自動覆蓋任何一份，請選擇要保留哪一個。</p>
      {conflicts.map((c) => {
        const l = c.local;
        const r = c.remote;
        const fmt = (s?: string) => (s ? new Date(s).toLocaleString('zh-TW', { hour12: false }) : '—');
        return (
          <div key={c.entityId} className="conflict">
            <div className="conflict-cols">
              <div>
                <b>這台裝置</b>
                <p>{l ? `${l.title}・${l.steps.length} 步` : '（已刪除）'}</p>
                <p className="muted small">修改於 {fmt(l?.updatedAt)}</p>
              </div>
              <div>
                <b>雲端</b>
                <p>{r && !r.deleted ? `${r.data.title}・${r.data.steps.length} 步` : '（已刪除）'}</p>
                <p className="muted small">更新於 {fmt(r?.updatedAt)}・第 {r?.revision ?? '—'} 版</p>
              </div>
            </div>
            <div className="btn-row">
              {(['local', 'remote', 'both'] as const).map((choice) => (
                <button
                  key={choice}
                  type="button"
                  className={`btn small ${choice === 'both' ? 'primary' : ''}`}
                  disabled={busy === c.entityId || (choice === 'both' && !l)}
                  onClick={async () => {
                    setBusy(c.entityId);
                    try {
                      await resolveConflict(c.entityId, choice);
                      useStore.getState().showToast('已處理版本衝突');
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {choice === 'local' ? '保留這台的版本' : choice === 'remote' ? '改用雲端版本' : '兩份都保留'}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

export function CloudDialog() {
  const c = useCloud();
  const [editing, setEditing] = useState(false);
  const cfg = getCloudConfig();
  useEffect(() => {
    if (!c.dialogOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && c.set({ dialogOpen: false });
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [c]);
  if (!c.dialogOpen) return null;
  const close = () => c.set({ dialogOpen: false });
  const teacher = isTeacherUser(c.user);

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="雲端同步" data-testid="cloud-dialog">
        <header>
          <h2>☁ 雲端同步與教師帳號</h2>
          <button type="button" className="btn icon" onClick={close} aria-label="關閉">
            ✕
          </button>
        </header>
        {!cfg || editing ? (
          <>
            {!cfg && <p>目前是<b>本機模式</b>：所有功能都能用，資料存在這台電腦。設定雲端後可以多裝置同步、自動收學生作業、給學生回饋。</p>}
            <ConfigForm onDone={() => setEditing(false)} />
          </>
        ) : (
          <>
            <p className="muted small">
              雲端：{new URL(cfg.url).host}（{cfg.source === 'build' ? '網站預設' : '這台電腦的設定'}）
              {cfg.source === 'local' && (
                <button type="button" className="link" onClick={() => setEditing(true)}>
                  {' '}
                  變更
                </button>
              )}
            </p>
            {teacher ? (
              <>
                <p>
                  已登入：<b>{c.user?.email}</b>
                </p>
                <p data-testid="sync-status">
                  狀態：{SYNC_TEXT[c.sync]}
                  {c.pending > 0 && `・${c.pending} 筆待上傳`}
                  {c.lastSyncAt && <span className="muted small">（上次同步 {c.lastSyncAt}）</span>}
                </p>
                {c.error && <p className="form-error">{c.error}</p>}
                <div className="btn-row">
                  <button type="button" className="btn primary" onClick={() => void syncNow()} disabled={c.sync === 'syncing'}>
                    立即同步
                  </button>
                  <button type="button" className="btn ghost" onClick={() => void signOut()}>
                    登出
                  </button>
                </div>
                <ConflictList />
              </>
            ) : (
              <AuthForm />
            )}
          </>
        )}
      </div>
    </div>
  );
}
