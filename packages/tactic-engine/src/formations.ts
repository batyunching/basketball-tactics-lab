import { produce } from 'immer';
import type { AttackDirection, BallState, Formation, PlayerState, TacticProject, TeamSize, Vec2 } from '@btl/shared-types';
import { basketPosition, fromBasketRelative, mirrorPoint, moveToward, round2 } from './court';
import { createId, nowIso, playerId, setCourtMode, setTeamSize, toggleAttackDirection } from './project';

/** 隊形定義：以「距進攻底線 d、橫向 y」描述，再轉為紅隊攻右邊的絕對座標 */
interface FormationSpec {
  name: string;
  courtMode: Formation['courtMode'];
  teamSize: TeamSize;
  red: [number, number][];
  /** 未提供時，自動放在對位進攻者與籃框之間 1.3m */
  blue?: [number, number][];
  /** 直接以絕對座標（全場用） */
  absolute?: boolean;
  holderSlot: number | null;
  freeBall?: Vec2;
}

const DIR: AttackDirection = 'right';

const SPECS: FormationSpec[] = [
  {
    name: '3v3 基本三角（弧頂持球）',
    courtMode: 'half',
    teamSize: 3,
    red: [
      [8.3, 7.5],
      [5.2, 2.0],
      [5.2, 13.0],
    ],
    holderSlot: 0,
  },
  {
    name: '3v3 強弱邊（側翼持球）',
    courtMode: 'half',
    teamSize: 3,
    red: [
      [6.0, 2.2],
      [0.9, 1.0],
      [5.8, 9.8],
    ],
    holderSlot: 0,
  },
  {
    name: '5v5 五外拉開（Five-out）',
    courtMode: 'half',
    teamSize: 5,
    red: [
      [8.6, 7.5],
      [6.0, 1.8],
      [6.0, 13.2],
      [1.0, 0.8],
      [1.0, 14.2],
    ],
    holderSlot: 0,
  },
  {
    name: '5v5 1-3-1 進攻 vs 2-3 區域',
    courtMode: 'half',
    teamSize: 5,
    red: [
      [8.6, 7.5],
      [5.6, 1.4],
      [5.6, 13.6],
      [5.8, 7.5],
      [1.2, 2.6],
    ],
    blue: [
      [6.3, 5.4],
      [2.6, 2.6],
      [2.6, 12.4],
      [6.3, 9.6],
      [1.8, 7.5],
    ],
    holderSlot: 0,
  },
  {
    name: '5v5 全場跳球開場',
    courtMode: 'full',
    teamSize: 5,
    absolute: true,
    red: [
      [13.3, 7.5],
      [11.6, 4.6],
      [11.6, 10.4],
      [15.2, 4.2],
      [9.0, 7.5],
    ],
    blue: [
      [14.7, 7.5],
      [16.4, 10.4],
      [16.4, 4.6],
      [12.8, 10.8],
      [19.0, 7.5],
    ],
    holderSlot: null,
    freeBall: { x: 14, y: 7.5 },
  },
];

function specToFormation(spec: FormationSpec, index: number): Formation {
  const basket = basketPosition(DIR);
  const players: Record<string, PlayerState> = {};
  const toAbs = ([a, b]: [number, number]): Vec2 => (spec.absolute ? { x: a, y: b } : fromBasketRelative(a, b, DIR));
  spec.red.forEach((pt, slot) => {
    const p = toAbs(pt);
    players[playerId('red', slot)] = { x: round2(p.x), y: round2(p.y) };
    const bPt = spec.blue?.[slot];
    const bp = bPt ? toAbs(bPt) : moveToward(p, basket, 1.3);
    players[playerId('blue', slot)] = { x: round2(bp.x), y: round2(bp.y) };
  });
  const holderId = spec.holderSlot === null ? null : playerId('red', spec.holderSlot);
  const hp = holderId ? players[holderId] : undefined;
  const ball: BallState = hp
    ? { holderId, x: hp.x, y: hp.y }
    : { holderId: null, x: spec.freeBall?.x ?? 14, y: spec.freeBall?.y ?? 7.5 };
  return {
    id: `builtin-${index + 1}`,
    name: spec.name,
    order: index,
    courtMode: spec.courtMode,
    teamSize: spec.teamSize,
    attackDirection: DIR,
    offenseTeam: 'red',
    players,
    ball,
    builtIn: true,
    updatedAt: '2026-11-04T00:00:00.000Z',
  };
}

/** 系統內建五組隊形 */
export function createBuiltInFormations(): Formation[] {
  return SPECS.map(specToFormation);
}

export function getBuiltInFormation(id: string): Formation | undefined {
  return createBuiltInFormations().find((f) => f.id === id);
}

/**
 * 套用隊形到某一步：
 * 1. 方向不同時，先把整份戰術鏡射到隊形的方向（其他步驟保持一致）
 * 2. 設定場地與人數
 * 3. 寫入隊形中「出場球員」的位置、球權與進攻隊
 */
export function applyFormation(project: TacticProject, stepIndex: number, f: Formation): TacticProject {
  let p = project;
  if (p.court.attackDirection !== f.attackDirection) p = toggleAttackDirection(p);
  p = setCourtMode(p, f.courtMode);
  p = setTeamSize(p, f.teamSize);
  return produce(p, (d) => {
    const step = d.steps[stepIndex];
    if (!step) return;
    for (const def of d.players) {
      if (def.slot >= f.teamSize) continue;
      const pos = f.players[def.id];
      if (pos) step.players[def.id] = { x: pos.x, y: pos.y };
    }
    step.ball = { ...f.ball };
    if (step.ball.holderId) {
      const h = step.players[step.ball.holderId];
      if (h) {
        step.ball.x = h.x;
        step.ball.y = h.y;
      }
    }
    step.offenseTeam = f.offenseTeam;
  });
}

/** 把目前步驟存成隊形（只保存出場球員） */
export function captureFormation(
  project: TacticProject,
  stepIndex: number,
  name: string,
  base?: Pick<Formation, 'id' | 'order' | 'builtIn'>,
): Formation {
  const step = project.steps[stepIndex];
  if (!step) throw new RangeError('步驟不存在');
  const players: Record<string, PlayerState> = {};
  for (const def of project.players) {
    if (def.slot >= project.teamSize) continue;
    const pos = step.players[def.id];
    if (pos) players[def.id] = { x: pos.x, y: pos.y };
  }
  return {
    id: base?.id ?? createId('form'),
    name: name.trim() || '未命名隊形',
    order: base?.order ?? Date.now(),
    courtMode: project.court.mode,
    teamSize: project.teamSize,
    attackDirection: project.court.attackDirection,
    offenseTeam: step.offenseTeam,
    players,
    ball: { ...step.ball },
    builtIn: base?.builtIn ?? false,
    updatedAt: nowIso(),
  };
}

export function duplicateFormation(f: Formation, order: number): Formation {
  return { ...f, id: createId('form'), name: `${f.name}（複製）`, order, builtIn: false, updatedAt: nowIso(), players: { ...f.players }, ball: { ...f.ball } };
}

export function renameFormation(f: Formation, name: string): Formation {
  return { ...f, name: name.trim() || f.name, updatedAt: nowIso() };
}

export function sortFormations(list: Formation[]): Formation[] {
  return [...list].sort((a, b) => a.order - b.order);
}

/** 把隊形鏡射到另一方向（測試與工具用） */
export function mirrorFormation(f: Formation): Formation {
  const players: Record<string, PlayerState> = {};
  for (const [id, p] of Object.entries(f.players)) {
    const m = mirrorPoint(p);
    players[id] = { x: round2(m.x), y: round2(m.y) };
  }
  const mb = mirrorPoint(f.ball);
  return {
    ...f,
    attackDirection: f.attackDirection === 'right' ? 'left' : 'right',
    players,
    ball: { ...f.ball, x: round2(mb.x), y: round2(mb.y) },
  };
}
