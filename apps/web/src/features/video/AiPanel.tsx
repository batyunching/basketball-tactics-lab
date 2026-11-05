import { useEffect, useMemo, useState } from 'react';
import type { PlayerDef } from '@btl/shared-types';
import {
  CONFIDENCE_LABEL,
  EVENT_LABEL,
  analyzeTactics,
  buildLessonFromEvents,
  evaluateReview,
  fmtSec,
  type AiState,
  type EventStatus,
  type PossessionMark,
  type ShotMark,
  type TacticalEvent,
  type TacticalEventType,
} from '@btl/tactic-ai';
import type { PlayerSample, VideoAnalysis, VideoAsset } from '@btl/video-engine';
import { navigate } from '../../app/router';
import { useStore } from '../../app/store';
import { TEAM_FILL, TEAM_LABEL } from '../players/PlayerToken';
import { repository } from '../storage/db';

const EMPTY: AiState = { possession: [], shots: [], report: null };
const uid = (p: string) => `${p}-${crypto.randomUUID().slice(0, 8)}`;

interface Props {
  asset: VideoAsset;
  analysis: VideoAnalysis;
  samples: Record<string, PlayerSample[]>;
  players: PlayerDef[];
  time: number;
  onJump: (ms: number) => void;
}

function pname(players: PlayerDef[], id: string | null | undefined) {
  if (!id) return '（無人持球）';
  const d = players.find((p) => p.id === id);
  return d ? `${TEAM_LABEL[d.teamId]}${d.jerseyNumber}` : id;
}

/** ⑦ AI 戰術分析：教師確認球權與得分 → 規則式分析 → 教師審核編輯 → 轉成學生教材 */
export function AiPanel({ asset, analysis, samples, players, time, onJump }: Props) {
  const [state, setState] = useState<AiState | null>(null);
  const [holderPick, setHolderPick] = useState<string>(players[0]?.id ?? '');
  const [shooterPick, setShooterPick] = useState<string>(players[0]?.id ?? '');
  const [made, setMade] = useState(true);
  const [filter, setFilter] = useState<'all' | EventStatus>('all');
  const [editing, setEditing] = useState<string | null>(null);
  const [lessonTitle, setLessonTitle] = useState(`${asset.name}：比賽戰術分析`);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    void repository.getAiState(asset.id).then((s) => setState(s ? { possession: s.possession, shots: s.shots, report: s.report } : EMPTY));
  }, [asset.id]);
  useEffect(() => {
    if (!state) return;
    const t = setTimeout(() => void repository.saveAiState(asset.id, state), 400);
    return () => clearTimeout(t);
  }, [state, asset.id]);

  const events = state?.report?.events ?? [];
  const quality = useMemo(() => evaluateReview(events), [events]);
  if (!state) return <p className="muted">讀取中…</p>;

  const patch = (p: Partial<AiState>) => setState((s) => (s ? { ...s, ...p } : s));
  const setEvents = (fn: (e: TacticalEvent[]) => TacticalEvent[]) => setState((s) => (s && s.report ? { ...s, report: { ...s.report, events: fn(s.report.events) } } : s));
  const setEvent = (id: string, p: Partial<TacticalEvent>) => setEvents((list) => list.map((e) => (e.id === id ? { ...e, ...p } : e)));

  const addPossession = () => patch({ possession: [...state.possession, { id: uid('pos'), timeMs: time, holderId: holderPick || null, confirmed: true }].sort((a, b) => a.timeMs - b.timeMs) });
  const addShot = () => patch({ shots: [...state.shots, { id: uid('shot'), timeMs: time, shooterId: shooterPick, made, confirmed: true }].sort((a, b) => a.timeMs - b.timeMs) });
  const importFromKeyframes = () => {
    const marks: PossessionMark[] = analysis.keyframes
      .filter((k) => k.holderId !== undefined)
      .map((k) => ({ id: uid('pos'), timeMs: k.timeMs, holderId: k.holderId ?? null, confirmed: false }));
    const existing = new Set(state.possession.map((p) => p.timeMs));
    patch({ possession: [...state.possession, ...marks.filter((m) => !existing.has(m.timeMs))].sort((a, b) => a.timeMs - b.timeMs) });
    useStore.getState().showToast(`從關鍵影格加入 ${marks.length} 個球權標記（請逐一確認）`);
  };

  const run = () => {
    const report = analyzeTactics({ players, samples, possession: state.possession, shots: state.shots, startMs: asset.trimStartMs, endMs: asset.trimEndMs });
    // 保留教師已審核過的事件（以類型＋時間對應），避免重跑時覆蓋
    const reviewed = (state.report?.events ?? []).filter((e) => e.status !== 'suggested' || e.manual);
    const merged = report.events.map((e) => {
      const old = reviewed.find((r) => !r.manual && r.type === e.type && Math.abs(r.keyMs - e.keyMs) < 600 && r.players[0]?.id === e.players[0]?.id);
      return old ? { ...e, status: old.status, edited: old.edited, ...(old.edited ? { inference: old.inference, suggestion: old.suggestion, evidence: old.evidence } : {}) } : e;
    });
    patch({ report: { ...report, events: [...merged, ...reviewed.filter((r) => r.manual)].sort((a, b) => a.keyMs - b.keyMs) } });
    useStore.getState().showToast(`分析完成：${report.events.length} 個事件`);
  };

  const toLesson = async () => {
    if (!state.report) return;
    try {
      const id = `video-${crypto.randomUUID().slice(0, 12)}`;
      const lesson = buildLessonFromEvents({
        id,
        title: lessonTitle.trim() || asset.name,
        summary: state.report.scoringKeys[0]?.summary ?? '',
        teamSize: analysis.teamSize,
        samples,
        events: state.report.events,
        possession: state.possession,
        scoringKeys: state.report.scoringKeys,
        startMs: asset.trimStartMs,
        endMs: asset.trimEndMs,
      });
      await repository.saveCustomLesson(lesson, asset.id);
      useStore.getState().showToast(`已建立教材「${lesson.title}」（${lesson.challenges.length} 題）`);
      navigate(`/lessons/${id}`);
    } catch (e) {
      useStore.getState().showToast((e as Error).message, 'error');
    }
  };

  const shown = events.filter((e) => filter === 'all' || e.status === filter);
  const confirmedCount = events.filter((e) => e.status === 'confirmed' && e.confidence !== 'insufficient').length;
  const hasSamples = Object.values(samples).some((s) => s.length);

  return (
    <>
      <section className="panel-section">
        <h2>1. 教師確認球權與得分</h2>
        <p className="muted small">系統不追蹤球，也不會自己判斷進球。請暫停在球換手、出手的畫面，標記「誰持球」與「出手結果」。AI 只依據你確認過的球權與得分分析。</p>
        <div className="mark-row">
          <span className="muted small">目前 {fmtSec(time)}</span>
          <select value={holderPick} onChange={(e) => setHolderPick(e.target.value)} aria-label="持球者" data-testid="ai-holder">
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {pname(players, p.id)}
              </option>
            ))}
            <option value="">無人持球</option>
          </select>
          <button type="button" className="btn small" onClick={addPossession} data-testid="ai-add-possession">
            ＋ 標記持球
          </button>
        </div>
        <div className="mark-row">
          <select value={shooterPick} onChange={(e) => setShooterPick(e.target.value)} aria-label="出手者" data-testid="ai-shooter">
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {pname(players, p.id)}
              </option>
            ))}
          </select>
          <label className="check">
            <input type="checkbox" checked={made} onChange={(e) => setMade(e.target.checked)} data-testid="ai-made" /> 進球
          </label>
          <button type="button" className="btn small" onClick={addShot} data-testid="ai-add-shot">
            ＋ 標記出手
          </button>
          {analysis.keyframes.some((k) => k.holderId !== undefined) && (
            <button type="button" className="btn small ghost" onClick={importFromKeyframes}>
              從關鍵影格匯入持球者
            </button>
          )}
        </div>
        <ul className="kf-list" data-testid="ai-marks">
          {[...state.possession.map((m) => ({ kind: 'pos' as const, m })), ...state.shots.map((m) => ({ kind: 'shot' as const, m }))]
            .sort((a, b) => a.m.timeMs - b.m.timeMs)
            .map(({ kind, m }) => (
              <li key={m.id}>
                <button type="button" className="link" onClick={() => onJump(m.timeMs)}>
                  {fmtSec(m.timeMs)}
                </button>
                <span className="small" style={{ flex: 1 }}>
                  {kind === 'pos' ? `🏀 ${pname(players, (m as PossessionMark).holderId)} 持球` : `🎯 ${pname(players, (m as ShotMark).shooterId)} 出手・${(m as ShotMark).made ? '進球' : '未進'}`}
                </span>
                <label className="check small">
                  <input
                    type="checkbox"
                    checked={m.confirmed}
                    aria-label="教師確認"
                    onChange={(e) =>
                      kind === 'pos'
                        ? patch({ possession: state.possession.map((x) => (x.id === m.id ? { ...x, confirmed: e.target.checked } : x)) })
                        : patch({ shots: state.shots.map((x) => (x.id === m.id ? { ...x, confirmed: e.target.checked } : x)) })
                    }
                  />
                  確認
                </label>
                <button
                  type="button"
                  className="btn tiny ghost"
                  aria-label="刪除標記"
                  onClick={() => (kind === 'pos' ? patch({ possession: state.possession.filter((x) => x.id !== m.id) }) : patch({ shots: state.shots.filter((x) => x.id !== m.id) }))}
                >
                  ✕
                </button>
              </li>
            ))}
        </ul>
        <button type="button" className="btn primary wide" onClick={run} disabled={!hasSamples} data-testid="ai-run">
          🤖 {state.report ? '重新分析（保留已審核結果）' : '執行 AI 戰術分析'}
        </button>
        {!hasSamples && <p className="form-error small">還沒有球員軌跡：請先完成 ④ 身分校正或 ⑤ 人工關鍵影格。</p>}
      </section>

      {state.report && (
        <>
          {state.report.notes.length > 0 && (
            <section className="panel-section notes" data-testid="ai-notes">
              {state.report.notes.map((n) => (
                <p key={n} className="small">
                  ⚠ {n}
                </p>
              ))}
            </section>
          )}
          {state.report.scoringKeys.map((k) => (
            <section key={k.shotId} className="panel-section scoring-key" data-testid="ai-scoring-key">
              <h2>
                🏆 得分關鍵（{fmtSec(k.timeMs)} {pname(players, k.shooterId)}）
              </h2>
              <p>{k.summary}</p>
            </section>
          ))}
          <section className="panel-section">
            <header className="row-between">
              <h2>2. 審核 AI 分析（{events.length}）</h2>
              <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="篩選">
                <option value="all">全部</option>
                <option value="suggested">待審核</option>
                <option value="confirmed">已確認</option>
                <option value="rejected">已否決</option>
              </select>
            </header>
            <p className="muted small">每個事件分為「可見證據」「戰術推論」「教學建議」。請對照影片確認或否決，也可以修改文字；只有確認的事件會進入學生教材。</p>
            <ul className="ai-events" data-testid="ai-events">
              {shown.map((e) => (
                <EventCard key={e.id} e={e} players={players} editing={editing === e.id} onEdit={() => setEditing(editing === e.id ? null : e.id)} onPatch={(p) => setEvent(e.id, p)} onJump={onJump} onDelete={() => setEvents((l) => l.filter((x) => x.id !== e.id))} />
              ))}
            </ul>
            {adding ? (
              <ManualEventForm
                players={players}
                time={time}
                onCancel={() => setAdding(false)}
                onAdd={(ev) => {
                  setEvents((l) => [...l, ev].sort((a, b) => a.keyMs - b.keyMs));
                  setAdding(false);
                }}
              />
            ) : (
              <button type="button" className="btn small" onClick={() => setAdding(true)} data-testid="ai-add-manual">
                ＋ 新增 AI 漏掉的事件
              </button>
            )}
          </section>

          <section className="panel-section" data-testid="ai-quality">
            <h2>3. 品質評估（以你的審核為準）</h2>
            <p className="small">
              已審核 {quality.reviewed}・待審核 {quality.pending}・證據不足 {quality.insufficient}
            </p>
            <table className="attempt-table small">
              <thead>
                <tr>
                  <th>事件</th>
                  <th>正確</th>
                  <th>誤報</th>
                  <th>漏抓</th>
                  <th>精確率</th>
                  <th>召回率</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(quality.byType).map(([t, s]) => (
                  <tr key={t}>
                    <td>{EVENT_LABEL[t as TacticalEventType]}</td>
                    <td>{s.truePositive}</td>
                    <td>{s.falsePositive}</td>
                    <td>{s.falseNegative}</td>
                    <td>{s.precision === null ? '—' : `${Math.round(s.precision * 100)}%`}</td>
                    <td>{s.recall === null ? '—' : `${Math.round(s.recall * 100)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">精確率＝AI 建議中被你確認的比例；召回率＝實際發生的事件中 AI 抓到的比例（你手動新增的視為漏抓）。</p>
          </section>

          <section className="panel-section">
            <h2>4. 轉換為學生互動教材</h2>
            <label className="field">
              <span>教材名稱</span>
              <input value={lessonTitle} onChange={(e) => setLessonTitle(e.target.value)} maxLength={100} data-testid="ai-lesson-title" />
            </label>
            <p className="muted small">會用已確認事件的時間點建立戰術動畫步驟，並自動出題（跑位預測、站位、傳球選擇、協防選擇、得分關鍵）。教材不含影片與追蹤原始資料。</p>
            <button type="button" className="btn primary wide" disabled={confirmedCount === 0} onClick={() => void toLesson()} data-testid="ai-to-lesson">
              📚 轉成互動教材（{confirmedCount} 個已確認事件）
            </button>
          </section>
        </>
      )}
    </>
  );
}

function EventCard({
  e,
  players,
  editing,
  onEdit,
  onPatch,
  onJump,
  onDelete,
}: {
  e: TacticalEvent;
  players: PlayerDef[];
  editing: boolean;
  onEdit: () => void;
  onPatch: (p: Partial<TacticalEvent>) => void;
  onJump: (ms: number) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState({ evidence: e.evidence.join('\n'), inference: e.inference, suggestion: e.suggestion });
  useEffect(() => setDraft({ evidence: e.evidence.join('\n'), inference: e.inference, suggestion: e.suggestion }), [e.evidence, e.inference, e.suggestion]);
  return (
    <li className={`ai-event conf-${e.confidence} st-${e.status}`} data-testid={`ai-event-${e.type}`} data-status={e.status}>
      <header>
        <span className={`type-badge ev-${e.type}`}>{EVENT_LABEL[e.type]}</span>
        <button type="button" className="link" onClick={() => onJump(e.startMs)}>
          ⏱ {fmtSec(e.startMs)}{e.endMs > e.startMs ? `～${fmtSec(e.endMs)}` : ''}
        </button>
        <span className={`conf conf-${e.confidence}`}>信心：{CONFIDENCE_LABEL[e.confidence]}</span>
        {e.manual && <span className="badge">教師新增</span>}
        {e.edited && <span className="badge">已修改</span>}
        <span className="st">{e.status === 'confirmed' ? '✅ 已確認' : e.status === 'rejected' ? '❌ 已否決' : '待審核'}</span>
      </header>
      <p className="players">
        {e.players.map((p) => {
          const d = players.find((x) => x.id === p.id);
          return (
            <span key={p.id + p.role} className="chip" style={{ background: d ? TEAM_FILL[d.teamId] : '#888' }}>
              {pname(players, p.id)}・{p.role}
            </span>
          );
        })}
      </p>
      {editing ? (
        <div className="ai-edit">
          <label className="field">
            <span>可見證據（每行一項）</span>
            <textarea rows={4} value={draft.evidence} onChange={(x) => setDraft({ ...draft, evidence: x.target.value })} />
          </label>
          <label className="field">
            <span>戰術推論</span>
            <textarea rows={3} value={draft.inference} onChange={(x) => setDraft({ ...draft, inference: x.target.value })} data-testid="ai-edit-inference" />
          </label>
          <label className="field">
            <span>教學建議</span>
            <textarea rows={3} value={draft.suggestion} onChange={(x) => setDraft({ ...draft, suggestion: x.target.value })} />
          </label>
          <div className="btn-row">
            <button
              type="button"
              className="btn small primary"
              data-testid="ai-edit-save"
              onClick={() => {
                onPatch({
                  evidence: draft.evidence.split('\n').map((s) => s.trim()).filter(Boolean),
                  inference: draft.inference.trim(),
                  suggestion: draft.suggestion.trim(),
                  edited: true,
                  ...(e.confidence === 'insufficient' ? {} : {}),
                });
                onEdit();
              }}
            >
              儲存修改
            </button>
            <button type="button" className="btn small ghost" onClick={onEdit}>
              取消
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="ai-sec">
            <b>可見證據</b>
            <ul>
              {e.evidence.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </div>
          {e.insufficientReason && <p className="insufficient">⚠ {e.insufficientReason}</p>}
          <div className="ai-sec">
            <b>戰術推論</b>
            <p>{e.inference}</p>
          </div>
          <div className="ai-sec">
            <b>教學建議</b>
            <p>{e.suggestion}</p>
          </div>
        </>
      )}
      <div className="btn-row">
        <button
          type="button"
          className={`btn tiny ${e.status === 'confirmed' ? 'is-on' : ''}`}
          disabled={e.confidence === 'insufficient' && !e.edited}
          title={e.confidence === 'insufficient' && !e.edited ? '證據不足的事件需先修改內容才能確認' : ''}
          onClick={() => onPatch({ status: e.status === 'confirmed' ? 'suggested' : 'confirmed', ...(e.confidence === 'insufficient' && e.edited ? { confidence: 'low' } : {}) })}
          data-testid="ai-confirm"
        >
          ✅ 確認
        </button>
        <button type="button" className={`btn tiny ${e.status === 'rejected' ? 'danger' : ''}`} onClick={() => onPatch({ status: e.status === 'rejected' ? 'suggested' : 'rejected' })} data-testid="ai-reject">
          ❌ 否決
        </button>
        <button type="button" className="btn tiny ghost" onClick={onEdit} data-testid="ai-edit">
          ✎ 修改
        </button>
        {e.manual && (
          <button type="button" className="btn tiny ghost" onClick={onDelete}>
            刪除
          </button>
        )}
      </div>
    </li>
  );
}

function ManualEventForm({ players, time, onAdd, onCancel }: { players: PlayerDef[]; time: number; onAdd: (e: TacticalEvent) => void; onCancel: () => void }) {
  const [type, setType] = useState<TacticalEventType>('cut');
  const [player, setPlayer] = useState(players[0]?.id ?? '');
  const [inference, setInference] = useState('');
  const [suggestion, setSuggestion] = useState('');
  return (
    <div className="ai-edit" data-testid="ai-manual-form">
      <h3>新增事件（{fmtSec(time)}）</h3>
      <div className="grid3">
        <label className="field">
          <span>類型</span>
          <select value={type} onChange={(e) => setType(e.target.value as TacticalEventType)}>
            {(['pass', 'cut', 'screen', 'drive', 'help'] as const).map((t) => (
              <option key={t} value={t}>
                {EVENT_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>主要球員</span>
          <select value={player} onChange={(e) => setPlayer(e.target.value)}>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {pname(players, p.id)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>戰術推論</span>
        <textarea rows={2} value={inference} onChange={(e) => setInference(e.target.value)} placeholder="例如：紅3 替紅1 做掩護" data-testid="ai-manual-inference" />
      </label>
      <label className="field">
        <span>教學建議</span>
        <textarea rows={2} value={suggestion} onChange={(e) => setSuggestion(e.target.value)} />
      </label>
      <div className="btn-row">
        <button
          type="button"
          className="btn small primary"
          disabled={!inference.trim()}
          data-testid="ai-manual-save"
          onClick={() =>
            onAdd({
              id: uid('manual'),
              type,
              startMs: time,
              endMs: time,
              keyMs: time,
              team: players.find((p) => p.id === player)?.teamId ?? null,
              players: [{ id: player, role: '主要球員' }],
              evidence: [`教師於影片 ${fmtSec(time)} 標記。`],
              inference: inference.trim(),
              suggestion: suggestion.trim() || '（教師補充）',
              confidence: 'high',
              score: 1,
              status: 'confirmed',
              edited: true,
              manual: true,
            })
          }
        >
          新增並確認
        </button>
        <button type="button" className="btn small ghost" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}
