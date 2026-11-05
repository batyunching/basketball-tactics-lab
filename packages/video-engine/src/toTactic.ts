import type { PlayerDef, TacticProject, Vec2 } from '@btl/shared-types';
import { addStep, createProject, movePlayer, setBallHolder, updateStepMeta } from '@btl/tactic-engine';
import { positionAt } from './series';
import type { Keyframe, PlayerSample } from './types';

/**
 * 把影片軌跡轉成戰術動畫（可在白板中編輯、發布為教材）。
 * 有 2 個以上關鍵影格時以關鍵影格為步驟，否則每 intervalMs 取一步。
 */
export function trajectoriesToTactic(opts: {
  title: string;
  teamSize: 1 | 2 | 3 | 4 | 5;
  samples: Record<string, PlayerSample[]>;
  keyframes: Keyframe[];
  startMs: number;
  endMs: number;
  intervalMs?: number;
}): TacticProject {
  const interval = opts.intervalMs ?? 2000;
  const kf = [...opts.keyframes].sort((a, b) => a.timeMs - b.timeMs);
  const times = kf.length >= 2 ? kf.map((k) => k.timeMs) : (() => {
    const t: number[] = [];
    for (let x = opts.startMs; x <= opts.endMs; x += interval) t.push(x);
    if (t[t.length - 1] !== opts.endMs) t.push(opts.endMs);
    return t;
  })();
  let p = createProject({ title: opts.title, mode: 'half', teamSize: opts.teamSize });
  const players: PlayerDef[] = p.players.filter((d) => d.slot < opts.teamSize);
  let holder: string | null = null;
  times.forEach((time, i) => {
    if (i > 0) p = addStep(p, i - 1);
    for (const def of players) {
      const s = positionAt(opts.samples[def.id], time);
      const pos: Vec2 | undefined = s?.courtPosition;
      if (pos) p = movePlayer(p, i, def.id, pos);
    }
    const k = kf.find((x) => x.timeMs === time);
    if (k && k.holderId !== undefined) holder = k.holderId;
    p = setBallHolder(p, i, holder);
    const prev = i > 0 ? times[i - 1]! : time;
    p = updateStepMeta(p, i, {
      title: `${(time / 1000).toFixed(1)} 秒`,
      durationMs: i > 0 ? Math.max(300, time - prev) : 1500,
      note: k?.note ?? `影片 ${(time / 1000).toFixed(1)} 秒的站位（由影片重建）`,
    });
  });
  return p;
}
