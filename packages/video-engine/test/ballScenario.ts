import type { BallCandidate, BallFrame, HoopMark, Track } from '../src';

/** 籃球測試用的合成情境（畫面 640×360、籃框 (500,120) 寬 30、球員框高 120） */
export const HOOP: HoopMark = { x: 500, y: 120, w: 30, source: 'manual' };
export const FPS = 10;

// ---------- 合成軌跡 ----------
type Seg = [t0: number, t1: number, fn: (k: number) => [number, number]];
const lerp = (a: [number, number], b: [number, number]) => (k: number): [number, number] => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
const arc = (a: [number, number], b: [number, number], peak: number) => (k: number): [number, number] => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k - 4 * peak * k * (1 - k)];

function ballPath(segs: Seg[]) {
  return (t: number): [number, number] | null => {
    for (const [t0, t1, fn] of segs) if (t >= t0 && t <= t1) return fn((t - t0) / Math.max(1, t1 - t0));
    return null;
  };
}

/** 傳球 → 投籃 → 進／不進 → 籃板 */
export function scenario(made: boolean) {
  const A: [number, number] = [200, 230];
  const B: [number, number] = [350, 215];
  const segs: Seg[] = [
    [0, 1000, (k) => [A[0], A[1] + 25 * Math.abs(Math.sin(k * 6 * Math.PI))]], // 運球
    [1000, 1400, lerp(A, B)], // 傳球
    [1400, 2400, () => B], // 持球
    [2400, 3100, arc(B, [495, 95], 120)], // 出手到籃框上方
    ...(made
      ? ([
          [3100, 3350, lerp([495, 95], [500, 185])], // 穿過籃框、籃網
          [3350, 3800, lerp([500, 185], [505, 290])], // 落地
          [3800, 4600, () => [505, 290]], // C 搶到
        ] as Seg[])
      : ([
          [3100, 3500, arc([495, 95], [575, 120], 50)], // 碰框彈出
          [3500, 3900, lerp([575, 120], [560, 280])],
          [3900, 4600, () => [560, 280]], // D 搶到
        ] as Seg[])),
  ];
  const tracks: Track[] = [
    track('T1', [170, 170, 60, 120]),
    track('T2', [320, 160, 60, 120]),
    track(made ? 'T3' : 'T4', made ? [475, 200, 60, 120] : [530, 190, 60, 120]),
  ];
  return { path: ballPath(segs), tracks };
}

export function track(id: string, [x, y, w, h]: number[]): Track {
  return {
    trackId: id,
    team: 'red',
    teamConfidence: 0.9,
    points: Array.from({ length: 24 }, (_, i) => ({ timeMs: i * 200, box: { x: x!, y: y!, w: w!, h: h! }, court: null, detectionConfidence: 0.9, color: { team: 'red', confidence: 0.9 }, source: 'observed', flags: [] })),
  };
}

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

export function framesFrom(path: (t: number) => [number, number] | null, opts: { noise?: number; drop?: number; fp?: number; seed?: number; endMs?: number; dropRange?: [number, number]; fps?: number } = {}): BallFrame[] {
  const r = rng(opts.seed ?? 1);
  const out: BallFrame[] = [];
  for (let t = 0; t <= (opts.endMs ?? 4600); t += 1000 / (opts.fps ?? FPS)) {
    const ts = Math.round(t);
    const c: BallCandidate[] = [];
    const p = path(ts);
    const hidden = opts.dropRange && ts >= opts.dropRange[0] && ts <= opts.dropRange[1];
    if (p && !hidden && r() >= (opts.drop ?? 0)) c.push({ x: p[0] + (r() - 0.5) * 2 * (opts.noise ?? 0), y: p[1] + (r() - 0.5) * 2 * (opts.noise ?? 0), r: 8, score: 0.6 + r() * 0.35, source: 'color' });
    if (r() < (opts.fp ?? 0)) c.push({ x: r() * 640, y: 150 + r() * 200, r: 6 + r() * 6, score: 0.3 + r() * 0.3, source: 'color' });
    out.push({ timeMs: ts, candidates: c });
  }
  return out;
}

