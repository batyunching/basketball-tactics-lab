import { applyHomography, mat3Inv } from './homography';
import { rgbToHsv } from './teamColor';
import type { Box, Px, Track } from './types';

/**
 * 籃球偵測、追蹤、持球判定、出手與進球判定（全部在瀏覽器端，純邏輯可單元測試）。
 *
 * 1. 候選：橘色（高飽和）且與背景不同的圓形色塊；另可加入 YOLOX 的 sports ball 類別。
 * 2. 追蹤：把每格的候選連成一條「最合理」的路徑（最短路徑／動態規劃），
 *    速度超過物理上限的連線不允許，偶發的誤判會被跳過。
 * 3. 持球：球心落在某位球員框的手部範圍內，且持續一小段時間。
 * 4. 出手與進球：需要老師標記籃框位置。球離手往上、接近籃框；
 *    之後若先出現在籃框上方、再出現在籃網區 → 進球；彈開或從旁邊落下 → 未進；
 *    看不到關鍵畫面 → 無法判定（不猜）。
 */

export const BALL_ENGINE_VERSION = 'ball-1.0';
/** 籃球直徑 0.24 m、成人約 1.8 m → 球半徑約為身高框的 0.067 */
export const BALL_RADIUS_PER_HEIGHT = 0.067;
export const RIM_HEIGHT_M = 3.05;
export const RIM_DIAMETER_M = 0.45;

export interface BallCandidate {
  x: number;
  y: number;
  /** 半徑（像素） */
  r: number;
  /** 0～1 */
  score: number;
  source: 'color' | 'model';
}

export interface BallFrame {
  timeMs: number;
  candidates: BallCandidate[];
}

/** 籃框（影像像素）：圓框中心與寬度 */
export interface HoopMark {
  x: number;
  y: number;
  w: number;
  source: 'manual' | 'suggested';
}

export interface BallPoint {
  timeMs: number;
  x: number;
  y: number;
  r: number;
  score: number;
  source: 'observed' | 'interpolated';
  /** 持球者的追蹤編號；null = 球在空中／地上滾動 */
  holderTrackId: string | null;
}

export type ShotResult = 'made' | 'missed' | 'unknown';
export type BallConfidence = 'high' | 'medium' | 'low';

export interface ShotDetection {
  id: string;
  /** 球離手 */
  releaseMs: number;
  /** 最接近籃框 */
  rimMs: number;
  shooterTrackId: string | null;
  result: ShotResult;
  confidence: BallConfidence;
  evidence: string[];
}

export interface PossessionRun {
  startMs: number;
  endMs: number;
  trackId: string;
  points: number;
  confidence: BallConfidence;
}

export interface BallAnalysis {
  version: string;
  fps: number;
  frames: BallFrame[];
  points: BallPoint[];
  shots: ShotDetection[];
  /** 片段中看得到球的時間比例（0～1） */
  coverage: number;
  analyzedAt: string;
}

// ---------------------------------------------------------------- 候選偵測

export interface ColorBallOptions {
  /** 畫布寬高 */
  width: number;
  height: number;
  /** 畫布像素 → 原影片像素的倍率 */
  scale: number;
  /** 預期球半徑（原影片像素）；不知道時用畫面高度估 */
  expectedR?: number;
  /** 背景（同尺寸 RGBA）：與背景差異太小的像素不算 */
  background?: Uint8ClampedArray | Uint8Array | null;
  hueMin?: number;
  hueMax?: number;
  satMin?: number;
  valMin?: number;
  /** 與背景 RGB 差異總和門檻 */
  diffMin?: number;
  maxCandidates?: number;
}

/**
 * 找橘色圓形色塊。飽和度門檻 0.6 用來排除皮膚與木地板（通常 < 0.55），
 * 色相 8°～38° 排除紅色球衣（約 340°～8°）。
 */
export function colorBallCandidates(rgba: Uint8ClampedArray | Uint8Array, opts: ColorBallOptions): BallCandidate[] {
  const { width: W, height: H, scale } = opts;
  const hueMin = opts.hueMin ?? 8;
  const hueMax = opts.hueMax ?? 38;
  const satMin = opts.satMin ?? 0.6;
  const valMin = opts.valMin ?? 0.2;
  const diffMin = opts.diffMin ?? 70;
  const bg = opts.background ?? null;
  const expectedR = (opts.expectedR ?? H * scale * 0.012) / scale; // 換成畫布像素
  const mask = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    const r = rgba[p]!;
    const g = rgba[p + 1]!;
    const b = rgba[p + 2]!;
    if (r < g || g < b) continue; // 橘色：R ≥ G ≥ B（快速排除）
    const [h, s, v] = rgbToHsv(r, g, b);
    if (h < hueMin || h > hueMax || s < satMin || v < valMin) continue;
    if (bg && Math.abs(r - bg[p]!) + Math.abs(g - bg[p + 1]!) + Math.abs(b - bg[p + 2]!) < diffMin) continue;
    mask[i] = 1;
  }
  // 連通區塊（4 連通）
  const label = new Int32Array(W * H);
  const stack = new Int32Array(W * H);
  const out: BallCandidate[] = [];
  let next = 1;
  for (let i = 0; i < W * H; i++) {
    if (!mask[i] || label[i]) continue;
    let sp = 0;
    stack[sp++] = i;
    label[i] = next;
    let n = 0;
    let sx = 0;
    let sy = 0;
    let x0 = W;
    let x1 = 0;
    let y0 = H;
    let y1 = 0;
    while (sp > 0) {
      const k = stack[--sp]!;
      const x = k % W;
      const y = (k - x) / W;
      n++;
      sx += x;
      sy += y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && mask[k - 1] && !label[k - 1]) { label[k - 1] = next; stack[sp++] = k - 1; }
      if (x < W - 1 && mask[k + 1] && !label[k + 1]) { label[k + 1] = next; stack[sp++] = k + 1; }
      if (y > 0 && mask[k - W] && !label[k - W]) { label[k - W] = next; stack[sp++] = k - W; }
      if (y < H - 1 && mask[k + W] && !label[k + W]) { label[k + W] = next; stack[sp++] = k + W; }
    }
    next++;
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    const r = (bw + bh) / 4;
    if (r < Math.max(1, expectedR * 0.35) || r > expectedR * 2.6) continue;
    const aspect = Math.min(bw, bh) / Math.max(bw, bh);
    const fill = n / (Math.PI * r * r);
    if (aspect < 0.45 || fill < 0.35) continue;
    const sizeScore = Math.exp(-(Math.log(r / expectedR) ** 2) / (2 * 0.5 ** 2));
    const shapeScore = Math.min(1, aspect / 0.85) * Math.min(1, fill / 0.7);
    const score = Math.round(Math.min(1, 0.25 + 0.75 * sizeScore * shapeScore) * 100) / 100;
    out.push({ x: (sx / n) * scale, y: (sy / n) * scale, r: r * scale, score, source: 'color' });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, opts.maxCandidates ?? 6);
}

/** 從多張畫面取每個像素的中位數當背景（球、球員會移動，所以會被濾掉） */
export function medianBackground(frames: (Uint8ClampedArray | Uint8Array)[]): Uint8ClampedArray {
  const n = frames.length;
  const len = frames[0]?.length ?? 0;
  const out = new Uint8ClampedArray(len);
  const buf = new Uint8Array(n);
  for (let i = 0; i < len; i++) {
    if ((i & 3) === 3) {
      out[i] = 255;
      continue;
    }
    for (let k = 0; k < n; k++) buf[k] = frames[k]![i]!;
    buf.sort();
    out[i] = buf[n >> 1]!;
  }
  return out;
}

/** 同一個位置在大部分畫面都出現 → 場邊靜止的橘色物品，不是球 */
export function removeStaticCandidates(frames: BallFrame[], ratio = 0.35): BallFrame[] {
  if (frames.length < 8) return frames;
  const cell = (c: BallCandidate) => `${Math.round(c.x / Math.max(6, c.r * 2))},${Math.round(c.y / Math.max(6, c.r * 2))}`;
  const count = new Map<string, number>();
  for (const f of frames) for (const k of new Set(f.candidates.map(cell))) count.set(k, (count.get(k) ?? 0) + 1);
  const limit = frames.length * ratio;
  return frames.map((f) => ({ ...f, candidates: f.candidates.filter((c) => (count.get(cell(c)) ?? 0) <= limit) }));
}

export function mergeCandidates(a: BallCandidate[], b: BallCandidate[]): BallCandidate[] {
  const out = [...a];
  for (const c of b) {
    const dup = out.find((o) => Math.hypot(o.x - c.x, o.y - c.y) < Math.max(o.r, c.r) * 1.2);
    if (dup) dup.score = Math.min(1, Math.max(dup.score, c.score) + 0.1);
    else out.push({ ...c });
  }
  return out;
}

/** 合併兩組畫面（例如一般取樣＋出手附近的精細取樣），同時間的候選合併 */
export function mergeBallFrames(a: BallFrame[], b: BallFrame[]): BallFrame[] {
  const map = new Map<number, BallFrame>();
  for (const f of [...a, ...b]) {
    const old = map.get(f.timeMs);
    map.set(f.timeMs, old ? { timeMs: f.timeMs, candidates: mergeCandidates(old.candidates, f.candidates) } : { timeMs: f.timeMs, candidates: [...f.candidates] });
  }
  return [...map.values()].sort((x, y) => x.timeMs - y.timeMs);
}

// ---------------------------------------------------------------- 追蹤

export interface BallTrackOptions {
  /** 球員身高（像素，中位數）；用來換算速度上限與球的大小 */
  playerHeightPx: number;
  /** 球速上限（公尺／秒） */
  maxSpeedMps?: number;
  /** 最長可跳過的時間（毫秒） */
  maxGapMs?: number;
  /** 少於這個時間的空檔用內插補上 */
  interpolateMs?: number;
}

/** 依球員身高估畫面中的球速上限（像素／毫秒） */
function vmaxPxPerMs(o: BallTrackOptions) {
  return ((o.maxSpeedMps ?? 14) * (o.playerHeightPx / 1.8)) / 1000;
}

/**
 * 在所有候選中找一條成本最低的路徑（依時間的有向無環圖最短路徑）：
 *  - 每一格沒有球：成本 1
 *  - 用某個候選：成本 1.1 ×（1 − 分數）
 *  - 相鄰兩點：依速度（相對上限）與大小變化加成本；超過上限不可連
 *  - 長時間看不到球後重新出現：跳接成本 3
 */
export function trackBall(frames: BallFrame[], o: BallTrackOptions): BallPoint[] {
  const fs = [...frames].sort((a, b) => a.timeMs - b.timeMs);
  const N = fs.length;
  if (!N) return [];
  const vmax = vmaxPxPerMs(o);
  const maxGap = o.maxGapMs ?? 1200;
  const MISS = 1;
  const JUMP = 3;
  type Node = { id: number; f: number; c: BallCandidate; cost: number; prev: number };
  const nodes: Node[] = [];
  const byFrame: number[][] = fs.map(() => []);
  // 跳接用：在第 f 格以前結束的最佳 (cost - f*MISS)
  let bestEndKey = Infinity;
  let bestEndNode = -1;
  let frontier = 0; // 已納入 bestEnd 的節點所在格
  const nodeCost = (c: BallCandidate) => 1.1 * (1 - c.score);
  for (let f = 0; f < N; f++) {
    const t = fs[f]!.timeMs;
    // 更新可跳接的節點（距離本格超過 maxGap 的）
    while (frontier < f && t - fs[frontier]!.timeMs > maxGap) {
      for (const ni of byFrame[frontier]!) {
        const key = nodes[ni]!.cost - frontier * MISS;
        if (key < bestEndKey) {
          bestEndKey = key;
          bestEndNode = ni;
        }
      }
      frontier++;
    }
    for (const c of fs[f]!.candidates) {
      // 從頭開始
      let best = f * MISS + 1.5 + nodeCost(c);
      let prev = -1;
      if (bestEndNode >= 0) {
        const v = bestEndKey + (f - 1) * MISS + JUMP + nodeCost(c);
        if (v < best) {
          best = v;
          prev = bestEndNode;
        }
      }
      for (let g = f - 1; g >= frontier; g--) {
        const dt = t - fs[g]!.timeMs;
        if (dt > maxGap) break;
        for (const ni of byFrame[g]!) {
          const p = nodes[ni]!;
          const d = Math.hypot(c.x - p.c.x, c.y - p.c.y);
          const v = d / dt;
          if (v > vmax * 1.25) continue;
          const sizeJump = Math.abs(Math.log(Math.max(1, c.r) / Math.max(1, p.c.r)));
          if (sizeJump > 1.1) continue;
          const trans = 0.6 * (v / vmax) ** 2 + 0.5 * sizeJump;
          const total = p.cost + (f - g - 1) * MISS + trans + nodeCost(c);
          if (total < best) {
            best = total;
            prev = ni;
          }
        }
      }
      byFrame[f]!.push(nodes.length);
      nodes.push({ id: nodes.length, f, c, cost: best, prev });
    }
  }
  // 結尾：剩下的格數都算看不到
  let end = -1;
  let endCost = N * MISS;
  nodes.forEach((n, i) => {
    const v = n.cost + (N - 1 - n.f) * MISS;
    if (v < endCost) {
      endCost = v;
      end = i;
    }
  });
  const path: Node[] = [];
  for (let i = end; i >= 0; i = nodes[i]!.prev) path.push(nodes[i]!);
  path.reverse();
  // 輸出：觀測點＋短空檔內插（不跨越跳接）
  const interp = o.interpolateMs ?? 600;
  const out: BallPoint[] = [];
  for (let i = 0; i < path.length; i++) {
    const a = path[i]!;
    const ta = fs[a.f]!.timeMs;
    out.push({ timeMs: ta, x: round1(a.c.x), y: round1(a.c.y), r: round1(a.c.r), score: a.c.score, source: 'observed', holderTrackId: null });
    const b = path[i + 1];
    if (!b) continue;
    const tb = fs[b.f]!.timeMs;
    const linked = b.prev === a.id;
    if (!linked || tb - ta > interp) continue;
    for (let g = a.f + 1; g < b.f; g++) {
      const t = fs[g]!.timeMs;
      const k = (t - ta) / (tb - ta);
      out.push({
        timeMs: t,
        x: round1(a.c.x + (b.c.x - a.c.x) * k),
        y: round1(a.c.y + (b.c.y - a.c.y) * k),
        r: round1(a.c.r + (b.c.r - a.c.r) * k),
        score: 0,
        source: 'interpolated',
        holderTrackId: null,
      });
    }
  }
  return out;
}

function round1(v: number) {
  return Math.round(v * 10) / 10;
}

// ---------------------------------------------------------------- 持球

/** 取某條軌跡在 t 時的框（前後兩點內插，最多相距 maxMs） */
export function boxAt(track: Track, t: number, maxMs = 700): Box | null {
  const pts = track.points;
  let lo = 0;
  let hi = pts.length - 1;
  if (hi < 0 || t < pts[0]!.timeMs - maxMs / 2 || t > pts[hi]!.timeMs + maxMs / 2) return null;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid]!.timeMs <= t) lo = mid;
    else hi = mid;
  }
  const a = pts[lo]!;
  const b = pts[hi]!;
  if (t <= a.timeMs) return Math.abs(a.timeMs - t) <= maxMs / 2 ? a.box : null;
  if (t >= b.timeMs) return Math.abs(b.timeMs - t) <= maxMs / 2 ? b.box : null;
  if (b.timeMs - a.timeMs > maxMs) return Math.abs(a.timeMs - t) < Math.abs(b.timeMs - t) ? (t - a.timeMs <= maxMs / 2 ? a.box : null) : b.timeMs - t <= maxMs / 2 ? b.box : null;
  const k = (t - a.timeMs) / (b.timeMs - a.timeMs);
  return { x: a.box.x + (b.box.x - a.box.x) * k, y: a.box.y + (b.box.y - a.box.y) * k, w: a.box.w + (b.box.w - a.box.w) * k, h: a.box.h + (b.box.h - a.box.h) * k };
}

/** 球是否在這個球員的「手部範圍」：框左右各放寬 30%、頭頂以下到腳 */
export function holdDistance(ball: Px, b: Box): number | null {
  const inX = ball.x >= b.x - b.w * 0.3 && ball.x <= b.x + b.w * 1.3;
  const inY = ball.y >= b.y + b.h * 0.05 && ball.y <= b.y + b.h * 1.02;
  if (!inX || !inY) return null;
  return Math.abs(ball.x - (b.x + b.w / 2)) / b.w + Math.abs(ball.y - (b.y + b.h * 0.45)) / b.h;
}

/**
 * 判定每個時間點的持球者，並去掉太短的片段（球只是從旁邊飛過）。
 * @param minHoldMs 至少連續這麼久才算持球
 */
export function assignHolders(points: BallPoint[], tracks: Track[], minHoldMs = 300): BallPoint[] {
  const raw = points.map((p) => {
    let best: string | null = null;
    let bestD = Infinity;
    for (const tr of tracks) {
      const b = boxAt(tr, p.timeMs);
      if (!b) continue;
      const d = holdDistance(p, b);
      if (d !== null && d < bestD) {
        bestD = d;
        best = tr.trackId;
      }
    }
    return { ...p, holderTrackId: best };
  });
  // 去掉過短的持球片段（以「時間長度＋一格間隔」計，避免取樣率不同造成差異）
  const out = raw.map((p) => ({ ...p }));
  let i = 0;
  while (i < out.length) {
    const id = out[i]!.holderTrackId;
    let j = i;
    while (j + 1 < out.length && out[j + 1]!.holderTrackId === id && out[j + 1]!.timeMs - out[j]!.timeMs < 700) j++;
    if (id && out[j]!.timeMs - out[i]!.timeMs + localStep(out, i, j) < minHoldMs) for (let k = i; k <= j; k++) out[k]!.holderTrackId = null;
    i = j + 1;
  }
  return out;
}

/** i～j 附近的取樣間隔（毫秒） */
function localStep(pts: BallPoint[], i: number, j: number): number {
  const prev = i > 0 ? pts[i]!.timeMs - pts[i - 1]!.timeMs : Infinity;
  const next = j + 1 < pts.length ? pts[j + 1]!.timeMs - pts[j]!.timeMs : Infinity;
  const inner = j > i ? (pts[j]!.timeMs - pts[i]!.timeMs) / (j - i) : Infinity;
  const v = Math.min(prev, next, inner);
  return Number.isFinite(v) ? Math.min(v, 500) : 200;
}

/** 持球片段（換手就是一個新的片段） */
export function possessionRuns(points: BallPoint[], minMs = 300): PossessionRun[] {
  const runs: PossessionRun[] = [];
  let cur: PossessionRun | null = null;
  let observed = 0;
  for (const p of points) {
    if (p.holderTrackId && cur && cur.trackId === p.holderTrackId && p.timeMs - cur.endMs < 800) {
      cur.endMs = p.timeMs;
      cur.points++;
      if (p.source === 'observed') observed++;
      continue;
    }
    if (cur) runs.push(finish(cur, observed));
    cur = p.holderTrackId ? { startMs: p.timeMs, endMs: p.timeMs, trackId: p.holderTrackId, points: 1, confidence: 'low' } : null;
    observed = p.source === 'observed' ? 1 : 0;
  }
  if (cur) runs.push(finish(cur, observed));
  return runs.filter((r) => r.endMs - r.startMs + (r.points > 1 ? (r.endMs - r.startMs) / (r.points - 1) : 200) >= minMs);

  function finish(r: PossessionRun, obs: number): PossessionRun {
    const ratio = obs / r.points;
    const conf: BallConfidence = r.points >= 4 && ratio >= 0.7 ? 'high' : r.points >= 2 && ratio >= 0.5 ? 'medium' : 'low';
    return { ...r, confidence: conf };
  }
}

// ---------------------------------------------------------------- 籃框

/**
 * 依球場校正估計籃框在畫面上的位置（建議值，請老師確認）：
 * 籃框正下方的地板點往上 3.05 m，用附近球員身高（約 1.8 m）換算像素。
 */
export function suggestHoop(H: number[] | null, tracks: Track[], basket = { x: 26.425, y: 7.5 }): HoopMark | null {
  if (!H) return null;
  const inv = mat3Inv(H);
  if (!inv) return null;
  const floor = applyHomography(inv, basket);
  const l = applyHomography(inv, { x: basket.x, y: basket.y - RIM_DIAMETER_M / 2 });
  const r = applyHomography(inv, { x: basket.x, y: basket.y + RIM_DIAMETER_M / 2 });
  if (!floor || !l || !r) return null;
  const hs: number[] = [];
  for (const t of tracks) for (const p of t.points) if (p.court && Math.hypot(p.court.x - basket.x, p.court.y - basket.y) < 6) hs.push(p.box.h);
  if (!hs.length) for (const t of tracks) for (const p of t.points) hs.push(p.box.h);
  hs.sort((a, b) => a - b);
  const ph = hs.length ? hs[hs.length >> 1]! : null;
  if (!ph) return null;
  const w = Math.max(8, Math.hypot(r.x - l.x, r.y - l.y));
  return { x: Math.round(floor.x), y: Math.round(floor.y - (ph * RIM_HEIGHT_M) / 1.8), w: Math.round(w), source: 'suggested' };
}

// ---------------------------------------------------------------- 出手與進球

export interface ShotOptions {
  /** 球離手後最晚多久要接近籃框 */
  maxFlightMs?: number;
}

const fmt = (ms: number) => `${(ms / 1000).toFixed(1)} 秒`;

/**
 * 從球的軌跡找出出手，並判斷進球與否。
 * 只用「看得到」的證據；關鍵畫面缺漏時回傳 unknown，交給老師判斷。
 */
export function detectShots(points: BallPoint[], hoop: HoopMark | null, opts: ShotOptions = {}): ShotDetection[] {
  if (!hoop || points.length < 3) return [];
  const { x: hx, y: hy, w } = hoop;
  const maxFlight = opts.maxFlightMs ?? 2500;
  const pts = [...points].sort((a, b) => a.timeMs - b.timeMs);
  const nearRim = (p: BallPoint) => Math.abs(p.x - hx) < w * 2.2 && p.y < hy + w * 1.0 && p.y > hy - w * 7;
  const shots: ShotDetection[] = [];
  // 1. 找「接近籃框」的片段（觀測點，彼此相隔 1.5 秒以上算不同次）
  const episodes: number[] = [];
  let lastNear = -Infinity;
  pts.forEach((p, k) => {
    if (p.source !== 'observed' || !nearRim(p) || p.holderTrackId !== null) return;
    if (p.timeMs - lastNear > 1500) episodes.push(k);
    lastNear = p.timeMs;
  });
  for (const reached of episodes) {
    const t0 = pts[reached]!.timeMs;
    // 2. 往回找離手點：最後一個持球點；沒有持球資料時，用 1.5 秒內畫面最低的點
    let release: BallPoint | null = null;
    let shooter: string | null = null;
    for (let k = reached - 1; k >= 0 && t0 - pts[k]!.timeMs <= maxFlight; k--) {
      if (pts[k]!.holderTrackId !== null) {
        release = pts[k]!;
        shooter = pts[k]!.holderTrackId;
        break;
      }
    }
    if (!release) {
      const back = pts.filter((q) => q.timeMs < t0 && t0 - q.timeMs <= 1500);
      const low = back.reduce<BallPoint | null>((a, q) => (!a || q.y > a.y ? q : a), null);
      if (low && low.y > pts[reached]!.y + w * 1.5) release = low;
    }
    if (!release) continue;
    // 必須是往上飛（排除傳球從籃下經過）
    const flight = pts.filter((q) => q.timeMs > release!.timeMs && q.timeMs <= t0 + 600);
    const rose = flight.some((q) => q.y < release!.y - w * 0.8);
    if (!rose) continue;
    // 3. 籃框附近的證據：從接近籃框起 1.4 秒內，直到有人再次持球
    const nextHold = pts.find((q) => q.timeMs > t0 && q.holderTrackId !== null)?.timeMs ?? Infinity;
    const win = pts.filter((q) => q.timeMs >= t0 - 200 && q.timeMs <= Math.min(t0 + 1400, nextHold) && q.source === 'observed');
    const above = win.filter((q) => q.y < hy - w * 0.1 && Math.abs(q.x - hx) < w * 1.3);
    const net = win.filter((q) => q.y >= hy + w * 0.05 && q.y <= hy + w * 1.5 && Math.abs(q.x - hx) <= w * 0.6);
    const belowIn = win.filter((q) => q.y > hy + w * 1.5 && q.y < hy + w * 4 && Math.abs(q.x - hx) <= w * 0.9);
    const firstAbove = above[0]?.timeMs ?? Infinity;
    const netAfter = net.filter((q) => q.timeMs >= firstAbove);
    const closest = win.reduce((a, q) => (Math.hypot(q.x - hx, q.y - hy) < Math.hypot(a.x - hx, a.y - hy) ? q : a), win[0] ?? pts[reached]!);
    const afterClosest = win.filter((q) => q.timeMs > closest.timeMs);
    const sideways = afterClosest.filter((q) => Math.abs(q.x - hx) > w * 1.0 && q.y < hy + w * 2.5);
    const bounceUp = Math.hypot(closest.x - hx, closest.y - hy) < w * 1.2 && afterClosest.some((q) => q.y < closest.y - w * 0.6);
    const sideDrop = win.filter((q) => q.y > hy + w * 0.3 && Math.abs(q.x - hx) > w * 1.0 && q.timeMs > firstAbove);
    let result: ShotResult = 'unknown';
    let confidence: BallConfidence = 'low';
    const ev: string[] = [`${fmt(release.timeMs)} 球離手，${fmt(t0)} 接近籃框。`];
    if (netAfter.length >= 1 && above.length >= 1 && sideways.length === 0 && !bounceUp) {
      result = 'made';
      confidence = netAfter.length >= 2 || belowIn.length >= 1 ? 'high' : 'medium';
      ev.push(`球先出現在籃框上方（${above.length} 格），再落入籃網區（${netAfter.length} 格）。`);
    } else if (netAfter.length === 0 && above.length >= 1 && belowIn.length >= 1 && sideways.length === 0 && !bounceUp) {
      result = 'made';
      confidence = 'medium';
      ev.push(`球從籃框上方直接出現在籃框正下方（${belowIn.length} 格），中間被籃網遮住。`);
    } else if (sideways.length >= 1 || bounceUp || sideDrop.length >= 1) {
      result = 'missed';
      confidence = sideways.length + sideDrop.length >= 2 || (bounceUp && sideways.length >= 1) ? 'high' : 'medium';
      if (bounceUp) ev.push('球碰到籃框附近後又往上彈。');
      if (sideways.length) ev.push(`球在籃框高度附近往外側彈開（${sideways.length} 格）。`);
      if (sideDrop.length) ev.push(`球從籃框旁邊落下，沒有經過籃網區（${sideDrop.length} 格）。`);
    } else {
      ev.push(win.length < 3 ? '球在籃框附近只被拍到很少的畫面（可能被籃板、籃網或球員擋住），系統無法確認是否進球。' : '球在籃框附近的動向不明確，系統無法確認是否進球。');
    }
    if (!shooter) ev.push('出手者無法從畫面確認（球離手時不在任何球員的手部範圍）。');
    shots.push({ id: `shot-${shots.length + 1}`, releaseMs: release.timeMs, rimMs: t0, shooterTrackId: shooter, result, confidence, evidence: ev });
  }
  return shots;
}

/** 片段中看得到球（觀測或短暫內插）的時間比例 */
export function ballCoverage(points: BallPoint[], frames: BallFrame[]): number {
  if (!frames.length) return 0;
  const seen = new Set(points.map((p) => p.timeMs));
  return Math.round((frames.filter((f) => seen.has(f.timeMs)).length / frames.length) * 100) / 100;
}

/** 某時間點的球（最近的一點，最多相差 maxMs） */
export function ballAt(points: BallPoint[] | undefined, t: number, maxMs = 160): BallPoint | null {
  if (!points?.length) return null;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.timeMs <= t) lo = mid;
    else hi = mid;
  }
  const a = points[lo]!;
  const b = points[hi]!;
  const best = Math.abs(a.timeMs - t) <= Math.abs(b.timeMs - t) ? a : b;
  return Math.abs(best.timeMs - t) <= maxMs ? best : null;
}

/** 球員身高中位數（像素）；沒有球員時用畫面高度的 25% */
export function medianPlayerHeight(tracks: Track[], frameH: number): number {
  const hs: number[] = [];
  for (const t of tracks) for (const p of t.points) if (p.source === 'observed') hs.push(p.box.h);
  if (!hs.length) return frameH * 0.25;
  hs.sort((a, b) => a - b);
  return hs[hs.length >> 1]!;
}

/** 整套流程：候選 → 去靜態 → 追蹤 → 持球 → 出手與進球 */
export function analyzeBall(frames: BallFrame[], tracks: Track[], hoop: HoopMark | null, frameH: number, fps: number): BallAnalysis {
  const ph = medianPlayerHeight(tracks, frameH);
  const clean = removeStaticCandidates(frames);
  const pts = assignHolders(trackBall(clean, { playerHeightPx: ph }), tracks);
  return {
    version: BALL_ENGINE_VERSION,
    fps,
    frames,
    points: pts,
    shots: detectShots(pts, hoop),
    coverage: ballCoverage(pts, frames),
    analyzedAt: new Date().toISOString(),
  };
}

/** 由球場校正估計籃框寬度（像素）：籃框正下方地板上 0.45 m 的寬度 */
export function hoopWidthPx(H: number[] | null, basket = { x: 26.425, y: 7.5 }): number | null {
  if (!H) return null;
  const inv = mat3Inv(H);
  if (!inv) return null;
  const l = applyHomography(inv, { x: basket.x, y: basket.y - RIM_DIAMETER_M / 2 });
  const r = applyHomography(inv, { x: basket.x, y: basket.y + RIM_DIAMETER_M / 2 });
  if (!l || !r) return null;
  return Math.max(6, Math.round(Math.hypot(r.x - l.x, r.y - l.y)));
}

/**
 * 需要精細分析的時段：球曾經接近籃框（含出手前 0.6 秒、之後 1.4 秒）。
 * 一般取樣（每秒 5～10 張）很容易剛好錯過球穿過籃框的瞬間，所以這些時段改用每秒 30 張。
 */
export function shotRefineWindows(points: BallPoint[], hoop: HoopMark | null, before = 900, after = 1400): [number, number][] {
  if (!hoop) return [];
  const { x: hx, y: hy, w } = hoop;
  const hits = points.filter((p) => p.source === 'observed' && Math.abs(p.x - hx) < w * 4 && p.y < hy + w * 2.5 && p.y > hy - w * 10).map((p) => p.timeMs);
  const out: [number, number][] = [];
  for (const t of hits) {
    const s = t - before;
    const e = t + after;
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}
