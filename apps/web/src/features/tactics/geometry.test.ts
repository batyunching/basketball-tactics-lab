import { describe, expect, it } from 'vitest';
import { arrowHead, pathLength, resample, screenBar, simplify, wavyPath } from './geometry';

describe('畫筆幾何', () => {
  it('重新取樣保持長度與端點', () => {
    const pts = resample([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], 0.1);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 1, y: 1 });
    expect(pathLength(pts)).toBeCloseTo(2, 5);
    expect(pts.length).toBeGreaterThanOrEqual(20);
  });

  it('簡化去除過密的點但保留頭尾', () => {
    const raw = Array.from({ length: 50 }, (_, i) => ({ x: i * 0.01, y: 0 }));
    const s = simplify(raw, 0.1);
    expect(s.length).toBeLessThan(10);
    expect(s[s.length - 1]).toEqual(raw[raw.length - 1]);
  });

  it('箭頭尖端在終點、掩護橫線垂直於方向', () => {
    expect(arrowHead([{ x: 0, y: 0 }, { x: 3, y: 0 }]).startsWith('3,0')).toBe(true);
    const [a, b] = screenBar([{ x: 0, y: 0 }, { x: 2, y: 0 }]);
    expect(a.x).toBeCloseTo(2);
    expect(b.x).toBeCloseTo(2);
    expect(Math.abs(a.y - b.y)).toBeCloseTo(1.1);
  });

  it('運球波浪路徑可產生', () => {
    expect(wavyPath([{ x: 0, y: 0 }, { x: 4, y: 0 }])).toMatch(/^M0 0/);
  });
});
