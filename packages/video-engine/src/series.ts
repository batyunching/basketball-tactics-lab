import type { PlayerDef, TeamId, Vec2 } from '@btl/shared-types';
import { isInBounds, lerpVec, playableBounds } from '@btl/tactic-engine';
import { iou } from './detect';
import { applyHomography } from './homography';
import type { Keyframe, PlayerSample, ReviewStatus, Track, TrackPoint, UncertaintyFlag } from './types';

export const LOW_CONFIDENCE = 0.45;
export const OVERLAP_IOU = 0.25;
/** 兩個可信位置之間最多內插多久 */
export const MAX_INTERPOLATE_MS = 3000;

/** 腳底點：框底部中央 */
export function footPoint(b: { x: number; y: number; w: number; h: number }) {
  return { x: b.x + b.w / 2, y: b.y + b.h };
}

/** 把每個追蹤點換算到球場座標，並標記不確定原因 */
export function projectTracks(tracks: Track[], H: number[] | null): Track[] {
  const bounds = playableBounds('half', 'right');
  // 同一時間的所有框（用來偵測重疊）
  const byTime = new Map<number, { trackId: string; p: TrackPoint }[]>();
  for (const t of tracks) for (const p of t.points) {
    const list = byTime.get(p.timeMs) ?? [];
    list.push({ trackId: t.trackId, p });
    byTime.set(p.timeMs, list);
  }
  return tracks.map((t) => ({
    ...t,
    points: t.points.map((p) => {
      const flags = new Set<UncertaintyFlag>(p.source === 'predicted' ? ['predicted'] : []);
      let court: Vec2 | null = null;
      if (!H) flags.add('no-calibration');
      else {
        court = applyHomography(H, footPoint(p.box));
        if (!court || !isInBounds(court, bounds)) flags.add('out-of-court');
      }
      if (p.source === 'observed' && p.detectionConfidence < LOW_CONFIDENCE) flags.add('low-confidence');
      if (p.source === 'observed' && (p.color.team === 'unknown' || p.color.confidence < 0.4)) flags.add('team-uncertain');
      const others = byTime.get(p.timeMs) ?? [];
      if (others.some((o) => o.trackId !== t.trackId && iou(o.p.box, p.box) > OVERLAP_IOU)) flags.add('overlap');
      return { ...p, court: court ? { x: Math.round(court.x * 100) / 100, y: Math.round(court.y * 100) / 100 } : null, flags: [...flags] };
    }),
  }));
}

export const FLAG_LABEL: Record<UncertaintyFlag, string> = {
  'low-confidence': '偵測信心低',
  overlap: '與其他球員重疊（身分可能交換）',
  'out-of-court': '落在場外（校正或偵測可能有誤）',
  'team-uncertain': '隊色不明確',
  predicted: '短暫遮擋，以速度推估',
  interpolated: '內插補上',
  'no-calibration': '尚未校正',
};

export interface SeriesInput {
  tracks: Track[];
  /** 老師指派：軌跡 → 球員（可多條軌跡指到同一人；'ignore' = 非球員） */
  assignments: Record<string, string>;
  reviews: Record<string, ReviewStatus>;
  keyframes: Keyframe[];
  players: PlayerDef[];
  /** 輸出的取樣時間 */
  times: number[];
  /** 判定「同一時間」的容許誤差 */
  toleranceMs: number;
}

interface Anchor {
  timeMs: number;
  pos: Vec2;
  source: 'manual' | 'observed' | 'predicted';
  trackId: string | null;
  detectionConfidence: number | null;
  flags: UncertaintyFlag[];
  review: ReviewStatus;
}

/** 依計畫書欄位輸出每位球員的軌跡樣本 */
export function buildPlayerSamples(input: SeriesInput): Record<string, PlayerSample[]> {
  const out: Record<string, PlayerSample[]> = {};
  for (const def of input.players) {
    const anchors: Anchor[] = [];
    for (const k of input.keyframes) {
      const p = k.players[def.id];
      if (p) anchors.push({ timeMs: k.timeMs, pos: p, source: 'manual', trackId: null, detectionConfidence: null, flags: [], review: 'corrected' });
    }
    for (const t of input.tracks) {
      if (input.assignments[t.trackId] !== def.id) continue;
      for (const p of t.points) {
        if (!p.court || p.flags.includes('out-of-court')) continue;
        anchors.push({
          timeMs: p.timeMs,
          pos: p.court,
          source: p.source,
          trackId: t.trackId,
          detectionConfidence: p.source === 'observed' ? p.detectionConfidence : null,
          flags: p.flags,
          review: input.reviews[t.trackId] ?? 'unreviewed',
        });
      }
    }
    anchors.sort((a, b) => a.timeMs - b.timeMs || (a.source === 'manual' ? -1 : 1));
    if (!anchors.length) continue;
    const samples: PlayerSample[] = [];
    for (const time of input.times) {
      const sample = sampleAt(anchors, time, input.toleranceMs);
      if (!sample) continue;
      samples.push({
        timeMs: time,
        trackId: sample.trackId,
        playerId: def.id,
        team: def.teamId as TeamId,
        jerseyNumber: def.jerseyNumber,
        courtPosition: sample.pos,
        detectionConfidence: sample.detectionConfidence,
        identityConfidence: sample.identityConfidence,
        reviewStatus: sample.review,
        positionSource: sample.source,
        flags: sample.flags,
      });
    }
    out[def.id] = samples;
  }
  return out;
}

function identityConfidence(a: Anchor): number {
  if (a.source === 'manual') return 1;
  let c = a.review === 'confirmed' ? 0.9 : 0.7;
  if (a.flags.includes('overlap')) c -= 0.3;
  if (a.flags.includes('predicted')) c -= 0.1;
  return Math.max(0.1, Math.round(c * 100) / 100);
}

function sampleAt(anchors: Anchor[], t: number, tol: number) {
  // 1. 人工關鍵影格優先，其次觀測點
  const near = anchors.filter((a) => Math.abs(a.timeMs - t) <= tol);
  const best = near.find((a) => a.source === 'manual') ?? near.find((a) => a.source === 'observed') ?? near[0];
  if (best) {
    return {
      pos: best.pos,
      source: best.source === 'manual' ? ('manual' as const) : best.source === 'predicted' ? ('predicted' as const) : ('observed' as const),
      trackId: best.trackId,
      detectionConfidence: best.detectionConfidence,
      identityConfidence: identityConfidence(best),
      flags: best.flags,
      review: best.review,
    };
  }
  // 2. 前後兩個錨點之間內插（間隔太長就不補）
  let before: Anchor | undefined;
  let after: Anchor | undefined;
  for (const a of anchors) {
    if (a.timeMs < t) before = a;
    else if (a.timeMs > t) {
      after = a;
      break;
    }
  }
  if (!before || !after || after.timeMs - before.timeMs > MAX_INTERPOLATE_MS) return null;
  const k = (t - before.timeMs) / (after.timeMs - before.timeMs);
  const pos = lerpVec(before.pos, after.pos, k);
  return {
    pos: { x: Math.round(pos.x * 100) / 100, y: Math.round(pos.y * 100) / 100 },
    source: 'interpolated' as const,
    trackId: before.trackId === after.trackId ? before.trackId : null,
    detectionConfidence: null,
    identityConfidence: Math.min(identityConfidence(before), identityConfidence(after)) * 0.9,
    flags: ['interpolated'] as UncertaintyFlag[],
    review: before.review === after.review ? before.review : ('unreviewed' as ReviewStatus),
  };
}

/** 播放時取任意時間的位置（在樣本之間線性內插） */
export function positionAt(samples: PlayerSample[] | undefined, t: number): PlayerSample | null {
  if (!samples?.length) return null;
  let lo = 0;
  let hi = samples.length - 1;
  if (t <= samples[0]!.timeMs) return Math.abs(t - samples[0]!.timeMs) < 500 ? samples[0]! : null;
  if (t >= samples[hi]!.timeMs) return Math.abs(t - samples[hi]!.timeMs) < 500 ? samples[hi]! : null;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid]!.timeMs <= t) lo = mid;
    else hi = mid;
  }
  const a = samples[lo]!;
  const b = samples[hi]!;
  if (b.timeMs - a.timeMs > MAX_INTERPOLATE_MS) return null;
  const k = (t - a.timeMs) / (b.timeMs - a.timeMs);
  return { ...a, timeMs: t, courtPosition: lerpVec(a.courtPosition, b.courtPosition, k) };
}

export function sampleTimes(startMs: number, endMs: number, fps: number): number[] {
  const step = 1000 / fps;
  const out: number[] = [];
  for (let t = startMs; t <= endMs + 1e-6; t += step) out.push(Math.round(t));
  return out;
}

/** 計畫書第九節的品質指標（可計算的部分） */
export interface QualityReport {
  frames: number;
  detectionsPerFrame: number;
  tracks: number;
  assignedTracks: number;
  /** 每位球員有位置的取樣比例 */
  coverage: Record<string, number>;
  /** 不確定樣本比例 */
  uncertainRatio: number;
  /** 同一位球員由幾條軌跡拼成（越多代表 ID 切換越多） */
  fragments: Record<string, number>;
}

export function qualityReport(frames: { boxes: unknown[] }[], tracks: Track[], assignments: Record<string, string>, samples: Record<string, PlayerSample[]>, timesCount: number): QualityReport {
  const coverage: Record<string, number> = {};
  const fragments: Record<string, number> = {};
  let total = 0;
  let uncertain = 0;
  for (const [pid, list] of Object.entries(samples)) {
    coverage[pid] = timesCount ? Math.round((list.length / timesCount) * 100) / 100 : 0;
    for (const s of list) {
      total++;
      if (s.flags.length || s.identityConfidence < 0.6) uncertain++;
    }
  }
  for (const pid of Object.values(assignments)) if (pid !== 'ignore') fragments[pid] = (fragments[pid] ?? 0) + 1;
  return {
    frames: frames.length,
    detectionsPerFrame: frames.length ? Math.round((frames.reduce((s, f) => s + f.boxes.length, 0) / frames.length) * 10) / 10 : 0,
    tracks: tracks.length,
    assignedTracks: Object.values(assignments).filter((v) => v !== 'ignore').length,
    coverage,
    uncertainRatio: total ? Math.round((uncertain / total) * 100) / 100 : 0,
    fragments,
  };
}
