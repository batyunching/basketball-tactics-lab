import { produce, type Draft } from 'immer';
import {
  SCHEMA_VERSION,
  type Annotation,
  type AttackDirection,
  type BallState,
  type CourtMode,
  type PlayerDef,
  type PlayerState,
  type TacticEvent,
  type TacticProject,
  type TacticStep,
  type TeamDef,
  type TeamId,
  type TeamSize,
  type Vec2,
} from '@btl/shared-types';
import {
  FIBA,
  basketPosition,
  clampToBounds,
  isInBounds,
  mirrorAcrossHalfLine,
  mirrorPoint,
  playableBounds,
  round2,
} from './court';
import { DEFAULT_STEP_DURATION_MS, MAX_STEP_DURATION_MS, MIN_STEP_DURATION_MS } from './animation';

export const TEAM_IDS: readonly TeamId[] = ['red', 'blue'];
export const MAX_TEAM_SIZE = 5;

export const DEFAULT_TEAMS: TeamDef[] = [
  { id: 'red', name: '紅隊', color: '#d7263d' },
  { id: 'blue', name: '藍隊', color: '#1b6ee8' },
];

let idCounter = 0;
export function createId(prefix = 'id'): string {
  idCounter = (idCounter + 1) % 1_000_000;
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${rand}${idCounter.toString(36)}`;
}

export function playerId(team: TeamId, slot: number): string {
  return `${team}-${slot + 1}`;
}

export function otherTeam(team: TeamId): TeamId {
  return team === 'red' ? 'blue' : 'red';
}

export function nowIso(): string {
  return new Date().toISOString();
}

function defaultPlayers(): PlayerDef[] {
  const list: PlayerDef[] = [];
  for (const team of TEAM_IDS) {
    for (let slot = 0; slot < MAX_TEAM_SIZE; slot++) {
      list.push({ id: playerId(team, slot), teamId: team, slot, jerseyNumber: slot + 1, locked: false });
    }
  }
  return list;
}

/** 初始預設位置（半場、紅隊攻右邊）：紅隊外圍、藍隊在內側 */
function defaultPositions(): Record<string, PlayerState> {
  const red: Vec2[] = [
    { x: 19.8, y: 7.5 },
    { x: 22.5, y: 2.2 },
    { x: 22.5, y: 12.8 },
    { x: 27.1, y: 0.9 },
    { x: 27.1, y: 14.1 },
  ];
  const basket = basketPosition('right');
  const players: Record<string, PlayerState> = {};
  red.forEach((p, slot) => {
    players[playerId('red', slot)] = { ...p };
    const dx = basket.x - p.x;
    const dy = basket.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    players[playerId('blue', slot)] = { x: round2(p.x + (dx / d) * 1.3), y: round2(p.y + (dy / d) * 1.3) };
  });
  return players;
}

export function createStep(partial: Partial<TacticStep> & Pick<TacticStep, 'players' | 'ball'>): TacticStep {
  return {
    id: createId('step'),
    title: '起始站位',
    durationMs: DEFAULT_STEP_DURATION_MS,
    offenseTeam: 'red',
    events: [],
    annotations: [],
    note: '',
    ...partial,
  };
}

export interface CreateProjectOptions {
  title?: string;
  mode?: CourtMode;
  teamSize?: TeamSize;
}

export function createProject(opts: CreateProjectOptions = {}): TacticProject {
  const t = nowIso();
  const base: TacticProject = {
    schemaVersion: SCHEMA_VERSION,
    id: createId('proj'),
    title: opts.title ?? '未命名戰術',
    revision: 0,
    createdAt: t,
    updatedAt: t,
    court: { mode: 'half', lengthM: FIBA.lengthM, widthM: FIBA.widthM, attackDirection: 'right' },
    teamSize: 3,
    teams: DEFAULT_TEAMS.map((x) => ({ ...x })),
    players: defaultPlayers(),
    steps: [
      createStep({
        players: defaultPositions(),
        ball: { holderId: playerId('red', 0), x: 19.8, y: 7.5 },
      }),
    ],
  };
  let p = base;
  if (opts.mode && opts.mode !== 'half') p = setCourtMode(p, opts.mode);
  if (opts.teamSize && opts.teamSize !== 3) p = setTeamSize(p, opts.teamSize);
  return p;
}

// ───────────────────────── 查詢 ─────────────────────────

export function isPlayerActive(project: TacticProject, id: string): boolean {
  const def = project.players.find((p) => p.id === id);
  return !!def && def.slot < project.teamSize;
}

export function activePlayers(project: TacticProject): PlayerDef[] {
  return project.players.filter((p) => p.slot < project.teamSize);
}

export function getPlayerDef(project: TacticProject, id: string): PlayerDef | undefined {
  return project.players.find((p) => p.id === id);
}

/** 某隊的進攻方向：全場時兩隊相反；半場（鬥牛）兩隊攻同一籃框 */
export function teamAttackDirection(project: TacticProject, team: TeamId): AttackDirection {
  const dir = project.court.attackDirection;
  if (project.court.mode === 'half' || team === 'red') return dir;
  return dir === 'right' ? 'left' : 'right';
}

export function boundsOf(project: TacticProject) {
  return playableBounds(project.court.mode, project.court.attackDirection);
}

// ───────────────────────── 內部工具 ─────────────────────────

function clampStepToCourt(step: Draft<TacticStep>, project: TacticProject | Draft<TacticProject>): void {
  const b = playableBounds(project.court.mode, project.court.attackDirection);
  for (const id of Object.keys(step.players)) {
    const p = step.players[id];
    if (!p) continue;
    let pos: Vec2 = { x: p.x, y: p.y };
    if (!isInBounds(pos, b) && project.court.mode === 'half') {
      const mirrored = mirrorAcrossHalfLine(pos);
      if (isInBounds(mirrored, b)) pos = mirrored;
    }
    const c = clampToBounds(pos, b);
    p.x = round2(c.x);
    p.y = round2(c.y);
  }
  if (!step.ball.holderId) {
    const c = clampToBounds(step.ball, b);
    step.ball.x = round2(c.x);
    step.ball.y = round2(c.y);
  }
}

function stepAt(draft: Draft<TacticProject>, index: number): Draft<TacticStep> {
  const s = draft.steps[index];
  if (!s) throw new RangeError(`步驟 ${index} 不存在`);
  return s;
}

function syncBallToHolder(step: Draft<TacticStep>): void {
  if (step.ball.holderId) {
    const h = step.players[step.ball.holderId];
    if (h) {
      step.ball.x = h.x;
      step.ball.y = h.y;
    }
  }
}

// ───────────────────────── 場地與人數（M01） ─────────────────────────

export function setTeamSize(project: TacticProject, size: TeamSize): TacticProject {
  if (size < 1 || size > MAX_TEAM_SIZE) throw new RangeError('人數須為 1～5');
  return produce(project, (d) => {
    d.teamSize = size;
    for (const step of d.steps) {
      const holder = step.ball.holderId;
      if (holder) {
        const def = d.players.find((p) => p.id === holder);
        if (!def || def.slot >= size) {
          const pos = step.players[holder];
          step.ball.holderId = null;
          if (pos) {
            step.ball.x = pos.x;
            step.ball.y = pos.y;
          }
        }
      }
      clampStepToCourt(step, d);
    }
  });
}

export function setCourtMode(project: TacticProject, mode: CourtMode): TacticProject {
  if (project.court.mode === mode) return project;
  return produce(project, (d) => {
    d.court.mode = mode;
    for (const step of d.steps) clampStepToCourt(step, d);
  });
}

/** 切換進攻方向：整份戰術（所有步驟、標註）以中心點鏡射到另一個籃框 */
export function toggleAttackDirection(project: TacticProject): TacticProject {
  return produce(project, (d) => {
    d.court.attackDirection = d.court.attackDirection === 'right' ? 'left' : 'right';
    for (const step of d.steps) {
      for (const id of Object.keys(step.players)) {
        const p = step.players[id];
        if (!p) continue;
        const m = mirrorPoint(p);
        p.x = round2(m.x);
        p.y = round2(m.y);
      }
      const mb = mirrorPoint(step.ball);
      step.ball.x = round2(mb.x);
      step.ball.y = round2(mb.y);
      for (const a of step.annotations) {
        a.points = a.points.map((pt) => {
          const m = mirrorPoint(pt);
          return { x: round2(m.x), y: round2(m.y) };
        });
      }
    }
  });
}

export function setTitle(project: TacticProject, title: string): TacticProject {
  return produce(project, (d) => {
    d.title = title.trim() || '未命名戰術';
  });
}

// ───────────────────────── 球員（M02） ─────────────────────────

export function movePlayer(project: TacticProject, stepIndex: number, id: string, pos: Vec2): TacticProject {
  const def = getPlayerDef(project, id);
  if (!def || def.locked) return project;
  const c = clampToBounds(pos, boundsOf(project));
  return produce(project, (d) => {
    const step = stepAt(d, stepIndex);
    step.players[id] = { x: round2(c.x), y: round2(c.y) };
    if (step.ball.holderId === id) syncBallToHolder(step);
  });
}

export function setPlayerLocked(project: TacticProject, id: string, locked: boolean): TacticProject {
  return produce(project, (d) => {
    const p = d.players.find((x) => x.id === id);
    if (p) p.locked = locked;
  });
}

export function validateJerseyNumber(project: TacticProject, id: string, n: number): string | null {
  if (!Number.isInteger(n) || n < 0 || n > 99) return '背號須為 0～99 的整數';
  const def = getPlayerDef(project, id);
  if (!def) return '找不到球員';
  const dup = project.players.find((p) => p.teamId === def.teamId && p.id !== id && p.jerseyNumber === n);
  if (dup) return `同隊已有 ${n} 號`;
  return null;
}

export function setJerseyNumber(project: TacticProject, id: string, n: number): TacticProject {
  const err = validateJerseyNumber(project, id, n);
  if (err) throw new Error(err);
  return produce(project, (d) => {
    const p = d.players.find((x) => x.id === id);
    if (p) p.jerseyNumber = n;
  });
}

// ───────────────────────── 籃球與球權（M03） ─────────────────────────

export function setBallHolder(project: TacticProject, stepIndex: number, holderId: string | null): TacticProject {
  if (holderId && !isPlayerActive(project, holderId)) return project;
  return produce(project, (d) => {
    const step = stepAt(d, stepIndex);
    step.ball.holderId = holderId;
    syncBallToHolder(step);
    if (holderId) {
      const def = d.players.find((p) => p.id === holderId);
      if (def) step.offenseTeam = def.teamId;
    }
  });
}

export function moveBallFree(project: TacticProject, stepIndex: number, pos: Vec2): TacticProject {
  const c = clampToBounds(pos, boundsOf(project));
  return produce(project, (d) => {
    const step = stepAt(d, stepIndex);
    step.ball = { holderId: null, x: round2(c.x), y: round2(c.y) };
  });
}

/** 傳球：持球者 → 隊友；記錄 pass 事件 */
export function passBall(project: TacticProject, stepIndex: number, toId: string): TacticProject {
  const step = project.steps[stepIndex];
  const fromId = step?.ball.holderId;
  if (!step || !fromId || fromId === toId || !isPlayerActive(project, toId)) return project;
  return produce(project, (d) => {
    const s = stepAt(d, stepIndex);
    s.ball.holderId = toId;
    syncBallToHolder(s);
    s.events.push({ id: createId('ev'), type: 'pass', fromId, toId });
  });
}

/** 投籃：球飛向該隊進攻籃框 */
export function shootBall(project: TacticProject, stepIndex: number): TacticProject {
  const step = project.steps[stepIndex];
  const shooter = step?.ball.holderId;
  if (!step || !shooter) return project;
  const def = getPlayerDef(project, shooter);
  if (!def) return project;
  const basket = basketPosition(teamAttackDirection(project, def.teamId));
  return produce(project, (d) => {
    const s = stepAt(d, stepIndex);
    s.ball = { holderId: null, x: basket.x, y: basket.y };
    s.events.push({ id: createId('ev'), type: 'shot', playerId: shooter });
  });
}

export function markDribble(project: TacticProject, stepIndex: number): TacticProject {
  const holder = project.steps[stepIndex]?.ball.holderId;
  if (!holder) return project;
  return produce(project, (d) => {
    stepAt(d, stepIndex).events.push({ id: createId('ev'), type: 'dribble', playerId: holder });
  });
}

/** 攻守轉換：切換此步驟的進攻隊；球交給新進攻隊的 1 號位（若在場） */
export function turnover(project: TacticProject, stepIndex: number): TacticProject {
  const step = project.steps[stepIndex];
  if (!step) return project;
  const fromTeam = step.offenseTeam;
  const toTeam = otherTeam(fromTeam);
  return produce(project, (d) => {
    const s = stepAt(d, stepIndex);
    s.offenseTeam = toTeam;
    const newHolder = playerId(toTeam, 0);
    s.ball.holderId = newHolder;
    syncBallToHolder(s);
    s.events.push({ id: createId('ev'), type: 'turnover', fromTeam, toTeam });
  });
}

export function removeEvent(project: TacticProject, stepIndex: number, eventId: string): TacticProject {
  return produce(project, (d) => {
    const s = stepAt(d, stepIndex);
    s.events = s.events.filter((e) => e.id !== eventId);
  });
}

export function describeEvent(project: TacticProject, e: TacticEvent): string {
  const name = (id: string) => {
    const def = getPlayerDef(project, id);
    if (!def) return id;
    return `${def.teamId === 'red' ? '紅' : '藍'}${def.jerseyNumber}`;
  };
  switch (e.type) {
    case 'pass':
      return `傳球 Pass：${name(e.fromId)} → ${name(e.toId)}`;
    case 'dribble':
      return `運球 Dribble：${name(e.playerId)}`;
    case 'shot':
      return `投籃 Shot：${name(e.playerId)}`;
    case 'turnover':
      return `攻守轉換 Turnover：${e.fromTeam === 'red' ? '紅' : '藍'} → ${e.toTeam === 'red' ? '紅' : '藍'}`;
  }
}

// ───────────────────────── 戰術標註（M04） ─────────────────────────

export function addAnnotation(project: TacticProject, stepIndex: number, a: Omit<Annotation, 'id'>): TacticProject {
  if (a.points.length < 2) return project;
  return produce(project, (d) => {
    stepAt(d, stepIndex).annotations.push({
      ...a,
      id: createId('ann'),
      points: a.points.map((p) => ({ x: round2(p.x), y: round2(p.y) })),
    });
  });
}

export function removeAnnotation(project: TacticProject, stepIndex: number, annotationId: string): TacticProject {
  return produce(project, (d) => {
    const s = stepAt(d, stepIndex);
    s.annotations = s.annotations.filter((a) => a.id !== annotationId);
  });
}

export function clearAnnotations(project: TacticProject, stepIndex: number): TacticProject {
  if ((project.steps[stepIndex]?.annotations.length ?? 0) === 0) return project;
  return produce(project, (d) => {
    stepAt(d, stepIndex).annotations = [];
  });
}

// ───────────────────────── 步驟（M06） ─────────────────────────

/** 在 afterIndex 後新增步驟：複製位置與球權，清空事件與標註 */
export function addStep(project: TacticProject, afterIndex: number): TacticProject {
  const src = project.steps[afterIndex];
  if (!src) return project;
  return produce(project, (d) => {
    d.steps.splice(afterIndex + 1, 0, {
      id: createId('step'),
      title: `步驟 ${afterIndex + 2}`,
      durationMs: DEFAULT_STEP_DURATION_MS,
      players: JSON.parse(JSON.stringify(src.players)) as Record<string, PlayerState>,
      ball: { ...src.ball },
      offenseTeam: src.offenseTeam,
      events: [],
      annotations: [],
      note: '',
    });
  });
}

export function removeStep(project: TacticProject, index: number): TacticProject {
  if (project.steps.length <= 1 || !project.steps[index]) return project;
  return produce(project, (d) => {
    d.steps.splice(index, 1);
  });
}

export function moveStep(project: TacticProject, from: number, to: number): TacticProject {
  if (from === to || !project.steps[from] || to < 0 || to >= project.steps.length) return project;
  return produce(project, (d) => {
    const [s] = d.steps.splice(from, 1);
    if (s) d.steps.splice(to, 0, s);
  });
}

export interface StepMetaPatch {
  title?: string;
  durationMs?: number;
  note?: string;
}

export function updateStepMeta(project: TacticProject, index: number, patch: StepMetaPatch): TacticProject {
  return produce(project, (d) => {
    const s = stepAt(d, index);
    if (patch.title !== undefined) s.title = patch.title;
    if (patch.note !== undefined) s.note = patch.note;
    if (patch.durationMs !== undefined && Number.isFinite(patch.durationMs)) {
      s.durationMs = Math.round(Math.min(MAX_STEP_DURATION_MS, Math.max(MIN_STEP_DURATION_MS, patch.durationMs)));
    }
  });
}

/** 存檔時呼叫：修訂版 +1、更新時間 */
export function touchProject(project: TacticProject): TacticProject {
  return produce(project, (d) => {
    d.revision += 1;
    d.updatedAt = nowIso();
  });
}

/** 匯入時給予新 id，避免覆蓋既有專案 */
export function cloneAsNewProject(project: TacticProject, titleSuffix = ''): TacticProject {
  const t = nowIso();
  return produce(project, (d) => {
    d.id = createId('proj');
    d.title = `${d.title}${titleSuffix}`;
    d.revision = 0;
    d.createdAt = t;
    d.updatedAt = t;
  });
}

export function ballOf(project: TacticProject, stepIndex: number): BallState | undefined {
  return project.steps[stepIndex]?.ball;
}
