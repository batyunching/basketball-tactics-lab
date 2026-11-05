import { describe, expect, it } from 'vitest';
import type { BallFrame, BallPoint } from '../src';
import { FPS, HOOP, framesFrom, scenario, track } from './ballScenario';
import {
  analyzeBall,
  assignHolders,
  ballAt,
  colorBallCandidates,
  detectShots,
  medianBackground,
  possessionRuns,
  removeStaticCandidates,
  shotRefineWindows,
  solveHomography,
  suggestHoop,
  trackBall,
} from '../src';

/**
 * 演算法單元測試：用可控的合成畫面與合成軌跡檢驗規則（不代表真實影片的準確度）。
 * 畫面 640×360；籃框在 (500,120)、寬 30 像素；球員框高 120 像素。
 */

// ---------- 合成畫面 ----------
function canvas(W: number, H: number, bg: [number, number, number]) {
  const a = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) a.set([...bg, 255], i * 4);
  return a;
}
function disk(a: Uint8ClampedArray, W: number, cx: number, cy: number, r: number, c: [number, number, number]) {
  for (let y = Math.floor(cy - r); y <= cy + r; y++)
    for (let x = Math.floor(cx - r); x <= cx + r; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) a.set([...c, 255], (y * W + x) * 4);
}
function rect(a: Uint8ClampedArray, W: number, x0: number, y0: number, w: number, h: number, c: [number, number, number]) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) a.set([...c, 255], (y * W + x) * 4);
}
const WOOD: [number, number, number] = [222, 184, 135];
const BALL: [number, number, number] = [205, 92, 38];
const PAINT: [number, number, number] = [196, 104, 60];

describe('籃球候選（顏色＋形狀）', () => {
  it('找到球；排除木地板、皮膚、紅色球衣、長條形的橘色物', () => {
    const W = 320;
    const H = 180;
    const img = canvas(W, H, WOOD);
    disk(img, W, 100, 60, 4, BALL); // 球
    disk(img, W, 200, 60, 4, [241, 194, 150]); // 淺膚色頭
    disk(img, W, 230, 60, 4, [168, 112, 74]); // 深膚色頭
    rect(img, W, 250, 40, 14, 20, [214, 38, 61]); // 紅色球衣
    rect(img, W, 20, 150, 120, 4, BALL); // 橘色長條（場邊線）
    const c = colorBallCandidates(img, { width: W, height: H, scale: 2, expectedR: 8 });
    expect(c).toHaveLength(1);
    expect(c[0]!.x).toBeCloseTo(200, 0);
    expect(c[0]!.y).toBeCloseTo(120, 0);
    expect(c[0]!.r).toBeGreaterThan(6);
    expect(c[0]!.score).toBeGreaterThan(0.7);
  });

  it('球經過橘色禁區：有背景模型時仍可分出來，沒有背景模型時會黏成一大塊被濾掉', () => {
    const W = 200;
    const H = 120;
    const frames = Array.from({ length: 9 }, (_, i) => {
      const f = canvas(W, H, WOOD);
      rect(f, W, 60, 40, 80, 50, PAINT);
      disk(f, W, 20 + i * 20, 30 + (i % 3) * 25, 5, BALL);
      return f;
    });
    const bg = medianBackground(frames);
    const scene = canvas(W, H, WOOD);
    rect(scene, W, 60, 40, 80, 50, PAINT);
    disk(scene, W, 100, 65, 5, BALL);
    expect(colorBallCandidates(scene, { width: W, height: H, scale: 1, expectedR: 5 })).toHaveLength(0);
    const withBg = colorBallCandidates(scene, { width: W, height: H, scale: 1, expectedR: 5, background: bg, diffMin: 20 });
    expect(withBg).toHaveLength(1);
    expect(withBg[0]!.x).toBeCloseTo(100, 0);
  });

  it('場邊靜止的橘色物品（每格都在同一位置）會被排除', () => {
    const frames: BallFrame[] = Array.from({ length: 20 }, (_, i) => ({
      timeMs: i * 100,
      candidates: [
        { x: 30, y: 300, r: 8, score: 0.9, source: 'color' },
        { x: 100 + i * 10, y: 200, r: 8, score: 0.8, source: 'color' },
      ],
    }));
    const clean = removeStaticCandidates(frames);
    expect(clean.every((f) => f.candidates.length === 1 && f.candidates[0]!.x > 90)).toBe(true);
  });
});

const OPT = { playerHeightPx: 120 };

describe('籃球追蹤', () => {
  it('雜訊與誤判下仍沿著真實軌跡（誤差 < 6 像素）', () => {
    const { path } = scenario(true);
    for (const seed of [1, 2, 3, 4, 5]) {
      const pts = trackBall(framesFrom(path, { noise: 2, fp: 0.4, seed }), OPT).filter((p) => p.source === 'observed');
      const errs = pts.map((p) => {
        const q = path(p.timeMs)!;
        return Math.hypot(p.x - q[0], p.y - q[1]);
      });
      expect(Math.max(...errs)).toBeLessThan(6);
      expect(pts.length).toBeGreaterThan(40);
    }
  });

  it('短暫被擋住會內插補上，標記為 interpolated', () => {
    const { path } = scenario(true);
    const pts = trackBall(framesFrom(path, { dropRange: [1100, 1300] }), OPT);
    const mid = pts.filter((p) => p.timeMs >= 1100 && p.timeMs <= 1300);
    expect(mid.length).toBe(3);
    expect(mid.every((p) => p.source === 'interpolated')).toBe(true);
    expect(ballAt(pts, 1200)!.x).toBeCloseTo(275, -1);
  });

  it('不可能的瞬移（超過球速上限）不會被連起來', () => {
    const frames: BallFrame[] = Array.from({ length: 10 }, (_, i) => ({
      timeMs: i * 100,
      candidates: [{ x: i % 2 ? 600 : 50, y: 200, r: 8, score: 0.5, source: 'color' as const }],
    }));
    const pts = trackBall(frames, OPT);
    // 只會選其中一側
    expect(new Set(pts.filter((p) => p.source === 'observed').map((p) => p.x > 300)).size).toBe(1);
  });
});

describe('持球判定', () => {
  it('運球、傳球、持球、出手：持球者依序為 T1 → T2 → 籃板', () => {
    const { path, tracks } = scenario(true);
    const pts = assignHolders(trackBall(framesFrom(path), OPT), tracks);
    const runs = possessionRuns(pts);
    expect(runs.map((r) => r.trackId)).toEqual(['T1', 'T2', 'T3']);
    expect(runs[0]!.confidence).toBe('high');
    // 傳球途中沒有人持球
    expect(ballAt(pts, 1200)!.holderTrackId).toBeNull();
  });
});

describe('出手與進球', () => {
  const run = (made: boolean, o: Parameters<typeof framesFrom>[1] = {}) => {
    const { path, tracks } = scenario(made);
    const pts = assignHolders(trackBall(framesFrom(path, o), OPT), tracks);
    return detectShots(pts, HOOP);
  };

  it('進球：球先在籃框上方、再進籃網區 → made（信心高）', () => {
    const shots = run(true);
    expect(shots).toHaveLength(1);
    expect(shots[0]).toMatchObject({ result: 'made', confidence: 'high', shooterTrackId: 'T2' });
    expect(shots[0]!.releaseMs).toBeGreaterThanOrEqual(2300);
    expect(shots[0]!.evidence.join('')).toContain('籃網區');
  });

  it('沒進：碰框往外彈 → missed', () => {
    const shots = run(false);
    expect(shots).toHaveLength(1);
    expect(shots[0]!.result).toBe('missed');
    expect(shots[0]!.shooterTrackId).toBe('T2');
  });

  it('籃框附近完全被擋住 → unknown，並說明無法確認', () => {
    const shots = run(true, { dropRange: [3000, 3700] });
    expect(shots).toHaveLength(1);
    expect(shots[0]!.result).toBe('unknown');
    expect(shots[0]!.evidence.join('')).toContain('無法確認');
  });

  it('雜訊、漏檢與誤判下，20 次中進球判定正確率 ≥ 85%，且從不把「沒進」判成「進」', () => {
    let correctMade = 0;
    let falseMade = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const m = run(true, { noise: 2, drop: 0.15, fp: 0.3, seed });
      if (m[0]?.result === 'made') correctMade++;
      const x = run(false, { noise: 2, drop: 0.15, fp: 0.3, seed: seed + 100 });
      if (x.some((s) => s.result === 'made')) falseMade++;
    }
    expect(correctMade).toBeGreaterThanOrEqual(17);
    expect(falseMade).toBe(0);
  });

  it('沒有標記籃框 → 不判斷出手', () => {
    const { path, tracks } = scenario(true);
    expect(detectShots(assignHolders(trackBall(framesFrom(path), OPT), tracks), null)).toEqual([]);
  });

  it('傳球從籃框下方經過（沒有往上飛）不算出手', () => {
    const pts: BallPoint[] = Array.from({ length: 20 }, (_, i) => ({ timeMs: i * 100, x: 300 + i * 20, y: 200, r: 8, score: 0.8, source: 'observed', holderTrackId: i < 3 ? 'T1' : null }));
    expect(detectShots(pts, { ...HOOP, y: 190 })).toEqual([]);
  });

  it('整套流程 analyzeBall：覆蓋率、持球、出手', () => {
    const { path, tracks } = scenario(true);
    const a = analyzeBall(framesFrom(path, { fp: 0.2 }), tracks, HOOP, 360, FPS);
    expect(a.coverage).toBeGreaterThan(0.9);
    expect(a.shots[0]?.result).toBe('made');
  });
});

describe('籃框建議位置', () => {
  it('由校正與球員身高估出籃框（在籃下地板點正上方約 1.7 個身高）', () => {
    // 正視、每公尺 20 像素的簡單相機：球場 (x,y) → 影像 (y*20+100, 500 - (28-x)*10)
    const court = [{ x: 14, y: 0 }, { x: 28, y: 0 }, { x: 28, y: 15 }, { x: 14, y: 15 }];
    const img = court.map((c) => ({ x: c.y * 20 + 100, y: 500 - (28 - c.x) * 10 }));
    const H = solveHomography(img, court)!;
    const tr = track('T1', [240, 300, 30, 100]);
    tr.points.forEach((p) => (p.court = { x: 24, y: 7 }));
    const h = suggestHoop(H, [tr])!;
    expect(h.source).toBe('suggested');
    expect(h.x).toBeCloseTo(250, -1);
    expect(h.y).toBeCloseTo(500 - 1.575 * 10 - (100 * 3.05) / 1.8, -1);
    expect(h.w).toBeGreaterThan(5);
  });
});

describe('精細分析時段', () => {
  it('球接近籃框的時間前後各取一段，重疊的會合併', () => {
    const pts: BallPoint[] = [1000, 1100, 1200, 5000].map((t) => ({ timeMs: t, x: 500, y: 110, r: 8, score: 0.8, source: 'observed', holderTrackId: null }));
    pts.push({ timeMs: 3000, x: 100, y: 300, r: 8, score: 0.8, source: 'observed', holderTrackId: null });
    expect(shotRefineWindows(pts, HOOP)).toEqual([
      [100, 2600],
      [4100, 6400],
    ]);
    expect(shotRefineWindows(pts, null)).toEqual([]);
  });
});

describe('不同取樣率下的持球判定', () => {
  it('每秒 30 張時，球只是從球員身邊飛過（0.2 秒）不算持球', () => {
    const tr = track('T9', [300, 150, 60, 120]);
    const pts: BallPoint[] = Array.from({ length: 30 }, (_, i) => ({ timeMs: i * 33, x: 150 + i * 12, y: 220, r: 8, score: 0.8, source: 'observed', holderTrackId: null }));
    expect(assignHolders(pts, [tr]).every((p) => p.holderTrackId === null)).toBe(true);
  });
  it('每秒 5 張時，連續 2 格（約 0.4 秒）在手上就算持球', () => {
    const tr = track('T9', [300, 150, 60, 120]);
    const pts: BallPoint[] = [0, 200, 400, 600].map((t, i) => ({ timeMs: t, x: i < 2 ? 330 : 600, y: 220, r: 8, score: 0.8, source: 'observed', holderTrackId: null }));
    expect(assignHolders(pts, [tr]).map((p) => p.holderTrackId)).toEqual(['T9', 'T9', null, null]);
  });
});
