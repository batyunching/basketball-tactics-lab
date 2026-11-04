import type { Formation, TacticProject } from '@btl/shared-types';
import { cloneAsNewProject, createBuiltInFormations, createProject, type CreateProjectOptions } from '@btl/tactic-engine';
import { buildExportBundle, parseExportJson, parseProject } from '@btl/data-schemas';
import { useStore } from '../../app/store';
import { repository, type TacticRepository } from './db';

const LAST_PROJECT_KEY = 'lastProjectId';
const SAVE_DELAY_MS = 500;

let repo: TacticRepository = repository;
/** 測試時可替換儲存實作 */
export function setRepository(r: TacticRepository): void {
  repo = r;
}
export function getRepository(): TacticRepository {
  return repo;
}

type SyncHook = (id: string, kind: 'upsert' | 'delete') => Promise<void> | void;
let syncHook: SyncHook | null = null;
/** 雲端同步啟用時，每次本機存檔後通知同步引擎 */
export function setSyncHook(h: SyncHook | null): void {
  syncHook = h;
}
async function notifySync(id: string, kind: 'upsert' | 'delete'): Promise<void> {
  try {
    await syncHook?.(id, kind);
  } catch (err) {
    console.error(err);
  }
}

let lastSavedProject: TacticProject | null = null;
let lastSavedFormations: Formation[] | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> = Promise.resolve();

function timeLabel(): string {
  return new Date().toLocaleTimeString('zh-TW', { hour12: false });
}

let booting: Promise<void> | null = null;

/** 啟動（只執行一次，React StrictMode 重複呼叫也安全） */
export function bootstrap(): Promise<void> {
  booting ??= doBootstrap();
  return booting;
}

/** 測試用：重設啟動狀態 */
export function resetPersistenceForTests(): void {
  booting = null;
  lastSavedProject = null;
  lastSavedFormations = null;
}

/** 載入隊形與上次的專案；資料損毀時建立新專案，不讓畫面空白 */
async function doBootstrap(): Promise<void> {
  const s = useStore.getState();
  s.setSaveStatus('loading');
  try {
    let forms = await repo.listFormations();
    if (forms.length === 0) {
      forms = createBuiltInFormations();
      await repo.replaceFormations(forms);
    }
    let project: TacticProject | undefined;
    const lastId = await repo.getMeta<string>(LAST_PROJECT_KEY);
    if (lastId) project = await repo.getProject(lastId);
    if (!project) {
      const list = await repo.listProjects();
      if (list[0]) project = await repo.getProject(list[0].id);
    }
    if (project && !parseProject(project).ok) {
      s.showToast('上次的戰術資料格式異常，已建立新的戰術', 'error');
      project = undefined;
    }
    if (!project) project = await repo.saveProject(createProject({ title: '我的第一個戰術' }));
    await repo.setMeta(LAST_PROJECT_KEY, project.id);
    lastSavedProject = project;
    lastSavedFormations = forms;
    s.setFormations(forms);
    s.loadProject(project);
    s.setSaveStatus('saved', timeLabel());
  } catch (err) {
    console.error(err);
    s.setSaveStatus('error');
    s.showToast('無法使用瀏覽器本機儲存（IndexedDB）；仍可操作，但重新整理後資料不會保留', 'error');
  }
}

async function doSave(): Promise<void> {
  const s = useStore.getState();
  const project = s.history.present;
  const forms = s.formations;
  if (project === lastSavedProject && forms === lastSavedFormations) return;
  s.setSaveStatus('saving');
  try {
    if (project !== lastSavedProject) {
      await repo.saveProject(project);
      await repo.setMeta(LAST_PROJECT_KEY, project.id);
      lastSavedProject = project;
      await notifySync(project.id, 'upsert');
    }
    if (forms !== lastSavedFormations) {
      await repo.replaceFormations(forms);
      lastSavedFormations = forms;
    }
    useStore.getState().setSaveStatus('saved', timeLabel());
  } catch (err) {
    console.error(err);
    useStore.getState().setSaveStatus('error');
  }
}

/** 立即寫入尚未保存的變更 */
export function flushSave(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  saving = saving.then(doSave);
  return saving;
}

/** 自動儲存：變更後 0.5 秒寫入 IndexedDB；拖曳中不寫入 */
export function startAutosave(): () => void {
  const unsub = useStore.subscribe((state, prev) => {
    if (state.saveStatus === 'loading') return;
    if (state.gestureBase) return;
    if (state.history.present === prev.history.present && state.formations === prev.formations && prev.gestureBase === null) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flushSave(), SAVE_DELAY_MS);
  });
  const onHide = () => {
    if (document.visibilityState === 'hidden') void flushSave();
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onHide);
  return () => {
    unsub();
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onHide);
  };
}

// ───────────────────────── 專案管理 ─────────────────────────

export async function openProject(id: string): Promise<void> {
  await flushSave();
  const p = await repo.getProject(id);
  if (!p) return;
  lastSavedProject = p;
  await repo.setMeta(LAST_PROJECT_KEY, p.id);
  useStore.getState().loadProject(p);
}

/** 把一份戰術（例如教材副本）存成新的本機戰術並開啟 */
export async function openAsNewProject(project: TacticProject, titleSuffix = '（副本）'): Promise<void> {
  await flushSave();
  const p = await repo.saveProject(cloneAsNewProject(project, titleSuffix));
  lastSavedProject = p;
  await repo.setMeta(LAST_PROJECT_KEY, p.id);
  await notifySync(p.id, 'upsert');
  useStore.getState().loadProject(p);
}

export async function newProject(opts: CreateProjectOptions): Promise<void> {
  await flushSave();
  const p = await repo.saveProject(createProject(opts));
  lastSavedProject = p;
  await notifySync(p.id, 'upsert');
  await repo.setMeta(LAST_PROJECT_KEY, p.id);
  useStore.getState().loadProject(p);
}

export async function deleteProject(id: string): Promise<void> {
  const current = useStore.getState().history.present.id;
  await repo.deleteProject(id);
  await notifySync(id, 'delete');
  if (id === current) {
    const list = await repo.listProjects();
    if (list[0]) {
      lastSavedProject = null;
      await openProject(list[0].id);
    } else {
      await newProject({ title: '未命名戰術' });
    }
  }
}

// ───────────────────────── 匯入匯出 ─────────────────────────

function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'tactic';
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportJson(includeFormations = true): string {
  const s = useStore.getState();
  const bundle = buildExportBundle(s.history.present, includeFormations ? s.formations : undefined);
  const text = JSON.stringify(bundle, null, 2);
  downloadBlob(new Blob([text], { type: 'application/json' }), `${safeFileName(s.history.present.title)}-${stamp()}.json`);
  return text;
}

export interface ImportResult {
  ok: boolean;
  message: string;
}

/** 匯入：戰術以「新專案」加入（不覆蓋現有）；同 id 隊形覆寫、其餘新增 */
export async function importJsonText(text: string): Promise<ImportResult> {
  const r = parseExportJson(text);
  if (!r.ok) return { ok: false, message: `匯入失敗：${r.errors.join('；')}` };
  const s = useStore.getState();
  const parts: string[] = [];
  if (r.value.formations.length) {
    const map = new Map(s.formations.map((f) => [f.id, f]));
    let order = Math.max(0, ...s.formations.map((f) => f.order)) + 1;
    for (const f of r.value.formations) {
      map.set(f.id, map.has(f.id) ? f : { ...f, order: order++ });
    }
    s.setFormations([...map.values()].sort((a, b) => a.order - b.order));
    parts.push(`${r.value.formations.length} 組隊形`);
  }
  if (r.value.project) {
    await flushSave();
    const imported = await repo.saveProject(cloneAsNewProject(r.value.project, '（匯入）'));
    lastSavedProject = imported;
    await notifySync(imported.id, 'upsert');
    await repo.setMeta(LAST_PROJECT_KEY, imported.id);
    useStore.getState().loadProject(imported);
    parts.push(`戰術「${imported.title}」`);
  }
  return { ok: true, message: `已匯入 ${parts.join('、')}` };
}

export async function importJsonFile(file: File): Promise<ImportResult> {
  if (file.size > 10 * 1024 * 1024) return { ok: false, message: '檔案太大（上限 10MB）' };
  return importJsonText(await file.text());
}

/** 將球場 SVG 轉成 PNG 下載（教學講義、備份用） */
export async function exportPng(svg: SVGSVGElement, title: string, widthPx = 1800): Promise<void> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const vb = svg.viewBox.baseVal;
  const heightPx = Math.round((widthPx * vb.height) / vb.width);
  clone.setAttribute('width', String(widthPx));
  clone.setAttribute('height', String(heightPx));
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.querySelectorAll('[data-export-hide]').forEach((n) => n.remove());
  const xml = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('圖片轉換失敗'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = widthPx;
    canvas.height = heightPx;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('瀏覽器不支援 Canvas');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, widthPx, heightPx);
    ctx.drawImage(img, 0, 0, widthPx, heightPx);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error('PNG 產生失敗');
    downloadBlob(blob, `${safeFileName(title)}-${stamp()}.png`);
  } finally {
    URL.revokeObjectURL(url);
  }
}
