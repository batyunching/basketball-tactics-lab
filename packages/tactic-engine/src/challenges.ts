import type {
  Challenge,
  ChallengeAnswer,
  ChallengeResult,
  ChoiceChallenge,
  PlacementChallenge,
  PredictChallenge,
  TacticProject,
  Vec2,
  Zone,
} from '@btl/shared-types';
import { distance } from './court';

export const CHALLENGE_TYPE_LABEL = {
  placement: '站位挑戰',
  predict: '跑位預測',
  choice: '戰術選擇',
} as const;

export function inZone(p: Vec2, z: Zone): boolean {
  return distance(p, z) <= z.r;
}

export function inAnyZone(p: Vec2, zones: Zone[]): boolean {
  return zones.some((z) => inZone(p, z));
}

/** 離最近判定區邊緣的距離（公尺，負值表示在區內） */
export function distanceToZones(p: Vec2, zones: Zone[]): number {
  if (zones.length === 0) return Infinity;
  return Math.min(...zones.map((z) => distance(p, z) - z.r));
}

function ratioScore(points: number, ratio: number): number {
  return Math.round(points * Math.min(1, Math.max(0, ratio)) * 10) / 10;
}

export function gradePlacement(c: PlacementChallenge, positions: Record<string, Vec2>, tries = 1): ChallengeResult {
  const details: Record<string, boolean> = {};
  for (const id of c.movable) {
    const p = positions[id];
    details[id] = !!p && inAnyZone(p, c.targets[id] ?? []);
  }
  const ok = Object.values(details).filter(Boolean).length;
  const ratio = c.movable.length ? ok / c.movable.length : 0;
  return {
    challengeId: c.id,
    type: 'placement',
    score: ratioScore(c.points, ratio),
    maxScore: c.points,
    correct: ratio === 1,
    ratio,
    details,
    answer: { type: 'placement', positions },
    tries,
  };
}

export function gradePredict(c: PredictChallenge, position: Vec2, tries = 1): ChallengeResult {
  const ok = inAnyZone(position, c.targets);
  return {
    challengeId: c.id,
    type: 'predict',
    score: ok ? c.points : 0,
    maxScore: c.points,
    correct: ok,
    ratio: ok ? 1 : 0,
    details: { [c.playerId]: ok },
    answer: { type: 'predict', position },
    tries,
  };
}

/** 多選：選中正確 +1、選到錯誤 −1，按正確數比例給分；全對才算 correct */
export function gradeChoice(c: ChoiceChallenge, selected: string[], tries = 1): ChallengeResult {
  const sel = new Set(selected);
  const correct = new Set(c.correct);
  const details: Record<string, boolean> = {};
  for (const o of c.options) details[o.id] = sel.has(o.id) === correct.has(o.id);
  let ratio: number;
  if (!c.multiple) {
    ratio = selected.length === 1 && correct.has(selected[0]!) ? 1 : 0;
  } else {
    const hit = [...sel].filter((s) => correct.has(s)).length;
    const wrong = [...sel].filter((s) => !correct.has(s)).length;
    ratio = correct.size ? Math.max(0, hit - wrong) / correct.size : 0;
  }
  return {
    challengeId: c.id,
    type: 'choice',
    score: ratioScore(c.points, ratio),
    maxScore: c.points,
    correct: ratio === 1,
    ratio,
    details,
    answer: { type: 'choice', selected: [...selected] },
    tries,
  };
}

export function gradeChallenge(c: Challenge, answer: ChallengeAnswer, tries = 1): ChallengeResult {
  if (c.type === 'placement' && answer.type === 'placement') return gradePlacement(c, answer.positions, tries);
  if (c.type === 'predict' && answer.type === 'predict') return gradePredict(c, answer.position, tries);
  if (c.type === 'choice' && answer.type === 'choice') return gradeChoice(c, answer.selected, tries);
  throw new Error('答案類型與題型不符');
}

export function totalScore(results: ChallengeResult[]): { score: number; maxScore: number } {
  return {
    score: Math.round(results.reduce((a, r) => a + r.score, 0) * 10) / 10,
    maxScore: results.reduce((a, r) => a + r.maxScore, 0),
  };
}

/** 題目畫面的球員位置：該步驟位置 + 覆寫 + 站位題的起始位置 */
export function challengeSetupPositions(project: TacticProject, c: Challenge): Record<string, Vec2> {
  const step = project.steps[c.stepIndex] ?? project.steps[0]!;
  const out: Record<string, Vec2> = {};
  for (const [id, p] of Object.entries(step.players)) out[id] = { x: p.x, y: p.y };
  if (c.type === 'predict' && c.overrides) Object.assign(out, c.overrides);
  if (c.type === 'placement' && c.startPositions) Object.assign(out, c.startPositions);
  return out;
}

/** 題目畫面的持球者 */
export function challengeSetupHolder(project: TacticProject, c: Challenge): string | null {
  const step = project.steps[c.stepIndex] ?? project.steps[0]!;
  if (c.type === 'predict' && c.ballHolderOverride !== undefined) return c.ballHolderOverride;
  return step.ball.holderId;
}
