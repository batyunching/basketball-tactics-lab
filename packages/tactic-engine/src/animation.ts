import type { Annotation, BallState, PlayerState, TacticProject, TacticStep, TeamId, Vec2 } from '@btl/shared-types';

export const MIN_STEP_DURATION_MS = 200;
export const MAX_STEP_DURATION_MS = 10_000;
export const DEFAULT_STEP_DURATION_MS = 1500;
export const PLAYBACK_SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2] as const;

export function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpVec(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

export function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** 傳球／投籃時，球在步驟中段才出手，看起來較自然 */
export function releaseProgress(t: number, start = 0.2, end = 0.85): number {
  return easeInOutCubic((clamp01(t) - start) / (end - start));
}

/** 每一步「到達時間」：stepTimes[0]=0，stepTimes[k]=stepTimes[k−1]+steps[k].durationMs */
export function stepTimes(steps: TacticStep[]): number[] {
  const times: number[] = [];
  let acc = 0;
  steps.forEach((s, i) => {
    if (i > 0) acc += s.durationMs;
    times.push(acc);
  });
  return times;
}

export function totalDuration(steps: TacticStep[]): number {
  const t = stepTimes(steps);
  return t[t.length - 1] ?? 0;
}

/** 某時間點對應的段落：從 fromIndex 走向 toIndex，local 為 0～1 的線性進度 */
export function segmentAt(steps: TacticStep[], timeMs: number): { fromIndex: number; toIndex: number; local: number } {
  const times = stepTimes(steps);
  if (steps.length <= 1 || timeMs <= 0) return { fromIndex: 0, toIndex: 0, local: 0 };
  const total = times[times.length - 1] ?? 0;
  if (timeMs >= total) {
    const last = steps.length - 1;
    return { fromIndex: last, toIndex: last, local: 0 };
  }
  for (let k = 1; k < times.length; k++) {
    const end = times[k] ?? 0;
    if (timeMs < end) {
      const start = times[k - 1] ?? 0;
      const dur = end - start;
      return { fromIndex: k - 1, toIndex: k, local: dur > 0 ? (timeMs - start) / dur : 1 };
    }
  }
  return { fromIndex: steps.length - 1, toIndex: steps.length - 1, local: 0 };
}

/** 球在某組球員位置下的實際位置（holderOffset 讓球畫在持球者身旁） */
export function resolveBallPosition(ball: BallState, players: Record<string, PlayerState>, holderOffset: Vec2): Vec2 {
  if (ball.holderId) {
    const h = players[ball.holderId];
    if (h) return { x: h.x + holderOffset.x, y: h.y + holderOffset.y };
  }
  return { x: ball.x, y: ball.y };
}

export interface Frame {
  fromIndex: number;
  toIndex: number;
  /** 線性進度 0～1 */
  local: number;
  players: Record<string, PlayerState>;
  ballPosition: Vec2;
  /** 球是否在空中（傳球、投籃中）；用於畫出拋物線放大效果 */
  ballInFlight: boolean;
  /** 0～1，飛行高度比例 */
  ballLift: number;
  holderId: string | null;
  offenseTeam: TeamId;
  annotations: Annotation[];
}

export function interpolatePlayers(
  a: Record<string, PlayerState>,
  b: Record<string, PlayerState>,
  t: number,
): Record<string, PlayerState> {
  const out: Record<string, PlayerState> = {};
  const ids = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const id of ids) {
    const pa = a[id] ?? b[id];
    const pb = b[id] ?? a[id];
    if (pa && pb) out[id] = lerpVec(pa, pb, t);
  }
  return out;
}

/** 計算任一時間點的畫面：球員平滑插值，球跟隨持球者或在兩者之間飛行 */
export function frameAt(project: TacticProject, timeMs: number, holderOffset: Vec2 = { x: 0, y: 0 }): Frame {
  const { steps } = project;
  const seg = segmentAt(steps, timeMs);
  const from = steps[seg.fromIndex];
  const to = steps[seg.toIndex];
  if (!from || !to) throw new Error('戰術至少需要一個步驟');
  const eased = easeInOutCubic(seg.local);
  const players = interpolatePlayers(from.players, to.players, eased);

  const sameHolder = from.ball.holderId !== null && from.ball.holderId === to.ball.holderId;
  let ballPosition: Vec2;
  let ballInFlight = false;
  let ballLift = 0;
  let holderId: string | null;
  if (seg.fromIndex === seg.toIndex || sameHolder) {
    ballPosition = resolveBallPosition(to.ball, players, holderOffset);
    holderId = to.ball.holderId;
    if (!to.ball.holderId && !from.ball.holderId) {
      ballPosition = lerpVec(from.ball, to.ball, eased);
    }
  } else {
    const p = releaseProgress(seg.local);
    const start = resolveBallPosition(from.ball, players, holderOffset);
    const end = resolveBallPosition(to.ball, players, holderOffset);
    ballPosition = lerpVec(start, end, p);
    ballInFlight = p > 0 && p < 1;
    ballLift = ballInFlight ? Math.sin(Math.PI * p) : 0;
    holderId = p <= 0 ? from.ball.holderId : p >= 1 ? to.ball.holderId : null;
  }

  return {
    fromIndex: seg.fromIndex,
    toIndex: seg.toIndex,
    local: seg.local,
    players,
    ballPosition,
    ballInFlight,
    ballLift,
    holderId,
    offenseTeam: seg.local >= 0.5 ? to.offenseTeam : from.offenseTeam,
    annotations: to.annotations,
  };
}

/** 下一個播放速度（循環） */
export function nextSpeed(current: number): number {
  const i = PLAYBACK_SPEEDS.indexOf(current as (typeof PLAYBACK_SPEEDS)[number]);
  return PLAYBACK_SPEEDS[(i + 1) % PLAYBACK_SPEEDS.length] ?? 1;
}
