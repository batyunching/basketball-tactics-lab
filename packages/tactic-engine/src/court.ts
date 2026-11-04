import type { AttackDirection, CourtMode, Vec2 } from '@btl/shared-types';

/** FIBA 標準球場參數（公尺） */
export const FIBA = {
  lengthM: 28,
  widthM: 15,
  /** 籃框中心距底線 */
  basketFromBaseline: 1.575,
  ringRadius: 0.225,
  /** 籃板距底線、籃板寬 */
  backboardFromBaseline: 1.2,
  backboardWidth: 1.8,
  /** 三分線半徑與底角直線距邊線 */
  threePointRadius: 6.75,
  threePointSideOffset: 0.9,
  /** 禁區寬、罰球線距底線 */
  keyWidth: 4.9,
  freeThrowLineFromBaseline: 5.8,
  freeThrowCircleRadius: 1.8,
  centerCircleRadius: 1.8,
  noChargeRadius: 1.25,
  lineWidth: 0.05,
} as const;

/** 球員可站在界外的額度（發邊線球、底線球） */
export const OUT_OF_BOUNDS_MARGIN = 1;
/** 半場模式可越過中線的額度 */
export const HALF_LINE_MARGIN = 0.6;

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** 進攻某方向的籃框中心 */
export function basketPosition(direction: AttackDirection): Vec2 {
  const x = direction === 'right' ? FIBA.lengthM - FIBA.basketFromBaseline : FIBA.basketFromBaseline;
  return { x, y: FIBA.widthM / 2 };
}

/** 三分線底角直線段長度（從底線起算），由半徑與邊線距離推得 ≈ 2.99m */
export function threePointCornerLength(): number {
  const dy = FIBA.widthM / 2 - FIBA.threePointSideOffset;
  const dx = Math.sqrt(FIBA.threePointRadius ** 2 - dy ** 2);
  return FIBA.basketFromBaseline + dx;
}

/** 球員可活動範圍（含界外額度）。半場模式只限於顯示的那一半。 */
export function playableBounds(mode: CourtMode, direction: AttackDirection): Bounds {
  const m = OUT_OF_BOUNDS_MARGIN;
  const full: Bounds = { minX: -m, maxX: FIBA.lengthM + m, minY: -m, maxY: FIBA.widthM + m };
  if (mode === 'full') return full;
  const half = FIBA.lengthM / 2;
  return direction === 'right'
    ? { ...full, minX: half - HALF_LINE_MARGIN }
    : { ...full, maxX: half + HALF_LINE_MARGIN };
}

export function clampToBounds(p: Vec2, b: Bounds): Vec2 {
  return {
    x: Math.min(b.maxX, Math.max(b.minX, p.x)),
    y: Math.min(b.maxY, Math.max(b.minY, p.y)),
  };
}

export function isInBounds(p: Vec2, b: Bounds): boolean {
  return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
}

/** 以中心點鏡射（換邊進攻時使用）：x → 28−x、y → 15−y */
export function mirrorPoint(p: Vec2): Vec2 {
  return { x: FIBA.lengthM - p.x, y: FIBA.widthM - p.y };
}

/** 只沿中線鏡射 x（全場轉半場時，把另一半場的球員搬到顯示的半場） */
export function mirrorAcrossHalfLine(p: Vec2): Vec2 {
  return { x: FIBA.lengthM - p.x, y: p.y };
}

/**
 * 以「距進攻籃框底線距離 d、橫向 y」描述的相對座標轉為絕對座標。
 * 預設隊形以此定義，才能套用到任一方向。
 */
export function fromBasketRelative(d: number, y: number, direction: AttackDirection): Vec2 {
  return direction === 'right' ? { x: FIBA.lengthM - d, y } : { x: d, y: FIBA.widthM - y };
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 將 p 朝 target 移動 dist 公尺（不越過 target） */
export function moveToward(p: Vec2, target: Vec2, dist: number): Vec2 {
  const d = distance(p, target);
  if (d === 0) return { ...p };
  const t = Math.min(1, dist / d);
  return { x: p.x + (target.x - p.x) * t, y: p.y + (target.y - p.y) * t };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
