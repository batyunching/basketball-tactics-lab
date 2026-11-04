import { PLAYBACK_SPEEDS, nextSpeed, segmentAt, stepTimes, totalDuration } from '@btl/tactic-engine';
import { useProject, useStore } from '../../app/store';

function sec(ms: number): string {
  return (ms / 1000).toFixed(1);
}

/** 下方播放控制列（M06）：上一步／播放暫停／下一步、速度、循環、時間軸 */
export function PlaybackBar() {
  const project = useProject();
  const currentStep = useStore((s) => s.currentStep);
  const pb = useStore((s) => s.playback);
  const s = useStore.getState;
  const total = totalDuration(project.steps);
  const times = stepTimes(project.steps);
  const t = pb.timeMs ?? times[currentStep] ?? 0;
  const seg = pb.timeMs !== null ? segmentAt(project.steps, pb.timeMs) : null;
  const shownStep = seg ? (seg.local > 0 ? seg.toIndex : seg.fromIndex) : currentStep;
  const n = project.steps.length;

  return (
    <div className="playback" role="toolbar" aria-label="動畫播放">
      <div className="pb-buttons">
        <button type="button" className="btn icon big" onClick={() => s().prevStep()} disabled={shownStep === 0 && pb.timeMs === null} aria-label="上一步" title="上一步">
          ⏮
        </button>
        <button type="button" className="btn icon big primary" onClick={() => s().togglePlay()} aria-label={pb.playing ? '暫停' : '播放'} title="播放／暫停（空白鍵）" data-testid="play">
          {pb.playing ? '⏸' : '▶'}
        </button>
        <button type="button" className="btn icon big" onClick={() => s().nextStep()} disabled={shownStep >= n - 1} aria-label="下一步" title="下一步（播放一段）" data-testid="next-step">
          ⏭
        </button>
        {pb.timeMs !== null && (
          <button type="button" className="btn" onClick={() => s().exitPlayback()} data-testid="exit-playback">
            ✎ 回到編輯
          </button>
        )}
      </div>
      <div className="pb-timeline">
        <div className="pb-meta">
          <span data-testid="step-indicator">
            步驟 {shownStep + 1} / {n}
          </span>
          <span className="muted">
            {sec(t)} / {sec(total)} 秒
          </span>
        </div>
        <div className="scrub-wrap">
          <input
            type="range"
            min={0}
            max={Math.max(1, total)}
            step={10}
            value={t}
            disabled={n < 2}
            aria-label="時間軸"
            onChange={(e) => s().seek(Number(e.target.value))}
          />
          <div className="ticks" aria-hidden>
            {total > 0 && times.map((tm, i) => <span key={i} style={{ left: `${(tm / total) * 100}%` }} />)}
          </div>
        </div>
      </div>
      <div className="pb-options">
        <div className="speed" role="radiogroup" aria-label="播放速度">
          {PLAYBACK_SPEEDS.map((sp) => (
            <button key={sp} type="button" role="radio" aria-checked={pb.speed === sp} className={pb.speed === sp ? 'is-on' : ''} onClick={() => s().setSpeed(sp)} data-testid={`speed-${sp}`}>
              {sp}×
            </button>
          ))}
        </div>
        <button type="button" className="btn speed-cycle" onClick={() => s().setSpeed(nextSpeed(pb.speed))} aria-label={`播放速度 ${pb.speed} 倍，點一下切換`}>
          {pb.speed}×
        </button>
        <button type="button" className={`btn ${pb.loop ? 'is-on' : ''}`} aria-pressed={pb.loop} onClick={() => s().toggleLoop()} data-testid="loop">
          🔁 循環
        </button>
      </div>
    </div>
  );
}
