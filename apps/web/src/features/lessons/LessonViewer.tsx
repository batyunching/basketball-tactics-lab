import { useMemo } from 'react';
import type { TacticProject, Vec2 } from '@btl/shared-types';
import { PLAYBACK_SPEEDS, describeEvent, frameAt, getViewTransform, nextSpeed, viewVectorToCourt } from '@btl/tactic-engine';
import { CourtView } from '../court/CourtView';
import { useTacticPlayer } from './useTacticPlayer';

/** 唯讀戰術播放器：教材庫、學生端共用 */
export function LessonViewer({ project, compact = false }: { project: TacticProject; compact?: boolean }) {
  const pl = useTacticPlayer(project);
  const offset = useMemo(() => viewVectorToCourt({ x: 0.5, y: 0.45 }, getViewTransform(project.court.mode, project.court.attackDirection)), [project]);
  const t = pl.timeMs ?? pl.times[pl.step] ?? 0;
  const frame = useMemo(() => frameAt(project, t, offset), [project, t, offset]);
  const players: Record<string, Vec2> = frame.players;
  const shown = project.steps[pl.current] ?? project.steps[0]!;
  const n = project.steps.length;

  return (
    <div className={`viewer ${compact ? 'compact' : ''}`} data-court={project.court.mode}>
      <div className="viewer-court">
        <div className="board-overlay">
          <div className="step-badge" data-testid="viewer-step">
            <b>{pl.current + 1}</b>
            <span>{shown.title}</span>
            {pl.timeMs !== null && <em>{pl.playing ? '播放中' : '已暫停'}</em>}
          </div>
        </div>
        <CourtView
          project={project}
          players={players}
          holderId={frame.holderId}
          ballPosition={frame.ballPosition}
          ballLift={frame.ballLift}
          annotations={frame.annotations}
          label={`戰術動畫：${project.title}`}
          testId="viewer-court"
        />
      </div>
      <div className="viewer-controls" role="toolbar" aria-label="教材播放">
        <button type="button" className="btn icon big" onClick={pl.prev} disabled={pl.current === 0 && pl.timeMs === null} aria-label="上一步">
          ⏮
        </button>
        <button type="button" className="btn icon big primary" onClick={pl.playing ? pl.pause : pl.play} aria-label={pl.playing ? '暫停' : '播放'} data-testid="viewer-play">
          {pl.playing ? '⏸' : '▶'}
        </button>
        <button type="button" className="btn icon big" onClick={pl.next} disabled={pl.current >= n - 1} aria-label="下一步" data-testid="viewer-next">
          ⏭
        </button>
        <input
          type="range"
          className="viewer-scrub"
          min={0}
          max={Math.max(1, pl.total)}
          step={10}
          value={t}
          aria-label="時間軸"
          onChange={(e) => pl.seek(Number(e.target.value))}
        />
        <button type="button" className="btn speed-btn" onClick={() => pl.setSpeed(nextSpeed(pl.speed))} aria-label={`速度 ${pl.speed} 倍`} title={`可選 ${PLAYBACK_SPEEDS.join('／')} 倍`}>
          {pl.speed}×
        </button>
        <button type="button" className={`btn ${pl.loop ? 'is-on' : ''}`} aria-pressed={pl.loop} onClick={() => pl.setLoop(!pl.loop)}>
          🔁
        </button>
      </div>
      <ol className="viewer-steps" aria-label="步驟">
        {project.steps.map((s, i) => (
          <li key={s.id} className={i === pl.current ? 'is-current' : ''}>
            <button type="button" onClick={() => pl.goto(i)} aria-current={i === pl.current ? 'step' : undefined}>
              <b>{i + 1}</b>
              <span>{s.title}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="viewer-note" aria-live="polite">
        <strong>
          {pl.current + 1}. {shown.title}
        </strong>
        {shown.events.map((e) => (
          <span key={e.id} className="event-chip">
            {describeEvent(project, e)}
          </span>
        ))}
        <p>{shown.note}</p>
      </div>
    </div>
  );
}
