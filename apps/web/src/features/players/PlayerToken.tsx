import { memo, type PointerEvent } from 'react';
import type { TeamId, Vec2 } from '@btl/shared-types';

export const TEAM_FILL: Record<TeamId, string> = { red: '#d7263d', blue: '#1b6ee8' };
export const TEAM_LABEL: Record<TeamId, string> = { red: '紅', blue: '藍' };
export const PLAYER_RADIUS = 0.58;

interface Props {
  id: string;
  team: TeamId;
  number: number;
  /** 畫面座標 */
  pos: Vec2;
  selected: boolean;
  locked: boolean;
  hasBall: boolean;
  interactive: boolean;
  onPointerDown?: (e: PointerEvent<SVGGElement>, id: string) => void;
}

/** 紅藍編號圓形球員（畫在畫面座標，數字永遠正向） */
export const PlayerToken = memo(function PlayerToken({ id, team, number, pos, selected, locked, hasBall, interactive, onPointerDown }: Props) {
  const r = PLAYER_RADIUS;
  return (
    <g
      transform={`translate(${pos.x.toFixed(3)} ${pos.y.toFixed(3)})`}
      data-player-id={id}
      data-testid={`player-${id}`}
      role="button"
      aria-label={`${TEAM_LABEL[team]}隊 ${number} 號${hasBall ? '（持球）' : ''}${locked ? '（已鎖定）' : ''}`}
      style={{ cursor: interactive ? (locked ? 'not-allowed' : 'grab') : 'default', pointerEvents: interactive ? 'auto' : 'none' }}
      onPointerDown={interactive && onPointerDown ? (e) => onPointerDown(e, id) : undefined}
    >
      {/* 加大的觸控範圍 */}
      <circle r={r + 0.35} fill="transparent" />
      {selected && <circle r={r + 0.22} fill="none" stroke="#f5b700" strokeWidth={0.14} data-export-hide />}
      <circle r={r} cy={0.07} fill="rgba(0,0,0,0.28)" />
      <circle r={r} fill={TEAM_FILL[team]} stroke="#ffffff" strokeWidth={0.1} />
      {hasBall && <circle r={r - 0.12} fill="none" stroke="#ffd166" strokeWidth={0.06} />}
      <text
        y={0.02}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={number >= 10 ? 0.52 : 0.68}
        fontWeight={800}
        fontFamily="system-ui, -apple-system, 'Segoe UI', 'Noto Sans TC', sans-serif"
        fill="#ffffff"
        style={{ userSelect: 'none' }}
      >
        {number}
      </text>
      {locked && (
        <g transform={`translate(${r * 0.72} ${-r * 0.72})`} data-export-hide>
          <circle r={0.24} fill="#1d1d1f" stroke="#fff" strokeWidth={0.04} />
          <rect x={-0.1} y={-0.03} width={0.2} height={0.15} fill="#fff" rx={0.02} />
          <path d="M-0.065 -0.03 V-0.09 A0.065 0.065 0 0 1 0.065 -0.09 V-0.03" fill="none" stroke="#fff" strokeWidth={0.035} />
        </g>
      )}
    </g>
  );
});

interface BallProps {
  pos: Vec2;
  lift: number;
  interactive: boolean;
  dragging: boolean;
  onPointerDown?: (e: PointerEvent<SVGGElement>) => void;
}

export const BALL_RADIUS = 0.3;

/** 籃球：飛行中依高度放大並加上影子 */
export const BallToken = memo(function BallToken({ pos, lift, interactive, dragging, onPointerDown }: BallProps) {
  const scale = 1 + lift * 0.7;
  const r = BALL_RADIUS;
  return (
    <g
      data-testid="ball"
      transform={`translate(${pos.x.toFixed(3)} ${pos.y.toFixed(3)})`}
      style={{ cursor: interactive ? (dragging ? 'grabbing' : 'grab') : 'default', pointerEvents: interactive ? 'auto' : 'none' }}
      onPointerDown={interactive ? onPointerDown : undefined}
      role="button"
      aria-label="籃球"
    >
      <circle r={r + 0.12} fill="transparent" />
      {lift > 0 && <ellipse rx={r} ry={r * 0.45} cy={0.25 + lift * 0.4} fill="rgba(0,0,0,0.25)" />}
      <g transform={`translate(0 ${(-lift * 0.5).toFixed(3)}) scale(${scale.toFixed(3)})`}>
        <circle r={r} fill="#ee7b2c" stroke="#3a1d0b" strokeWidth={0.04} />
        <path d={`M${-r} 0 H${r} M0 ${-r} V${r}`} stroke="#3a1d0b" strokeWidth={0.03} />
        <path d={`M${-r * 0.7} ${-r * 0.7} Q0 0 ${-r * 0.7} ${r * 0.7} M${r * 0.7} ${-r * 0.7} Q0 0 ${r * 0.7} ${r * 0.7}`} fill="none" stroke="#3a1d0b" strokeWidth={0.03} />
      </g>
    </g>
  );
});
