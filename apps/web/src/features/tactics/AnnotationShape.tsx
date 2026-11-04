import { memo, type PointerEvent } from 'react';
import type { Annotation, AnnotationKind } from '@btl/shared-types';
import { arrowHead, screenBar, smoothPath, trimEnd, wavyPath } from './geometry';

export const DRAW_TOOLS: { kind: AnnotationKind; label: string; en: string; hint: string }[] = [
  { kind: 'run', label: '跑動', en: 'Cut / Move', hint: '實線箭頭：無球跑位、空切' },
  { kind: 'pass', label: '傳球', en: 'Pass', hint: '虛線箭頭：球的路線' },
  { kind: 'dribble', label: '運球', en: 'Dribble', hint: '波浪箭頭：持球推進或突破' },
  { kind: 'screen', label: '掩護', en: 'Screen', hint: 'T 字線：掩護站位' },
  { kind: 'circle', label: '標註圈', en: 'Highlight', hint: '圈出重點球員或區域' },
  { kind: 'zone', label: '防守色塊', en: 'Zone', hint: '半透明色塊：防守責任區' },
];

export const DRAW_COLORS = [
  { value: '#1d1d1f', label: '黑' },
  { value: '#d7263d', label: '紅' },
  { value: '#1b6ee8', label: '藍' },
  { value: '#f5b700', label: '黃' },
  { value: '#ffffff', label: '白' },
];

const SW = 0.12;

interface Props {
  a: Pick<Annotation, 'kind' | 'points' | 'color'>;
  erasable?: boolean;
  onErase?: () => void;
  draft?: boolean;
}

/** 單一戰術標註（球場公尺座標） */
export const AnnotationShape = memo(function AnnotationShape({ a, erasable, onErase, draft }: Props) {
  const { points, color } = a;
  if (points.length < 2) return null;
  const opacity = draft ? 0.7 : 1;
  const hit = erasable
    ? {
        onPointerDown: (e: PointerEvent) => {
          e.stopPropagation();
          onErase?.();
        },
        style: { cursor: 'pointer' },
      }
    : {};
  const p0 = points[0]!;
  const p1 = points[points.length - 1]!;

  switch (a.kind) {
    case 'circle': {
      const r = Math.max(0.2, Math.hypot(p1.x - p0.x, p1.y - p0.y));
      return (
        <g opacity={opacity} {...hit} data-annotation={a.kind}>
          <circle cx={p0.x} cy={p0.y} r={r} fill={color} fillOpacity={0.12} stroke={color} strokeWidth={SW} />
          {erasable && <circle cx={p0.x} cy={p0.y} r={r} fill="transparent" stroke="transparent" strokeWidth={0.6} />}
        </g>
      );
    }
    case 'zone': {
      const x = Math.min(p0.x, p1.x);
      const y = Math.min(p0.y, p1.y);
      return (
        <g opacity={opacity} {...hit} data-annotation={a.kind}>
          <rect
            x={x}
            y={y}
            width={Math.abs(p1.x - p0.x)}
            height={Math.abs(p1.y - p0.y)}
            rx={0.4}
            fill={color}
            fillOpacity={0.28}
            stroke={color}
            strokeWidth={0.08}
            strokeDasharray="0.35 0.2"
          />
        </g>
      );
    }
    case 'screen': {
      const [l, r] = screenBar(points);
      return (
        <g opacity={opacity} {...hit} data-annotation={a.kind}>
          <path d={smoothPath(points)} fill="none" stroke={color} strokeWidth={SW} strokeLinecap="round" />
          <line x1={l.x} y1={l.y} x2={r.x} y2={r.y} stroke={color} strokeWidth={SW * 1.6} strokeLinecap="round" />
          {erasable && <path d={smoothPath(points)} fill="none" stroke="transparent" strokeWidth={0.7} />}
        </g>
      );
    }
    default: {
      const trimmed = trimEnd(points, 0.4);
      const d = a.kind === 'dribble' ? wavyPath(trimmed) : smoothPath(trimmed);
      return (
        <g opacity={opacity} {...hit} data-annotation={a.kind}>
          <path
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={SW}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={a.kind === 'pass' ? '0.38 0.26' : undefined}
          />
          <polygon points={arrowHead(points)} fill={color} />
          {erasable && <path d={smoothPath(points)} fill="none" stroke="transparent" strokeWidth={0.7} />}
        </g>
      );
    }
  }
});
