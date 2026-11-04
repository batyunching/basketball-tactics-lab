import type { Vec2 } from '@btl/shared-types';

const fmt = (n: number) => Number(n.toFixed(3));

export function pathLength(points: Vec2[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    len += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return len;
}

/** 依固定間距重新取樣折線 */
export function resample(points: Vec2[], spacing: number): Vec2[] {
  if (points.length < 2) return [...points];
  const out: Vec2[] = [points[0]!];
  let need = spacing;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg === 0) continue;
    let pos = 0;
    while (seg - pos >= need) {
      pos += need;
      const t = pos / seg;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      need = spacing;
    }
    need -= seg - pos;
  }
  const last = points[points.length - 1]!;
  const tail = out[out.length - 1]!;
  if (tail.x !== last.x || tail.y !== last.y) out.push(last);
  return out;
}

/** 手繪點簡化：與前一點距離小於 minDist 的點略過 */
export function simplify(points: Vec2[], minDist: number): Vec2[] {
  if (points.length <= 2) return points;
  const out: Vec2[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    const prev = out[out.length - 1]!;
    if (Math.hypot(p.x - prev.x, p.y - prev.y) >= minDist) out.push(p);
  }
  out.push(points[points.length - 1]!);
  return out;
}

/** 平滑曲線（以中點作二次貝茲） */
export function smoothPath(points: Vec2[]): string {
  if (points.length === 0) return '';
  const p0 = points[0]!;
  if (points.length < 3) return points.map((p, i) => `${i ? 'L' : 'M'}${fmt(p.x)} ${fmt(p.y)}`).join(' ');
  let d = `M${fmt(p0.x)} ${fmt(p0.y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    const n = points[i + 1]!;
    d += ` Q${fmt(p.x)} ${fmt(p.y)} ${fmt((p.x + n.x) / 2)} ${fmt((p.y + n.y) / 2)}`;
  }
  const last = points[points.length - 1]!;
  return `${d} L${fmt(last.x)} ${fmt(last.y)}`;
}

/** 運球曲線：沿路徑左右擺動的波浪，最後一小段保持直線接箭頭 */
export function wavyPath(points: Vec2[], amplitude = 0.2, wavelength = 0.7): string {
  const total = pathLength(points);
  if (total < 0.05) return smoothPath(points);
  const pts = resample(points, 0.08);
  const straightTail = Math.min(0.6, total * 0.25);
  let s = 0;
  const out: Vec2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    if (i > 0) {
      const q = pts[i - 1]!;
      s += Math.hypot(p.x - q.x, p.y - q.y);
    }
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(pts.length - 1, i + 1)]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const fade = s > total - straightTail ? 0 : Math.min(1, s / 0.3);
    const off = Math.sin((2 * Math.PI * s) / wavelength) * amplitude * fade;
    out.push({ x: p.x + nx * off, y: p.y + ny * off });
  }
  return out.map((p, i) => `${i ? 'L' : 'M'}${fmt(p.x)} ${fmt(p.y)}`).join(' ');
}

/** 末端方向：取最後一段距離足夠的向量 */
export function endDirection(points: Vec2[]): Vec2 {
  const end = points[points.length - 1]!;
  for (let i = points.length - 2; i >= 0; i--) {
    const p = points[i]!;
    const d = Math.hypot(end.x - p.x, end.y - p.y);
    if (d > 0.25 || i === 0) return d === 0 ? { x: 1, y: 0 } : { x: (end.x - p.x) / d, y: (end.y - p.y) / d };
  }
  return { x: 1, y: 0 };
}

/** 箭頭三角形的三點（SVG polygon points 字串） */
export function arrowHead(points: Vec2[], size = 0.55): string {
  const end = points[points.length - 1]!;
  const dir = endDirection(points);
  const bx = end.x - dir.x * size;
  const by = end.y - dir.y * size;
  const w = size * 0.5;
  const l = { x: bx - dir.y * w, y: by + dir.x * w };
  const r = { x: bx + dir.y * w, y: by - dir.x * w };
  return [end, l, r].map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(' ');
}

/** 線段縮短：讓線條停在箭頭底部，不從箭頭尖端穿出 */
export function trimEnd(points: Vec2[], amount: number): Vec2[] {
  if (points.length < 2) return points;
  const dir = endDirection(points);
  const end = points[points.length - 1]!;
  return [...points.slice(0, -1), { x: end.x - dir.x * amount, y: end.y - dir.y * amount }];
}

/** 掩護 T 字：垂直於末端方向的短橫線 */
export function screenBar(points: Vec2[], halfWidth = 0.55): [Vec2, Vec2] {
  const end = points[points.length - 1]!;
  const dir = endDirection(points);
  return [
    { x: end.x - dir.y * halfWidth, y: end.y + dir.x * halfWidth },
    { x: end.x + dir.y * halfWidth, y: end.y - dir.x * halfWidth },
  ];
}
