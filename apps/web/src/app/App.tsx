import { useEffect } from 'react';
import { describeEvent, movePlayer, segmentAt } from '@btl/tactic-engine';
import { TopBar } from '../components/TopBar';
import { CourtBoard } from '../features/court/CourtBoard';
import { SetupPanel } from '../features/court/SetupPanel';
import { FormationPanel } from '../features/formations/FormationPanel';
import { PlayerPanel } from '../features/players/PlayerPanel';
import { PlaybackBar } from '../features/animation/PlaybackBar';
import { StepPanel } from '../features/animation/StepPanel';
import { usePlaybackLoop } from '../features/animation/usePlaybackLoop';
import { bootstrap, startAutosave } from '../features/storage/persistence';
import { useCurrentStep, useProject, useStore } from './store';

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const s = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        s.redo();
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        s.togglePlay();
        return;
      }
      if (e.key === 'Escape') {
        s.exitPlayback();
        s.select(null);
        return;
      }
      const arrows: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
      const dir = arrows[e.key];
      if (dir && s.selectedId && s.playback.timeMs === null) {
        // 方向鍵以「畫面方向」微調選取的球員（Shift 加大）
        e.preventDefault();
        const p = s.history.present;
        const pos = p.steps[s.currentStep]?.players[s.selectedId];
        if (!pos) return;
        const k = e.shiftKey ? 0.5 : 0.1;
        let [dx, dy] = [dir[0] * k, dir[1] * k];
        if (p.court.mode === 'half') {
          // 半場畫面為旋轉顯示：畫面 (vx, vy) → 球場向量
          [dx, dy] = p.court.attackDirection === 'right' ? [-dy, dx] : [dy, -dx];
        }
        const id = s.selectedId;
        s.commit((q) => movePlayer(q, s.currentStep, id, { x: pos.x + dx, y: pos.y + dy }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** 球場上方的步驟說明（大屏幕講解用） */
function BoardOverlay() {
  const project = useProject();
  const step = useCurrentStep();
  const timeMs = useStore((s) => s.playback.timeMs);
  const playing = useStore((s) => s.playback.playing);
  const mode = useStore((s) => s.mode);
  const drawTool = useStore((s) => s.drawTool);
  const currentStep = useStore((s) => s.currentStep);
  let idx = currentStep;
  if (timeMs !== null) {
    // 播放時顯示正在前往的步驟
    const seg = segmentAt(project.steps, timeMs);
    idx = seg.local > 0 ? seg.toIndex : seg.fromIndex;
  }
  const shown = project.steps[idx] ?? step;
  return (
    <div className="board-overlay">
      <div className="step-badge" data-testid="board-step-title">
        <b>{idx + 1}</b>
        <span>{shown.title || `步驟 ${idx + 1}`}</span>
        {timeMs !== null && <em>{playing ? '播放中' : '已暫停'}</em>}
        {timeMs === null && mode === 'draw' && <em className="draw">{drawTool === 'eraser' ? '橡皮擦：點線條刪除' : '繪圖模式'}</em>}
      </div>
      {(shown.note || shown.events.length > 0) && (
        <div className="step-note">
          {shown.events.map((e) => (
            <span key={e.id} className="event-chip">
              {describeEvent(project, e)}
            </span>
          ))}
          {shown.note && <p>{shown.note}</p>}
        </div>
      )}
    </div>
  );
}

function ToastHost() {
  const toast = useStore((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => useStore.setState({ toast: null }), toast.kind === 'error' ? 5000 : 2600);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return (
    <div className={`toast ${toast.kind}`} role="status" data-testid="toast">
      {toast.text}
    </div>
  );
}

export function App() {
  const focusMode = useStore((s) => s.focusMode);
  const courtMode = useProject().court.mode;
  usePlaybackLoop();
  useShortcuts();
  useEffect(() => {
    void bootstrap();
    return startAutosave();
  }, []);

  return (
    <div className={`app ${focusMode ? 'focus' : ''}`} data-court={courtMode}>
      <TopBar />
      <aside className="panel left" aria-label="設定">
        <SetupPanel />
        <FormationPanel />
      </aside>
      <main className="board" aria-label="戰術球場">
        <BoardOverlay />
        <CourtBoard />
      </main>
      <aside className="panel right" aria-label="球員與步驟">
        <PlayerPanel />
        <StepPanel />
      </aside>
      <footer className="bottom">
        <PlaybackBar />
      </footer>
      <ToastHost />
    </div>
  );
}
