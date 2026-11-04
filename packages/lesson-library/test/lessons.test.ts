import { describe, expect, it } from 'vitest';
import { parseProject } from '@btl/data-schemas';
import {
  challengeSetupPositions,
  gradeChoice,
  gradePlacement,
  gradePredict,
  inAnyZone,
  isInBounds,
  playableBounds,
} from '@btl/tactic-engine';
import { LESSONS, getLesson } from '../src';

describe('六套戰術教材（M07）', () => {
  it('共六套，涵蓋傳切、擋拆、無球掩護、快攻、人盯人協防、區域輪轉', () => {
    expect(LESSONS.map((l) => l.id)).toEqual(['give-and-go', 'pick-and-roll', 'off-ball-screen', 'fast-break', 'man-to-man-help', 'zone-2-3']);
    expect(getLesson('fast-break')?.project.court.mode).toBe('full');
  });

  describe.each(LESSONS.map((l) => [l.title, l] as const))('%s', (_t, lesson) => {
    const { project } = lesson;
    const bounds = playableBounds(project.court.mode, project.court.attackDirection);

    it('戰術資料通過格式驗證，至少四步', () => {
      const r = parseProject(project);
      expect(r.ok, r.ok ? '' : r.errors.join('\n')).toBe(true);
      expect(project.steps.length).toBeGreaterThanOrEqual(4);
    });

    it('每一步出場球員都在場內、每步都有說明', () => {
      for (const s of project.steps) {
        expect(s.note.length).toBeGreaterThan(5);
        for (const def of project.players.filter((p) => p.slot < project.teamSize)) {
          expect(isInBounds(s.players[def.id]!, bounds), `${s.title} ${def.id}`).toBe(true);
        }
      }
    });

    it('三種題型各一題、id 唯一、題目步驟存在', () => {
      expect(lesson.challenges.map((c) => c.type).sort()).toEqual(['choice', 'placement', 'predict']);
      expect(new Set(lesson.challenges.map((c) => c.id)).size).toBe(3);
      for (const c of lesson.challenges) expect(project.steps[c.stepIndex]).toBeDefined();
    });

    it('標準答案（教材本身的位置）可得滿分；題目起始畫面不會直接是答案', () => {
      for (const c of lesson.challenges) {
        if (c.type === 'placement') {
          const answer = Object.fromEntries(c.movable.map((id) => [id, project.steps[c.solutionStepIndex ?? c.stepIndex]!.players[id]!]));
          expect(gradePlacement(c, answer).correct, c.id).toBe(true);
          const setup = challengeSetupPositions(project, c);
          expect(gradePlacement(c, setup).correct, `${c.id} 起始即正解`).toBe(false);
          for (const id of c.movable) for (const z of c.targets[id]!) expect(isInBounds(z, bounds)).toBe(true);
        } else if (c.type === 'predict') {
          const answer = project.steps[c.answerStepIndex]!.players[c.playerId]!;
          expect(gradePredict(c, answer).correct, c.id).toBe(true);
          const setup = challengeSetupPositions(project, c)[c.playerId]!;
          expect(inAnyZone(setup, c.targets), `${c.id} 起始即正解`).toBe(false);
          expect(c.answerStepIndex).toBeGreaterThanOrEqual(c.stepIndex);
        } else {
          expect(c.correct.length).toBeGreaterThan(0);
          for (const id of c.correct) expect(c.options.some((o) => o.id === id)).toBe(true);
          expect(gradeChoice(c, c.correct).correct).toBe(true);
        }
      }
    });
  });

  it('至少一題允許多個合理解（多個判定區或多個正確選項）', () => {
    const multi = LESSONS.flatMap((l) => l.challenges).filter(
      (c) => (c.type === 'choice' && c.correct.length > 1) || (c.type === 'predict' && c.targets.length > 1) || (c.type === 'placement' && Object.values(c.targets).some((z) => z.length > 1)),
    );
    expect(multi.length).toBeGreaterThanOrEqual(6);
  });
});
