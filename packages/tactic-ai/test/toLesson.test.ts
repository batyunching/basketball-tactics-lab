import { describe, expect, it } from 'vitest';
import { parseLesson } from '@btl/data-schemas';
import { challengeSetupPositions, gradeChoice, gradePlacement, gradePredict, inAnyZone } from '@btl/tactic-engine';
import { analyzeTactics, buildLessonFromEvents, evaluateReview, type TacticalEvent } from '../src';
import { giveAndGo, pickAndRollHelp, players, type Scenario } from './scenarios';

function prepare(sc: Scenario, review: (e: TacticalEvent) => TacticalEvent['status'] = () => 'confirmed') {
  const r = analyzeTactics({ players: players(sc.teamSize), samples: sc.samples, possession: sc.possession, shots: sc.shots, startMs: 0, endMs: sc.endMs });
  const events = r.events.map((e) => ({ ...e, status: e.confidence === 'insufficient' ? ('suggested' as const) : review(e) }));
  return { r, events };
}

describe('教師確認的事件 → 學生互動教材', () => {
  it.each([['傳切', giveAndGo], ['擋拆協防', pickAndRollHelp]] as const)('%s：教材通過格式驗證，題目標準答案正確', (_n, make) => {
    const sc = make();
    const { r, events } = prepare(sc);
    const lesson = buildLessonFromEvents({ id: 'video-test', title: `${sc.name}（影片）`, summary: '', teamSize: sc.teamSize, samples: sc.samples, events, possession: sc.possession, scoringKeys: r.scoringKeys, startMs: 0, endMs: sc.endMs });
    const v = parseLesson(lesson);
    expect(v.ok, v.ok ? '' : v.errors.join('\n')).toBe(true);
    expect(lesson.challenges.length).toBeGreaterThanOrEqual(2);
    expect(new Set(lesson.challenges.map((c) => c.type)).size).toBeGreaterThanOrEqual(2);
    for (const c of lesson.challenges) {
      if (c.type === 'predict') {
        expect(gradePredict(c, lesson.project.steps[c.answerStepIndex]!.players[c.playerId]!).correct, c.id).toBe(true);
        expect(inAnyZone(challengeSetupPositions(lesson.project, c)[c.playerId]!, c.targets)).toBe(false);
      } else if (c.type === 'placement') {
        expect(gradePlacement(c, Object.fromEntries(c.movable.map((id) => [id, lesson.project.steps[c.solutionStepIndex!]!.players[id]!]))).correct).toBe(true);
      } else {
        expect(gradeChoice(c, c.correct).correct).toBe(true);
      }
    }
  });

  it('傳切教材包含「下一步去哪」與「得分關鍵」題', () => {
    const sc = giveAndGo();
    const { r, events } = prepare(sc);
    const lesson = buildLessonFromEvents({ id: 'g', title: 't', summary: '', teamSize: 3, samples: sc.samples, events, possession: sc.possession, scoringKeys: r.scoringKeys, startMs: 0, endMs: sc.endMs });
    expect(lesson.challenges.some((c) => c.type === 'predict' && c.playerId === 'red-1')).toBe(true);
    const key = lesson.challenges.find((c) => c.id.endsWith('scoring-key'));
    expect(key && key.type === 'choice' && key.correct).toContain('cut');
  });

  it('隱私：學生教材不含影片、追蹤編號、偵測框或信心數值', () => {
    const sc = pickAndRollHelp();
    const { r, events } = prepare(sc);
    const json = JSON.stringify(buildLessonFromEvents({ id: 'p', title: 't', summary: '', teamSize: 3, samples: sc.samples, events, possession: sc.possession, scoringKeys: r.scoringKeys, startMs: 0, endMs: sc.endMs }));
    for (const k of ['trackId', '"box"', 'detectionConfidence', 'identityConfidence', 'blob:', 'insufficientReason']) expect(json).not.toContain(k);
  });

  it('被否決或未確認的事件不會進入學生教材', () => {
    const sc = pickAndRollHelp();
    const { r, events } = prepare(sc, (e) => (e.type === 'help' ? 'rejected' : e.type === 'screen' ? 'suggested' : 'confirmed'));
    const lesson = buildLessonFromEvents({ id: 'x', title: 't', summary: '', teamSize: 3, samples: sc.samples, events, possession: sc.possession, scoringKeys: r.scoringKeys, startMs: 0, endMs: sc.endMs });
    expect(lesson.challenges.some((c) => c.title === '誰該協防？')).toBe(false);
    expect(lesson.project.steps.some((st) => st.title.includes('協防') || st.title.includes('掩護'))).toBe(false);
    expect(lesson.challenges.some((c) => c.type === 'placement')).toBe(false);
  });

  it('教師修改的文字會用在教材中', () => {
    const sc = giveAndGo();
    const { r, events } = prepare(sc);
    const edited = events.map((e) => (e.type === 'cut' ? { ...e, inference: '老師版本：紅1 傳完立刻切到籃下', edited: true } : e));
    const lesson = buildLessonFromEvents({ id: 'e', title: 't', summary: '', teamSize: 3, samples: sc.samples, events: edited, possession: sc.possession, scoringKeys: r.scoringKeys, startMs: 0, endMs: sc.endMs });
    expect(JSON.stringify(lesson)).toContain('老師版本');
  });

  it('沒有確認的事件時拒絕轉換', () => {
    const sc = giveAndGo();
    const { r, events } = prepare(sc, () => 'suggested');
    expect(() => buildLessonFromEvents({ id: 'n', title: 't', summary: '', teamSize: 3, samples: sc.samples, events, possession: sc.possession, scoringKeys: r.scoringKeys, startMs: 0, endMs: sc.endMs })).toThrow(/至少要有一個/);
  });
});

describe('品質評估（以教師審核當真值）', () => {
  it('確認＝正確、否決＝誤報、手動新增＝漏抓', () => {
    const sc = pickAndRollHelp();
    const { events } = prepare(sc, (e) => (e.type === 'cut' ? 'rejected' : 'confirmed'));
    const manual: TacticalEvent = { ...events[0]!, id: 'm1', type: 'screen', manual: true, status: 'confirmed' };
    const q = evaluateReview([...events, manual]);
    expect(q.byType.cut!.precision).toBe(0);
    expect(q.byType.screen!.recall).toBe(0.5);
    expect(q.pending).toBe(0);
    expect(q.overall.precision).toBeGreaterThan(0.5);
  });
});
