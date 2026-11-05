import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeTactics, evaluateAgainstTruth } from '../src';
import { fiveOnFiveDrive, giveAndGo, pickAndRollHelp, players, type Scenario } from './scenarios';

/**
 * 合成情境基準測試：不同追蹤雜訊（隨機高斯抖動）與漏檢比例下的偵測品質。
 * 結果寫到 test/benchmark-result.json，供 docs/quality-evaluation.md 引用。
 * 合成資料只能驗證規則邏輯，不能代表真實比賽影片的準確度。
 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
function degrade(sc: Scenario, sigma: number, dropRate: number, seed: number): Scenario {
  const r = rng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  const samples = Object.fromEntries(
    Object.entries(sc.samples).map(([id, list]) => [
      id,
      list
        .filter((_, i) => i === 0 || i === list.length - 1 || r() >= dropRate)
        .map((x) => ({ ...x, positionSource: 'observed' as const, identityConfidence: 0.85, courtPosition: { x: x.courtPosition.x + sigma * gauss(), y: x.courtPosition.y + sigma * gauss() } })),
    ]),
  );
  return { ...sc, samples };
}

const SCENARIOS = [
  ['傳切 3v3', giveAndGo],
  ['擋拆＋協防 3v3', pickAndRollHelp],
  ['突破分球 5v5', fiveOnFiveDrive],
] as const;
const LEVELS = [
  { sigma: 0, drop: 0 },
  { sigma: 0.15, drop: 0 },
  { sigma: 0.3, drop: 0.1 },
  { sigma: 0.5, drop: 0.2 },
  { sigma: 0.8, drop: 0.3 },
];
const SEEDS = 20;

describe('基準測試（雜訊／漏檢）', () => {
  const table: { scenario: string; sigma: number; drop: number; precision: number; recall: number; f1: number; insufficientRate: number }[] = [];
  for (const [name, make] of SCENARIOS) {
    for (const lv of LEVELS) {
      let tp = 0;
      let fp = 0;
      let fn = 0;
      let insufficient = 0;
      let total = 0;
      for (let seed = 1; seed <= (lv.sigma === 0 ? 1 : SEEDS); seed++) {
        const sc = degrade(make(), lv.sigma, lv.drop, seed * 7919 + Math.round(lv.sigma * 100));
        const r = analyzeTactics({ players: players(sc.teamSize), samples: sc.samples, possession: sc.possession, shots: sc.shots, startMs: 0, endMs: sc.endMs });
        const q = evaluateAgainstTruth(r.events, sc.truth);
        tp += q.overall.truePositive;
        fp += q.overall.falsePositive;
        fn += q.overall.falseNegative;
        insufficient += r.events.filter((e) => e.confidence === 'insufficient').length;
        total += r.events.length;
      }
      const precision = tp + fp ? tp / (tp + fp) : 1;
      const recall = tp + fn ? tp / (tp + fn) : 1;
      table.push({ scenario: name, ...lv, precision: +precision.toFixed(3), recall: +recall.toFixed(3), f1: +((2 * precision * recall) / (precision + recall || 1)).toFixed(3), insufficientRate: +(total ? insufficient / total : 0).toFixed(3) });
    }
  }

  it('輸出結果表', () => {
    writeFileSync(join(import.meta.dirname, 'benchmark-result.json'), `${JSON.stringify(table, null, 2)}\n`);
    expect(table).toHaveLength(SCENARIOS.length * LEVELS.length);
  });
  it('乾淨資料：召回率 1、精確率 ≥ 0.85（已知：擋拆時掩護者的防守者上前延阻，會被判成協防）', () => {
    for (const row of table.filter((t) => t.sigma === 0)) {
      expect(row.recall).toBe(1);
      expect(row.precision).toBeGreaterThanOrEqual(0.85);
    }
  });
  it('一般追蹤品質（σ ≤ 0.3 m、漏檢 ≤ 10%）：F1 ≥ 0.85', () => {
    for (const row of table.filter((t) => t.sigma > 0 && t.sigma <= 0.3)) expect(row.f1).toBeGreaterThanOrEqual(0.85);
  });
});
