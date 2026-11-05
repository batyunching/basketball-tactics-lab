import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { Vec2 } from '@btl/shared-types';
import { activePlayers, createProject } from '@btl/tactic-engine';
import {
  FLAG_LABEL,
  HALF_COURT_LANDMARKS,
  applyHomography,
  buildPlayerSamples,
  clampTrim,
  halfCourtLines,
  isDegenerate,
  mat3Inv,
  positionAt,
  projectTracks,
  qualityReport,
  reprojectionError,
  runTracker,
  sampleTimes,
  solveHomography,
  trajectoriesToTactic,
  type Calibration,
  type FrameDetections,
  type Keyframe,
  type PlayerSample,
  type Track,
  type TrackPoint,
  type VideoAnalysis,
  type VideoAsset,
} from '@btl/video-engine';
import { navigate } from '../../app/router';
import { useStore } from '../../app/store';
import { CourtView } from '../court/CourtView';
import { TEAM_FILL, TEAM_LABEL } from '../players/PlayerToken';
import { repository } from '../storage/db';
import { downloadBlob, openAsNewProject } from '../storage/persistence';
import { MODEL_VERSION, detectPlayers } from './detector';

const STEPS = ['① 片段', '② 球場校正', '③ 自動追蹤', '④ 身分校正', '⑤ 人工關鍵影格', '⑥ 對照回放'] as const;
const sec = (ms: number) => (ms / 1000).toFixed(1);

function playerLabel(id: string, project: ReturnType<typeof createProject>): string {
  const d = project.players.find((p) => p.id === id);
  return d ? `${TEAM_LABEL[d.teamId]}${d.jerseyNumber}` : id;
}

/** 影片工作區：校正、追蹤、身分、關鍵影格、同步回放 */
export function VideoWorkspace({ id }: { id: string }) {
  const [asset, setAsset] = useState<VideoAsset | null>(null);
  const [analysis, setAnalysis] = useState<VideoAnalysis | null>(null);
  const [url, setUrl] = useState('');
  const [missing, setMissing] = useState(false);
  const [step, setStep] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const videoRef = useRef<HTMLVideoElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const loaded = useRef(false);
  // 校正點選擇、人工放置的球員
  const [calLandmark, setCalLandmark] = useCalState();
  const [armed, setArmed] = useState<string | null>(null);

  // 載入
  useEffect(() => {
    let objUrl = '';
    void (async () => {
      const [v, blob, a] = await Promise.all([repository.getVideo(id), repository.getVideoBlob(id), repository.getAnalysis(id)]);
      if (!v || !blob) {
        setMissing(true);
        return;
      }
      objUrl = URL.createObjectURL(blob);
      setUrl(objUrl);
      setAsset(v);
      setAnalysis(a ?? (await import('@btl/video-engine')).emptyAnalysis(id));
      setTime(v.trimStartMs);
      setStep(a?.calibration?.homography ? (a.status === 'done' || a.keyframes.length ? 5 : 2) : 0);
      loaded.current = true;
    })();
    return () => {
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [id]);

  // 自動儲存
  useEffect(() => {
    if (!loaded.current || !analysis) return;
    const t = setTimeout(() => void repository.saveAnalysis(analysis), 400);
    return () => clearTimeout(t);
  }, [analysis]);
  useEffect(() => {
    if (!loaded.current || !asset) return;
    const t = setTimeout(() => void repository.saveVideo(asset), 400);
    return () => clearTimeout(t);
  }, [asset]);

  // 播放時更新時間（rAF 讓球場動畫平順）
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v && asset) {
        const ms = v.currentTime * 1000;
        if (ms >= asset.trimEndMs) {
          v.pause();
          v.currentTime = asset.trimStartMs / 1000;
          setTime(asset.trimStartMs);
          setPlaying(false);
          return;
        }
        setTime(Math.round(ms));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, asset]);

  const project = useMemo(() => createProject({ teamSize: analysis?.teamSize ?? 3 }), [analysis?.teamSize]);
  const players = useMemo(() => activePlayers(project), [project]);
  const H = analysis?.calibration?.homography ?? null;
  const Hinv = useMemo(() => (H ? mat3Inv(H) : null), [H]);
  const fps = analysis && analysis.frames.length ? analysis.sampleFps : 10;
  const times = useMemo(() => (asset ? sampleTimes(asset.trimStartMs, asset.trimEndMs, fps) : []), [asset, fps]);
  const samples = useMemo<Record<string, PlayerSample[]>>(
    () =>
      analysis
        ? buildPlayerSamples({
            tracks: analysis.tracks,
            assignments: analysis.assignments,
            reviews: analysis.reviews,
            keyframes: analysis.keyframes,
            players,
            times,
            toleranceMs: 500 / fps,
          })
        : {},
    [analysis, players, times, fps],
  );

  if (missing) {
    return (
      <div className="page">
        <p>找不到這支影片（可能已刪除）。</p>
        <button type="button" className="btn" onClick={() => navigate('/video')}>
          回影片列表
        </button>
      </div>
    );
  }
  if (!asset || !analysis) return <div className="page muted">讀取影片中…</div>;

  const W = asset.width || 1280;
  const Hh = asset.height || 720;
  const patch = (p: Partial<VideoAnalysis>) => setAnalysis((a) => (a ? { ...a, ...p } : a));

  const seekTo = (ms: number) => {
    const v = videoRef.current;
    const t = Math.max(asset.trimStartMs, Math.min(asset.trimEndMs, ms));
    if (v) v.currentTime = t / 1000;
    setTime(Math.round(t));
  };
  const togglePlay = async () => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) {
      v.pause();
      setPlaying(false);
    } else {
      if (time >= asset.trimEndMs - 50) seekTo(asset.trimStartMs);
      v.playbackRate = rate;
      try {
        await v.play();
        setPlaying(true);
      } catch {
        useStore.getState().showToast('瀏覽器無法播放這支影片', 'error');
      }
    }
  };

  // 目前時間的追蹤框
  const tol = 500 / fps;
  const boxesNow: { track: Track; p: TrackPoint }[] = [];
  for (const tr of analysis.tracks) {
    const p = tr.points.find((x) => Math.abs(x.timeMs - time) <= tol);
    if (p) boxesNow.push({ track: tr, p });
  }
  const rawNow: FrameDetections | undefined = analysis.frames.find((f) => Math.abs(f.timeMs - time) <= tol);

  const toImagePx = (e: { clientX: number; clientY: number }) => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  const keyframeNow = analysis.keyframes.find((k) => Math.abs(k.timeMs - time) <= 60);

  const setCalibration = (points: Calibration['points']) => {
    const usable = points.length >= 4 && !isDegenerate(points.map((p) => p.image));
    const homography = usable ? solveHomography(points.map((p) => p.image), points.map((p) => p.court)) : null;
    const errorM = homography ? Math.round(reprojectionError(homography, points.map((p) => p.image), points.map((p) => p.court)) * 100) / 100 : null;
    const calibration: Calibration = { points, homography, errorM, updatedAt: new Date().toISOString() };
    setAnalysis((a) => (a ? { ...a, calibration, tracks: projectTracks(a.tracks, homography) } : a));
  };

  const upsertKeyframe = (fn: (k: Keyframe) => Keyframe) => {
    setAnalysis((a) => {
      if (!a) return a;
      const existing = a.keyframes.find((k) => Math.abs(k.timeMs - time) <= 60);
      if (existing) return { ...a, keyframes: a.keyframes.map((k) => (k.id === existing.id ? fn(k) : k)) };
      const base: Keyframe = { id: `kf-${crypto.randomUUID().slice(0, 8)}`, timeMs: time, players: {}, holderId: null };
      return { ...a, keyframes: [...a.keyframes, fn(base)].sort((x, y) => x.timeMs - y.timeMs) };
    });
  };

  const onOverlayClick = (e: MouseEvent<SVGSVGElement>) => {
    const px = toImagePx(e);
    if (!px) return;
    if (step === 1 && calLandmark) {
      const lm = HALF_COURT_LANDMARKS.find((l) => l.id === calLandmark)!;
      const pts = (analysis.calibration?.points ?? []).filter((p) => p.landmarkId !== lm.id);
      const next = [...pts, { landmarkId: lm.id, image: { x: Math.round(px.x), y: Math.round(px.y) }, court: lm.court }];
      setCalibration(next);
      const nextLm = HALF_COURT_LANDMARKS.find((l) => !next.some((p) => p.landmarkId === l.id));
      setCalLandmark(nextLm?.id ?? null);
    } else if (step === 4 && armed && H) {
      const c = applyHomography(H, px);
      if (!c) return;
      upsertKeyframe((k) => ({ ...k, players: { ...k.players, [armed]: { x: Math.round(c.x * 100) / 100, y: Math.round(c.y * 100) / 100 } } }));
      const idx = players.findIndex((p) => p.id === armed);
      setArmed(players[idx + 1]?.id ?? null);
    }
  };

  // 球場上的位置
  const nowSamples: Record<string, PlayerSample> = {};
  for (const p of players) {
    const s = positionAt(samples[p.id], time);
    if (s) nowSamples[p.id] = s;
  }
  const courtPlayers: Record<string, Vec2> = {};
  if (step === 4 && keyframeNow) Object.assign(courtPlayers, Object.fromEntries(Object.entries(nowSamples).map(([k, s]) => [k, s.courtPosition])), keyframeNow.players);
  else for (const [k, s] of Object.entries(nowSamples)) courtPlayers[k] = s.courtPosition;
  const uncertainNow = Object.entries(nowSamples)
    .filter(([, s]) => s.positionSource !== 'manual' && (s.flags.some((f) => f !== 'interpolated') || s.identityConfidence < 0.6))
    .map(([k]) => k);
  const holderNow = [...analysis.keyframes].reverse().find((k) => k.timeMs <= time + 60 && k.holderId !== undefined)?.holderId ?? null;

  return (
    <div className="page video-page" data-testid="video-workspace">
      <header className="page-head row-between">
        <div>
          <button type="button" className="link muted" onClick={() => navigate('/video')}>
            ← 影片列表
          </button>
          <h1>{asset.name}</h1>
          <p className="muted small">
            {sec(asset.durationMs)} 秒・{W}×{Hh}・分析片段 {sec(asset.trimStartMs)}～{sec(asset.trimEndMs)} 秒・🔒 只存在這台電腦
          </p>
        </div>
      </header>
      <nav className="tabs" role="tablist" aria-label="分析步驟">
        {STEPS.map((s, i) => (
          <button key={s} type="button" role="tab" aria-selected={step === i} className={step === i ? 'is-on' : ''} onClick={() => setStep(i)} data-testid={`vstep-${i + 1}`}>
            {s}
            {i === 1 && H ? ' ✓' : ''}
            {i === 2 && analysis.status === 'done' ? ' ✓' : ''}
            {i === 4 && analysis.keyframes.length ? `（${analysis.keyframes.length}）` : ''}
          </button>
        ))}
      </nav>

      <div className="vw-grid">
        <div className="vw-left">
          <div className="video-stage" style={{ aspectRatio: `${W} / ${Hh}` }}>
            <video
              ref={videoRef}
              src={url}
              playsInline
              muted
              preload="auto"
              onLoadedMetadata={() => seekTo(time)}
              onSeeked={(e) => !playing && setTime(Math.round(e.currentTarget.currentTime * 1000))}
              onPause={() => setPlaying(false)}
              data-testid="video-el"
            />
            <svg
              ref={svgRef}
              className={`video-overlay ${(step === 1 && calLandmark) || (step === 4 && armed) ? 'picking' : ''}`}
              viewBox={`0 0 ${W} ${Hh}`}
              preserveAspectRatio="xMidYMid meet"
              onClick={onOverlayClick}
              data-testid="video-overlay"
            >
              {step === 1 && Hinv && <ProjectedCourt Hinv={Hinv} stroke={W / 400} />}
              {step === 1 &&
                (analysis.calibration?.points ?? []).map((p) => (
                  <g key={p.landmarkId} transform={`translate(${p.image.x} ${p.image.y})`} data-calpoint={p.landmarkId}>
                    <circle r={W / 150} fill="#f5b700" stroke="#1d1d1f" strokeWidth={W / 900} />
                    <text y={-W / 90} textAnchor="middle" fontSize={W / 60} fontWeight={800} fill="#fff" stroke="#000" strokeWidth={W / 1500} paintOrder="stroke">
                      {HALF_COURT_LANDMARKS.findIndex((l) => l.id === p.landmarkId) + 1}
                    </text>
                  </g>
                ))}
              {step >= 2 &&
                boxesNow.map(({ track, p }) => {
                  const pid = analysis.assignments[track.trackId];
                  const def = pid && pid !== 'ignore' ? project.players.find((d) => d.id === pid) : undefined;
                  const color = def ? TEAM_FILL[def.teamId] : pid === 'ignore' ? '#8a8f99' : track.team === 'red' ? '#ff6b7a' : track.team === 'blue' ? '#6ea8ff' : '#f5b700';
                  const unsure = p.flags.some((f) => f !== 'interpolated');
                  return (
                    <g key={track.trackId} data-box={track.trackId}>
                      <rect x={p.box.x} y={p.box.y} width={p.box.w} height={p.box.h} fill="none" stroke={color} strokeWidth={W / 450} strokeDasharray={unsure ? `${W / 120} ${W / 200}` : undefined} />
                      <text x={p.box.x} y={p.box.y - W / 200} fontSize={W / 70} fontWeight={800} fill={color} stroke="#000" strokeWidth={W / 1600} paintOrder="stroke">
                        {track.trackId}
                        {def ? `→${playerLabel(def.id, project)}` : pid === 'ignore' ? '（非球員）' : ''}
                        {unsure ? ' ?' : ''}
                      </text>
                    </g>
                  );
                })}
              {step === 2 &&
                rawNow?.boxes
                  .filter((b) => !boxesNow.some(({ p }) => Math.abs(p.box.x - b.x) < 1 && Math.abs(p.box.y - b.y) < 1))
                  .map((b, i) => <rect key={`raw-${i}`} x={b.x} y={b.y} width={b.w} height={b.h} fill="none" stroke="#ffffff" strokeOpacity={0.5} strokeWidth={W / 900} />)}
            </svg>
          </div>
          <div className="viewer-controls" role="toolbar" aria-label="影片播放">
            <button type="button" className="btn icon" onClick={() => seekTo(time - 100)} aria-label="上一格（0.1 秒）">
              ◀
            </button>
            <button type="button" className="btn icon big primary" onClick={() => void togglePlay()} aria-label={playing ? '暫停' : '播放'} data-testid="video-play">
              {playing ? '⏸' : '▶'}
            </button>
            <button type="button" className="btn icon" onClick={() => seekTo(time + 100)} aria-label="下一格（0.1 秒）">
              ▶
            </button>
            <input
              type="range"
              className="viewer-scrub"
              min={asset.trimStartMs}
              max={asset.trimEndMs}
              step={50}
              value={time}
              aria-label="影片時間"
              onChange={(e) => seekTo(Number(e.target.value))}
              data-testid="video-scrub"
            />
            <span className="time-label" data-testid="video-time">
              {sec(time)} s
            </span>
            <select
              value={rate}
              aria-label="播放速度"
              onChange={(e) => {
                const r = Number(e.target.value);
                setRate(r);
                if (videoRef.current) videoRef.current.playbackRate = r;
              }}
            >
              {[0.25, 0.5, 1].map((r) => (
                <option key={r} value={r}>
                  {r}×
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="vw-right">
          {step >= 3 && (
            <div className="vw-court" data-court="half">
              <CourtView
                project={project}
                players={courtPlayers}
                holderId={holderNow}
                draggable={step === 4 && keyframeNow ? players.map((p) => p.id) : []}
                onMove={(pid, pos) => upsertKeyframe((k) => ({ ...k, players: { ...k.players, [pid]: { x: Math.round(pos.x * 100) / 100, y: Math.round(pos.y * 100) / 100 } } }))}
                uncertain={step === 4 ? [] : uncertainNow}
                trails={
                  step === 5
                    ? players
                        .map((p) => ({
                          id: p.id,
                          color: TEAM_FILL[p.teamId],
                          points: (samples[p.id] ?? []).filter((s) => s.timeMs <= time && s.timeMs >= time - 2000).map((s) => s.courtPosition),
                        }))
                        .filter((t) => t.points.length > 1)
                    : []
                }
                label="虛擬球場"
                testId="video-court"
              />
            </div>
          )}
          {step === 0 && <TrimPanel asset={asset} time={time} onChange={(t) => setAsset({ ...asset, ...t })} hasFrames={analysis.frames.length > 0} />}
          {step === 1 && <CalibrationPanel calibration={analysis.calibration} current={calLandmark} onPick={setCalLandmark} onSet={setCalibration} />}
          {step === 2 && (
            <TrackingPanel
              asset={asset}
              url={url}
              analysis={analysis}
              onDone={(frames, fpsUsed) => {
                const tracks = projectTracks(runTracker(frames), H);
                patch({ frames, tracks, sampleFps: fpsUsed, status: 'done', modelVersion: MODEL_VERSION, analyzedAt: new Date().toISOString(), error: null, assignments: {}, reviews: {} });
                if (tracks.length) setStep(3);
              }}
              onFail={(status, error) => patch({ status, error })}
              samples={samples}
              times={times}
            />
          )}
          {step === 3 && <IdentityPanel analysis={analysis} project={project} onPatch={patch} onJump={seekTo} />}
          {step === 4 && (
            <KeyframePanel
              analysis={analysis}
              project={project}
              time={time}
              keyframeNow={keyframeNow}
              hasCalibration={!!H}
              armed={armed}
              onArm={setArmed}
              onCreate={() =>
                upsertKeyframe((k) => ({
                  ...k,
                  players: Object.keys(k.players).length ? k.players : Object.fromEntries(players.map((p) => [p.id, nowSamples[p.id]?.courtPosition ?? project.steps[0]!.players[p.id]!])),
                }))
              }
              onPatchKeyframe={(fn) => upsertKeyframe(fn)}
              onDelete={(kid) => patch({ keyframes: analysis.keyframes.filter((k) => k.id !== kid) })}
              onJump={seekTo}
            />
          )}
          {step === 5 && (
            <PlaybackPanel
              asset={asset}
              analysis={analysis}
              samples={samples}
              times={times}
              project={project}
              uncertainNow={uncertainNow}
              nowSamples={nowSamples}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** 校正點選擇狀態（獨立 hook，避免條件式呼叫） */
function useCalState() {
  return useState<string | null>(HALF_COURT_LANDMARKS[0]!.id);
}

function ProjectedCourt({ Hinv, stroke }: { Hinv: number[]; stroke: number }) {
  return (
    <g data-testid="projected-court">
      {halfCourtLines().map((line, i) => {
        const pts = line.map((p) => applyHomography(Hinv, p)).filter((p): p is Vec2 => !!p);
        return <polyline key={i} points={pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} fill="none" stroke="#2bb673" strokeWidth={stroke} strokeOpacity={0.9} />;
      })}
    </g>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function TrimPanel({ asset, time, onChange, hasFrames }: { asset: VideoAsset; time: number; onChange: (t: { trimStartMs: number; trimEndMs: number }) => void; hasFrames: boolean }) {
  const set = (s: number, e: number) => onChange(clampTrim(s, e, asset.durationMs));
  const len = asset.trimEndMs - asset.trimStartMs;
  return (
    <Panel title="選擇分析片段（10～30 秒）">
      <p className="muted small">影片原檔不會被修改；系統只分析與播放這個片段。</p>
      <label className="field">
        <span>開始：{sec(asset.trimStartMs)} 秒</span>
        <input type="range" min={0} max={asset.durationMs} step={100} value={asset.trimStartMs} onChange={(e) => set(Number(e.target.value), asset.trimEndMs)} data-testid="trim-start" />
      </label>
      <label className="field">
        <span>結束：{sec(asset.trimEndMs)} 秒</span>
        <input type="range" min={0} max={asset.durationMs} step={100} value={asset.trimEndMs} onChange={(e) => set(asset.trimStartMs, Number(e.target.value))} data-testid="trim-end" />
      </label>
      <div className="btn-row">
        <button type="button" className="btn small" onClick={() => set(time, time + len)}>
          從目前時間開始
        </button>
        <button type="button" className="btn small" onClick={() => set(asset.trimStartMs, time)}>
          在目前時間結束
        </button>
      </div>
      <p>
        片段長度：<b data-testid="trim-length">{sec(len)} 秒</b>
      </p>
      {hasFrames && <p className="form-error small">已有分析結果；改變片段後請重新執行「③ 自動追蹤」。</p>}
    </Panel>
  );
}

function CalibrationPanel({ calibration, current, onPick, onSet }: { calibration: Calibration | null; current: string | null; onPick: (id: string | null) => void; onSet: (p: Calibration['points']) => void }) {
  const pts = calibration?.points ?? [];
  const err = calibration?.errorM;
  const quality = err === null || err === undefined ? null : err < 0.3 ? ['good', '準確'] : err < 0.7 ? ['ok', '可用'] : ['bad', '誤差偏大，請檢查點的位置'];
  return (
    <Panel title="球場校正">
      <ol className="small muted cal-help">
        <li>把影片暫停在球場線條清楚的畫面。</li>
        <li>在下方選一個校正點，再到影片上點它的位置（點完自動跳下一個）。</li>
        <li>至少 4 點，建議 6 點以上、分散在畫面各處。綠色線條會疊在影片上，對齊球場就代表校正正確。</li>
      </ol>
      <ul className="landmark-list" data-testid="landmark-list">
        {HALF_COURT_LANDMARKS.map((l, i) => {
          const p = pts.find((x) => x.landmarkId === l.id);
          return (
            <li key={l.id} className={current === l.id ? 'is-on' : ''}>
              <button type="button" className="link" onClick={() => onPick(l.id)} aria-pressed={current === l.id} data-testid={`lm-${l.id}`}>
                <b>{i + 1}</b> {l.label}
              </button>
              {p ? (
                <span className="lm-done">
                  ✓
                  <button type="button" className="btn tiny ghost" aria-label={`清除 ${l.label}`} onClick={() => onSet(pts.filter((x) => x.landmarkId !== l.id))}>
                    ✕
                  </button>
                </span>
              ) : current === l.id ? (
                <span className="lm-wait">← 請點影片</span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p data-testid="cal-status">
        已標 {pts.length} 點・
        {calibration?.homography ? (
          <>
            平均誤差 <b>{err} 公尺</b>（<span className={`q-${quality?.[0]}`}>{quality?.[1]}</span>）
          </>
        ) : pts.length >= 4 ? (
          '這幾個點幾乎在同一直線上，請改選分散的點'
        ) : (
          `還需要 ${4 - pts.length} 點`
        )}
      </p>
      <div className="btn-row">
        <button type="button" className="btn small ghost" disabled={!pts.length} onClick={() => onSet([])}>
          全部清除
        </button>
        <button type="button" className="btn small ghost" onClick={() => onPick(null)} disabled={!current}>
          停止標點
        </button>
      </div>
    </Panel>
  );
}

function TrackingPanel({
  asset,
  url,
  analysis,
  onDone,
  onFail,
  samples,
  times,
}: {
  asset: VideoAsset;
  url: string;
  analysis: VideoAnalysis;
  onDone: (frames: FrameDetections[], fps: number) => void;
  onFail: (status: 'failed' | 'cancelled', error: string) => void;
  samples: Record<string, PlayerSample[]>;
  times: number[];
}) {
  const [fps, setFps] = useState(analysis.sampleFps || 5);
  const [progress, setProgress] = useState<{ done: number; total: number; people: number } | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const running = progress !== null;
  const est = Math.round(((asset.trimEndMs - asset.trimStartMs) / 1000) * fps);

  const run = async () => {
    ctrl.current = new AbortController();
    setProgress({ done: 0, total: est, people: 0 });
    try {
      const frames = await detectPlayers(url, asset, {
        fps,
        signal: ctrl.current.signal,
        onProgress: (done, total, last) => setProgress({ done, total, people: last.boxes.length }),
      });
      onDone(frames, fps);
    } catch (e) {
      const cancelled = (e as Error).name === 'AbortError';
      onFail(cancelled ? 'cancelled' : 'failed', cancelled ? '已取消' : (e as Error).message);
      if (!cancelled) useStore.getState().showToast(`自動追蹤失敗：${(e as Error).message}`, 'error');
    } finally {
      setProgress(null);
      ctrl.current = null;
    }
  };

  const q = analysis.status === 'done' ? qualityReport(analysis.frames, analysis.tracks, analysis.assignments, samples, times.length) : null;
  return (
    <Panel title="自動偵測與追蹤">
      <p className="muted small">
        在你的電腦上用 YOLOX 模型逐格找人，再追蹤每個人的移動、以背心顏色判斷隊伍。第一次會下載約 20MB 的模型。結果都會標示信心與不確定處，請在下一步人工確認。
      </p>
      {!analysis.calibration?.homography && <p className="form-error small">尚未校正球場：可以先追蹤，但要完成校正後才能換算球場位置。</p>}
      {!asset.consent && <p className="form-error small">此影片匯入時未勾選授權確認，請確認已取得授權再分析。</p>}
      <label className="field">
        <span>每秒取樣張數（越多越準、越慢）</span>
        <select value={fps} disabled={running} onChange={(e) => setFps(Number(e.target.value))} data-testid="track-fps">
          {[2, 5, 10].map((f) => (
            <option key={f} value={f}>
              {f} 張／秒（約 {Math.round(((asset.trimEndMs - asset.trimStartMs) / 1000) * f)} 張）
            </option>
          ))}
        </select>
      </label>
      {running ? (
        <div data-testid="track-progress">
          <progress max={progress.total} value={progress.done} style={{ width: '100%' }} />
          <p className="small">
            分析中 {progress.done} / {progress.total} 張，這張找到 {progress.people} 人…
          </p>
          <button type="button" className="btn small" onClick={() => ctrl.current?.abort()}>
            取消
          </button>
        </div>
      ) : (
        <button type="button" className="btn primary wide" onClick={() => void run()} disabled={!asset.consent} data-testid="track-run">
          {analysis.status === 'done' ? '重新分析（會清除身分指派）' : '開始自動追蹤'}
        </button>
      )}
      {analysis.status === 'failed' && <p className="form-error">上次分析失敗：{analysis.error}。可改用「⑤ 人工關鍵影格」建立軌跡。</p>}
      {q && (
        <div className="quality" data-testid="track-result">
          <h3>分析結果</h3>
          <ul className="small">
            <li>分析 {q.frames} 張畫面，平均每張找到 {q.detectionsPerFrame} 人</li>
            <li>
              建立 <b>{q.tracks}</b> 條軌跡（已指派 {q.assignedTracks} 條）
            </li>
            <li>模型：{analysis.modelVersion}・{analysis.analyzedAt ? new Date(analysis.analyzedAt).toLocaleString('zh-TW', { hour12: false }) : ''}</li>
          </ul>
          {q.tracks === 0 ? (
            <p className="form-error" data-testid="no-tracks">沒有偵測到可追蹤的球員。可能是鏡頭太遠、畫面太暗或球員太小。請改用「⑤ 人工關鍵影格」手動建立軌跡。</p>
          ) : (
            <p className="small">下一步：到「④ 身分校正」依影片中的背號，把每條軌跡指派給球員。</p>
          )}
        </div>
      )}
    </Panel>
  );
}

function IdentityPanel({ analysis, project, onPatch, onJump }: { analysis: VideoAnalysis; project: ReturnType<typeof createProject>; onPatch: (p: Partial<VideoAnalysis>) => void; onJump: (ms: number) => void }) {
  const players = activePlayers(project);
  const tracks = [...analysis.tracks].sort((a, b) => b.points.length - a.points.length);
  return (
    <Panel title="身分校正（隊別與背號）">
      <label className="field">
        <span>每隊人數</span>
        <select value={analysis.teamSize} onChange={(e) => onPatch({ teamSize: Number(e.target.value) as VideoAnalysis['teamSize'] })} data-testid="team-size-select">
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n}v{n}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small">系統不會把追蹤編號當成背號。請按「看」跳到該軌跡出現的畫面，依背號指派給球員；同一人斷成幾段時，可把多條軌跡指派給同一人。</p>
      {tracks.length === 0 ? (
        <p className="muted">還沒有自動追蹤的軌跡。可以直接到「⑤ 人工關鍵影格」手動標記。</p>
      ) : (
        <div className="table-wrap">
          <table className="attempt-table" data-testid="track-table">
            <thead>
              <tr>
                <th>軌跡</th>
                <th>時間</th>
                <th>隊色判斷</th>
                <th>不確定</th>
                <th>指派給</th>
                <th>已確認</th>
              </tr>
            </thead>
            <tbody>
              {tracks.map((t) => {
                const obs = t.points.filter((p) => p.source === 'observed');
                const unsure = t.points.filter((p) => p.flags.some((f) => f !== 'interpolated')).length;
                const first = t.points[0]!.timeMs;
                const last = t.points[t.points.length - 1]!.timeMs;
                return (
                  <tr key={t.trackId}>
                    <td>
                      <b>{t.trackId}</b>{' '}
                      <button type="button" className="btn tiny ghost" onClick={() => onJump(first)}>
                        看
                      </button>
                    </td>
                    <td className="small">
                      {sec(first)}～{sec(last)}s（{obs.length} 次）
                    </td>
                    <td>
                      {t.team === 'unknown' ? '不明' : `${TEAM_LABEL[t.team]}（${Math.round(t.teamConfidence * 100)}%）`}
                    </td>
                    <td className={unsure / t.points.length > 0.3 ? 'part' : ''}>{Math.round((unsure / t.points.length) * 100)}%</td>
                    <td>
                      <select
                        value={analysis.assignments[t.trackId] ?? ''}
                        aria-label={`${t.trackId} 指派給`}
                        onChange={(e) => {
                          const v = e.target.value;
                          const next = { ...analysis.assignments };
                          if (v) next[t.trackId] = v;
                          else delete next[t.trackId];
                          onPatch({ assignments: next });
                        }}
                      >
                        <option value="">未指派</option>
                        {players
                          .filter((p) => t.team === 'unknown' || p.teamId === t.team)
                          .concat(players.filter((p) => t.team !== 'unknown' && p.teamId !== t.team))
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {TEAM_LABEL[p.teamId]} {p.jerseyNumber} 號
                            </option>
                          ))}
                        <option value="ignore">非球員（裁判、觀眾）</option>
                      </select>
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`確認 ${t.trackId}`}
                        checked={analysis.reviews[t.trackId] === 'confirmed'}
                        onChange={(e) => onPatch({ reviews: { ...analysis.reviews, [t.trackId]: e.target.checked ? 'confirmed' : 'unreviewed' } })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function KeyframePanel({
  analysis,
  project,
  time,
  keyframeNow,
  hasCalibration,
  armed,
  onArm,
  onCreate,
  onPatchKeyframe,
  onDelete,
  onJump,
}: {
  analysis: VideoAnalysis;
  project: ReturnType<typeof createProject>;
  time: number;
  keyframeNow: Keyframe | undefined;
  hasCalibration: boolean;
  armed: string | null;
  onArm: (id: string | null) => void;
  onCreate: () => void;
  onPatchKeyframe: (fn: (k: Keyframe) => Keyframe) => void;
  onDelete: (id: string) => void;
  onJump: (ms: number) => void;
}) {
  const players = activePlayers(project);
  return (
    <Panel title="人工關鍵影格">
      <p className="muted small">自動追蹤不準或失敗時，在重要的時間點手動放好每位球員；兩個關鍵影格之間會自動內插。人工位置優先於自動偵測。</p>
      {!keyframeNow ? (
        <button type="button" className="btn primary wide" onClick={onCreate} data-testid="kf-create">
          ＋ 在 {sec(time)} 秒建立關鍵影格
        </button>
      ) : (
        <div className="kf-editor" data-testid="kf-editor">
          <p>
            正在編輯 <b>{sec(keyframeNow.timeMs)} 秒</b> 的關鍵影格：拖曳下方球場上的球員，
            {hasCalibration ? '或選一位球員後點影片上他腳底的位置。' : '（完成球場校正後也可以直接點影片放置）'}
          </p>
          {hasCalibration && (
            <div className="btn-row">
              {players.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`btn tiny ${armed === p.id ? 'is-on' : ''}`}
                  style={{ borderColor: TEAM_FILL[p.teamId] }}
                  onClick={() => onArm(armed === p.id ? null : p.id)}
                  data-testid={`arm-${p.id}`}
                >
                  {TEAM_LABEL[p.teamId]}
                  {p.jerseyNumber}
                  {keyframeNow.players[p.id] ? ' ✓' : ''}
                </button>
              ))}
            </div>
          )}
          <label className="field">
            <span>持球者</span>
            <select value={keyframeNow.holderId ?? ''} onChange={(e) => onPatchKeyframe((k) => ({ ...k, holderId: e.target.value || null }))} data-testid="kf-holder">
              <option value="">（無／看不清楚）</option>
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  {TEAM_LABEL[p.teamId]} {p.jerseyNumber} 號
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>這一刻的說明（會成為戰術步驟說明）</span>
            <input value={keyframeNow.note ?? ''} onChange={(e) => onPatchKeyframe((k) => ({ ...k, note: e.target.value }))} placeholder="例如：紅2 空切" />
          </label>
        </div>
      )}
      <h3>關鍵影格（{analysis.keyframes.length}）</h3>
      <ul className="kf-list" data-testid="kf-list">
        {analysis.keyframes.map((k) => (
          <li key={k.id} className={keyframeNow?.id === k.id ? 'is-on' : ''}>
            <button type="button" className="link" onClick={() => onJump(k.timeMs)}>
              {sec(k.timeMs)} 秒
            </button>
            <span className="muted small">
              {Object.keys(k.players).length} 人{k.holderId ? `・持球 ${k.holderId.startsWith('red') ? '紅' : '藍'}${k.holderId.split('-')[1]}` : ''}
              {k.note ? `・${k.note}` : ''}
            </span>
            <button type="button" className="btn tiny ghost" onClick={() => onDelete(k.id)} aria-label={`刪除 ${sec(k.timeMs)} 秒的關鍵影格`}>
              ✕
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function PlaybackPanel({
  asset,
  analysis,
  samples,
  times,
  project,
  uncertainNow,
  nowSamples,
}: {
  asset: VideoAsset;
  analysis: VideoAnalysis;
  samples: Record<string, PlayerSample[]>;
  times: number[];
  project: ReturnType<typeof createProject>;
  uncertainNow: string[];
  nowSamples: Record<string, PlayerSample>;
}) {
  const has = Object.values(samples).some((s) => s.length);
  const q = qualityReport(analysis.frames, analysis.tracks, analysis.assignments, samples, times.length);
  const toTactic = async () => {
    const p = trajectoriesToTactic({ title: `${asset.name}（影片重建）`, teamSize: analysis.teamSize, samples, keyframes: analysis.keyframes, startMs: asset.trimStartMs, endMs: asset.trimEndMs });
    await openAsNewProject(p, '');
    useStore.getState().showToast('已轉成戰術動畫，可在白板編輯或發布為教材');
    navigate('/');
  };
  const exportJson = () => {
    const payload = {
      format: 'basketball-tactics-lab/tracks',
      schemaVersion: 1,
      video: { name: asset.name, trimStartMs: asset.trimStartMs, trimEndMs: asset.trimEndMs, width: asset.width, height: asset.height },
      calibration: analysis.calibration,
      modelVersion: analysis.modelVersion,
      samples: Object.values(samples).flat(),
    };
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `軌跡-${asset.name}.json`);
  };
  return (
    <Panel title="原影片 × 虛擬球場 同步回放">
      {!has ? (
        <p className="form-error" data-testid="no-samples">還沒有任何球員軌跡。請先完成「④ 身分校正」指派軌跡，或在「⑤ 人工關鍵影格」放置球員。</p>
      ) : (
        <>
          <p className="muted small">播放或拖曳時間軸，左邊影片與右邊球場會同步；球場上的線是過去 2 秒的軌跡。</p>
          <div className="legend small">
            <span>
              <i className="lg manual" /> 人工／觀測
            </span>
            <span>
              <i className="lg unsure" /> 不確定（橘色虛線圈）
            </span>
          </div>
          {uncertainNow.length > 0 && (
            <ul className="small uncertain-list" data-testid="uncertain-list">
              {uncertainNow.map((pid) => (
                <li key={pid}>
                  {playerLabel(pid, project)}：{nowSamples[pid]!.flags.filter((f) => f !== 'interpolated').map((f) => FLAG_LABEL[f]).join('、') || `身分信心 ${Math.round(nowSamples[pid]!.identityConfidence * 100)}%`}
                </li>
              ))}
            </ul>
          )}
          <table className="attempt-table small">
            <thead>
              <tr>
                <th>球員</th>
                <th>覆蓋率</th>
                <th>軌跡段數</th>
              </tr>
            </thead>
            <tbody>
              {activePlayers(project).map((p) => (
                <tr key={p.id}>
                  <td>{playerLabel(p.id, project)}</td>
                  <td>{Math.round((q.coverage[p.id] ?? 0) * 100)}%</td>
                  <td>{q.fragments[p.id] ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">不確定樣本比例：{Math.round(q.uncertainRatio * 100)}%</p>
          <div className="btn-row">
            <button type="button" className="btn primary" onClick={() => void toTactic()} data-testid="to-tactic">
              🏀 轉成戰術動畫
            </button>
            <button type="button" className="btn" onClick={exportJson}>
              匯出軌跡 JSON
            </button>
          </div>
        </>
      )}
    </Panel>
  );
}
