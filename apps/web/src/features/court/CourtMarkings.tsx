import { memo } from 'react';
import { FIBA, OUT_OF_BOUNDS_MARGIN, basketPosition, threePointCornerLength } from '@btl/tactic-engine';

export const COURT_COLORS = {
  surround: '#22324f',
  floor: '#e7c391',
  paint: '#c8693c',
  center: '#c8693c',
  line: '#fffaf0',
  rim: '#ff7a1a',
};

const LW = 0.07;

/** 單側籃框區域（禁區、罰球圈、三分線、籃板） */
function BasketEnd({ side }: { side: 'left' | 'right' }) {
  const s = side === 'left' ? 1 : -1;
  const x0 = side === 'left' ? 0 : FIBA.lengthM;
  const b = basketPosition(side);
  const keyTop = FIBA.widthM / 2 - FIBA.keyWidth / 2;
  const ftX = x0 + s * FIBA.freeThrowLineFromBaseline;
  const corner = threePointCornerLength();
  const cx = x0 + s * corner;
  const y1 = FIBA.threePointSideOffset;
  const y2 = FIBA.widthM - FIBA.threePointSideOffset;
  const r = FIBA.threePointRadius;
  const sweep = side === 'left' ? 1 : 0;
  const ftR = FIBA.freeThrowCircleRadius;
  const nc = FIBA.noChargeRadius;
  const bbX = x0 + s * FIBA.backboardFromBaseline;
  const keyX = side === 'left' ? 0 : FIBA.lengthM - FIBA.freeThrowLineFromBaseline;
  return (
    <g>
      <rect x={keyX} y={keyTop} width={FIBA.freeThrowLineFromBaseline} height={FIBA.keyWidth} fill={COURT_COLORS.paint} stroke={COURT_COLORS.line} strokeWidth={LW} />
      {/* 罰球圈：禁區外實線、禁區內虛線 */}
      <path
        d={`M${ftX} ${7.5 - ftR} A${ftR} ${ftR} 0 0 ${sweep} ${ftX} ${7.5 + ftR}`}
        fill="none"
        stroke={COURT_COLORS.line}
        strokeWidth={LW}
      />
      <path
        d={`M${ftX} ${7.5 - ftR} A${ftR} ${ftR} 0 0 ${1 - sweep} ${ftX} ${7.5 + ftR}`}
        fill="none"
        stroke={COURT_COLORS.line}
        strokeWidth={LW}
        strokeDasharray="0.3 0.25"
      />
      {/* 三分線 */}
      <path
        d={`M${x0} ${y1} L${cx} ${y1} A${r} ${r} 0 0 ${sweep} ${cx} ${y2} L${x0} ${y2}`}
        fill="none"
        stroke={COURT_COLORS.line}
        strokeWidth={LW}
      />
      {/* 無衝撞半圓 */}
      <path d={`M${b.x} ${7.5 - nc} A${nc} ${nc} 0 0 ${sweep} ${b.x} ${7.5 + nc}`} fill="none" stroke={COURT_COLORS.line} strokeWidth={LW} />
      {/* 籃板、籃框 */}
      <line x1={bbX} y1={7.5 - FIBA.backboardWidth / 2} x2={bbX} y2={7.5 + FIBA.backboardWidth / 2} stroke="#ffffff" strokeWidth={0.1} />
      <line x1={bbX} y1={7.5} x2={b.x - s * FIBA.ringRadius} y2={7.5} stroke={COURT_COLORS.rim} strokeWidth={0.06} />
      <circle cx={b.x} cy={b.y} r={FIBA.ringRadius} fill="none" stroke={COURT_COLORS.rim} strokeWidth={0.07} />
    </g>
  );
}

/** FIBA 28 × 15m 球場標線（以球場公尺座標繪製，外層 transform 決定半場／全場方向） */
export const CourtMarkings = memo(function CourtMarkings() {
  const m = OUT_OF_BOUNDS_MARGIN + 3;
  return (
    <g data-testid="court-markings">
      <rect x={-m} y={-m} width={FIBA.lengthM + 2 * m} height={FIBA.widthM + 2 * m} fill={COURT_COLORS.surround} />
      <rect x={0} y={0} width={FIBA.lengthM} height={FIBA.widthM} fill={COURT_COLORS.floor} />
      <circle cx={FIBA.lengthM / 2} cy={FIBA.widthM / 2} r={FIBA.centerCircleRadius} fill={COURT_COLORS.center} fillOpacity={0.55} stroke={COURT_COLORS.line} strokeWidth={LW} />
      <line x1={FIBA.lengthM / 2} y1={0} x2={FIBA.lengthM / 2} y2={FIBA.widthM} stroke={COURT_COLORS.line} strokeWidth={LW} />
      <BasketEnd side="left" />
      <BasketEnd side="right" />
      <rect x={0} y={0} width={FIBA.lengthM} height={FIBA.widthM} fill="none" stroke={COURT_COLORS.line} strokeWidth={LW * 1.4} />
    </g>
  );
});
