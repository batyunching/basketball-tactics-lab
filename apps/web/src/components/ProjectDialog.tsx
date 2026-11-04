import { useEffect, useState } from 'react';
import { useProject, useStore } from '../app/store';
import type { ProjectSummary } from '../features/storage/db';
import { deleteProject, getRepository, newProject, openProject } from '../features/storage/persistence';

/** 戰術檔管理：新專案、開啟、刪除（皆存在本機 IndexedDB） */
export function ProjectDialog({ onClose }: { onClose: () => void }) {
  const current = useProject();
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const refresh = () => {
    getRepository()
      .listProjects()
      .then(setList)
      .catch(() => setList([]));
  };
  useEffect(refresh, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const create = async (mode: 'half' | 'full', size: 3 | 5) => {
    await newProject({ title: `新戰術 ${size}v${size}${mode === 'half' ? '半場' : '全場'}`, mode, teamSize: size });
    useStore.getState().showToast('已建立新戰術');
    onClose();
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="戰術檔" data-testid="project-dialog">
        <header>
          <h2>戰術檔</h2>
          <button type="button" className="btn icon" onClick={onClose} aria-label="關閉">
            ✕
          </button>
        </header>
        <div className="btn-row">
          <button type="button" className="btn primary" onClick={() => void create('half', 3)} data-testid="new-project">
            ＋ 新戰術（3v3 半場）
          </button>
          <button type="button" className="btn" onClick={() => void create('half', 5)}>
            ＋ 5v5 半場
          </button>
          <button type="button" className="btn" onClick={() => void create('full', 5)}>
            ＋ 5v5 全場
          </button>
        </div>
        {list === null ? (
          <p className="muted">讀取中…</p>
        ) : list.length === 0 ? (
          <p className="muted">尚無已儲存的戰術。</p>
        ) : (
          <ul className="project-list">
            {list.map((p) => (
              <li key={p.id} className={p.id === current.id ? 'is-current' : ''}>
                <button
                  type="button"
                  className="link"
                  onClick={async () => {
                    await openProject(p.id);
                    onClose();
                  }}
                >
                  <strong>{p.title}</strong>
                  <small className="muted">
                    {p.teamSize}v{p.teamSize}・{p.courtMode === 'half' ? '半場' : '全場'}・{p.stepCount} 步・{new Date(p.updatedAt).toLocaleString('zh-TW', { hour12: false })}
                  </small>
                </button>
                {p.id === current.id && <span className="badge">目前</span>}
                <button
                  type="button"
                  className={`btn tiny ${confirmId === p.id ? 'danger' : 'ghost'}`}
                  onClick={async () => {
                    if (confirmId !== p.id) {
                      setConfirmId(p.id);
                      return;
                    }
                    await deleteProject(p.id);
                    setConfirmId(null);
                    refresh();
                  }}
                >
                  {confirmId === p.id ? '確認刪除' : '刪除'}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">資料自動儲存在這台裝置的瀏覽器中。換電腦請用「匯出 JSON」帶走，再到新電腦「匯入」。</p>
      </div>
    </div>
  );
}
