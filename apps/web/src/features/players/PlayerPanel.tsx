import { useEffect, useState } from 'react';
import {
  activePlayers,
  describeEvent,
  getPlayerDef,
  markDribble,
  movePlayer,
  passBall,
  removeEvent,
  setBallHolder,
  setJerseyNumber,
  setPlayerLocked,
  shootBall,
  turnover,
  validateJerseyNumber,
} from '@btl/tactic-engine';
import { useCurrentStep, useIsPlayback, useProject, useStore } from '../../app/store';
import { Section } from '../../components/Section';
import { TEAM_FILL, TEAM_LABEL } from './PlayerToken';

function NumberField({ label, value, onCommit, step = 0.1, disabled, testId }: { label: string; value: number; onCommit: (n: number) => void; step?: number; disabled?: boolean; testId?: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text);
    if (Number.isFinite(n) && n !== value) onCommit(n);
    else setText(String(value));
  };
  return (
    <label className="num-field">
      <span>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        value={text}
        disabled={disabled}
        data-testid={testId}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}

/** 右側：選取球員屬性 + 球權與事件（M02、M03） */
export function PlayerPanel() {
  const project = useProject();
  const step = useCurrentStep();
  const currentStep = useStore((s) => s.currentStep);
  const selectedId = useStore((s) => s.selectedId);
  const playback = useIsPlayback();
  const s = useStore.getState;
  const def = selectedId ? getPlayerDef(project, selectedId) : undefined;
  const active = def && def.slot < project.teamSize ? def : undefined;
  const pos = active ? step.players[active.id] : undefined;
  const holder = step.ball.holderId ? getPlayerDef(project, step.ball.holderId) : undefined;
  const isHolder = active && step.ball.holderId === active.id;
  const teammates = active ? activePlayers(project).filter((p) => p.teamId === active.teamId && p.id !== active.id) : [];

  return (
    <>
      <Section title="球員" en="Player">
        {!active || !pos ? (
          <p className="muted">點選球場上的球員可查看位置、改背號、鎖定或設定持球。拖曳籃球到球員身上即可交球／傳球。</p>
        ) : (
          <div className="player-card" data-testid="player-panel">
            <div className="player-head">
              <span className="chip" style={{ background: TEAM_FILL[active.teamId] }}>
                {TEAM_LABEL[active.teamId]} {active.jerseyNumber}
              </span>
              <span className="muted small">{isHolder ? '🏀 持球中' : '無球'}</span>
            </div>
            <div className="grid3">
              <NumberField
                label="背號"
                value={active.jerseyNumber}
                step={1}
                disabled={playback}
                testId="jersey-input"
                onCommit={(n) => {
                  const err = validateJerseyNumber(project, active.id, n);
                  if (err) s().showToast(err, 'error');
                  else s().commit((p) => setJerseyNumber(p, active.id, n));
                }}
              />
              <NumberField label="X (m)" value={pos.x} disabled={playback || active.locked} onCommit={(x) => s().commit((p) => movePlayer(p, currentStep, active.id, { x, y: pos.y }))} />
              <NumberField label="Y (m)" value={pos.y} disabled={playback || active.locked} onCommit={(y) => s().commit((p) => movePlayer(p, currentStep, active.id, { x: pos.x, y }))} />
            </div>
            <div className="btn-row">
              <button type="button" className="btn" disabled={playback} onClick={() => s().commit((p) => setPlayerLocked(p, active.id, !active.locked))}>
                {active.locked ? '🔓 解除鎖定' : '🔒 鎖定位置'}
              </button>
              {!isHolder && (
                <button type="button" className="btn primary" disabled={playback} onClick={() => s().commit((p) => setBallHolder(p, currentStep, active.id))} data-testid="give-ball">
                  🏀 設為持球
                </button>
              )}
            </div>
            {isHolder && (
              <>
                <label className="field-label">傳球給 Pass to</label>
                <div className="btn-row">
                  {teammates.length === 0 && <span className="muted small">沒有隊友可傳</span>}
                  {teammates.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="btn"
                      disabled={playback}
                      style={{ borderColor: TEAM_FILL[t.teamId] }}
                      onClick={() => s().commit((p) => passBall(p, currentStep, t.id))}
                    >
                      → {TEAM_LABEL[t.teamId]}
                      {t.jerseyNumber}
                    </button>
                  ))}
                </div>
                <div className="btn-row">
                  <button type="button" className="btn" disabled={playback} onClick={() => s().commit((p) => markDribble(p, currentStep))}>
                    運球 Dribble
                  </button>
                  <button type="button" className="btn accent" disabled={playback} onClick={() => s().commit((p) => shootBall(p, currentStep))} data-testid="shoot">
                    投籃 Shot
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </Section>

      <Section title="球權與事件" en="Ball & Events">
        <p className="possession">
          進攻：
          <span className="chip" style={{ background: TEAM_FILL[step.offenseTeam] }}>
            {TEAM_LABEL[step.offenseTeam]}隊
          </span>
          持球：
          <strong data-testid="holder-label">{holder ? `${TEAM_LABEL[holder.teamId]} ${holder.jerseyNumber} 號` : '球在地上／空中'}</strong>
        </p>
        <div className="btn-row">
          <button type="button" className="btn" disabled={playback} onClick={() => s().commit((p) => turnover(p, currentStep))} data-testid="turnover">
            ⇆ 攻守轉換
          </button>
        </div>
        {step.events.length > 0 ? (
          <ul className="event-list">
            {step.events.map((e) => (
              <li key={e.id}>
                <span>{describeEvent(project, e)}</span>
                <button type="button" className="btn tiny ghost" aria-label="刪除事件" disabled={playback} onClick={() => s().commit((p) => removeEvent(p, currentStep, e.id))}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">此步驟尚無事件。傳球、運球、投籃會記錄在「進入此步驟」的動畫中。</p>
        )}
      </Section>
    </>
  );
}
