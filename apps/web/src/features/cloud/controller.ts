import type { Session } from '@supabase/supabase-js';
import { useStore } from '../../app/store';
import { repository } from '../storage/db';
import { getRepository, setSyncHook } from '../storage/persistence';
import { SyncEngine, type ConflictChoice } from '../sync/syncEngine';
import { friendlyError, getSupabase, resetSupabase } from './client';
import { getCloudConfig } from './config';
import { SupabaseProjectStore } from './remoteProjects';
import { isTeacherUser, useCloud, type CloudUser } from './cloudStore';

let engine: SyncEngine | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let debounce: ReturnType<typeof setTimeout> | null = null;
let started = false;
let unsubAuth: (() => void) | null = null;

function deviceId(): string {
  try {
    let id = localStorage.getItem('btl.deviceId');
    if (!id) {
      id = `dev-${crypto.randomUUID()}`;
      localStorage.setItem('btl.deviceId', id);
    }
    return id;
  } catch {
    return 'dev-unknown';
  }
}

function toUser(s: Session | null): CloudUser | null {
  if (!s) return null;
  return { id: s.user.id, email: s.user.email ?? null, isAnonymous: !!s.user.is_anonymous };
}

async function refreshCounts() {
  if (!engine) return;
  useCloud.getState().set({ pending: await engine.pendingCount(), conflicts: await engine.listConflicts() });
}

/** 執行一次同步，並把雲端的變更反映到目前開啟的戰術 */
export async function syncNow(): Promise<void> {
  if (!engine) return;
  const cloud = useCloud.getState();
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    cloud.set({ sync: 'offline' });
    await refreshCounts();
    return;
  }
  cloud.set({ sync: 'syncing', error: null });
  try {
    const r = await engine.sync();
    const app = useStore.getState();
    const currentId = app.history.present.id;
    if (r.pulled.includes(currentId)) {
      const p = await getRepository().getProject(currentId);
      if (p) {
        app.loadProject(p);
        app.showToast('已載入雲端上較新的版本');
      }
    }
    if (r.removed.includes(currentId)) app.showToast('這份戰術已在其他裝置刪除', 'error');
    useCloud.getState().set({ sync: 'idle', lastSyncAt: new Date().toLocaleTimeString('zh-TW', { hour12: false }), pending: r.pending });
    if (r.conflicts > 0) app.showToast(`有 ${r.conflicts} 份戰術在多台裝置都被修改，請選擇要保留的版本`, 'error');
  } catch (err) {
    const offline = /fetch|network|offline/i.test(String((err as Error)?.message ?? err));
    useCloud.getState().set({ sync: offline ? 'offline' : 'error', error: offline ? null : friendlyError(err) });
  }
  await refreshCounts();
}

function scheduleSync(delay = 1500) {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => void syncNow(), delay);
}

function startEngine() {
  const sb = getSupabase();
  if (!sb) return;
  engine = new SyncEngine(repository, new SupabaseProjectStore(sb), deviceId());
  setSyncHook(async (id, kind) => {
    if (!engine) return;
    await engine.enqueue(id, kind);
    await refreshCounts();
    scheduleSync();
  });
  if (!timer) timer = setInterval(() => void syncNow(), 60_000);
  void (async () => {
    // 第一次登入：把本機既有戰術排入上傳佇列（已同步過的會被跳過）
    for (const p of await repository.listProjects()) {
      if (!(await repository.getSyncMeta(p.id)) && !(await repository.listOps()).some((o) => o.entityId === p.id)) {
        await engine?.enqueue(p.id, 'upsert');
      }
    }
    await syncNow();
  })();
}

function stopEngine() {
  engine = null;
  setSyncHook(null);
  if (timer) clearInterval(timer);
  timer = null;
}

function applySession(s: Session | null) {
  const user = toUser(s);
  const cloud = useCloud.getState();
  cloud.set({ user, sync: isTeacherUser(user) ? 'idle' : 'signed-out' });
  if (isTeacherUser(user)) {
    if (!engine) startEngine();
  } else {
    stopEngine();
  }
}

/** 教師端啟動：讀取登入狀態、連線恢復時自動同步 */
export function startCloud(): void {
  if (started) return;
  started = true;
  const sb = getSupabase();
  useCloud.getState().set({ configured: !!getCloudConfig(), sync: sb ? 'signed-out' : 'disabled' });
  if (!sb) return;
  void sb.auth.getSession().then(({ data }) => applySession(data.session));
  const { data } = sb.auth.onAuthStateChange((_e, session) => applySession(session));
  unsubAuth = () => data.subscription.unsubscribe();
  window.addEventListener('online', () => void syncNow());
  window.addEventListener('offline', () => useCloud.getState().set({ sync: 'offline' }));
}

/** 設定變更後重新啟動 */
export function restartCloud(): void {
  unsubAuth?.();
  stopEngine();
  resetSupabase();
  started = false;
  startCloud();
}

export async function signIn(email: string, password: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error('尚未設定雲端');
  const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(friendlyError(error));
}

export async function signUp(email: string, password: string): Promise<'signed-in' | 'confirm-email'> {
  const sb = getSupabase();
  if (!sb) throw new Error('尚未設定雲端');
  const { data, error } = await sb.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: `${location.origin}${location.pathname}` } });
  if (error) throw new Error(friendlyError(error));
  return data.session ? 'signed-in' : 'confirm-email';
}

export async function signOut(): Promise<void> {
  await getSupabase()?.auth.signOut();
}

export async function resolveConflict(entityId: string, choice: ConflictChoice): Promise<void> {
  if (!engine) return;
  const r = await engine.resolve(entityId, choice, () => `proj-${crypto.randomUUID().slice(0, 8)}`);
  const app = useStore.getState();
  if (r.changed.includes(app.history.present.id)) {
    const p = await getRepository().getProject(app.history.present.id);
    if (p) app.loadProject(p);
  }
  await refreshCounts();
  await syncNow();
}
