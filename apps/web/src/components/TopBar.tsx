import { useEffect, useRef, useState } from 'react';
import { setTitle } from '@btl/tactic-engine';
import { useProject, useStore } from '../app/store';
import { boardRef } from '../features/court/boardRef';
import { exportJson, exportPng, importJsonFile } from '../features/storage/persistence';
import { ProjectDialog } from './ProjectDialog';

function useFullscreen() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const h = () => setOn(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);
  const toggle = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      useStore.getState().showToast('此瀏覽器不支援全螢幕；可改用「專注模式」放大球場', 'error');
      useStore.getState().toggleFocus();
    }
  };
  return { on, toggle };
}

export function TopBar() {
  const project = useProject();
  const canUndo = useStore((s) => s.history.past.length > 0);
  const canRedo = useStore((s) => s.history.future.length > 0);
  const saveStatus = useStore((s) => s.saveStatus);
  const lastSavedAt = useStore((s) => s.lastSavedAt);
  const focusMode = useStore((s) => s.focusMode);
  const [titleDraft, setTitleDraft] = useState(project.title);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const fs = useFullscreen();
  const s = useStore.getState;

  useEffect(() => setTitleDraft(project.title), [project.title]);

  const statusText =
    saveStatus === 'loading' ? '載入中…' : saveStatus === 'saving' ? '儲存中…' : saveStatus === 'error' ? '⚠ 無法儲存' : lastSavedAt ? `✓ 已自動儲存 ${lastSavedAt}` : '✓ 已儲存';

  return (
    <header className="topbar">
      <div className="brand">
        <svg width="30" height="30" viewBox="0 0 64 64" aria-hidden>
          <circle cx="32" cy="32" r="29" fill="#ee7b2c" stroke="#14213d" strokeWidth="3" />
          <path d="M3 32h58M32 3v58M12 12c10 9 10 31 0 40M52 12c-10 9-10 31 0 40" fill="none" stroke="#14213d" strokeWidth="3" />
        </svg>
        <div>
          <strong>籃球戰術白板</strong>
          <small>Basketball Tactics Lab</small>
        </div>
      </div>
      <input
        className="title-input"
        value={titleDraft}
        aria-label="戰術名稱"
        data-testid="project-title"
        onChange={(e) => setTitleDraft(e.target.value)}
        onBlur={() => titleDraft !== project.title && s().commit((p) => setTitle(p, titleDraft))}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <div className="topbar-actions">
        <button type="button" className="btn" onClick={() => setProjectsOpen(true)} data-testid="open-projects">
          📁 戰術檔
        </button>
        <span className="divider" />
        <button type="button" className="btn icon" onClick={() => s().undo()} disabled={!canUndo} aria-label="復原" title="復原（Ctrl+Z）" data-testid="undo">
          ↶
        </button>
        <button type="button" className="btn icon" onClick={() => s().redo()} disabled={!canRedo} aria-label="重做" title="重做（Ctrl+Y）" data-testid="redo">
          ↷
        </button>
        <span className="divider" />
        <button type="button" className="btn" onClick={() => fileRef.current?.click()} data-testid="import">
          匯入
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          data-testid="import-file"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            const r = await importJsonFile(f);
            s().showToast(r.message, r.ok ? 'info' : 'error');
          }}
        />
        <button type="button" className="btn" onClick={() => exportJson()} data-testid="export-json">
          匯出 JSON
        </button>
        <button
          type="button"
          className="btn"
          onClick={async () => {
            if (!boardRef.current) return;
            try {
              await exportPng(boardRef.current, project.title);
            } catch (err) {
              s().showToast(err instanceof Error ? err.message : 'PNG 匯出失敗', 'error');
            }
          }}
        >
          PNG
        </button>
        <span className="divider" />
        <button type="button" className={`btn ${focusMode ? 'is-on' : ''}`} aria-pressed={focusMode} onClick={() => s().toggleFocus()} title="隱藏側欄，球場放到最大">
          ◱ 專注
        </button>
        <button type="button" className={`btn ${fs.on ? 'is-on' : ''}`} onClick={() => void fs.toggle()} data-testid="fullscreen">
          ⛶ 全螢幕
        </button>
      </div>
      <span className={`save-status ${saveStatus}`} data-testid="save-status" aria-live="polite">
        {statusText}
      </span>
      {projectsOpen && <ProjectDialog onClose={() => setProjectsOpen(false)} />}
    </header>
  );
}
