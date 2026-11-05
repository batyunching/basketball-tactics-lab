import type { PlayerDef, TeamId, Vec2 } from '@btl/shared-types';
import { basketPosition } from '@btl/tactic-engine';
import { positionAt, type PlayerSample } from '@btl/video-engine';
import type { PossessionMark, ShotMark } from './types';

/** 分析用的等間隔時間軸（預設每 0.2 秒一格） */
export interface Timeline {
  times: number[];
  stepMs: number;
  players: PlayerDef[];
  pos: Record<string, (Vec2 | null)[]>;
  /** 0～1：該格位置的可信程度（身分信心 × 是否有不確定標記） */
  quality: Record<string, number[]>;
  holder: (string | null)[];
  holderConfirmed: boolean[];
  basket: Vec2;
  possession: PossessionMark[];
  shots: ShotMark[];
}

export interface AnalyzeInput {
  players: PlayerDef[];
  samples: Record<string, PlayerSample[]>;
  possession: PossessionMark[];
  shots: ShotMark[];
  startMs: number;
  endMs: number;
  stepMs?: number;
  /** 平滑半徑（格數），0 = 不平滑 */
  smoothRadius?: number;
}

export function smooth(ps: (Vec2 | null)[], r: number): (Vec2 | null)[] {
  if (r <= 0) return ps;
  return ps.map((p, i) => {
    if (!p) return null;
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let k = i - r; k <= i + r; k++) {
      const q = ps[k];
      if (q) {
        sx += q.x;
        sy += q.y;
        n++;
      }
    }
    return { x: sx / n, y: sy / n };
  });
}

export function sampleQuality(s: PlayerSample | null): number {
  if (!s) return 0;
  if (s.positionSource === 'manual') return 1;
  let q = s.identityConfidence;
  if (s.flags.some((f) => f !== 'interpolated')) q *= 0.6;
  if (s.positionSource === 'interpolated') q *= 0.8;
  return Math.max(0, Math.min(1, q));
}

export function buildTimeline(input: AnalyzeInput): Timeline {
  const stepMs = input.stepMs ?? 200;
  const times: number[] = [];
  for (let t = input.startMs; t <= input.endMs; t += stepMs) times.push(t);
  const pos: Timeline['pos'] = {};
  const quality: Timeline['quality'] = {};
  for (const p of input.players) {
    pos[p.id] = [];
    quality[p.id] = [];
    for (const t of times) {
      const s = positionAt(input.samples[p.id], t);
      pos[p.id]!.push(s ? s.courtPosition : null);
      quality[p.id]!.push(sampleQuality(s));
    }
  }
  // 去抖動：以前後各 2 格（約 ±0.4 秒）平均，降低追蹤雜訊造成的誤判
  for (const p of input.players) pos[p.id] = smooth(pos[p.id]!, input.smoothRadius ?? 2);
  const marks = [...input.possession].sort((a, b) => a.timeMs - b.timeMs);
  const holder: (string | null)[] = [];
  const holderConfirmed: boolean[] = [];
  for (const t of times) {
    let m: PossessionMark | undefined;
    for (const x of marks) if (x.timeMs <= t + stepMs / 2) m = x;
    holder.push(m ? m.holderId : null);
    holderConfirmed.push(!!m?.confirmed);
  }
  return { times, stepMs, players: input.players, pos, quality, holder, holderConfirmed, basket: basketPosition('right'), possession: marks, shots: [...input.shots].sort((a, b) => a.timeMs - b.timeMs) };
}

export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

export function teamOf(tl: Timeline, id: string | null): TeamId | null {
  if (!id) return null;
  return tl.players.find((p) => p.id === id)?.teamId ?? null;
}

export function name(tl: Timeline, id: string): string {
  const d = tl.players.find((p) => p.id === id);
  return d ? `${d.teamId === 'red' ? '紅' : '藍'}${d.jerseyNumber}` : id;
}

export function indexAt(tl: Timeline, t: number): number {
  return Math.max(0, Math.min(tl.times.length - 1, Math.round((t - tl.times[0]!) / tl.stepMs)));
}

/** 禁區（半場、攻右邊籃框） */
export function inPaint(p: Vec2): boolean {
  return p.x >= 22.2 && p.y >= 5.05 && p.y <= 9.95;
}

/** 某隊在 k 格時，離 p 最近的對手 */
export function nearestOpponent(tl: Timeline, team: TeamId, k: number, p: Vec2, exclude: string[] = []): { id: string; d: number } | null {
  let best: { id: string; d: number } | null = null;
  for (const o of tl.players) {
    if (o.teamId === team || exclude.includes(o.id)) continue;
    const q = tl.pos[o.id]![k];
    if (!q) continue;
    const d = dist(p, q);
    if (!best || d < best.d) best = { id: o.id, d };
  }
  return best;
}

/** 一段時間內某球員資料的平均可信度（沒有位置算 0） */
export function windowQuality(tl: Timeline, id: string, k0: number, k1: number): number {
  const q = tl.quality[id]!;
  let s = 0;
  let n = 0;
  for (let k = k0; k <= k1; k++) {
    s += q[k] ?? 0;
    n++;
  }
  return n ? s / n : 0;
}

export function fmtSec(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} 秒`;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}

export const m1 = (v: number) => v.toFixed(1);
