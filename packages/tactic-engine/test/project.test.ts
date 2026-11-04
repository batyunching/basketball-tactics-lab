import { describe, expect, it } from 'vitest';
import {
  activePlayers,
  addAnnotation,
  addStep,
  clearAnnotations,
  createProject,
  markDribble,
  moveStep,
  movePlayer,
  passBall,
  removeEvent,
  removeStep,
  setBallHolder,
  setCourtMode,
  setJerseyNumber,
  setPlayerLocked,
  setTeamSize,
  toggleAttackDirection,
  turnover,
  validateJerseyNumber,
} from '../src';

describe('人數與場地（M01）', () => {
  it.each([1, 2, 3, 4, 5] as const)('%iv%i 兩隊人數正確', (n) => {
    const p = setTeamSize(createProject(), n);
    const act = activePlayers(p);
    expect(act.filter((x) => x.teamId === 'red')).toHaveLength(n);
    expect(act.filter((x) => x.teamId === 'blue')).toHaveLength(n);
  });

  it('縮減人數時，下場球員的球權會釋放', () => {
    let p = setTeamSize(createProject(), 5);
    p = setBallHolder(p, 0, 'red-5');
    p = setTeamSize(p, 3);
    expect(p.steps[0]!.ball.holderId).toBeNull();
  });

  it('全場 → 半場時，另一半場的球員被搬回顯示範圍', () => {
    let p = setCourtMode(createProject(), 'full');
    p = movePlayer(p, 0, 'red-2', { x: 5, y: 3 });
    p = setCourtMode(p, 'half');
    expect(p.steps[0]!.players['red-2']!.x).toBeGreaterThanOrEqual(13.4);
  });

  it('切換進攻方向會鏡射所有步驟與標註', () => {
    let p = addStep(createProject(), 0);
    p = addAnnotation(p, 1, { kind: 'pass', color: '#000', points: [{ x: 20, y: 7 }, { x: 25, y: 2 }] });
    const q = toggleAttackDirection(p);
    expect(q.court.attackDirection).toBe('left');
    expect(q.steps[1]!.players['red-1']!.x).toBeCloseTo(28 - p.steps[1]!.players['red-1']!.x);
    expect(q.steps[1]!.annotations[0]!.points[0]).toEqual({ x: 8, y: 8 });
    expect(toggleAttackDirection(q).steps[1]!.players).toEqual(p.steps[1]!.players);
  });
});

describe('球員互動（M02）', () => {
  it('拖曳後位置被限制在可活動範圍內', () => {
    const p = movePlayer(createProject(), 0, 'red-1', { x: 3, y: 50 });
    expect(p.steps[0]!.players['red-1']).toEqual({ x: 13.4, y: 16 });
  });

  it('鎖定的球員不能移動', () => {
    let p = setPlayerLocked(createProject(), 'red-2', true);
    const before = p.steps[0]!.players['red-2'];
    p = movePlayer(p, 0, 'red-2', { x: 20, y: 7 });
    expect(p.steps[0]!.players['red-2']).toEqual(before);
  });

  it('背號在同隊內唯一，可與對手同號', () => {
    const p = createProject();
    expect(validateJerseyNumber(p, 'red-1', 2)).toMatch(/同隊/);
    expect(validateJerseyNumber(p, 'red-1', 23)).toBeNull();
    expect(validateJerseyNumber(p, 'red-1', 100)).toMatch(/0～99/);
    expect(setJerseyNumber(p, 'red-1', 23).players.find((x) => x.id === 'red-1')!.jerseyNumber).toBe(23);
    expect(() => setJerseyNumber(p, 'red-1', 3)).toThrow();
  });

  it('不可變更新：原本的物件不被改動', () => {
    const p = createProject();
    const snapshot = JSON.stringify(p);
    movePlayer(p, 0, 'red-1', { x: 20, y: 5 });
    expect(JSON.stringify(p)).toBe(snapshot);
  });
});

describe('籃球與球權（M03）', () => {
  it('持球者移動時球的座標同步', () => {
    const p = movePlayer(createProject(), 0, 'red-1', { x: 21, y: 6 });
    expect(p.steps[0]!.ball).toMatchObject({ holderId: 'red-1', x: 21, y: 6 });
  });

  it('設定藍隊持球時進攻隊同步切換', () => {
    const p = setBallHolder(createProject(), 0, 'blue-1');
    expect(p.steps[0]!.offenseTeam).toBe('blue');
  });

  it('傳球記錄事件，可刪除事件', () => {
    let p = passBall(createProject(), 0, 'red-3');
    expect(p.steps[0]!.ball.holderId).toBe('red-3');
    const ev = p.steps[0]!.events[0]!;
    expect(ev).toMatchObject({ type: 'pass', fromId: 'red-1', toId: 'red-3' });
    p = removeEvent(p, 0, ev.id);
    expect(p.steps[0]!.events).toHaveLength(0);
  });

  it('不能傳給下場球員', () => {
    const p = createProject();
    expect(passBall(p, 0, 'red-5')).toBe(p);
  });

  it('攻守轉換切換進攻隊並交球給對方', () => {
    const p = turnover(markDribble(createProject(), 0), 0);
    expect(p.steps[0]!.offenseTeam).toBe('blue');
    expect(p.steps[0]!.ball.holderId).toBe('blue-1');
    expect(p.steps[0]!.events.map((e) => e.type)).toEqual(['dribble', 'turnover']);
  });
});

describe('畫筆與步驟（M04、M06）', () => {
  it('新增標註並四捨五入到公分，少於兩點不新增', () => {
    let p = addAnnotation(createProject(), 0, { kind: 'run', color: '#111', points: [{ x: 20.123, y: 3.456 }, { x: 21, y: 4 }] });
    expect(p.steps[0]!.annotations[0]!.points[0]).toEqual({ x: 20.12, y: 3.46 });
    expect(addAnnotation(p, 0, { kind: 'run', color: '#111', points: [{ x: 1, y: 1 }] })).toBe(p);
    p = clearAnnotations(p, 0);
    expect(p.steps[0]!.annotations).toHaveLength(0);
  });

  it('新增、移動、刪除步驟；至少保留一步', () => {
    let p = addStep(addStep(createProject(), 0), 1);
    const ids = p.steps.map((s) => s.id);
    p = moveStep(p, 2, 0);
    expect(p.steps.map((s) => s.id)).toEqual([ids[2], ids[0], ids[1]]);
    p = removeStep(removeStep(removeStep(p, 0), 0), 0);
    expect(p.steps).toHaveLength(1);
  });
});
