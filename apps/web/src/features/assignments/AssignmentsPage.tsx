import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { Assignment, Attempt } from '@btl/shared-types';
import { parseResultFile } from '@btl/data-schemas';
import { getLesson } from '@btl/lesson-library';
import { useAllLessons } from '../lessons/useLessons';
import { CHALLENGE_TYPE_LABEL } from '@btl/tactic-engine';
import type { Route } from '../../app/router';
import { useStore } from '../../app/store';
import { friendlyError, getSupabase } from '../cloud/client';
import { isTeacherUser, useCloud } from '../cloud/cloudStore';
import { repository } from '../storage/db';
import { downloadBlob } from '../storage/persistence';
import {
  assignmentChallenges,
  attemptsToCsv,
  buildAssignment,
  cloudLink,
  createCloudAssignment,
  deleteCloudAssignment,
  listCloudAssignments,
  listCloudAttempts,
  localLink,
  saveCloudFeedback,
  shareLink,
  setCloudAssignmentOpen,
} from './api';

type Item = { a: Assignment; cloud: boolean };

function useShareLink(it: Item): string {
  const [link, setLink] = useState(() => (it.cloud ? cloudLink(it.a.code) : getLesson(it.a.lessonId) ? localLink(it.a) : ''));
  useEffect(() => {
    let alive = true;
    void shareLink(it.a, it.cloud).then((l) => alive && setLink(l));
    return () => {
      alive = false;
    };
  }, [it]);
  return link;
}

function QrCode({ text }: { text: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCode.toDataURL(text, { margin: 1, width: 360, errorCorrectionLevel: 'M' })
      .then(setSrc)
      .catch(() => setSrc(''));
  }, [text]);
  return src ? <img className="qr" src={src} alt="任務 QR Code，學生用手機掃描開啟" width={180} height={180} /> : <p className="muted small">連結太長，無法產生 QR Code，請改用複製連結。</p>;
}

function ShareBox({ it }: { it: Item }) {
  const link = useShareLink(it);
  const [copied, setCopied] = useState(false);
  return (
    <div className="share-box" data-testid="share-box">
      {link ? <QrCode text={link} /> : <p className="muted small">產生連結中…</p>}
      <div className="share-info">
        <p className="muted small">學生用手機掃描 QR Code，或開啟下方連結；也可以口頭告訴學生任務代碼。</p>
        <p className="code-big" data-testid="share-code">
          {it.a.code}
        </p>
        <input className="link-input" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="任務連結" data-testid="share-link" />
        <div className="btn-row">
          <button
            type="button"
            className="btn primary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                useStore.getState().showToast('無法自動複製，請手動選取連結', 'error');
              }
            }}
          >
            {copied ? '✓ 已複製' : '複製連結'}
          </button>
          <a className="btn" href={link} target="_blank" rel="noreferrer">
            以學生身分預覽
          </a>
        </div>
        <p className="muted small">{it.cloud ? '雲端任務：學生繳交後成績會自動出現在這裡。' : '本機任務：學生繳交後會下載結果檔，請收齊後用「匯入學生結果檔」匯入。'}</p>
      </div>
    </div>
  );
}

function CreateForm({ initialLesson, canCloud, onCreated }: { initialLesson: string; canCloud: boolean; onCreated: (it: Item) => void }) {
  const { builtIn, custom } = useAllLessons();
  const all = [...builtIn, ...custom];
  const [lessonId, setLessonId] = useState(initialLesson || builtIn[0]!.id);
  const lesson = all.find((l) => l.id === lessonId) ?? builtIn[0]!;
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [picked, setPicked] = useState<string[]>(lesson.challenges.map((c) => c.id));
  const [busy, setBusy] = useState(false);
  useEffect(() => setPicked(lesson.challenges.map((c) => c.id)), [lesson]);

  const publish = async () => {
    setBusy(true);
    try {
      const draft = buildAssignment(lesson, { title: title || lesson.title, message, challengeIds: lesson.challenges.map((c) => c.id).filter((id) => picked.includes(id)) });
      if (canCloud) {
        const sb = getSupabase()!;
        onCreated({ a: await createCloudAssignment(sb, draft), cloud: true });
      } else {
        await repository.putLocalAssignment(draft);
        onCreated({ a: draft, cloud: false });
      }
      setTitle('');
      setMessage('');
      useStore.getState().showToast('任務已發布');
    } catch (err) {
      useStore.getState().showToast(`發布失敗：${friendlyError(err)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel-section" data-testid="create-assignment">
      <h2>發布新任務</h2>
      <label className="field">
        <span>教材</span>
        <select value={lessonId} onChange={(e) => setLessonId(e.target.value)} data-testid="asg-lesson">
          <optgroup label="內建教材">
            {builtIn.map((l, i) => (
              <option key={l.id} value={l.id}>
                {i + 1}. {l.title}（{l.en}）
              </option>
            ))}
          </optgroup>
          {custom.length > 0 && (
            <optgroup label="我的教材（由影片轉換）">
              {custom.map((l) => (
                <option key={l.id} value={l.id}>
                  🎥 {l.title}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      <label className="field">
        <span>任務名稱</span>
        <input value={title} placeholder={`例如：801 ${lesson.title}練習`} onChange={(e) => setTitle(e.target.value)} maxLength={120} data-testid="asg-title" />
      </label>
      <label className="field">
        <span>給學生的話（選填）</span>
        <textarea rows={2} value={message} placeholder="例如：先看完動畫，再做三題，下課前繳交" onChange={(e) => setMessage(e.target.value)} maxLength={1000} />
      </label>
      <fieldset className="field">
        <span>包含的題目</span>
        {lesson.challenges.map((c, i) => (
          <label key={c.id} className="check">
            <input type="checkbox" checked={picked.includes(c.id)} onChange={() => setPicked((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))} />
            {i + 1}. {CHALLENGE_TYPE_LABEL[c.type]}：{c.title}
          </label>
        ))}
      </fieldset>
      <p className="muted small">
        {canCloud ? '☁ 已登入雲端：學生作答會自動回傳。' : '📁 未登入雲端：會產生本機連結，學生繳交時下載結果檔交給老師。登入雲端後可自動收作業。'}
      </p>
      <button type="button" className="btn primary wide" onClick={() => void publish()} disabled={busy} data-testid="asg-publish">
        {busy ? '發布中…' : '📤 發布並產生連結'}
      </button>
    </section>
  );
}

function ResultsPanel({ it, onClose }: { it: Item; onClose: () => void }) {
  const [list, setList] = useState<Attempt[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const challenges = assignmentChallenges(it.a);

  const load = async () => {
    try {
      if (it.cloud) setList(await listCloudAttempts(getSupabase()!, it.a));
      else setList((await repository.listAttempts()).filter((x) => x.assignmentCode === it.a.code && x.lessonId === it.a.lessonId));
    } catch (err) {
      useStore.getState().showToast(friendlyError(err), 'error');
      setList([]);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [it.a.id]);

  const saveFeedback = async (t: Attempt) => {
    const text = (drafts[t.id] ?? t.teacherFeedback).trim();
    try {
      if (it.cloud) await saveCloudFeedback(getSupabase()!, t.id, text);
      else await repository.putAttempt({ ...t, teacherFeedback: text, feedbackAt: new Date().toISOString() });
      useStore.getState().showToast(`已儲存給 ${t.student.name} 的回饋`);
      await load();
    } catch (err) {
      useStore.getState().showToast(friendlyError(err), 'error');
    }
  };

  const importFiles = async (files: FileList) => {
    let count = 0;
    const errors: string[] = [];
    for (const f of Array.from(files)) {
      const r = parseResultFile(await f.text());
      if (!r.ok) {
        errors.push(`${f.name}：${r.errors[0]}`);
        continue;
      }
      for (const att of r.value) {
        if (att.assignmentCode !== it.a.code || att.lessonId !== it.a.lessonId) {
          errors.push(`${f.name}：不是這個任務的結果檔`);
          continue;
        }
        await repository.putAttempt({ ...att, source: 'local' });
        count++;
      }
    }
    useStore.getState().showToast(errors.length ? `匯入 ${count} 份；${errors.join('；')}` : `已匯入 ${count} 份作答`, errors.length ? 'error' : 'info');
    await load();
  };

  const avg = list && list.length ? Math.round((list.reduce((s, x) => s + x.score, 0) / list.length) * 10) / 10 : 0;

  return (
    <section className="panel-section results" data-testid="results-panel">
      <header className="row-between">
        <h2>
          作答紀錄：{it.a.title} <small className="muted">（{it.a.code}）</small>
        </h2>
        <button type="button" className="btn ghost small" onClick={onClose}>
          關閉
        </button>
      </header>
      <div className="btn-row">
        <button type="button" className="btn small" onClick={() => void load()}>
          ↻ 重新整理
        </button>
        {!it.cloud && (
          <>
            <button type="button" className="btn small" onClick={() => fileRef.current?.click()} data-testid="import-results">
              匯入學生結果檔
            </button>
            <input ref={fileRef} type="file" accept=".json,application/json" multiple hidden data-testid="import-results-file" onChange={(e) => e.target.files && void importFiles(e.target.files).then(() => (e.target.value = ''))} />
          </>
        )}
        <button
          type="button"
          className="btn small"
          disabled={!list?.length}
          onClick={() => list && downloadBlob(new Blob([attemptsToCsv(list, it.a)], { type: 'text/csv;charset=utf-8' }), `成績-${it.a.title}-${it.a.code}.csv`)}
        >
          匯出成績 CSV
        </button>
      </div>
      {list === null ? (
        <p className="muted">讀取中…</p>
      ) : list.length === 0 ? (
        <p className="muted">還沒有學生繳交。</p>
      ) : (
        <>
          <p className="muted small">
            共 {list.length} 份，平均 {avg} 分
          </p>
          <div className="table-wrap">
            <table className="attempt-table" data-testid="attempt-table">
              <thead>
                <tr>
                  <th>班級</th>
                  <th>座號</th>
                  <th>姓名</th>
                  <th>總分</th>
                  {challenges.map((c, i) => (
                    <th key={c.id} title={c.title}>
                      {i + 1}. {CHALLENGE_TYPE_LABEL[c.type]}
                    </th>
                  ))}
                  <th>繳交時間</th>
                  <th>教師回饋</th>
                </tr>
              </thead>
              <tbody>
                {list.map((t) => (
                  <tr key={t.id}>
                    <td>{t.student.className}</td>
                    <td>{t.student.seatNo}</td>
                    <td>
                      <button type="button" className="link" onClick={() => setOpen(open === t.id ? null : t.id)}>
                        {t.student.name}
                      </button>
                    </td>
                    <td>
                      <b>{t.score}</b>/{t.maxScore}
                    </td>
                    {challenges.map((c) => {
                      const r = t.results.find((x) => x.challengeId === c.id);
                      return (
                        <td key={c.id} className={r ? (r.correct ? 'ok' : r.ratio > 0 ? 'part' : 'miss') : ''} title={r ? `作答 ${r.tries} 次` : '未作答'}>
                          {r ? `${r.score}` : '—'}
                        </td>
                      );
                    })}
                    <td className="small">{new Date(t.submittedAt).toLocaleString('zh-TW', { hour12: false })}</td>
                    <td className="fb">
                      <textarea
                        rows={2}
                        value={drafts[t.id] ?? t.teacherFeedback}
                        placeholder="給這位同學的回饋"
                        aria-label={`給 ${t.student.name} 的回饋`}
                        onChange={(e) => setDrafts((d) => ({ ...d, [t.id]: e.target.value }))}
                      />
                      <button type="button" className="btn tiny" onClick={() => void saveFeedback(t)} disabled={(drafts[t.id] ?? t.teacherFeedback) === t.teacherFeedback}>
                        儲存
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {open && (() => {
            const t = list.find((x) => x.id === open);
            if (!t) return null;
            return (
              <div className="attempt-detail">
                <h3>{t.student.name} 的作答</h3>
                <ul>
                  {challenges.map((c, i) => {
                    const r = t.results.find((x) => x.challengeId === c.id);
                    let ans = '未作答';
                    if (r?.answer.type === 'choice') ans = `選了：${r.answer.selected.map((s) => c.type === 'choice' ? c.options.find((o) => o.id === s)?.text ?? s : s).join('、') || '（無）'}`;
                    if (r?.answer.type === 'predict') ans = `拖到 (${r.answer.position.x.toFixed(1)}, ${r.answer.position.y.toFixed(1)}) 公尺`;
                    if (r?.answer.type === 'placement') ans = `站位：${Object.values(r.details).filter(Boolean).length}/${Object.keys(r.details).length} 人正確`;
                    return (
                      <li key={c.id}>
                        {i + 1}. {c.title}：{r ? `${r.score}/${r.maxScore} 分（${r.tries} 次）` : ''} {ans}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })()}
          {!it.cloud && <p className="muted small">本機任務的回饋只存在這台電腦；要讓學生看到回饋，請改用雲端任務。</p>}
        </>
      )}
    </section>
  );
}

/** 教師：發布任務、分享連結／QR、查看學生紀錄、寫回饋 */
export function AssignmentsPage({ route }: { route: Route }) {
  const user = useCloud((s) => s.user);
  const configured = useCloud((s) => s.configured);
  const canCloud = isTeacherUser(user) && !!getSupabase();
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Item | null>(null);
  const [results, setResults] = useState<Item | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const load = async () => {
    const out: Item[] = [];
    if (canCloud) {
      try {
        out.push(...(await listCloudAssignments(getSupabase()!)).map((a) => ({ a, cloud: true })));
      } catch (err) {
        useStore.getState().showToast(friendlyError(err), 'error');
      }
    }
    out.push(...(await repository.listLocalAssignments()).map((a) => ({ a, cloud: false })));
    setItems(out);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCloud]);

  const lessonParam = route.query.get('lesson') ?? '';
  const sorted = useMemo(() => [...items].sort((x, y) => y.a.createdAt.localeCompare(x.a.createdAt)), [items]);

  return (
    <div className="page teach-page">
      <header className="page-head">
        <h1>學生任務</h1>
        <p className="muted">選教材 → 發布 → 學生掃 QR Code 作答 → 在這裡看成績、寫回饋。學生只能觀看與作答，無法修改教材。</p>
        {!configured && <p className="muted small">目前為「本機模式」。若要自動收作業與給學生回饋，請在右上角「☁ 雲端」完成設定並登入。</p>}
        {configured && !canCloud && (
          <p className="small">
            <button type="button" className="link" onClick={() => useCloud.getState().set({ dialogOpen: true })}>
              ☁ 登入教師帳號
            </button>
            後，發布的任務會自動收集學生作答。
          </p>
        )}
      </header>
      <div className="teach-grid">
        <CreateForm
          initialLesson={lessonParam}
          canCloud={canCloud}
          onCreated={(it) => {
            setItems((x) => [it, ...x]);
            setSelected(it);
            setResults(null);
          }}
        />
        <div>
          {selected && (
            <section className="panel-section">
              <header className="row-between">
                <h2>分享任務：{selected.a.title}</h2>
                <button type="button" className="btn ghost small" onClick={() => setSelected(null)}>
                  關閉
                </button>
              </header>
              <ShareBox it={selected} />
            </section>
          )}
          {results && <ResultsPanel it={results} onClose={() => setResults(null)} />}
          <section className="panel-section">
            <h2>已發布的任務</h2>
            {sorted.length === 0 ? (
              <p className="muted">還沒有任務。</p>
            ) : (
              <ul className="assignment-list" data-testid="assignment-list">
                {sorted.map((it) => (
                  <li key={it.a.id}>
                    <div>
                      <strong>{it.a.title}</strong>
                      <span className="muted small">
                        {' '}
                        {it.cloud ? '☁ 雲端' : '📁 本機'}・代碼 {it.a.code}・{it.a.lesson.title}・{it.a.challengeIds.length} 題・{new Date(it.a.createdAt).toLocaleDateString('zh-TW')}
                      </span>
                      {it.cloud && !it.a.open && <span className="badge closed">已關閉</span>}
                    </div>
                    <div className="btn-row">
                      <button type="button" className="btn tiny" onClick={() => { setSelected(it); setResults(null); }}>
                        連結／QR
                      </button>
                      <button type="button" className="btn tiny primary" onClick={() => setResults(it)} data-testid="view-results">
                        作答紀錄
                      </button>
                      {it.cloud && (
                        <button
                          type="button"
                          className="btn tiny ghost"
                          onClick={async () => {
                            try {
                              await setCloudAssignmentOpen(getSupabase()!, it.a.id, !it.a.open);
                              await load();
                            } catch (err) {
                              useStore.getState().showToast(friendlyError(err), 'error');
                            }
                          }}
                        >
                          {it.a.open ? '關閉繳交' : '重新開放'}
                        </button>
                      )}
                      <button
                        type="button"
                        className={`btn tiny ${confirmDel === it.a.id ? 'danger' : 'ghost'}`}
                        onClick={async () => {
                          if (confirmDel !== it.a.id) {
                            setConfirmDel(it.a.id);
                            return;
                          }
                          try {
                            if (it.cloud) await deleteCloudAssignment(getSupabase()!, it.a.id);
                            else await repository.deleteLocalAssignment(it.a.id);
                            setConfirmDel(null);
                            if (selected?.a.id === it.a.id) setSelected(null);
                            if (results?.a.id === it.a.id) setResults(null);
                            await load();
                          } catch (err) {
                            useStore.getState().showToast(friendlyError(err), 'error');
                          }
                        }}
                      >
                        {confirmDel === it.a.id ? (it.cloud ? '確認刪除（含作答）' : '確認刪除') : '刪除'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
