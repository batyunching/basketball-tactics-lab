import { describe, expect, it } from 'vitest';
import { HALF_COURT_LANDMARKS, applyHomography, halfCourtLines, isDegenerate, mat3Inv, reprojectionError, solveHomography } from '../src';

/** 模擬一台斜上方攝影機：球場 → 影像 的透視矩陣 */
const CAM = [-40, 52, 1100, 30, 6, -160, -0.002, 0.012, 1];
const camInv = mat3Inv(CAM)!;
const toImage = (p: { x: number; y: number }) => applyHomography(CAM, p)!;

describe('球場校正（單應性）', () => {
  it('四個以上校正點可完全還原透視轉換', () => {
    const lm = HALF_COURT_LANDMARKS.slice(0, 6);
    const img = lm.map((l) => toImage(l.court));
    const H = solveHomography(img, lm.map((l) => l.court))!;
    expect(H).not.toBeNull();
    expect(reprojectionError(H, img, lm.map((l) => l.court))).toBeLessThan(1e-6);
    // 校正點以外的位置（籃框下）也正確
    const p = applyHomography(H, toImage({ x: 26, y: 7.5 }))!;
    expect(p.x).toBeCloseTo(26, 4);
    expect(p.y).toBeCloseTo(7.5, 4);
    expect(camInv).toBeTruthy();
  });

  it('點擊誤差 ±3 像素時，球場誤差在 0.3 公尺內', () => {
    const lm = HALF_COURT_LANDMARKS.filter((l) => ['baseline-left', 'baseline-right', 'ft-left', 'ft-right', 'half-left', 'half-right'].includes(l.id));
    const noise = [3, -2, 1, -3, 2, -1, -3, 3, 2, 1, -2, -1];
    const img = lm.map((l, i) => {
      const p = toImage(l.court);
      return { x: p.x + noise[i * 2]!, y: p.y + noise[i * 2 + 1]! };
    });
    const H = solveHomography(img, lm.map((l) => l.court))!;
    expect(reprojectionError(H, img, lm.map((l) => l.court))).toBeLessThan(0.3);
  });

  it('點太少或共線時拒絕', () => {
    expect(solveHomography([{ x: 0, y: 0 }], [{ x: 0, y: 0 }])).toBeNull();
    expect(isDegenerate([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0.01 }])).toBe(true);
    expect(isDegenerate([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }])).toBe(false);
  });

  it('校正點清單 12 個、半場線條可畫', () => {
    expect(HALF_COURT_LANDMARKS).toHaveLength(12);
    expect(new Set(HALF_COURT_LANDMARKS.map((l) => l.id)).size).toBe(12);
    const arc = halfCourtLines()[2]!;
    const top = arc.reduce((m, p) => (p.x < m.x ? p : m));
    expect(top.x).toBeCloseTo(19.675, 1);
    expect(top.y).toBeCloseTo(7.5, 1);
  });
});
