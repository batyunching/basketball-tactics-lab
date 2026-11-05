import type { Vec2 } from '@btl/shared-types';
import type { Px } from './types';

/**
 * 單應性（透視）轉換：影像像素 ↔ 球場公尺座標。
 * 以正規化 DLT（≥4 點最小平方）求解，h33 固定為 1。
 */

function normalize(pts: Px[]): { pts: Px[]; T: number[] } {
  const n = pts.length;
  const cx = pts.reduce((s, p) => s + p.x, 0) / n;
  const cy = pts.reduce((s, p) => s + p.y, 0) / n;
  const d = pts.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / n || 1;
  const k = Math.SQRT2 / d;
  return { pts: pts.map((p) => ({ x: (p.x - cx) * k, y: (p.y - cy) * k })), T: [k, 0, -cx * k, 0, k, -cy * k, 0, 0, 1] };
}

/** 高斯消去法解 Ax=b（部分選主元） */
export function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    if (Math.abs(M[p]![c]!) < 1e-12) return null;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / M[c]![c]!;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

export function mat3Mul(a: number[], b: number[]): number[] {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k]! * b[k * 3 + c]!;
  return o;
}

export function mat3Inv(m: number[]): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = m as [number, number, number, number, number, number, number, number, number];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) return null;
  const inv = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d];
  return inv.map((v) => v / det);
}

/** 由 ≥4 組對應點求 src → dst 的單應性矩陣 */
export function solveHomography(src: Px[], dst: Px[]): number[] | null {
  if (src.length !== dst.length || src.length < 4) return null;
  const ns = normalize(src);
  const nd = normalize(dst);
  // 建立 2N×8 方程，以正規方程 (AᵀA)h = Aᵀb 求最小平方解
  const rows: number[][] = [];
  const rhs: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const { x, y } = ns.pts[i]!;
    const { x: u, y: v } = nd.pts[i]!;
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    rhs.push(u);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    rhs.push(v);
  }
  const AtA = Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => rows.reduce((s, row) => s + row[r]! * row[c]!, 0)));
  const Atb = Array.from({ length: 8 }, (_, r) => rows.reduce((s, row, k) => s + row[r]! * rhs[k]!, 0));
  const h = solveLinear(AtA, Atb);
  if (!h) return null;
  const Hn = [...h, 1];
  const TdInv = mat3Inv(nd.T);
  if (!TdInv) return null;
  const H = mat3Mul(mat3Mul(TdInv, Hn), ns.T);
  const s = H[8]!;
  if (Math.abs(s) < 1e-15) return null;
  return H.map((v) => v / s);
}

export function applyHomography(H: number[], p: Px): Vec2 | null {
  const w = H[6]! * p.x + H[7]! * p.y + H[8]!;
  if (Math.abs(w) < 1e-12) return null;
  return { x: (H[0]! * p.x + H[1]! * p.y + H[2]!) / w, y: (H[3]! * p.x + H[4]! * p.y + H[5]!) / w };
}

/** 平均重投影誤差（以 dst 單位計） */
export function reprojectionError(H: number[], src: Px[], dst: Px[]): number {
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    const q = applyHomography(H, src[i]!);
    sum += q ? Math.hypot(q.x - dst[i]!.x, q.y - dst[i]!.y) : 1e6;
  }
  return sum / src.length;
}

/** 檢查四點是否幾乎共線（共線無法求透視） */
export function isDegenerate(pts: Px[]): boolean {
  if (pts.length < 4) return true;
  let maxArea = 0;
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++)
      for (let k = j + 1; k < pts.length; k++) {
        const a = pts[i]!;
        const b = pts[j]!;
        const c = pts[k]!;
        maxArea = Math.max(maxArea, Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2);
      }
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
  return maxArea < span * span * 0.01;
}
