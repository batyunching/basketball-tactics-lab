import { useMemo, useRef, useState, type PointerEvent } from 'react';
import type { Annotation, TacticProject, Vec2, Zone } from '@btl/shared-types';
import {
  activePlayers,
  clampToBounds,
  courtToView,
  getBaseViewBox,
  getViewTransform,
  playableBounds,
  transformToSvg,
  viewToCourt,
  viewVectorToCourt,
} from '@btl/tactic-engine';
import { AnnotationShape } from '../tactics/AnnotationShape';
import { BallToken, PlayerToken } from '../players/PlayerToken';
import { CourtMarkings } from './CourtMarkings';

export interface ZoneMark {
  zone: Zone;
  /** true = 綠（答對）、false = 灰（參考位置）、undefined = 黃（目標區） */
  ok?: boolean;
}

interface Props {
  project: TacticProject;
  players: Record<string, Vec2>;
  holderId: string | null;
  /** 球的球場座標（未提供則畫在持球者身旁） */
  ballPosition?: Vec2;
  ballLift?: number;
  annotations?: Annotation[];
  /** 可拖曳的球員（學生作答） */
  draggable?: string[];
  onMove?: (id: string, pos: Vec2) => void;
  /** 標示判定區 */
  zones?: ZoneMark[];
  /** 學生答案的殘影（揭曉答案時） */
  ghosts?: { id: string; pos: Vec2; ok: boolean }[];
  /** 依答對／答錯標示球員 */
  playerMarks?: Record<string, boolean>;
  label?: string;
  testId?: string;
  /** 位置不確定的球員（橘色虛線圈＋問號） */
  uncertain?: string[];
  /** 軌跡尾巴（球場座標） */
  trails?: { id: string; points: Vec2[]; color: string }[];
}

const BALL_VIEW_OFFSET: Vec2 = { x: 0.5, y: 0.45 };

/** 唯讀／作答用球場：學生端與教材播放共用，不會改動任何教師資料 */
export function CourtView({ project, players, holderId, ballPosition, ballLift = 0, annotations = [], draggable = [], onMove, zones = [], ghosts = [], playerMarks = {}, label, testId, uncertain = [], trails = [] }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ id: string; pointerId: number; offset: Vec2 } | null>(null);
  const { mode, attackDirection } = project.court;
  const t = useMemo(() => getViewTransform(mode, attackDirection), [mode, attackDirection]);
  const vb = getBaseViewBox(mode);
  const bounds = playableBounds(mode, attackDirection);
  const actives = activePlayers(project);
  const holderOffset = viewVectorToCourt(BALL_VIEW_OFFSET, t);
  const holder = holderId ? players[holderId] : undefined;
  const ballCourt = ballPosition ?? (holder ? { x: holder.x + holderOffset.x, y: holder.y + holderOffset.y } : null);

  const toCourt = (e: { clientX: number; clientY: number }): Vec2 | null => {
    const svg = svgRef.current;
    const ctm = svg && typeof svg.getScreenCTM === 'function' ? svg.getScreenCTM() : null;
    if (!ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return viewToCourt({ x: p.x, y: p.y }, t);
  };

  const onPlayerDown = (e: PointerEvent<SVGGElement>, id: string) => {
    if (!draggable.includes(id) || !onMove) return;
    e.stopPropagation();
    const c = toCourt(e);
    const pos = players[id];
    if (!pos) return;
    try {
      svgRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* jsdom */
    }
    setDrag({ id, pointerId: e.pointerId, offset: c ? { x: pos.x - c.x, y: pos.y - c.y } : { x: 0, y: 0 } });
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag || drag.pointerId !== e.pointerId || !onMove) return;
    const c = toCourt(e);
    if (!c) return;
    onMove(drag.id, clampToBounds({ x: c.x + drag.offset.x, y: c.y + drag.offset.y }, bounds));
  };

  const end = (e: PointerEvent<SVGSVGElement>) => {
    if (drag?.pointerId === e.pointerId) setDrag(null);
  };

  return (
    <svg
      ref={svgRef}
      className="court-svg"
      viewBox={[vb.x, vb.y, vb.width, vb.height].map((v) => Number(v.toFixed(3))).join(' ')}
      preserveAspectRatio="xMidYMid meet"
      style={{ touchAction: draggable.length ? 'none' : 'auto' }}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      role="img"
      aria-label={label ?? '戰術球場'}
      data-testid={testId}
      data-holder={holderId ?? ''}
    >
      <g transform={transformToSvg(t)}>
        <CourtMarkings />
        {zones.map((z, i) => (
          <g key={i} data-zone={z.ok === undefined ? 'target' : z.ok ? 'ok' : 'ref'}>
            <circle
              cx={z.zone.x}
              cy={z.zone.y}
              r={z.zone.r}
              fill={z.ok === false ? '#ffffff' : z.ok ? '#2bb673' : '#f5b700'}
              fillOpacity={0.3}
              stroke={z.ok === false ? '#ffffff' : z.ok ? '#1f8f58' : '#d99a00'}
              strokeWidth={0.08}
              strokeDasharray="0.3 0.2"
            />
          </g>
        ))}
        {annotations.map((a) => (
          <AnnotationShape key={a.id} a={a} />
        ))}
        {trails.map((tr) =>
          tr.points.length > 1 ? (
            <polyline
              key={`trail-${tr.id}`}
              points={tr.points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}
              fill="none"
              stroke={tr.color}
              strokeOpacity={0.6}
              strokeWidth={0.14}
              strokeLinecap="round"
              strokeLinejoin="round"
              data-trail={tr.id}
            />
          ) : null,
        )}
      </g>
      {ghosts.map((g) => {
        const v = courtToView(g.pos, t);
        return (
          <g key={`ghost-${g.id}`} transform={`translate(${v.x} ${v.y})`} opacity={0.75} data-ghost={g.ok ? 'ok' : 'miss'}>
            <circle r={0.58} fill="none" stroke={g.ok ? '#2bb673' : '#d7263d'} strokeWidth={0.1} strokeDasharray="0.2 0.14" />
            <text textAnchor="middle" dominantBaseline="central" fontSize={0.5} fontWeight={800} fill={g.ok ? '#1f8f58' : '#d7263d'}>
              {g.ok ? '✓' : '✗'}
            </text>
          </g>
        );
      })}
      <g>
        {actives.map((def) => {
          const pos = players[def.id];
          if (!pos) return null;
          const v = courtToView(pos, t);
          const canDrag = draggable.includes(def.id);
          const mark = playerMarks[def.id];
          return (
            <g key={def.id} data-draggable={canDrag ? 'true' : undefined}>
              {canDrag && <circle cx={v.x} cy={v.y} r={0.95} fill="none" stroke="#f5b700" strokeWidth={0.12} strokeDasharray="0.25 0.15" className="pulse" />}
              {mark !== undefined && <circle cx={v.x} cy={v.y} r={0.9} fill="none" stroke={mark ? '#2bb673' : '#d7263d'} strokeWidth={0.16} />}
              {uncertain.includes(def.id) && (
                <g data-uncertain={def.id}>
                  <circle cx={v.x} cy={v.y} r={0.92} fill="none" stroke="#ff9f1c" strokeWidth={0.14} strokeDasharray="0.22 0.16" />
                  <circle cx={v.x + 0.62} cy={v.y - 0.62} r={0.3} fill="#ff9f1c" />
                  <text x={v.x + 0.62} y={v.y - 0.6} textAnchor="middle" dominantBaseline="central" fontSize={0.42} fontWeight={900} fill="#1d1d1f">
                    ?
                  </text>
                </g>
              )}
              <PlayerToken
                id={def.id}
                team={def.teamId}
                number={def.jerseyNumber}
                pos={v}
                selected={drag?.id === def.id}
                locked={false}
                hasBall={holderId === def.id}
                interactive={canDrag}
                onPointerDown={onPlayerDown}
              />
            </g>
          );
        })}
      </g>
      {ballCourt && <BallToken pos={courtToView(ballCourt, t)} lift={ballLift} interactive={false} dragging={false} />}
    </svg>
  );
}
