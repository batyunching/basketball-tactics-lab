import type {
  Annotation,
  AnnotationKind,
  Challenge,
  ChoiceChallenge,
  CourtMode,
  Lesson,
  PlacementChallenge,
  PlayerState,
  PredictChallenge,
  TacticEvent,
  TacticProject,
  TacticStep,
  TeamSize,
  Vec2,
  Zone,
} from '@btl/shared-types';
import { basketPosition, createProject, fromBasketRelative, moveToward, round2 } from '@btl/tactic-engine';

/**
 * 教材撰寫工具：
 *  半場教材以「距進攻底線 d、橫向 y」描述（紅隊進攻上方籃框），
 *  全場教材直接用球場絕對座標。未寫到的球員沿用上一步位置。
 */
export type Key = 'r1' | 'r2' | 'r3' | 'r4' | 'r5' | 'b1' | 'b2' | 'b3' | 'b4' | 'b5';
export type P = [number, number];

export const BLACK = '#1d1d1f';
export const BLUE = '#1b6ee8';
export const YELLOW = '#f5b700';
export const RED = '#d7263d';

export function pid(k: Key): string {
  return `${k[0] === 'r' ? 'red' : 'blue'}-${k[1]}`;
}

export type EventSpec = ['pass', Key, Key] | ['dribble', Key] | ['shot', Key];

export interface AnnSpec {
  kind: AnnotationKind;
  pts: P[];
  color?: string;
}

export interface StepSpec {
  title: string;
  note: string;
  durationMs?: number;
  pos?: Partial<Record<Key, P>>;
  /** 未指定的藍隊依對位紅隊自動放在「人與籃框之間 1.3m」 */
  autoDefense?: boolean;
  ball?: Key;
  events?: EventSpec[];
  ann?: AnnSpec[];
}

export interface LessonCtx {
  mode: CourtMode;
  /** 轉成球場絕對座標 */
  at: (p: P) => Vec2;
  zone: (p: P, r: number, label?: string) => Zone;
}

export function ctxFor(mode: CourtMode): LessonCtx {
  const at = (p: P): Vec2 => {
    const v = mode === 'half' ? fromBasketRelative(p[0], p[1], 'right') : { x: p[0], y: p[1] };
    return { x: round2(v.x), y: round2(v.y) };
  };
  return { mode, at, zone: (p, r, label) => ({ ...at(p), r, ...(label ? { label } : {}) }) };
}

export interface LessonSpec extends Omit<Lesson, 'project' | 'challenges'> {
  mode: CourtMode;
  teamSize: TeamSize;
  steps: StepSpec[];
  challenges: (ctx: LessonCtx) => Challenge[];
}

export function buildLesson(spec: LessonSpec): Lesson {
  const ctx = ctxFor(spec.mode);
  const base = createProject({ title: spec.title, mode: spec.mode, teamSize: spec.teamSize });
  const basket = basketPosition('right');
  let players: Record<string, PlayerState> = { ...base.steps[0]!.players };
  let holder: string | null = null;
  const steps: TacticStep[] = spec.steps.map((s, i) => {
    players = { ...players };
    for (const [k, p] of Object.entries(s.pos ?? {}) as [Key, P][]) players[pid(k)] = ctx.at(p);
    if (s.autoDefense) {
      for (let n = 1; n <= 5; n++) {
        const k = `b${n}` as Key;
        if (s.pos?.[k]) continue;
        const man = players[pid(`r${n}` as Key)];
        if (!man) continue;
        const d = moveToward(man, basket, 1.3);
        players[pid(k)] = { x: round2(d.x), y: round2(d.y) };
      }
    }
    if (s.ball) holder = pid(s.ball);
    const events: TacticEvent[] = (s.events ?? []).map((e, j) => {
      const id = `${spec.id}-s${i}-e${j}`;
      if (e[0] === 'pass') return { id, type: 'pass', fromId: pid(e[1]), toId: pid(e[2]) };
      if (e[0] === 'dribble') return { id, type: 'dribble', playerId: pid(e[1]) };
      return { id, type: 'shot', playerId: pid(e[1]) };
    });
    const shot = (s.events ?? []).some((e) => e[0] === 'shot');
    if (shot) holder = null;
    const hp = holder ? players[holder] : undefined;
    const ball = shot ? { holderId: null, x: basket.x, y: basket.y } : hp ? { holderId: holder, x: hp.x, y: hp.y } : { holderId: null, x: basket.x, y: basket.y };
    const annotations: Annotation[] = (s.ann ?? []).map((a, j) => ({
      id: `${spec.id}-s${i}-a${j}`,
      kind: a.kind,
      color: a.color ?? (a.kind === 'zone' ? BLUE : a.kind === 'circle' ? YELLOW : BLACK),
      points: a.pts.map(ctx.at),
    }));
    return {
      id: `${spec.id}-s${i}`,
      title: s.title,
      durationMs: s.durationMs ?? 1500,
      players,
      ball,
      offenseTeam: 'red',
      events,
      annotations,
      note: s.note,
    };
  });
  const project: TacticProject = {
    ...base,
    id: `lesson-${spec.id}`,
    title: spec.title,
    createdAt: '2026-11-05T00:00:00.000Z',
    updatedAt: '2026-11-05T00:00:00.000Z',
    steps,
  };
  const { mode: _m, teamSize: _t, steps: _s, challenges, ...meta } = spec;
  return { ...meta, project, challenges: challenges(ctx) };
}

// 題目小工具（減少重複欄位）
type Common = { id: string; title: string; prompt: string; stepIndex: number; explanation: string; hint?: string; points?: number };

export function placement(c: Common & { movable: Key[]; targets: Partial<Record<Key, Zone[]>>; start?: Partial<Record<Key, Vec2>>; solutionStep?: number }): PlacementChallenge {
  const targets: Record<string, Zone[]> = {};
  for (const [k, z] of Object.entries(c.targets) as [Key, Zone[]][]) targets[pid(k)] = z;
  const startPositions: Record<string, Vec2> = {};
  for (const [k, p] of Object.entries(c.start ?? {}) as [Key, Vec2][]) startPositions[pid(k)] = p;
  return {
    id: c.id,
    type: 'placement',
    title: c.title,
    prompt: c.prompt,
    stepIndex: c.stepIndex,
    explanation: c.explanation,
    ...(c.hint ? { hint: c.hint } : {}),
    points: c.points ?? 10,
    movable: c.movable.map(pid),
    targets,
    ...(c.start ? { startPositions } : {}),
    ...(c.solutionStep !== undefined ? { solutionStepIndex: c.solutionStep } : {}),
  };
}

export function predict(c: Common & { player: Key; targets: Zone[]; answerStepIndex: number; overrides?: Partial<Record<Key, Vec2>>; holder?: Key }): PredictChallenge {
  const overrides: Record<string, Vec2> = {};
  for (const [k, p] of Object.entries(c.overrides ?? {}) as [Key, Vec2][]) overrides[pid(k)] = p;
  return {
    id: c.id,
    type: 'predict',
    title: c.title,
    prompt: c.prompt,
    stepIndex: c.stepIndex,
    explanation: c.explanation,
    ...(c.hint ? { hint: c.hint } : {}),
    points: c.points ?? 10,
    playerId: pid(c.player),
    targets: c.targets,
    answerStepIndex: c.answerStepIndex,
    ...(c.overrides ? { overrides } : {}),
    ...(c.holder ? { ballHolderOverride: pid(c.holder) } : {}),
  };
}

export function choice(c: Common & { options: [string, string, boolean][]; multiple?: boolean }): ChoiceChallenge {
  return {
    id: c.id,
    type: 'choice',
    title: c.title,
    prompt: c.prompt,
    stepIndex: c.stepIndex,
    explanation: c.explanation,
    ...(c.hint ? { hint: c.hint } : {}),
    points: c.points ?? 10,
    options: c.options.map(([id, text]) => ({ id, text })),
    correct: c.options.filter((o) => o[2]).map((o) => o[0]),
    multiple: c.multiple ?? c.options.filter((o) => o[2]).length > 1,
  };
}
