import { describe, expect, it } from 'vitest';
import { LESSONS } from '@btl/lesson-library';
import { parseAssignment, parseLesson, parseResultFile } from '../src';

const attempt = {
  id: 'a1',
  assignmentId: 'as1',
  assignmentCode: 'ABC123',
  lessonId: 'give-and-go',
  student: { className: '801', seatNo: '5', name: '王小明' },
  results: [
    { challengeId: 'c', type: 'choice', score: 10, maxScore: 10, correct: true, ratio: 1, details: { a: true }, answer: { type: 'choice', selected: ['a'] }, tries: 1 },
  ],
  score: 10,
  maxScore: 10,
  submittedAt: '2026-11-05T00:00:00Z',
  teacherFeedback: '',
  feedbackAt: null,
  source: 'local',
};

describe('Phase 2 資料驗證', () => {
  it('六套教材都通過教材格式驗證', () => {
    for (const l of LESSONS) {
      const r = parseLesson(l);
      expect(r.ok, r.ok ? '' : r.errors.join()).toBe(true);
    }
  });

  it('任務：代碼格式必須正確', () => {
    const base = { id: 'x', code: 'AB12CD', title: 't', message: '', lessonId: 'give-and-go', lesson: LESSONS[0], challengeIds: [], open: true, createdAt: 'now' };
    expect(parseAssignment(base).ok).toBe(true);
    expect(parseAssignment({ ...base, code: 'bad code' }).ok).toBe(false);
  });

  it('學生繳交檔：格式正確才可匯入、姓名不可空白', () => {
    const file = { format: 'basketball-tactics-lab/attempts', schemaVersion: 1, attempts: [attempt] };
    expect(parseResultFile(JSON.stringify(file)).ok).toBe(true);
    const bad = { ...file, attempts: [{ ...attempt, student: { ...attempt.student, name: '  ' } }] };
    expect(parseResultFile(JSON.stringify(bad)).ok).toBe(false);
    expect(parseResultFile('x').ok).toBe(false);
  });
});
