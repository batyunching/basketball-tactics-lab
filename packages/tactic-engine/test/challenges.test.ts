import { describe, expect, it } from 'vitest';
import type { ChoiceChallenge, PlacementChallenge, PredictChallenge } from '@btl/shared-types';
import { distanceToZones, gradeChallenge, gradeChoice, gradePlacement, gradePredict, totalScore } from '../src';

const base = { title: 't', prompt: 'p', stepIndex: 0, explanation: 'e', points: 10 };
const placement: PlacementChallenge = {
  ...base,
  id: 'pl',
  type: 'placement',
  movable: ['red-2', 'red-3'],
  targets: {
    'red-2': [{ x: 22, y: 2, r: 1.5 }, { x: 27, y: 1, r: 1.2 }],
    'red-3': [{ x: 22, y: 13, r: 1.5 }],
  },
};
const predict: PredictChallenge = { ...base, id: 'pr', type: 'predict', playerId: 'red-1', answerStepIndex: 1, targets: [{ x: 26, y: 6.6, r: 1.5 }, { x: 26, y: 8.4, r: 1.5 }] };
const choice: ChoiceChallenge = {
  ...base,
  id: 'ch',
  type: 'choice',
  multiple: true,
  options: [
    { id: 'a', text: 'A' },
    { id: 'b', text: 'B' },
    { id: 'c', text: 'C' },
    { id: 'd', text: 'D' },
  ],
  correct: ['b', 'c'],
};

describe('站位挑戰評分', () => {
  it('允許多個合理位置', () => {
    const r1 = gradePlacement(placement, { 'red-2': { x: 22.5, y: 2.5 }, 'red-3': { x: 21.5, y: 13 } });
    const r2 = gradePlacement(placement, { 'red-2': { x: 27, y: 1.4 }, 'red-3': { x: 22, y: 12 } });
    expect(r1.correct && r2.correct).toBe(true);
    expect(r1.score).toBe(10);
  });
  it('部分正確給部分分數並標出哪位錯', () => {
    const r = gradePlacement(placement, { 'red-2': { x: 22, y: 2 }, 'red-3': { x: 15, y: 7 } });
    expect(r.score).toBe(5);
    expect(r.details).toEqual({ 'red-2': true, 'red-3': false });
    expect(r.correct).toBe(false);
  });
});

describe('跑位預測評分', () => {
  it('落在任一判定區即正確', () => {
    expect(gradePredict(predict, { x: 26.2, y: 8.9 }).correct).toBe(true);
    expect(gradePredict(predict, { x: 20, y: 7.5 }).score).toBe(0);
  });
  it('計算離判定區距離', () => {
    expect(distanceToZones({ x: 26, y: 6.6 }, predict.targets)).toBeCloseTo(-1.5);
  });
});

describe('戰術選擇評分', () => {
  it('多選：全對滿分、漏選部分分、選錯扣分', () => {
    expect(gradeChoice(choice, ['b', 'c']).score).toBe(10);
    expect(gradeChoice(choice, ['b']).score).toBe(5);
    expect(gradeChoice(choice, ['b', 'a']).score).toBe(0);
    expect(gradeChoice(choice, ['b', 'c', 'a']).score).toBe(5);
  });
  it('單選', () => {
    const single = { ...choice, multiple: false, correct: ['b'] };
    expect(gradeChoice(single, ['b']).correct).toBe(true);
    expect(gradeChoice(single, ['a']).score).toBe(0);
  });
  it('gradeChallenge 分派與總分', () => {
    const rs = [gradeChallenge(choice, { type: 'choice', selected: ['b', 'c'] }), gradeChallenge(predict, { type: 'predict', position: { x: 0, y: 0 } })];
    expect(totalScore(rs)).toEqual({ score: 10, maxScore: 20 });
    expect(() => gradeChallenge(choice, { type: 'predict', position: { x: 0, y: 0 } })).toThrow();
  });
});
