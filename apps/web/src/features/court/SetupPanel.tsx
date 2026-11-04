import type { TeamSize } from '@btl/shared-types';
import { clearAnnotations, setCourtMode, setTeamSize, toggleAttackDirection } from '@btl/tactic-engine';
import { MAX_ZOOM, useCurrentStep, useIsPlayback, useProject, useStore } from '../../app/store';
import { Section } from '../../components/Section';
import { Segmented } from '../../components/Segmented';
import { DRAW_COLORS, DRAW_TOOLS } from '../tactics/AnnotationShape';

const SIZES: TeamSize[] = [1, 2, 3, 4, 5];

export function SetupPanel() {
  const project = useProject();
  const step = useCurrentStep();
  const currentStep = useStore((s) => s.currentStep);
  const mode = useStore((s) => s.mode);
  const drawTool = useStore((s) => s.drawTool);
  const drawColor = useStore((s) => s.drawColor);
  const zoom = useStore((s) => s.zoom);
  const playback = useIsPlayback();
  const s = useStore.getState;

  const dirLabel =
    project.court.mode === 'half'
      ? '半場：進攻籃框在上方'
      : `紅隊攻 ${project.court.attackDirection === 'right' ? '→ 右' : '← 左'}，藍隊攻 ${project.court.attackDirection === 'right' ? '← 左' : '→ 右'}`;

  return (
    <>
      <Section title="對戰設定" en="Setup">
        <label className="field-label">人數</label>
        <Segmented
          label="對戰人數"
          testId="team-size"
          value={project.teamSize}
          disabled={playback}
          options={SIZES.map((n) => ({ value: n, label: `${n}v${n}` }))}
          onChange={(n) => s().commit((p) => setTeamSize(p, n))}
        />
        <label className="field-label">場地</label>
        <Segmented
          label="場地"
          testId="court-mode"
          value={project.court.mode}
          disabled={playback}
          options={[
            { value: 'half', label: '半場 Half' },
            { value: 'full', label: '全場 Full' },
          ]}
          onChange={(m) => s().commit((p) => setCourtMode(p, m))}
        />
        <div className="row gap">
          <button
            type="button"
            className="btn"
            disabled={playback}
            onClick={() => s().commit(toggleAttackDirection)}
            title="整份戰術鏡射到另一個籃框"
          >
            ⇄ 換邊進攻
          </button>
          <span className="muted small">{dirLabel}</span>
        </div>
      </Section>

      <Section title="操作模式" en="Mode">
        <Segmented
          label="操作模式"
          testId="interaction-mode"
          value={mode}
          disabled={playback}
          options={[
            { value: 'move', label: '✋ 移動球員' },
            { value: 'draw', label: '✏️ 繪圖' },
          ]}
          onChange={(m) => s().setMode(m)}
        />
        {mode === 'draw' && (
          <div className="draw-tools">
            <div className="tool-grid" role="radiogroup" aria-label="畫筆">
              {DRAW_TOOLS.map((t) => (
                <button
                  key={t.kind}
                  type="button"
                  role="radio"
                  aria-checked={drawTool === t.kind}
                  className={`tool ${drawTool === t.kind ? 'is-on' : ''}`}
                  title={t.hint}
                  onClick={() => s().setDrawTool(t.kind)}
                >
                  <ToolIcon kind={t.kind} />
                  <span>{t.label}</span>
                  <small>{t.en}</small>
                </button>
              ))}
              <button
                type="button"
                role="radio"
                aria-checked={drawTool === 'eraser'}
                className={`tool ${drawTool === 'eraser' ? 'is-on' : ''}`}
                title="點一下線條即可刪除"
                onClick={() => s().setDrawTool('eraser')}
              >
                <ToolIcon kind="eraser" />
                <span>橡皮擦</span>
                <small>Erase</small>
              </button>
            </div>
            <div className="color-row" role="radiogroup" aria-label="顏色">
              {DRAW_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  role="radio"
                  aria-checked={drawColor === c.value}
                  aria-label={`${c.label}色`}
                  className={`swatch ${drawColor === c.value ? 'is-on' : ''}`}
                  style={{ background: c.value }}
                  onClick={() => s().setDrawColor(c.value)}
                />
              ))}
            </div>
            <button
              type="button"
              className="btn ghost"
              disabled={step.annotations.length === 0}
              onClick={() => s().commit((p) => clearAnnotations(p, currentStep))}
            >
              清除本步畫線（{step.annotations.length}）
            </button>
          </div>
        )}
      </Section>

      <Section title="縮放" en="Zoom">
        <div className="row gap">
          <button type="button" className="btn icon" aria-label="縮小" onClick={() => s().setZoom(zoom / 1.25)} disabled={zoom <= 1}>
            －
          </button>
          <span className="zoom-label">{Math.round(zoom * 100)}%</span>
          <button type="button" className="btn icon" aria-label="放大" onClick={() => s().setZoom(zoom * 1.25)} disabled={zoom >= MAX_ZOOM}>
            ＋
          </button>
          <button type="button" className="btn ghost" onClick={() => s().resetView()} disabled={zoom === 1}>
            重置
          </button>
        </div>
        <p className="muted small">滾輪或雙指縮放；放大後拖曳空白處可平移。</p>
      </Section>
    </>
  );
}

function ToolIcon({ kind }: { kind: string }) {
  const c = 'currentColor';
  const common = { width: 36, height: 20, viewBox: '0 0 36 20', 'aria-hidden': true } as const;
  switch (kind) {
    case 'run':
      return (
        <svg {...common}>
          <path d="M3 15 Q14 2 28 10" fill="none" stroke={c} strokeWidth="2.4" />
          <path d="M33 13 L26 14 L29 7 Z" fill={c} />
        </svg>
      );
    case 'pass':
      return (
        <svg {...common}>
          <path d="M3 10 H27" stroke={c} strokeWidth="2.4" strokeDasharray="4 3" />
          <path d="M34 10 L26 14 L26 6 Z" fill={c} />
        </svg>
      );
    case 'dribble':
      return (
        <svg {...common}>
          <path d="M3 10 q3 -6 6 0 t6 0 t6 0 t6 0" fill="none" stroke={c} strokeWidth="2.2" />
          <path d="M34 10 L27 14 L27 6 Z" fill={c} />
        </svg>
      );
    case 'screen':
      return (
        <svg {...common}>
          <path d="M3 10 H28 M28 3 V17" stroke={c} strokeWidth="2.6" fill="none" />
        </svg>
      );
    case 'circle':
      return (
        <svg {...common}>
          <circle cx="18" cy="10" r="7.5" fill="none" stroke={c} strokeWidth="2.4" />
        </svg>
      );
    case 'zone':
      return (
        <svg {...common}>
          <rect x="5" y="3" width="26" height="14" rx="3" fill={c} fillOpacity="0.3" stroke={c} strokeWidth="1.8" strokeDasharray="3 2" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M10 16 L4 10 L14 2 L24 10 L18 16 Z" fill="none" stroke={c} strokeWidth="2.2" />
          <path d="M8 18 H30" stroke={c} strokeWidth="2.2" />
        </svg>
      );
  }
}
