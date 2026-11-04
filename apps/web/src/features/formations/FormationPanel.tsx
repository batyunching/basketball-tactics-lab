import { useEffect, useState } from 'react';
import type { Formation } from '@btl/shared-types';
import {
  applyFormation,
  captureFormation,
  createBuiltInFormations,
  duplicateFormation,
  renameFormation,
  sortFormations,
} from '@btl/tactic-engine';
import { useIsPlayback, useStore } from '../../app/store';
import { Section } from '../../components/Section';

type Pending = { id: string; action: 'overwrite' | 'delete' } | null;

/** 預設隊形（M05）：快速點選 + 新增／保存／改名／複製／刪除 */
export function FormationPanel() {
  const formations = useStore((s) => s.formations);
  const playback = useIsPlayback();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const s = useStore.getState;

  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(null), 3500);
    return () => clearTimeout(t);
  }, [pending]);

  const list = sortFormations(formations);
  const nextOrder = () => Math.max(-1, ...formations.map((f) => f.order)) + 1;
  const replace = (next: Formation[]) => s().setFormations(sortFormations(next));

  const apply = (f: Formation) => {
    const st = s();
    st.commit((p) => applyFormation(p, st.currentStep, f));
    st.resetView();
    st.showToast(`已套用「${f.name}」`);
  };

  const overwrite = (f: Formation) => {
    if (pending?.id !== f.id || pending.action !== 'overwrite') {
      setPending({ id: f.id, action: 'overwrite' });
      return;
    }
    const st = s();
    const captured = captureFormation(st.history.present, st.currentStep, f.name, { id: f.id, order: f.order, builtIn: false });
    replace(formations.map((x) => (x.id === f.id ? captured : x)));
    setPending(null);
    st.showToast(`已把目前站位保存到「${f.name}」`);
  };

  const remove = (f: Formation) => {
    if (pending?.id !== f.id || pending.action !== 'delete') {
      setPending({ id: f.id, action: 'delete' });
      return;
    }
    replace(formations.filter((x) => x.id !== f.id));
    setPending(null);
    s().showToast(`已刪除「${f.name}」`);
  };

  const addNew = () => {
    const st = s();
    const f = captureFormation(st.history.present, st.currentStep, `我的隊形 ${formations.length + 1}`, {
      id: `form-${Date.now().toString(36)}`,
      order: nextOrder(),
      builtIn: false,
    });
    replace([...formations, f]);
    setEditingId(f.id);
    setNameDraft(f.name);
  };

  const restoreBuiltIns = () => {
    const builtIns = createBuiltInFormations();
    const ids = new Set(builtIns.map((b) => b.id));
    replace([...builtIns, ...formations.filter((f) => !ids.has(f.id))]);
    s().showToast('已還原內建五組隊形');
  };

  const commitRename = (f: Formation) => {
    replace(formations.map((x) => (x.id === f.id ? renameFormation(x, nameDraft) : x)));
    setEditingId(null);
  };

  return (
    <Section
      title="預設隊形"
      en="Formations"
      actions={
        <button type="button" className="btn tiny" onClick={addNew} disabled={playback} data-testid="formation-add">
          ＋ 新增
        </button>
      }
    >
      <div className="quick-formations" aria-label="快速套用隊形">
        {list.slice(0, 5).map((f, i) => (
          <button key={f.id} type="button" className="quick" title={f.name} disabled={playback} onClick={() => apply(f)} data-testid={`formation-quick-${i + 1}`}>
            <b>{i + 1}</b>
            <span>{f.name}</span>
          </button>
        ))}
      </div>
      <ul className="formation-list" data-testid="formation-list">
        {list.map((f, i) => (
          <li key={f.id}>
            <div className="formation-title">
              <span className="badge">{i + 1}</span>
              {editingId === f.id ? (
                <input
                  autoFocus
                  value={nameDraft}
                  aria-label="隊形名稱"
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={() => commitRename(f)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(f);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="link"
                  title="套用此隊形"
                  onClick={() => apply(f)}
                  disabled={playback}
                >
                  {f.name}
                </button>
              )}
              <small className="muted">
                {f.teamSize}v{f.teamSize}・{f.courtMode === 'half' ? '半場' : '全場'}
              </small>
            </div>
            <div className="formation-actions">
              <button type="button" className={`btn tiny ${pending?.id === f.id && pending.action === 'overwrite' ? 'danger' : ''}`} disabled={playback} onClick={() => overwrite(f)} data-testid={`formation-save-${i + 1}`}>
                {pending?.id === f.id && pending.action === 'overwrite' ? '再按一次覆寫' : '保存目前站位'}
              </button>
              <button
                type="button"
                className="btn tiny ghost"
                onClick={() => {
                  setEditingId(f.id);
                  setNameDraft(f.name);
                }}
              >
                改名
              </button>
              <button type="button" className="btn tiny ghost" onClick={() => replace([...formations, duplicateFormation(f, nextOrder())])}>
                複製
              </button>
              <button type="button" className={`btn tiny ${pending?.id === f.id && pending.action === 'delete' ? 'danger' : 'ghost'}`} onClick={() => remove(f)}>
                {pending?.id === f.id && pending.action === 'delete' ? '確認刪除' : '刪除'}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <button type="button" className="btn ghost small" onClick={restoreBuiltIns}>
        還原內建五組
      </button>
    </Section>
  );
}
