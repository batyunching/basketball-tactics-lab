import { describe, expect, it } from 'vitest';
import {
  applyFormation,
  canRedo,
  canUndo,
  captureFormation,
  commitGesture,
  createBuiltInFormations,
  createHistory,
  createProject,
  duplicateFormation,
  mirrorFormation,
  movePlayer,
  playableBounds,
  isInBounds,
  pushHistory,
  redo,
  setBallHolder,
  toggleAttackDirection,
  undo,
} from '../src';

describe('預設隊形（M05）', () => {
  it('內建五組隊形，所有出場球員都在可活動範圍內', () => {
    const list = createBuiltInFormations();
    expect(list).toHaveLength(5);
    for (const f of list) {
      const b = playableBounds(f.courtMode, f.attackDirection);
      const ids = Object.keys(f.players);
      expect(ids.length).toBe(f.teamSize * 2);
      for (const id of ids) expect(isInBounds(f.players[id]!, b)).toBe(true);
    }
  });

  it('附錄 B 情境：保存隊形 1 → 套用隊形 2 → 再載入隊形 1，位置與球權完整還原', () => {
    let p = createProject();
    p = movePlayer(p, 0, 'red-1', { x: 25.5, y: 1.8 }); // 紅 1 到側翼
    p = movePlayer(p, 0, 'blue-1', { x: 25.9, y: 3 }); // 藍 1 跟防
    p = setBallHolder(p, 0, 'red-1');
    const saved = captureFormation(p, 0, '我的隊形 1');
    const [, f2] = createBuiltInFormations();
    p = applyFormation(p, 0, f2!);
    expect(p.steps[0]!.players['red-1']).not.toEqual(saved.players['red-1']);
    p = applyFormation(p, 0, saved);
    for (const [id, pos] of Object.entries(saved.players)) expect(p.steps[0]!.players[id]).toEqual(pos);
    expect(p.steps[0]!.ball).toEqual(saved.ball);
    expect(p.teamSize).toBe(saved.teamSize);
  });

  it('隊形方向與目前不同時，會先鏡射整份戰術再套用', () => {
    let p = toggleAttackDirection(createProject());
    const f = createBuiltInFormations()[0]!;
    p = applyFormation(p, 0, f);
    expect(p.court.attackDirection).toBe('right');
    expect(p.steps[0]!.players['red-1']).toEqual(f.players['red-1']);
  });

  it('套用全場隊形會切換場地與人數', () => {
    const f = createBuiltInFormations()[4]!;
    const p = applyFormation(createProject(), 0, f);
    expect(p.court.mode).toBe('full');
    expect(p.teamSize).toBe(5);
    expect(p.steps[0]!.ball.holderId).toBeNull();
  });

  it('複製隊形產生新 id，鏡射兩次回原位', () => {
    const f = createBuiltInFormations()[0]!;
    const d = duplicateFormation(f, 9);
    expect(d.id).not.toBe(f.id);
    expect(d.builtIn).toBe(false);
    expect(mirrorFormation(mirrorFormation(f)).players).toEqual(f.players);
  });
});

describe('復原／重做', () => {
  it('push / undo / redo', () => {
    let h = createHistory(1);
    h = pushHistory(h, 2);
    h = pushHistory(h, 3);
    expect(canUndo(h)).toBe(true);
    h = undo(h);
    expect(h.present).toBe(2);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present).toBe(3);
    h = undo(undo(h));
    h = pushHistory(h, 9);
    expect(h.future).toHaveLength(0);
    expect(undo(undo(undo(h))).present).toBe(1);
  });

  it('拖曳手勢只記錄成一筆', () => {
    const start = createProject();
    let h = createHistory(start);
    let p = start;
    for (let i = 0; i < 20; i++) p = movePlayer(p, 0, 'red-1', { x: 20 + i * 0.1, y: 7 });
    h = { ...h, present: p };
    h = commitGesture(h, start);
    expect(h.past).toHaveLength(1);
    expect(undo(h).present).toBe(start);
  });

  it('上限 100 筆', () => {
    let h = createHistory(0);
    for (let i = 1; i <= 150; i++) h = pushHistory(h, i);
    expect(h.past).toHaveLength(100);
  });
});
