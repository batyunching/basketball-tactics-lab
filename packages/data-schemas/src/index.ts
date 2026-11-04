import { z } from 'zod';
import { SCHEMA_VERSION, type Assignment, type Attempt, type ExportBundle, type Formation, type Lesson, type TacticProject } from '@btl/shared-types';

/** 座標限制：球場 28×15 外加界外緩衝，避免匯入異常資料 */
const coord = z.number().finite().min(-5).max(35);

export const vec2Schema = z.object({ x: coord, y: coord });
export const teamIdSchema = z.enum(['red', 'blue']);
export const playerStateSchema = vec2Schema;
export const ballStateSchema = z.object({ holderId: z.string().nullable(), x: coord, y: coord });

export const eventSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string(), type: z.literal('pass'), fromId: z.string(), toId: z.string() }),
  z.object({ id: z.string(), type: z.literal('dribble'), playerId: z.string() }),
  z.object({ id: z.string(), type: z.literal('shot'), playerId: z.string() }),
  z.object({ id: z.string(), type: z.literal('turnover'), fromTeam: teamIdSchema, toTeam: teamIdSchema }),
]);

export const annotationSchema = z.object({
  id: z.string(),
  kind: z.enum(['run', 'pass', 'dribble', 'screen', 'circle', 'zone']),
  points: z.array(vec2Schema).min(2).max(2000),
  color: z.string().max(32),
});

export const stepSchema = z.object({
  id: z.string(),
  title: z.string().max(200),
  durationMs: z.number().int().min(0).max(60_000),
  players: z.record(z.string(), playerStateSchema),
  ball: ballStateSchema,
  offenseTeam: teamIdSchema,
  events: z.array(eventSchema),
  annotations: z.array(annotationSchema),
  note: z.string().max(10_000),
});

export const projectSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    id: z.string().min(1),
    title: z.string().max(200),
    revision: z.number().int().min(0),
    createdAt: z.string(),
    updatedAt: z.string(),
    court: z.object({
      mode: z.enum(['half', 'full']),
      lengthM: z.number().positive(),
      widthM: z.number().positive(),
      attackDirection: z.enum(['left', 'right']),
    }),
    teamSize: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    teams: z.array(z.object({ id: teamIdSchema, name: z.string(), color: z.string() })).length(2),
    players: z
      .array(
        z.object({
          id: z.string(),
          teamId: teamIdSchema,
          slot: z.number().int().min(0).max(4),
          jerseyNumber: z.number().int().min(0).max(99),
          locked: z.boolean(),
        }),
      )
      .min(2)
      .max(10),
    steps: z.array(stepSchema).min(1).max(200),
  })
  .superRefine((p, ctx) => {
    const ids = new Set<string>();
    for (const pl of p.players) {
      if (ids.has(pl.id)) ctx.addIssue({ code: 'custom', message: `球員 id 重複：${pl.id}` });
      ids.add(pl.id);
    }
    for (const team of ['red', 'blue'] as const) {
      const nums = p.players.filter((x) => x.teamId === team).map((x) => x.jerseyNumber);
      if (new Set(nums).size !== nums.length) ctx.addIssue({ code: 'custom', message: `${team} 隊背號重複` });
    }
    p.steps.forEach((s, i) => {
      for (const id of ids) {
        if (!s.players[id]) ctx.addIssue({ code: 'custom', message: `步驟 ${i + 1} 缺少球員 ${id} 的位置` });
      }
      if (s.ball.holderId && !ids.has(s.ball.holderId)) {
        ctx.addIssue({ code: 'custom', message: `步驟 ${i + 1} 的持球者不存在` });
      }
    });
  });

export const formationSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(200),
  order: z.number(),
  courtMode: z.enum(['half', 'full']),
  teamSize: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  attackDirection: z.enum(['left', 'right']),
  offenseTeam: teamIdSchema,
  players: z.record(z.string(), playerStateSchema),
  ball: ballStateSchema,
  builtIn: z.boolean(),
  updatedAt: z.string(),
});

export const exportBundleSchema = z
  .object({
    format: z.literal('basketball-tactics-lab'),
    schemaVersion: z.number().int(),
    exportedAt: z.string(),
    ball: ballStateSchema.optional(),
    project: z.unknown().optional(),
    formations: z.array(z.unknown()).optional(),
  })
  .refine((b) => b.project !== undefined || b.formations !== undefined, { message: '檔案內沒有戰術或隊形' });

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function issues(err: z.ZodError): string[] {
  return err.issues.slice(0, 8).map((i) => `${i.path.join('.') || '(根)'}：${i.message}`);
}

/**
 * 版本遷移：目前只有 v1。未來 v2 需在此把舊資料轉換為新格式。
 * 回傳 null 表示不支援的版本。
 */
export function migrateBundle(raw: Record<string, unknown>): Record<string, unknown> | null {
  const v = raw.schemaVersion;
  if (v === SCHEMA_VERSION) return raw;
  return null;
}

export function parseProject(raw: unknown): ParseResult<TacticProject> {
  const r = projectSchema.safeParse(raw);
  return r.success ? { ok: true, value: r.data as TacticProject } : { ok: false, errors: issues(r.error) };
}

export function parseFormation(raw: unknown): ParseResult<Formation> {
  const r = formationSchema.safeParse(raw);
  return r.success ? { ok: true, value: r.data as Formation } : { ok: false, errors: issues(r.error) };
}

/** 解析匯入的 JSON 文字 */
export function parseExportJson(text: string): ParseResult<{ project?: TacticProject; formations: Formation[] }> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['不是有效的 JSON 檔案'] };
  }
  const head = exportBundleSchema.safeParse(raw);
  if (!head.success) return { ok: false, errors: issues(head.error) };
  const migrated = migrateBundle(raw as Record<string, unknown>);
  if (!migrated) return { ok: false, errors: [`不支援的資料版本：${String(head.data.schemaVersion)}`] };

  const out: { project?: TacticProject; formations: Formation[] } = { formations: [] };
  if (migrated.project !== undefined) {
    const p = parseProject(migrated.project);
    if (!p.ok) return { ok: false, errors: p.errors.map((e) => `戰術 ${e}`) };
    out.project = p.value;
  }
  const forms = (migrated.formations as unknown[] | undefined) ?? [];
  for (const [i, f] of forms.entries()) {
    const r = parseFormation(f);
    if (!r.ok) return { ok: false, errors: r.errors.map((e) => `隊形 ${i + 1} ${e}`) };
    out.formations.push(r.value);
  }
  return { ok: true, value: out };
}

export function buildExportBundle(project: TacticProject | undefined, formations: Formation[] | undefined): ExportBundle {
  const bundle: ExportBundle = {
    format: 'basketball-tactics-lab',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
  };
  if (project) {
    bundle.project = project;
    const first = project.steps[0];
    if (first) bundle.ball = { ...first.ball };
  }
  if (formations) bundle.formations = formations;
  return bundle;
}

// ═════════════════════════ Phase 2：教材、任務、作答 ═════════════════════════

export const zoneSchema = z.object({ x: coord, y: coord, r: z.number().positive().max(10), label: z.string().max(60).optional() });
const challengeBase = {
  id: z.string().min(1).max(80),
  title: z.string().max(100),
  prompt: z.string().max(500),
  stepIndex: z.number().int().min(0),
  hint: z.string().max(300).optional(),
  explanation: z.string().max(1000),
  points: z.number().min(0).max(100),
};
export const challengeSchema = z.discriminatedUnion('type', [
  z.object({
    ...challengeBase,
    type: z.literal('placement'),
    movable: z.array(z.string()).min(1).max(10),
    targets: z.record(z.string(), z.array(zoneSchema).min(1)),
    startPositions: z.record(z.string(), vec2Schema).optional(),
    solutionStepIndex: z.number().int().min(0).optional(),
  }),
  z.object({
    ...challengeBase,
    type: z.literal('predict'),
    playerId: z.string(),
    targets: z.array(zoneSchema).min(1),
    answerStepIndex: z.number().int().min(0),
    overrides: z.record(z.string(), vec2Schema).optional(),
    ballHolderOverride: z.string().nullable().optional(),
  }),
  z.object({
    ...challengeBase,
    type: z.literal('choice'),
    options: z.array(z.object({ id: z.string(), text: z.string().max(300) })).min(2).max(8),
    correct: z.array(z.string()).min(1),
    multiple: z.boolean(),
  }),
]);

export const lessonSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().max(100),
  en: z.string().max(100),
  category: z.enum(['offense', 'defense', 'transition']),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  summary: z.string().max(1000),
  objectives: z.array(z.string().max(300)),
  keyPoints: z.array(z.string().max(300)),
  project: projectSchema,
  challenges: z.array(challengeSchema).max(30),
});

export const assignmentSchema = z.object({
  id: z.string().min(1),
  code: z.string().regex(/^[A-Z0-9]{4,12}$/),
  title: z.string().max(120),
  message: z.string().max(1000),
  lessonId: z.string(),
  lesson: lessonSchema,
  challengeIds: z.array(z.string()),
  open: z.boolean(),
  createdAt: z.string(),
  ownerId: z.string().optional(),
});

const studentSchema = z.object({
  className: z.string().trim().min(1).max(20),
  seatNo: z.string().trim().min(1).max(10),
  name: z.string().trim().min(1).max(30),
});

export const challengeResultSchema = z.object({
  challengeId: z.string(),
  type: z.enum(['placement', 'predict', 'choice']),
  score: z.number().min(0),
  maxScore: z.number().min(0),
  correct: z.boolean(),
  ratio: z.number().min(0).max(1),
  details: z.record(z.string(), z.boolean()),
  answer: z.union([
    z.object({ type: z.literal('placement'), positions: z.record(z.string(), vec2Schema) }),
    z.object({ type: z.literal('predict'), position: vec2Schema }),
    z.object({ type: z.literal('choice'), selected: z.array(z.string()) }),
  ]),
  tries: z.number().int().min(1),
});

export const attemptSchema = z.object({
  id: z.string().min(1),
  assignmentId: z.string(),
  assignmentCode: z.string(),
  lessonId: z.string(),
  student: studentSchema,
  results: z.array(challengeResultSchema).max(30),
  score: z.number().min(0),
  maxScore: z.number().min(0),
  submittedAt: z.string(),
  teacherFeedback: z.string().max(2000),
  feedbackAt: z.string().nullable(),
  source: z.enum(['cloud', 'local']),
});

export function parseLesson(raw: unknown): ParseResult<Lesson> {
  const r = lessonSchema.safeParse(raw);
  return r.success ? { ok: true, value: r.data as Lesson } : { ok: false, errors: issues(r.error) };
}

export function parseAssignment(raw: unknown): ParseResult<Assignment> {
  const r = assignmentSchema.safeParse(raw);
  return r.success ? { ok: true, value: r.data as Assignment } : { ok: false, errors: issues(r.error) };
}

export const studentIdentitySchema = studentSchema;

/** 學生離線作答的繳交檔（教師匯入） */
export const resultFileSchema = z.object({
  format: z.literal('basketball-tactics-lab/attempts'),
  schemaVersion: z.literal(1),
  attempts: z.array(attemptSchema).min(1).max(500),
});

export function parseResultFile(text: string): ParseResult<Attempt[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['不是有效的 JSON 檔案'] };
  }
  const r = resultFileSchema.safeParse(raw);
  return r.success ? { ok: true, value: r.data.attempts as Attempt[] } : { ok: false, errors: issues(r.error) };
}
