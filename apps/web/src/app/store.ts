import { create } from 'zustand';
import type { AnnotationKind, Formation, TacticProject, Vec2 } from '@btl/shared-types';
import {
  canRedo,
  canUndo,
  commitGesture,
  createHistory,
  createProject,
  pushHistory,
  redo as redoHistory,
  segmentAt,
  stepTimes,
  totalDuration,
  undo as undoHistory,
  type History,
} from '@btl/tactic-engine';

export type InteractionMode = 'move' | 'draw';
export type DrawTool = AnnotationKind | 'eraser';
export type SaveStatus = 'loading' | 'idle' | 'saving' | 'saved' | 'error';

export interface PlaybackState {
  /** null = 編輯模式（顯示目前步驟）；數字 = 播放／暫停中的時間點 */
  timeMs: number | null;
  playing: boolean;
  speed: number;
  loop: boolean;
  /** 「下一步」只播放一段，到此時間點自動停下 */
  stopAtMs: number | null;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

export interface AppState {
  history: History<TacticProject>;
  gestureBase: TacticProject | null;
  formations: Formation[];
  currentStep: number;
  selectedId: string | null;
  mode: InteractionMode;
  drawTool: DrawTool;
  drawColor: string;
  playback: PlaybackState;
  zoom: number;
  pan: Vec2;
  focusMode: boolean;
  saveStatus: SaveStatus;
  lastSavedAt: string | null;
  toast: Toast | null;

  /** 以一筆紀錄套用變更（可復原） */
  commit: (fn: (p: TacticProject) => TacticProject) => void;
  beginGesture: () => void;
  gestureUpdate: (fn: (p: TacticProject) => TacticProject) => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;
  loadProject: (p: TacticProject) => void;
  setCurrentStep: (i: number) => void;
  select: (id: string | null) => void;
  setMode: (m: InteractionMode) => void;
  setDrawTool: (t: DrawTool) => void;
  setDrawColor: (c: string) => void;

  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  exitPlayback: () => void;
  nextStep: () => void;
  prevStep: () => void;
  seek: (ms: number) => void;
  tick: (dtMs: number) => void;
  setSpeed: (s: number) => void;
  toggleLoop: () => void;

  setFormations: (list: Formation[]) => void;
  setZoom: (z: number) => void;
  setPan: (p: Vec2) => void;
  resetView: () => void;
  toggleFocus: () => void;
  setSaveStatus: (s: SaveStatus, at?: string) => void;
  showToast: (text: string, kind?: Toast['kind']) => void;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;

let toastId = 0;

function clampStep(p: TacticProject, i: number): number {
  return Math.max(0, Math.min(p.steps.length - 1, i));
}

/** 離開播放時回到最近的步驟 */
function nearestStep(p: TacticProject, timeMs: number): number {
  const seg = segmentAt(p.steps, timeMs);
  return seg.local >= 0.5 ? seg.toIndex : seg.fromIndex;
}

const idlePlayback = (speed: number, loop: boolean): PlaybackState => ({
  timeMs: null,
  playing: false,
  speed,
  loop,
  stopAtMs: null,
});

export const useStore = create<AppState>()((set, get) => ({
  history: createHistory(createProject()),
  gestureBase: null,
  formations: [],
  currentStep: 0,
  selectedId: null,
  mode: 'move',
  drawTool: 'run',
  drawColor: '#1d1d1f',
  playback: idlePlayback(1, false),
  zoom: 1,
  pan: { x: 0, y: 0 },
  focusMode: false,
  saveStatus: 'loading',
  lastSavedAt: null,
  toast: null,

  commit: (fn) => {
    const { history } = get();
    const next = fn(history.present);
    if (next === history.present) return;
    set({ history: pushHistory(history, next), currentStep: clampStep(next, get().currentStep) });
  },
  beginGesture: () => set({ gestureBase: get().history.present }),
  gestureUpdate: (fn) => {
    const { history } = get();
    const next = fn(history.present);
    if (next !== history.present) set({ history: { ...history, present: next } });
  },
  endGesture: () => {
    const { gestureBase, history } = get();
    if (!gestureBase) return;
    set({ history: commitGesture(history, gestureBase), gestureBase: null });
  },
  undo: () => {
    const { history, playback } = get();
    if (!canUndo(history)) return;
    const h = undoHistory(history);
    set({ history: h, currentStep: clampStep(h.present, get().currentStep), playback: idlePlayback(playback.speed, playback.loop) });
  },
  redo: () => {
    const { history, playback } = get();
    if (!canRedo(history)) return;
    const h = redoHistory(history);
    set({ history: h, currentStep: clampStep(h.present, get().currentStep), playback: idlePlayback(playback.speed, playback.loop) });
  },
  loadProject: (p) => {
    const { playback } = get();
    set({
      history: createHistory(p),
      currentStep: 0,
      selectedId: null,
      playback: idlePlayback(playback.speed, playback.loop),
      zoom: 1,
      pan: { x: 0, y: 0 },
    });
  },
  setCurrentStep: (i) => {
    const { history, playback } = get();
    set({ currentStep: clampStep(history.present, i), playback: idlePlayback(playback.speed, playback.loop) });
  },
  select: (id) => set({ selectedId: id }),
  setMode: (m) => set({ mode: m }),
  setDrawTool: (t) => set({ drawTool: t, mode: 'draw' }),
  setDrawColor: (c) => set({ drawColor: c }),

  play: () => {
    const { history, currentStep, playback } = get();
    const p = history.present;
    if (p.steps.length < 2) {
      get().showToast('至少需要兩個步驟才能播放動畫；請先按「＋新增步驟」');
      return;
    }
    let t = playback.timeMs;
    const total = totalDuration(p.steps);
    if (t === null || t >= total) {
      t = currentStep >= p.steps.length - 1 ? 0 : (stepTimes(p.steps)[currentStep] ?? 0);
    }
    set({ playback: { ...playback, timeMs: t, playing: true, stopAtMs: null }, mode: 'move' });
  },
  pause: () => set({ playback: { ...get().playback, playing: false } }),
  togglePlay: () => (get().playback.playing ? get().pause() : get().play()),
  exitPlayback: () => {
    const { playback, history } = get();
    if (playback.timeMs === null) return;
    set({ currentStep: nearestStep(history.present, playback.timeMs), playback: idlePlayback(playback.speed, playback.loop) });
  },
  nextStep: () => {
    const { history, playback } = get();
    const p = history.present;
    let cur = get().currentStep;
    if (playback.timeMs !== null) cur = nearestStep(p, playback.timeMs);
    if (cur >= p.steps.length - 1) {
      set({ currentStep: cur, playback: idlePlayback(playback.speed, playback.loop) });
      return;
    }
    const times = stepTimes(p.steps);
    set({
      currentStep: cur,
      mode: 'move',
      playback: { ...playback, timeMs: times[cur] ?? 0, playing: true, stopAtMs: times[cur + 1] ?? 0 },
    });
  },
  prevStep: () => {
    const { history, playback } = get();
    let cur = get().currentStep;
    if (playback.timeMs !== null) {
      const seg = segmentAt(history.present.steps, playback.timeMs);
      cur = seg.local > 0 ? seg.toIndex : seg.fromIndex;
    }
    set({ currentStep: Math.max(0, cur - 1), playback: idlePlayback(playback.speed, playback.loop) });
  },
  seek: (ms) => {
    const { playback, history } = get();
    const total = totalDuration(history.present.steps);
    set({ playback: { ...playback, timeMs: Math.max(0, Math.min(total, ms)), playing: false, stopAtMs: null } });
  },
  tick: (dtMs) => {
    const { playback, history } = get();
    if (!playback.playing || playback.timeMs === null) return;
    const p = history.present;
    const total = totalDuration(p.steps);
    let t = playback.timeMs + dtMs * playback.speed;
    if (playback.stopAtMs !== null && t >= playback.stopAtMs) {
      set({ currentStep: nearestStep(p, playback.stopAtMs), playback: idlePlayback(playback.speed, playback.loop) });
      return;
    }
    if (t >= total) {
      if (playback.loop && total > 0) {
        t = t % total;
      } else {
        set({ currentStep: p.steps.length - 1, playback: idlePlayback(playback.speed, playback.loop) });
        return;
      }
    }
    set({ playback: { ...playback, timeMs: t } });
  },
  setSpeed: (s) => set({ playback: { ...get().playback, speed: s } }),
  toggleLoop: () => set({ playback: { ...get().playback, loop: !get().playback.loop } }),

  setFormations: (list) => set({ formations: list }),
  setZoom: (z) => set({ zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(z * 100) / 100)) }),
  setPan: (p) => set({ pan: p }),
  resetView: () => set({ zoom: 1, pan: { x: 0, y: 0 } }),
  toggleFocus: () => set({ focusMode: !get().focusMode }),
  setSaveStatus: (s, at) => set({ saveStatus: s, lastSavedAt: at ?? get().lastSavedAt }),
  showToast: (text, kind = 'info') => set({ toast: { id: ++toastId, text, kind } }),
}));

export const useProject = () => useStore((s) => s.history.present);
export const useCurrentStep = () =>
  useStore((s) => s.history.present.steps[s.currentStep] ?? s.history.present.steps[0]!);
export const useIsPlayback = () => useStore((s) => s.playback.timeMs !== null);
