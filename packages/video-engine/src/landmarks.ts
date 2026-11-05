import type { Vec2 } from '@btl/shared-types';
import { FIBA, threePointCornerLength } from '@btl/tactic-engine';

/**
 * 半場校正點（以紅隊攻右邊籃框的球場座標表示）。
 * 「左／右」以「站在中線、面向籃框」的方向來看。
 */
export interface Landmark {
  id: string;
  label: string;
  court: Vec2;
}

const L = FIBA.lengthM;
const W = FIBA.widthM;
const keyL = W / 2 - FIBA.keyWidth / 2;
const keyR = W / 2 + FIBA.keyWidth / 2;
const ft = L - FIBA.freeThrowLineFromBaseline;
const corner = L - threePointCornerLength();

export const HALF_COURT_LANDMARKS: Landmark[] = [
  { id: 'baseline-left', label: '底線與左邊線交角', court: { x: L, y: 0 } },
  { id: 'baseline-right', label: '底線與右邊線交角', court: { x: L, y: W } },
  { id: 'key-base-left', label: '禁區左下角（底線上）', court: { x: L, y: keyL } },
  { id: 'key-base-right', label: '禁區右下角（底線上）', court: { x: L, y: keyR } },
  { id: 'ft-left', label: '罰球線左端', court: { x: ft, y: keyL } },
  { id: 'ft-right', label: '罰球線右端', court: { x: ft, y: keyR } },
  { id: 'three-left', label: '左側三分線直線與弧線交點', court: { x: corner, y: FIBA.threePointSideOffset } },
  { id: 'three-right', label: '右側三分線直線與弧線交點', court: { x: corner, y: W - FIBA.threePointSideOffset } },
  { id: 'three-top', label: '三分線弧頂（正中央）', court: { x: L - FIBA.basketFromBaseline - FIBA.threePointRadius, y: W / 2 } },
  { id: 'half-left', label: '中線與左邊線交角', court: { x: L / 2, y: 0 } },
  { id: 'half-right', label: '中線與右邊線交角', court: { x: L / 2, y: W } },
  { id: 'center', label: '中圈圓心', court: { x: L / 2, y: W / 2 } },
];

export function getLandmark(id: string): Landmark | undefined {
  return HALF_COURT_LANDMARKS.find((l) => l.id === id);
}

/** 校正後用來疊在影片上的半場線條（球場座標折線） */
export function halfCourtLines(): Vec2[][] {
  const lines: Vec2[][] = [
    [{ x: L / 2, y: 0 }, { x: L, y: 0 }, { x: L, y: W }, { x: L / 2, y: W }, { x: L / 2, y: 0 }],
    [{ x: L, y: keyL }, { x: ft, y: keyL }, { x: ft, y: keyR }, { x: L, y: keyR }],
  ];
  // 三分線
  const bx = L - FIBA.basketFromBaseline;
  const arc: Vec2[] = [{ x: L, y: FIBA.threePointSideOffset }, { x: corner, y: FIBA.threePointSideOffset }];
  const a0 = Math.atan2(FIBA.threePointSideOffset - W / 2, corner - bx);
  const a1 = Math.atan2(W - FIBA.threePointSideOffset - W / 2, corner - bx);
  // 從左側往右側繞過弧頂（角度經過 π）
  const start = a0 < 0 ? a0 + 2 * Math.PI : a0;
  const end = a1;
  for (let i = 0; i <= 24; i++) {
    const t = start + ((end - start) * i) / 24;
    arc.push({ x: bx + FIBA.threePointRadius * Math.cos(t), y: W / 2 + FIBA.threePointRadius * Math.sin(t) });
  }
  arc.push({ x: L, y: W - FIBA.threePointSideOffset });
  lines.push(arc);
  return lines;
}
