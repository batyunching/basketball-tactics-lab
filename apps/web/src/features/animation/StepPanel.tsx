import { useEffect, useState } from 'react';
import { MAX_STEP_DURATION_MS, MIN_STEP_DURATION_MS, addStep, moveStep, removeStep, segmentAt, updateStepMeta } from '@btl/tactic-engine';
import { useCurrentStep, useIsPlayback, useProject, useStore } from '../../app/store';
import { Section } from '../../components/Section';

/** 文字欄位：輸入時即時顯示，離開欄位才寫入歷史（避免每個字一筆復原） */
function useDraft(value: string, onCommit: (v: string) => void) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return {
    value: draft,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: () => {
      if (draft !== value) onCommit(draft);
    },
  };
}

/** 動畫步驟編輯（M06）：新增、刪除、排序、時間、教師註解 */
export function StepPanel() {
  const project = useProject();
  const step = useCurrentStep();
  const currentStep = useStore((s) => s.currentStep);
  const timeMs = useStore((s) => s.playback.timeMs);
  const playback = useIsPlayback();
  const s = useStore.getState;
  const n = project.steps.length;
  const seg = timeMs !== null ? segmentAt(project.steps, timeMs) : null;
  const highlighted = seg ? (seg.local > 0 ? seg.toIndex : seg.fromIndex) : currentStep;

  const title = useDraft(step.title, (v) => s().commit((p) => updateStepMeta(p, currentStep, { title: v })));
  const note = useDraft(step.note, (v) => s().commit((p) => updateStepMeta(p, currentStep, { note: v })));

  const add = () => {
    const st = s();
    st.commit((p) => addStep(p, st.currentStep));
    st.setCurrentStep(st.currentStep + 1);
  };

  return (
    <Section
      title="戰術步驟"
      en="Steps"
      actions={
        <button type="button" className="btn tiny primary" onClick={add} disabled={playback} data-testid="add-step">
          ＋ 新增步驟
        </button>
      }
    >
      <ol className="step-list" data-testid="step-list">
        {project.steps.map((st, i) => (
          <li key={st.id} className={i === highlighted ? 'is-current' : ''}>
            <button type="button" className="step-btn" onClick={() => s().setCurrentStep(i)} aria-current={i === highlighted ? 'step' : undefined}>
              <b>{i + 1}</b>
              <span className="step-title">{st.title || `步驟 ${i + 1}`}</span>
              <small className="muted">
                {i === 0 ? '起始' : `${(st.durationMs / 1000).toFixed(1)}s`}
                {st.events.length > 0 && ` ・${st.events.length} 事件`}
                {st.annotations.length > 0 && ` ・${st.annotations.length} 線`}
              </small>
            </button>
          </li>
        ))}
      </ol>

      <div className="step-edit">
        <div className="btn-row">
          <button type="button" className="btn tiny ghost" disabled={playback || currentStep === 0} onClick={() => {
            s().commit((p) => moveStep(p, currentStep, currentStep - 1));
            s().setCurrentStep(currentStep - 1);
          }}>
            ↑ 上移
          </button>
          <button type="button" className="btn tiny ghost" disabled={playback || currentStep >= n - 1} onClick={() => {
            s().commit((p) => moveStep(p, currentStep, currentStep + 1));
            s().setCurrentStep(currentStep + 1);
          }}>
            ↓ 下移
          </button>
          <button type="button" className="btn tiny ghost" disabled={playback || n <= 1} onClick={() => s().commit((p) => removeStep(p, currentStep))} data-testid="remove-step">
            刪除此步
          </button>
        </div>
        <label className="field">
          <span>步驟名稱</span>
          <input {...title} disabled={playback} placeholder="例如：掩護、突破、空切" data-testid="step-title" />
        </label>
        {currentStep > 0 ? (
          <label className="field">
            <span>移動時間 {(step.durationMs / 1000).toFixed(1)} 秒</span>
            <input
              type="range"
              min={MIN_STEP_DURATION_MS}
              max={MAX_STEP_DURATION_MS / 2}
              step={100}
              value={step.durationMs}
              disabled={playback}
              onPointerDown={() => s().beginGesture()}
              onPointerUp={() => s().endGesture()}
              onChange={(e) => {
                const v = Number(e.target.value);
                const st = s();
                if (st.gestureBase) st.gestureUpdate((p) => updateStepMeta(p, currentStep, { durationMs: v }));
                else st.commit((p) => updateStepMeta(p, currentStep, { durationMs: v }));
              }}
            />
          </label>
        ) : (
          <p className="muted small">第 1 步為起始站位。按「＋ 新增步驟」複製目前位置後，再拖曳球員即可做出移動。</p>
        )}
        <label className="field">
          <span>教師註解</span>
          <textarea {...note} rows={3} disabled={playback} placeholder="這一步要學生注意什麼？" data-testid="step-note" />
        </label>
      </div>
    </Section>
  );
}
