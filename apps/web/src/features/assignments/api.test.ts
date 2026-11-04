import { describe, expect, it } from 'vitest';
import { LESSONS } from '@btl/lesson-library';
import { assignmentChallenges, assignmentFromLocalLink, attemptsToCsv, buildAssignment, localLink, makeCode } from './api';

describe('任務連結', () => {
  it('代碼為 6 碼且不含易混淆字元', () => {
    for (let i = 0; i < 50; i++) expect(makeCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });

  it('本機連結只帶教材 id 與題目，可還原成相同任務（教材來自系統，學生無法竄改）', () => {
    const lesson = LESSONS[1]!;
    const a = buildAssignment(lesson, { title: '801 擋拆', message: '週五前完成', challengeIds: [lesson.challenges[2]!.id, lesson.challenges[0]!.id] }, 'AB23CD');
    const url = new URL(localLink(a));
    expect(url.hash.startsWith('#/p/pick-and-roll?')).toBe(true);
    expect(url.hash.length).toBeLessThan(400);
    const [path, qs] = url.hash.slice(2).split('?');
    const back = assignmentFromLocalLink(decodeURIComponent(path!.split('/')[1]!), new URLSearchParams(qs));
    expect(back).toMatchObject({ code: 'AB23CD', title: '801 擋拆', message: '週五前完成', lessonId: 'pick-and-roll' });
    expect(assignmentChallenges(back!).map((c) => c.type)).toEqual(['choice', 'placement']);
    expect(back!.lesson).toBe(lesson);
  });

  it('不存在的教材 id 回傳 null；未指定題目時包含全部題目', () => {
    expect(assignmentFromLocalLink('nope', new URLSearchParams())).toBeNull();
    expect(assignmentFromLocalLink('fast-break', new URLSearchParams())!.challengeIds).toHaveLength(3);
  });

  it('成績 CSV 含中文標題與 BOM（Excel 可直接開）', () => {
    const lesson = LESSONS[0]!;
    const a = buildAssignment(lesson, { title: 't', message: '', challengeIds: lesson.challenges.map((c) => c.id) }, 'AAAAAA');
    const csv = attemptsToCsv(
      [
        {
          id: '1',
          assignmentId: a.id,
          assignmentCode: 'AAAAAA',
          lessonId: lesson.id,
          student: { className: '801', seatNo: '3', name: '林, 小華' },
          results: [],
          score: 20,
          maxScore: 30,
          submittedAt: new Date().toISOString(),
          teacherFeedback: '',
          feedbackAt: null,
          source: 'local',
        },
      ],
      a,
    );
    expect(csv.startsWith('﻿班級,座號,姓名')).toBe(true);
    expect(csv).toContain('"林, 小華"');
  });
});
