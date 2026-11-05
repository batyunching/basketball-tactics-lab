import type { Vec2 } from '@btl/shared-types';
import { positionAt, type PlayerSample } from '@btl/video-engine';
import type { TacticalEvent, TacticalEventType } from './types';

/**
 * 品質評估（計畫書第九節）
 * 1. evaluateAgainstTruth：與人工標註真值比對（測試集用）
 * 2. evaluateReview：以教師審核結果當作真值（實際上課影片用）
 *    確認 = 正確、否決 = 誤報、教師手動新增 = 漏抓
 */
export interface TruthEvent {
  type: TacticalEventType;
  timeMs: number;
  players: string[];
}

export interface TypeScore {
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  precision: number | null;
  recall: number | null;
}

function ratio(a: number, b: number): number | null {
  return b === 0 ? null : Math.round((a / b) * 100) / 100;
}

function score(tp: number, fp: number, fn: number): TypeScore {
  return { truePositive: tp, falsePositive: fp, falseNegative: fn, precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn) };
}

/** 事件比對：同類型、時間在容許誤差內、主要球員相同 */
export function evaluateAgainstTruth(detected: TacticalEvent[], truth: TruthEvent[], toleranceMs = 1000): { byType: Record<string, TypeScore>; overall: TypeScore } {
  const det = detected.filter((e) => e.confidence !== 'insufficient' && e.status !== 'rejected');
  const used = new Set<string>();
  const types = new Set<string>([...det.map((d) => d.type), ...truth.map((t) => t.type)]);
  const byType: Record<string, TypeScore> = {};
  let TP = 0;
  let FP = 0;
  let FN = 0;
  for (const type of types) {
    let tp = 0;
    let fn = 0;
    for (const t of truth.filter((x) => x.type === type)) {
      const m = det.find((d) => !used.has(d.id) && d.type === type && t.timeMs >= d.startMs - toleranceMs && t.timeMs <= d.endMs + toleranceMs && t.players.every((p) => d.players.some((dp) => dp.id === p)));
      if (m) {
        used.add(m.id);
        tp++;
      } else fn++;
    }
    const fp = det.filter((d) => d.type === type && !used.has(d.id)).length;
    byType[type] = score(tp, fp, fn);
    TP += tp;
    FP += fp;
    FN += fn;
  }
  return { byType, overall: score(TP, FP, FN) };
}

/** 以教師審核結果評估 AI 建議的品質 */
export function evaluateReview(events: TacticalEvent[]): { byType: Record<string, TypeScore>; overall: TypeScore; reviewed: number; pending: number; insufficient: number } {
  const byType: Record<string, TypeScore> = {};
  let TP = 0;
  let FP = 0;
  let FN = 0;
  const types = new Set(events.map((e) => e.type));
  for (const type of types) {
    const list = events.filter((e) => e.type === type);
    const tp = list.filter((e) => !e.manual && e.status === 'confirmed').length;
    const fp = list.filter((e) => !e.manual && e.status === 'rejected').length;
    const fn = list.filter((e) => e.manual && e.status !== 'rejected').length;
    byType[type] = score(tp, fp, fn);
    TP += tp;
    FP += fp;
    FN += fn;
  }
  return {
    byType,
    overall: score(TP, FP, FN),
    reviewed: events.filter((e) => !e.manual && e.status !== 'suggested').length,
    pending: events.filter((e) => e.status === 'suggested').length,
    insufficient: events.filter((e) => e.confidence === 'insufficient').length,
  };
}

/** 軌跡品質：與真值路徑比較的平均定位誤差與覆蓋率 */
export function evaluateTrajectories(samples: Record<string, PlayerSample[]>, truth: Record<string, { t: number; x: number; y: number }[]>): Record<string, { meanErrorM: number | null; coverage: number }> {
  const out: Record<string, { meanErrorM: number | null; coverage: number }> = {};
  for (const [pid, path] of Object.entries(truth)) {
    let n = 0;
    let sum = 0;
    for (const g of path) {
      const s = positionAt(samples[pid], g.t);
      if (!s) continue;
      const p: Vec2 = s.courtPosition;
      sum += Math.hypot(p.x - g.x, p.y - g.y);
      n++;
    }
    out[pid] = { meanErrorM: n ? Math.round((sum / n) * 100) / 100 : null, coverage: path.length ? Math.round((n / path.length) * 100) / 100 : 0 };
  }
  return out;
}
