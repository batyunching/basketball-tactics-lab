import { describe, expect, it } from 'vitest';
import {
  FIBA,
  basketPosition,
  clampToBounds,
  fromBasketRelative,
  mirrorPoint,
  playableBounds,
  threePointCornerLength,
} from '../src';

describe('FIBA 球場幾何', () => {
  it('球場為 28 × 15 公尺', () => {
    expect(FIBA.lengthM).toBe(28);
    expect(FIBA.widthM).toBe(15);
  });

  it('籃框中心距底線 1.575m', () => {
    expect(basketPosition('right')).toEqual({ x: 26.425, y: 7.5 });
    expect(basketPosition('left')).toEqual({ x: 1.575, y: 7.5 });
  });

  it('三分線底角直線長度約 2.99m', () => {
    expect(threePointCornerLength()).toBeCloseTo(2.99, 2);
  });

  it('半場可活動範圍只在進攻那一半', () => {
    const r = playableBounds('half', 'right');
    expect(r.minX).toBeGreaterThan(13);
    expect(r.maxX).toBe(29);
    const l = playableBounds('half', 'left');
    expect(l.maxX).toBeLessThan(15);
    expect(l.minX).toBe(-1);
  });

  it('座標約束會把球員夾在範圍內', () => {
    const b = playableBounds('half', 'right');
    expect(clampToBounds({ x: 2, y: -10 }, b)).toEqual({ x: b.minX, y: -1 });
  });

  it('相對座標在兩個方向互為中心鏡射', () => {
    const r = fromBasketRelative(6, 2, 'right');
    const l = fromBasketRelative(6, 2, 'left');
    expect(mirrorPoint(r)).toEqual(l);
  });
});
