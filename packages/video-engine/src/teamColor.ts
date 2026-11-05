import type { ColorGuess } from './types';

/**
 * 以上半身像素判斷紅／藍背心。
 * 只計算飽和度與亮度足夠的像素（排除皮膚、地板陰影、白色號碼），
 * 紅色色相 ≤20° 或 ≥335°；藍色 190°～255°。
 */
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / d + 2);
    else h = 60 * ((rn - gn) / d + 4);
  }
  if (h < 0) h += 360;
  return [h, max === 0 ? 0 : d / max, max];
}

export function classifyTeamColor(rgba: Uint8ClampedArray | Uint8Array): ColorGuess {
  let red = 0;
  let blue = 0;
  let total = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const [h, s, v] = rgbToHsv(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
    total++;
    if (s < 0.35 || v < 0.2) continue;
    if (h <= 20 || h >= 335) red++;
    else if (h >= 190 && h <= 255) blue++;
  }
  if (total === 0) return { team: 'unknown', confidence: 0 };
  const colored = red + blue;
  const coverage = colored / total;
  if (colored === 0 || coverage < 0.08) return { team: 'unknown', confidence: 0 };
  const dominance = Math.abs(red - blue) / colored;
  const confidence = Math.round(Math.min(1, dominance * Math.min(1, coverage / 0.25)) * 100) / 100;
  if (dominance < 0.3) return { team: 'unknown', confidence };
  return { team: red > blue ? 'red' : 'blue', confidence };
}

/** 背心取樣區：框的上方 20%～55%、中間 60% 寬 */
export function torsoRegion(b: { x: number; y: number; w: number; h: number }) {
  return { x: b.x + b.w * 0.2, y: b.y + b.h * 0.2, w: b.w * 0.6, h: b.h * 0.35 };
}
