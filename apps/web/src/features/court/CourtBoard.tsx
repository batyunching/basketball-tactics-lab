import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { AnnotationKind, PlayerState, Vec2 } from '@btl/shared-types';
import {
  activePlayers,
  addAnnotation,
  clampPan,
  clampToBounds,
  courtToView,
  distance,
  frameAt,
  getBaseViewBox,
  getViewTransform,
  moveBallFree,
  movePlayer,
  passBall,
  playableBounds,
  removeAnnotation,
  resolveBallPosition,
  setBallHolder,
  transformToSvg,
  viewToCourt,
  viewVectorToCourt,
  zoomViewBox,
} from '@btl/tactic-engine';
import { useCurrentStep, useProject, useStore } from '../../app/store';
import { AnnotationShape } from '../tactics/AnnotationShape';
import { pathLength, simplify } from '../tactics/geometry';
import { BallToken, PlayerToken } from '../players/PlayerToken';
import { CourtMarkings } from './CourtMarkings';
import { boardRef } from './boardRef';

type Drag =
  | { kind: 'player'; id: string; pointerId: number; offset: Vec2 }
  | { kind: 'ball'; pointerId: number }
  | { kind: 'pan'; pointerId: number; startClient: Vec2; startPan: Vec2 }
  | { kind: 'draw'; pointerId: number }
  | { kind: 'pinch'; startDist: number; startZoom: number };

interface Draft {
  kind: AnnotationKind;
  points: Vec2[];
  color: string;
}

/** 球在持球者右下方（畫面座標），讓號碼不被遮住 */
const BALL_VIEW_OFFSET: Vec2 = { x: 0.5, y: 0.45 };
const SNAP_DIST = 0.85;
const CATCH_DIST = 1.0;

export function CourtBoard() {
  const project = useProject();
  const step = useCurrentStep();
  const currentStep = useStore((s) => s.currentStep);
  const selectedId = useStore((s) => s.selectedId);
  const mode = useStore((s) => s.mode);
  const drawTool = useStore((s) => s.drawTool);
  const drawColor = useStore((s) => s.drawColor);
  const timeMs = useStore((s) => s.playback.timeMs);
  const zoom = useStore((s) => s.zoom);
  const pan = useStore((s) => s.pan);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, Vec2>());
  const [ballDrag, setBallDrag] = useState<Vec2 | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const { mode: courtMode, attackDirection } = project.court;
  const t = useMemo(() => getViewTransform(courtMode, attackDirection), [courtMode, attackDirection]);
  const base = useMemo(() => getBaseViewBox(courtMode), [courtMode]);
  const vb = zoomViewBox(base, zoom, pan);
  const holderOffset = useMemo(() => viewVectorToCourt(BALL_VIEW_OFFSET, t), [t]);
  const isPlayback = timeMs !== null;
  const frame = useMemo(() => (timeMs !== null ? frameAt(project, timeMs, holderOffset) : null), [project, timeMs, holderOffset]);
  const actives = useMemo(() => activePlayers(project), [project]);

  const positions: Record<string, PlayerState> = frame ? frame.players : step.players;
  const holderId = frame ? frame.holderId : step.ball.holderId;
  const ballCourt = ballDrag ?? (frame ? frame.ballPosition : resolveBallPosition(step.ball, step.players, holderOffset));
  const annotations = frame ? frame.annotations : step.annotations;
  const editable = !isPlayback;

  useEffect(() => {
    boardRef.current = svgRef.current;
    return () => {
      boardRef.current = null;
    };
  }, []);

  // 滑鼠滾輪縮放（需非被動監聽才能阻止頁面捲動）
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = useStore.getState();
      s.setZoom(s.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
      const z = useStore.getState().zoom;
      s.setPan(clampPan(getBaseViewBox(courtMode), z, s.pan));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [courtMode]);

  function toView(e: { clientX: number; clientY: number }): Vec2 {
    const svg = svgRef.current;
    const ctm = svg && typeof svg.getScreenCTM === 'function' ? svg.getScreenCTM() : null;
    if (!ctm) return { x: 0, y: 0 };
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: pt.x, y: pt.y };
  }
  const toCourt = (e: { clientX: number; clientY: number }) => viewToCourt(toView(e), t);

  function nearestPlayer(p: Vec2, maxDist: number, exclude?: string): string | null {
    let best: string | null = null;
    let bestD = maxDist;
    for (const def of actives) {
      if (def.id === exclude) continue;
      const pos = positions[def.id];
      if (!pos) continue;
      const d = distance(p, pos);
      if (d <= bestD) {
        best = def.id;
        bestD = d;
      }
    }
    return best;
  }

  function capture(e: PointerEvent) {
    try {
      svgRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* jsdom / 舊瀏覽器 */
    }
  }

  function startPinchIfNeeded(): boolean {
    if (pointers.current.size !== 2) return false;
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return false;
    // 取消進行中的拖曳或繪圖
    const d = dragRef.current;
    if (d?.kind === 'player') useStore.getState().endGesture();
    setDraft(null);
    setBallDrag(null);
    dragRef.current = { kind: 'pinch', startDist: Math.hypot(a.x - b.x, a.y - b.y), startZoom: useStore.getState().zoom };
    return true;
  }

  const onPlayerDown = (e: PointerEvent<SVGGElement>, id: string) => {
    if (mode !== 'move' || !editable) return;
    e.stopPropagation();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (startPinchIfNeeded()) return;
    const s = useStore.getState();
    s.select(id);
    const def = project.players.find((p) => p.id === id);
    if (!def || def.locked) return;
    const pos = positions[id];
    if (!pos) return;
    const c = toCourt(e);
    capture(e);
    dragRef.current = { kind: 'player', id, pointerId: e.pointerId, offset: { x: pos.x - c.x, y: pos.y - c.y } };
    s.beginGesture();
  };

  const onBallDown = (e: PointerEvent<SVGGElement>) => {
    if (mode !== 'move' || !editable) return;
    e.stopPropagation();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (startPinchIfNeeded()) return;
    capture(e);
    dragRef.current = { kind: 'ball', pointerId: e.pointerId };
    setBallDrag(toCourt(e));
  };

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (startPinchIfNeeded()) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const s = useStore.getState();
    if (mode === 'draw' && editable && drawTool !== 'eraser') {
      let start = toCourt(e);
      if (drawTool !== 'zone' && drawTool !== 'circle') {
        const snap = nearestPlayer(start, SNAP_DIST);
        const sp = snap ? positions[snap] : undefined;
        if (sp) start = { x: sp.x, y: sp.y };
      }
      capture(e);
      dragRef.current = { kind: 'draw', pointerId: e.pointerId };
      setDraft({ kind: drawTool, points: [start, start], color: drawColor });
      return;
    }
    if (mode === 'move') {
      s.select(null);
      if (s.zoom > 1) {
        capture(e);
        dragRef.current = { kind: 'pan', pointerId: e.pointerId, startClient: { x: e.clientX, y: e.clientY }, startPan: s.pan };
      }
    }
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = dragRef.current;
    if (!d) return;
    const s = useStore.getState();
    if (d.kind === 'pinch') {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b || d.startDist === 0) return;
      s.setZoom((d.startZoom * Math.hypot(a.x - b.x, a.y - b.y)) / d.startDist);
      s.setPan(clampPan(base, useStore.getState().zoom, s.pan));
      return;
    }
    if (d.pointerId !== e.pointerId) return;
    if (d.kind === 'player') {
      const c = toCourt(e);
      s.gestureUpdate((p) => movePlayer(p, currentStep, d.id, { x: c.x + d.offset.x, y: c.y + d.offset.y }));
    } else if (d.kind === 'ball') {
      setBallDrag(clampToBounds(toCourt(e), playableBounds(courtMode, attackDirection)));
    } else if (d.kind === 'pan') {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      const k = vb.width / rect.width;
      const next = { x: d.startPan.x - (e.clientX - d.startClient.x) * k, y: d.startPan.y - (e.clientY - d.startClient.y) * k };
      s.setPan(clampPan(base, s.zoom, next));
    } else if (d.kind === 'draw') {
      const c = toCourt(e);
      setDraft((dr) => {
        if (!dr) return dr;
        if (dr.kind === 'run' || dr.kind === 'dribble') {
          const last = dr.points[dr.points.length - 1]!;
          if (dr.points.length > 2 && distance(last, c) < 0.12) return dr;
          // 第二點一開始與起點相同，直接替換
          const pts = dr.points.length === 2 && distance(dr.points[0]!, dr.points[1]!) === 0 ? [dr.points[0]!, c] : [...dr.points, c];
          return { ...dr, points: pts };
        }
        return { ...dr, points: [dr.points[0]!, c] };
      });
    }
  };

  const finishDraw = (dr: Draft) => {
    let pts = dr.points;
    if (dr.kind === 'run' || dr.kind === 'dribble') pts = simplify(pts, 0.25);
    if (dr.kind === 'pass') {
      // 傳球終點吸附到接球者
      const end = pts[pts.length - 1]!;
      const snap = nearestPlayer(end, SNAP_DIST);
      const sp = snap ? positions[snap] : undefined;
      if (sp && distance(sp, pts[0]!) > 0.5) pts = [pts[0]!, { x: sp.x, y: sp.y }];
    }
    const p0 = pts[0]!;
    const p1 = pts[pts.length - 1]!;
    const valid =
      dr.kind === 'zone'
        ? Math.abs(p1.x - p0.x) > 0.3 && Math.abs(p1.y - p0.y) > 0.3
        : dr.kind === 'circle'
          ? distance(p0, p1) > 0.25
          : pathLength(pts) > 0.4;
    if (!valid) return;
    useStore.getState().commit((p) => addAnnotation(p, currentStep, { kind: dr.kind, points: pts, color: dr.color }));
  };

  const onUp = (e: PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    const d = dragRef.current;
    if (!d) return;
    const s = useStore.getState();
    if (d.kind === 'pinch') {
      if (pointers.current.size === 0) dragRef.current = null;
      return;
    }
    if (d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (d.kind === 'player') {
      s.endGesture();
    } else if (d.kind === 'ball') {
      const drop = ballDrag ?? toCourt(e);
      setBallDrag(null);
      const target = nearestPlayer(drop, CATCH_DIST);
      const currentHolder = step.ball.holderId;
      if (target) {
        if (target === currentHolder) return;
        const holderDef = project.players.find((p) => p.id === currentHolder);
        const targetDef = project.players.find((p) => p.id === target);
        if (holderDef && targetDef && holderDef.teamId === targetDef.teamId) {
          s.commit((p) => passBall(p, currentStep, target));
        } else {
          s.commit((p) => setBallHolder(p, currentStep, target));
        }
      } else {
        s.commit((p) => moveBallFree(p, currentStep, drop));
      }
    } else if (d.kind === 'draw') {
      if (draft) finishDraw(draft);
      setDraft(null);
    }
  };

  const eraser = mode === 'draw' && drawTool === 'eraser' && editable;
  const playersInteractive = mode === 'move' && editable;
  const ballView = courtToView(ballCourt, t);
  const cursor = mode === 'draw' && editable ? (eraser ? 'cell' : 'crosshair') : zoom > 1 ? 'move' : 'default';

  return (
    <svg
      ref={svgRef}
      className="court-svg"
      data-testid="court"
      data-mode={mode}
      viewBox={[vb.x, vb.y, vb.width, vb.height].map((v) => Number(v.toFixed(3))).join(' ')}
      preserveAspectRatio="xMidYMid meet"
      style={{ cursor, touchAction: 'none' }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onContextMenu={(e) => e.preventDefault()}
      role="application"
      aria-label={`籃球場（${courtMode === 'half' ? '半場' : '全場'}）`}
    >
      <g transform={transformToSvg(t)}>
        <CourtMarkings />
        <g data-testid="annotations">
          {annotations.map((a) => (
            <AnnotationShape
              key={a.id}
              a={a}
              erasable={eraser}
              onErase={() => useStore.getState().commit((p) => removeAnnotation(p, currentStep, a.id))}
            />
          ))}
          {draft && <AnnotationShape a={draft} draft />}
        </g>
      </g>
      <g data-testid="players">
        {actives.map((def) => {
          const pos = positions[def.id];
          if (!pos) return null;
          return (
            <PlayerToken
              key={def.id}
              id={def.id}
              team={def.teamId}
              number={def.jerseyNumber}
              pos={courtToView(pos, t)}
              selected={selectedId === def.id}
              locked={def.locked}
              hasBall={holderId === def.id}
              interactive={playersInteractive}
              onPointerDown={onPlayerDown}
            />
          );
        })}
      </g>
      <BallToken pos={ballView} lift={frame?.ballLift ?? 0} interactive={playersInteractive} dragging={!!ballDrag} onPointerDown={onBallDown} />
    </svg>
  );
}
