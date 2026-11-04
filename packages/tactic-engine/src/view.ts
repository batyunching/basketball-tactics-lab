import type { AttackDirection, CourtMode, Vec2 } from '@btl/shared-types';
import { FIBA, HALF_LINE_MARGIN, OUT_OF_BOUNDS_MARGIN } from './court';

/**
 * 球場公尺座標 ↔ 畫面（SVG viewBox）座標轉換。
 * 全場：橫向顯示，畫面座標 = 球場座標。
 * 半場：直向顯示，進攻籃框固定在畫面上方（大屏幕講解最直覺）。
 * 兩種半場皆為「旋轉」而非鏡像，左右關係不會顛倒。
 */
export interface ViewTransform {
  /** SVG matrix(a b c d e f)：view = (a·x + c·y + e, b·x + d·y + f) */
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function getViewTransform(mode: CourtMode, direction: AttackDirection): ViewTransform {
  if (mode === 'full') return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  if (direction === 'right') return { a: 0, b: -1, c: 1, d: 0, e: 0, f: FIBA.lengthM };
  return { a: 0, b: 1, c: -1, d: 0, e: FIBA.widthM, f: 0 };
}

export function courtToView(p: Vec2, t: ViewTransform): Vec2 {
  return { x: t.a * p.x + t.c * p.y + t.e, y: t.b * p.x + t.d * p.y + t.f };
}

export function viewToCourt(v: Vec2, t: ViewTransform): Vec2 {
  const det = t.a * t.d - t.b * t.c;
  const dx = v.x - t.e;
  const dy = v.y - t.f;
  return { x: (t.d * dx - t.c * dy) / det, y: (-t.b * dx + t.a * dy) / det };
}

/** 只轉換方向向量（不含平移） */
export function viewVectorToCourt(v: Vec2, t: ViewTransform): Vec2 {
  const det = t.a * t.d - t.b * t.c;
  return { x: (t.d * v.x - t.c * v.y) / det, y: (-t.b * v.x + t.a * v.y) / det };
}

export function transformToSvg(t: ViewTransform): string {
  return `matrix(${t.a} ${t.b} ${t.c} ${t.d} ${t.e} ${t.f})`;
}

/** 基本可視範圍（未縮放） */
export function getBaseViewBox(mode: CourtMode): ViewBox {
  const m = OUT_OF_BOUNDS_MARGIN + 0.2;
  if (mode === 'full') {
    return { x: -m, y: -m, width: FIBA.lengthM + 2 * m, height: FIBA.widthM + 2 * m };
  }
  const half = FIBA.lengthM / 2;
  return { x: -m, y: -m, width: FIBA.widthM + 2 * m, height: half + m + HALF_LINE_MARGIN + 0.2 };
}

/** 以中心點縮放並平移後的 viewBox；zoom ≥ 1 */
export function zoomViewBox(base: ViewBox, zoom: number, pan: Vec2): ViewBox {
  const z = Math.max(1, zoom);
  const width = base.width / z;
  const height = base.height / z;
  const cx = base.x + base.width / 2 + pan.x;
  const cy = base.y + base.height / 2 + pan.y;
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}

/** 把平移量限制在縮放後仍不會看到球場外太多 */
export function clampPan(base: ViewBox, zoom: number, pan: Vec2): Vec2 {
  const z = Math.max(1, zoom);
  const maxX = (base.width - base.width / z) / 2;
  const maxY = (base.height - base.height / z) / 2;
  return {
    x: Math.min(maxX, Math.max(-maxX, pan.x)),
    y: Math.min(maxY, Math.max(-maxY, pan.y)),
  };
}
