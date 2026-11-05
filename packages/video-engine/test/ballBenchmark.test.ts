import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assignHolders, detectShots, trackBall } from '../src';
import { HOOP, framesFrom, scenario } from './ballScenario';

/**
 * 籃球合成基準：取樣率 × 位置雜訊 × 漏檢，各 30 種子；每格另有 30% 機率出現一個誤判候選。
 * 結果寫到 test/ball-benchmark-result.json，供 docs/quality-evaluation.md 引用。
 * 合成資料只驗證規則邏輯，不代表真實影片的準確度。
 */
const LEVELS = [
  { fps: 5, noise: 0, drop: 0 },
  { fps: 10, noise: 0, drop: 0 },
  { fps: 10, noise: 2, drop: 0.15 },
  { fps: 10, noise: 4, drop: 0.3 },
  { fps: 30, noise: 2, drop: 0.15 },
  { fps: 30, noise: 4, drop: 0.3 },
];
const SEEDS = 30;

describe('籃球基準測試', () => {
  const rows = LEVELS.map((lv) => {
    let found = 0;
    let madeOk = 0;
    let missOk = 0;
    let falseMade = 0;
    let unknown = 0;
    let errSum = 0;
    let errN = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      for (const made of [true, false]) {
        const { path, tracks } = scenario(made);
        const pts = assignHolders(trackBall(framesFrom(path, { ...lv, fp: 0.3, seed: seed * 31 + (made ? 0 : 7) }), { playerHeightPx: 120 }), tracks);
        for (const p of pts) {
          const q = path(p.timeMs);
          if (q && p.source === 'observed') {
            errSum += Math.hypot(p.x - q[0], p.y - q[1]);
            errN++;
          }
        }
        const s = detectShots(pts, HOOP)[0];
        if (!s) continue;
        found++;
        if (s.result === 'unknown') unknown++;
        if (made && s.result === 'made') madeOk++;
        if (!made && s.result === 'missed') missOk++;
        if (!made && s.result === 'made') falseMade++;
      }
    }
    return {
      fps: lv.fps,
      noisePx: lv.noise,
      drop: lv.drop,
      shotFound: +(found / (SEEDS * 2)).toFixed(3),
      madeCorrect: +(madeOk / SEEDS).toFixed(3),
      missedCorrect: +(missOk / SEEDS).toFixed(3),
      falseMade: +(falseMade / SEEDS).toFixed(3),
      unknownRate: +(unknown / Math.max(1, found)).toFixed(3),
      meanErrPx: +(errSum / Math.max(1, errN)).toFixed(2),
    };
  });

  it('輸出結果表', () => {
    writeFileSync(join(import.meta.dirname, 'ball-benchmark-result.json'), `${JSON.stringify(rows, null, 2)}\n`);
    expect(rows).toHaveLength(LEVELS.length);
  });
  it('任何條件下都不會把「沒進」判成「進球」', () => {
    for (const r of rows) expect(r.falseMade).toBe(0);
  });
  it('每秒 10 張以上、雜訊 ≤ 2 像素、漏檢 ≤ 15%：出手全部找到，進／沒進判對 ≥ 85%', () => {
    for (const r of rows.filter((x) => x.fps >= 10 && x.noisePx <= 2 && x.drop <= 0.15)) {
      expect(r.shotFound).toBe(1);
      expect(r.madeCorrect).toBeGreaterThanOrEqual(0.85);
      expect(r.missedCorrect).toBeGreaterThanOrEqual(0.85);
    }
  });
});
