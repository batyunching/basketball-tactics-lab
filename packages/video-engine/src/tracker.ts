import { iou } from './detect';
import type { Box, ColorGuess, Detection, FrameDetections, TeamGuess, Track, TrackPoint } from './types';

/**
 * 多目標追蹤（ByteTrack 精簡版）：
 *  1. 以等速模型預測每條軌跡的位置
 *  2. 先用高信心偵測配對，再用低信心偵測補配（被遮擋時分數常偏低）
 *  3. 配對以 IoU 為主；低影格率時移動距離大，IoU 為 0 則改用中心距離（限一個身高內）
 *  4. 短暫遺失時以速度推估（標記 predicted），超過時限才結束
 * 軌跡編號只是追蹤用的 id，絕不自動等同背號。
 */
export interface TrackerOptions {
  highThreshold: number;
  lowThreshold: number;
  matchThreshold: number;
  /** 遺失後仍以速度推估的時間 */
  maxCoastMs: number;
  /** 遺失超過此時間就結束軌跡 */
  maxLostMs: number;
  /** 至少要被觀測到幾次才算有效軌跡 */
  minHits: number;
}

export const DEFAULT_TRACKER: TrackerOptions = {
  highThreshold: 0.5,
  lowThreshold: 0.15,
  matchThreshold: 0.12,
  maxCoastMs: 600,
  maxLostMs: 1500,
  minHits: 3,
};

interface State {
  id: string;
  box: Box;
  vx: number;
  vy: number;
  lastSeen: number;
  hits: number;
  points: TrackPoint[];
}

type Det = Detection & { color: ColorGuess };

function center(b: Box) {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

function predictBox(s: State, t: number): Box {
  const dt = t - s.lastSeen;
  return { ...s.box, x: s.box.x + s.vx * dt, y: s.box.y + s.vy * dt };
}

/** 相似度 = IoU ＋ 中心距離分數（低影格率時 IoU 可能為 0，仍可依距離配對） */
function similarity(a: Box, b: Box): number {
  const ca = center(a);
  const cb = center(b);
  const d = Math.hypot(ca.x - cb.x, ca.y - cb.y);
  const gate = Math.max(a.h, b.h);
  const dist = d < gate ? 0.3 * (1 - d / gate) : 0;
  const v = iou(a, b);
  return v > 0 || dist > 0 ? v + dist : 0;
}

/** 貪婪配對：相似度由高到低 */
function greedyMatch(boxes: Box[], dets: Det[], threshold: number): [number, number][] {
  const pairs: [number, number, number][] = [];
  boxes.forEach((b, i) => dets.forEach((d, j) => {
    const s = similarity(b, d);
    if (s >= threshold) pairs.push([s, i, j]);
  }));
  pairs.sort((a, b) => b[0] - a[0]);
  const ui = new Set<number>();
  const uj = new Set<number>();
  const out: [number, number][] = [];
  for (const [, i, j] of pairs) {
    if (ui.has(i) || uj.has(j)) continue;
    ui.add(i);
    uj.add(j);
    out.push([i, j]);
  }
  return out;
}

export class Tracker {
  private active: State[] = [];
  private finished: State[] = [];
  private seq = 0;

  constructor(private readonly opts: TrackerOptions = DEFAULT_TRACKER) {}

  update(frame: FrameDetections): void {
    const t = frame.timeMs;
    const high = frame.boxes.filter((d) => d.score >= this.opts.highThreshold);
    const low = frame.boxes.filter((d) => d.score >= this.opts.lowThreshold && d.score < this.opts.highThreshold);
    const predicted = this.active.map((s) => predictBox(s, t));

    const matched = new Set<number>();
    const m1 = greedyMatch(predicted, high, this.opts.matchThreshold);
    for (const [i, j] of m1) {
      this.observe(this.active[i]!, high[j]!, t);
      matched.add(i);
    }
    const restIdx = this.active.map((_, i) => i).filter((i) => !matched.has(i));
    const m2 = greedyMatch(restIdx.map((i) => predicted[i]!), low, 0.3);
    for (const [k, j] of m2) {
      const i = restIdx[k]!;
      this.observe(this.active[i]!, low[j]!, t);
      matched.add(i);
    }
    // 未配對的軌跡：短暫推估或結束
    const keep: State[] = [];
    this.active.forEach((s, i) => {
      if (matched.has(i)) {
        keep.push(s);
        return;
      }
      const lost = t - s.lastSeen;
      if (lost > this.opts.maxLostMs) {
        this.finished.push(s);
        return;
      }
      if (s.hits >= 2 && lost <= this.opts.maxCoastMs) {
        s.points.push({ timeMs: t, box: predicted[i]!, court: null, detectionConfidence: 0, color: { team: 'unknown', confidence: 0 }, source: 'predicted', flags: ['predicted'] });
      }
      keep.push(s);
    });
    // 新的高信心偵測 → 新軌跡
    const usedHigh = new Set(m1.map(([, j]) => j));
    high.forEach((d, j) => {
      if (usedHigh.has(j)) return;
      keep.push({
        id: `T${++this.seq}`,
        box: { x: d.x, y: d.y, w: d.w, h: d.h },
        vx: 0,
        vy: 0,
        lastSeen: t,
        hits: 1,
        points: [{ timeMs: t, box: { x: d.x, y: d.y, w: d.w, h: d.h }, court: null, detectionConfidence: d.score, color: d.color, source: 'observed', flags: [] }],
      });
    });
    this.active = keep;
  }

  private observe(s: State, d: Det, t: number) {
    const dt = t - s.lastSeen;
    if (dt > 0) {
      const c0 = center(s.box);
      const c1 = center(d);
      const k = 0.6;
      s.vx = k * ((c1.x - c0.x) / dt) + (1 - k) * s.vx;
      s.vy = k * ((c1.y - c0.y) / dt) + (1 - k) * s.vy;
    }
    s.box = { x: d.x, y: d.y, w: d.w, h: d.h };
    s.lastSeen = t;
    s.hits++;
    s.points.push({ timeMs: t, box: { ...s.box }, court: null, detectionConfidence: d.score, color: d.color, source: 'observed', flags: [] });
  }

  /** 取得結果：去掉太短的軌跡，並計算整條軌跡的隊色 */
  finish(): Track[] {
    const all = [...this.finished, ...this.active].filter((s) => s.hits >= this.opts.minHits);
    return all.map((s) => {
      while (s.points.length && s.points[s.points.length - 1]!.source === 'predicted') s.points.pop();
      const { team, confidence } = voteTeam(s.points);
      return { trackId: s.id, points: s.points, team, teamConfidence: confidence };
    });
  }
}

export function voteTeam(points: TrackPoint[]): { team: TeamGuess; confidence: number } {
  let red = 0;
  let blue = 0;
  for (const p of points) {
    if (p.color.team === 'red') red += p.color.confidence;
    if (p.color.team === 'blue') blue += p.color.confidence;
  }
  const total = red + blue;
  if (total === 0) return { team: 'unknown', confidence: 0 };
  const dom = Math.abs(red - blue) / total;
  const coverage = Math.min(1, total / Math.max(1, points.filter((p) => p.source === 'observed').length * 0.5));
  const confidence = Math.round(dom * coverage * 100) / 100;
  return { team: dom < 0.3 ? 'unknown' : red > blue ? 'red' : 'blue', confidence };
}

export function runTracker(frames: FrameDetections[], opts?: TrackerOptions): Track[] {
  const t = new Tracker(opts);
  for (const f of [...frames].sort((a, b) => a.timeMs - b.timeMs)) t.update(f);
  return t.finish();
}
