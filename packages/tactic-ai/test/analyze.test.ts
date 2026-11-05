import { describe, expect, it } from 'vitest';
import { analyzeTactics, evaluateAgainstTruth, grade, type TacticalEvent } from '../src';
import { fiveOnFiveDrive, giveAndGo, pickAndRollHelp, players, type Scenario } from './scenarios';

const run = (s: Scenario) => analyzeTactics({ players: players(s.teamSize), samples: s.samples, possession: s.possession, shots: s.shots, startMs: 0, endMs: s.endMs });
const ofType = (evs: TacticalEvent[], t: string) => evs.filter((e) => e.type === t && e.confidence !== 'insufficient');

describe('情境：傳切（Give-and-Go）', () => {
  const r = run(giveAndGo());
  it('偵測到兩次傳球、一次傳切、一次得分', () => {
    expect(ofType(r.events, 'pass')).toHaveLength(2);
    const cut = ofType(r.events, 'cut');
    expect(cut).toHaveLength(1);
    expect(cut[0]!.subtype).toBe('give-and-go');
    expect(cut[0]!.players[0]!.id).toBe('red-1');
    expect(ofType(r.events, 'score')).toHaveLength(1);
  });
  it('每個事件都有繁中三段：可見證據（含數字）、戰術推論、教學建議，以及信心', () => {
    for (const e of r.events) {
      expect(e.evidence.length).toBeGreaterThan(0);
      expect(e.evidence.join('')).toMatch(/\d/);
      expect(e.inference).toMatch(/[一-鿿]/);
      expect(e.suggestion).toMatch(/[一-鿿]/);
      expect(['high', 'medium', 'low', 'insufficient']).toContain(e.confidence);
      expect(e.status).toBe('suggested');
    }
    const cut = ofType(r.events, 'cut')[0]!;
    expect(cut.evidence[0]).toMatch(/紅1 從距籃框 \d+\.\d 公尺切到 \d+\.\d 公尺/);
    expect(cut.evidence.join('')).toMatch(/接到 紅2 的傳球/);
  });
  it('得分關鍵指出空切', () => {
    expect(r.scoringKeys).toHaveLength(1);
    expect(r.scoringKeys[0]!.summary).toMatch(/傳切|空切/);
  });
  it('與真值比對：精確率、召回率皆為 1', () => {
    const q = evaluateAgainstTruth(r.events, giveAndGo().truth);
    expect(q.overall.recall).toBe(1);
    expect(q.overall.precision).toBe(1);
  });
});

describe('情境：擋拆＋協防＋分球', () => {
  const r = run(pickAndRollHelp());
  it('偵測到持球掩護（擋拆）、突破、協防並被分球、得分', () => {
    const scr = ofType(r.events, 'screen');
    expect(scr).toHaveLength(1);
    expect(scr[0]!.players.map((p) => p.id)).toEqual(['red-3', 'red-1', 'blue-1']);
    expect(scr[0]!.subtype).toBe('pick-and-roll');
    expect(ofType(r.events, 'drive')[0]!.subtype).toBe('beat-defender');
    const help = ofType(r.events, 'help');
    expect(help.map((h) => h.players[0]!.id)).toContain('blue-2');
    expect(help.find((h) => h.players[0]!.id === 'blue-2')!.subtype).toBe('help-and-kick');
    expect(r.scoringKeys[0]!.chain.length).toBeGreaterThanOrEqual(2);
  });
  it('與真值比對：召回率 1、精確率 ≥ 0.8', () => {
    const q = evaluateAgainstTruth(r.events, pickAndRollHelp().truth);
    expect(q.overall.recall).toBe(1);
    expect(q.overall.precision!).toBeGreaterThanOrEqual(0.8);
  });
});

describe('5v5 擴充', () => {
  it('同一套規則可處理 5v5：突破、協防、分球', () => {
    const s = fiveOnFiveDrive();
    const r = run(s);
    const q = evaluateAgainstTruth(r.events, s.truth);
    expect(q.overall.recall).toBe(1);
    expect(ofType(r.events, 'help')[0]!.players[0]!.id).toBe('blue-3');
  });
});

describe('證據不足時明確說無法確認', () => {
  it('空切者的位置多為重疊／身分不確定 → 無法確認', () => {
    const r = run(giveAndGo({ uncertainCutter: true }));
    const cut = r.events.find((e) => e.type === 'cut')!;
    expect(cut.confidence).toBe('insufficient');
    expect(cut.inference).toMatch(/證據不足，無法確認/);
    expect(cut.insufficientReason).toMatch(/紅1 位置可信度/);
  });

  it('沒有標記球權 → 不分析攻守事件，並說明原因', () => {
    const s = giveAndGo();
    const r = analyzeTactics({ players: players(3), samples: s.samples, possession: [], shots: [], startMs: 0, endMs: s.endMs });
    expect(r.events).toHaveLength(0);
    expect(r.notes.join('')).toMatch(/尚未標記球權/);
    expect(r.notes.join('')).toMatch(/不會自行判斷是否進球/);
  });

  it('球權未經教師確認 → 傳球標示無法確認', () => {
    const s = giveAndGo();
    const r = analyzeTactics({ players: players(3), samples: s.samples, possession: s.possession.map((p) => ({ ...p, confirmed: false })), shots: s.shots, startMs: 0, endMs: s.endMs });
    for (const p of r.events.filter((e) => e.type === 'pass')) expect(p.confidence).toBe('insufficient');
    expect(r.notes.join('')).toMatch(/尚未確認/);
  });

  it('得分未經教師確認 → 不判定得分、不產生得分關鍵（不臆測）', () => {
    const s = giveAndGo();
    const r = analyzeTactics({ players: players(3), samples: s.samples, possession: s.possession, shots: s.shots.map((x) => ({ ...x, confirmed: false })), startMs: 0, endMs: s.endMs });
    const sc = r.events.find((e) => e.type === 'score')!;
    expect(sc.confidence).toBe('insufficient');
    expect(sc.insufficientReason).toMatch(/系統不會自行判斷得分/);
    expect(r.scoringKeys).toHaveLength(0);
  });

  it('沒有軌跡 → 不產生任何事件', () => {
    const r = analyzeTactics({ players: players(3), samples: {}, possession: [], shots: [], startMs: 0, endMs: 1000 });
    expect(r.events).toHaveLength(0);
    expect(r.notes[0]).toMatch(/沒有任何球員軌跡/);
  });

  it('信心分級', () => {
    expect(grade(1, 1).confidence).toBe('high');
    expect(grade(0.7, 0.5).confidence).toBe('medium');
    expect(grade(0.5, 0.5).confidence).toBe('low');
    expect(grade(0.2, 1).confidence).toBe('insufficient');
  });
});

describe('靜態站位不應產生事件（避免誤報）', () => {
  it('所有人不動、一直由同一人持球 → 沒有事件', () => {
    const s = giveAndGo();
    const still = Object.fromEntries(Object.entries(s.samples).map(([k, v]) => [k, v.map((x) => ({ ...x, courtPosition: v[0]!.courtPosition }))]));
    const r = analyzeTactics({ players: players(3), samples: still, possession: [s.possession[0]!], shots: [], startMs: 0, endMs: s.endMs });
    expect(r.events).toHaveLength(0);
  });
});

describe('追蹤雜訊（±0.2 公尺抖動）下仍能偵測', () => {
  /** 決定性的抖動（不用亂數，測試可重現） */
  function jitter(sc: Scenario, amp = 0.2): Scenario {
    const samples = Object.fromEntries(
      Object.entries(sc.samples).map(([id, list], pi) => [
        id,
        list.map((x, i) => ({ ...x, positionSource: 'observed' as const, identityConfidence: 0.9, courtPosition: { x: x.courtPosition.x + amp * Math.sin(i * 1.7 + pi), y: x.courtPosition.y + amp * Math.cos(i * 2.3 + pi * 0.7) } })),
      ]),
    );
    return { ...sc, samples };
  }
  it.each([['傳切', giveAndGo], ['擋拆協防', pickAndRollHelp], ['5v5', fiveOnFiveDrive]] as const)('%s：召回率 1、精確率 ≥ 0.8', (_n, make) => {
    const sc = jitter(make());
    const q = evaluateAgainstTruth(run(sc).events, sc.truth);
    expect(q.overall.recall).toBe(1);
    expect(q.overall.precision!).toBeGreaterThanOrEqual(0.8);
  });
});
