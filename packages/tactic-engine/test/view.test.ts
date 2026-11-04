import { describe, expect, it } from 'vitest';
import { basketPosition, clampPan, courtToView, getBaseViewBox, getViewTransform, viewToCourt, zoomViewBox } from '../src';

const cases = [
  ['full', 'right'],
  ['full', 'left'],
  ['half', 'right'],
  ['half', 'left'],
] as const;

describe('球場 ↔ 畫面座標轉換', () => {
  it.each(cases)('%s / %s 往返轉換不偏移', (mode, dir) => {
    const t = getViewTransform(mode, dir);
    for (const p of [
      { x: 0, y: 0 },
      { x: 20.37, y: 3.14 },
      { x: 27.9, y: 14.2 },
    ]) {
      const back = viewToCourt(courtToView(p, t), t);
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    }
  });

  it.each(['right', 'left'] as const)('半場（%s）時進攻籃框位於畫面上方中央', (dir) => {
    const t = getViewTransform('half', dir);
    const v = courtToView(basketPosition(dir), t);
    expect(v.x).toBeCloseTo(7.5);
    expect(v.y).toBeCloseTo(1.575);
  });

  it('半場為旋轉而非鏡像（行列式 = 1）', () => {
    for (const dir of ['right', 'left'] as const) {
      const t = getViewTransform('half', dir);
      expect(t.a * t.d - t.b * t.c).toBe(1);
    }
  });

  it('縮放後的 viewBox 以中心縮小，平移有上限', () => {
    const base = getBaseViewBox('full');
    const z = zoomViewBox(base, 2, { x: 0, y: 0 });
    expect(z.width).toBeCloseTo(base.width / 2);
    expect(z.x + z.width / 2).toBeCloseTo(base.x + base.width / 2);
    const pan = clampPan(base, 2, { x: 999, y: -999 });
    expect(pan.x).toBeCloseTo(base.width / 4);
    expect(pan.y).toBeCloseTo(-base.height / 4);
    expect(clampPan(base, 1, { x: 5, y: 5 })).toEqual({ x: 0, y: 0 });
  });
});
