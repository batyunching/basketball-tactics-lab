import { useEffect, useMemo, useState } from 'react';
import type { Assignment, Attempt, ChallengeResult, StudentIdentity } from '@btl/shared-types';
import { studentIdentitySchema } from '@btl/data-schemas';
import { CHALLENGE_TYPE_LABEL, totalScore } from '@btl/tactic-engine';
import type { Route } from '../../app/router';
import { ChallengeRunner } from '../challenges/ChallengeRunner';
import { friendlyError, getSupabase } from '../cloud/client';
import { LessonViewer } from '../lessons/LessonViewer';
import { assignmentChallenges, assignmentFromLink, fetchAssignmentByCode, listMyCloudAttempts, newId, submitCloudAttempt } from '../assignments/api';
import { repository } from '../storage/db';
import { downloadBlob } from '../storage/persistence';

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; a: Assignment; cloud: boolean };

const ID_KEY = 'btl.student';

function readJson<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function writeJson(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* 無痕模式 */
  }
}

function IdentityForm({ initial, onSave }: { initial: StudentIdentity | null; onSave: (s: StudentIdentity) => void }) {
  const [v, setV] = useState<StudentIdentity>(initial ?? { className: '', seatNo: '', name: '' });
  const [err, setErr] = useState('');
  return (
    <form
      className="identity"
      onSubmit={(e) => {
        e.preventDefault();
        const r = studentIdentitySchema.safeParse(v);
        if (!r.success) {
          setErr('請填寫班級、座號和姓名');
          return;
        }
        onSave(r.data);
      }}
    >
      <h2>先寫上你的資料</h2>
      <div className="grid3">
        <label className="field">
          <span>班級</span>
          <input value={v.className} onChange={(e) => setV({ ...v, className: e.target.value })} placeholder="801" inputMode="numeric" data-testid="stu-class" />
        </label>
        <label className="field">
          <span>座號</span>
          <input value={v.seatNo} onChange={(e) => setV({ ...v, seatNo: e.target.value })} placeholder="12" inputMode="numeric" data-testid="stu-seat" />
        </label>
        <label className="field">
          <span>姓名</span>
          <input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="王小明" data-testid="stu-name" />
        </label>
      </div>
      {err && <p className="form-error">{err}</p>}
      <button type="submit" className="btn primary wide" data-testid="stu-start">
        開始
      </button>
    </form>
  );
}

/** 學生端：只能觀看教材與作答，沒有任何編輯教材的功能 */
export function StudentPage({ route }: { route: Route }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [student, setStudent] = useState<StudentIdentity | null>(() => readJson<StudentIdentity>(ID_KEY));
  const [editingId, setEditingId] = useState(false);
  const [tab, setTab] = useState<'learn' | number | 'submit'>('learn');
  const [results, setResults] = useState<Record<string, ChallengeResult>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<Attempt | null>(null);
  const [mine, setMine] = useState<Attempt[]>([]);
  const [error, setError] = useState('');

  const kind = route.segments[0];
  const key = route.segments[1] ?? '';

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (kind === 's') {
          const sb = getSupabase();
          if (!sb) throw new Error('這個任務連結需要雲端，但網站還沒設定雲端。請告訴老師。');
          const a = await fetchAssignmentByCode(sb, key);
          if (!alive) return;
          setLoad(a ? { state: 'ok', a, cloud: true } : { state: 'error', message: `找不到任務代碼「${key}」，請確認連結是否正確。` });
        } else {
          const a = await assignmentFromLink(key, route.query);
          if (!alive) return;
          setLoad(
            a
              ? { state: 'ok', a, cloud: false }
              : { state: 'error', message: key === 'custom' ? '教材資料無法驗證（連結可能不完整或被修改），請跟老師重新索取連結。' : '連結中的教材不存在，請跟老師確認連結。' },
          );
        }
      } catch (err) {
        if (alive) setLoad({ state: 'error', message: friendlyError(err) });
      }
    })();
    return () => {
      alive = false;
    };
  }, [kind, key, route.query]);

  const a = load.state === 'ok' ? load.a : null;
  const draftKey = a ? `btl.draft.${a.code}.${a.lessonId}` : '';
  const challenges = useMemo(() => (a ? assignmentChallenges(a) : []), [a]);

  // 作答進度暫存在這台裝置（重新整理不會不見）
  useEffect(() => {
    if (!draftKey) return;
    const d = readJson<Record<string, ChallengeResult>>(draftKey);
    if (d) setResults(d);
  }, [draftKey]);
  useEffect(() => {
    if (draftKey) writeJson(draftKey, results);
  }, [draftKey, results]);

  const refreshMine = async () => {
    if (!a) return;
    try {
      if (load.state === 'ok' && load.cloud) {
        const sb = getSupabase();
        if (sb) setMine(await listMyCloudAttempts(sb, a));
      } else {
        setMine((await repository.listAttempts()).filter((x) => x.assignmentCode === a.code && x.lessonId === a.lessonId));
      }
    } catch {
      /* 尚未登入或離線 */
    }
  };
  useEffect(() => {
    void refreshMine();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a]);

  if (load.state === 'loading') return <div className="page student"><p className="muted">讀取任務中…</p></div>;
  if (load.state === 'error' || !a) {
    return (
      <div className="page student">
        <div className="panel-section">
          <h1>無法開啟任務</h1>
          <p data-testid="student-error">{load.state === 'error' ? load.message : ''}</p>
        </div>
      </div>
    );
  }

  const answered = challenges.filter((c) => results[c.id]);
  const sum = totalScore(challenges.map((c) => results[c.id]).filter((r): r is ChallengeResult => !!r));
  const maxScore = challenges.reduce((s, c) => s + c.points, 0);

  const submit = async () => {
    if (!student) return;
    setSubmitting(true);
    setError('');
    const list = challenges.map((c) => results[c.id]).filter((r): r is ChallengeResult => !!r);
    try {
      let att: Attempt;
      if (load.cloud) {
        const sb = getSupabase();
        if (!sb) throw new Error('雲端未設定');
        att = await submitCloudAttempt(sb, a, student, list, sum.score, maxScore);
      } else {
        att = {
          id: newId('att'),
          assignmentId: a.id,
          assignmentCode: a.code,
          lessonId: a.lessonId,
          student,
          results: list,
          score: sum.score,
          maxScore,
          submittedAt: new Date().toISOString(),
          teacherFeedback: '',
          feedbackAt: null,
          source: 'local',
        };
        await repository.putAttempt(att);
        downloadResultFile(att);
      }
      setSubmitted(att);
      await refreshMine();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page student" data-testid="student-page">
      <header className="student-head">
        <div>
          <p className="muted small">
            任務代碼 <b>{a.code}</b>・{a.lesson.title}
          </p>
          <h1>{a.title}</h1>
          {a.message && <p className="teacher-msg">📣 {a.message}</p>}
          {!a.open && <p className="form-error">老師已關閉這個任務：可以看教材、練習，但不能繳交。</p>}
        </div>
        {student && !editingId && (
          <button type="button" className="btn ghost small" onClick={() => setEditingId(true)}>
            {student.className} 班 {student.seatNo} 號 {student.name} ✎
          </button>
        )}
      </header>

      {!student || editingId ? (
        <IdentityForm
          initial={student}
          onSave={(s) => {
            setStudent(s);
            writeJson(ID_KEY, s);
            setEditingId(false);
          }}
        />
      ) : (
        <>
          <nav className="tabs" role="tablist" aria-label="任務內容">
            <button type="button" role="tab" aria-selected={tab === 'learn'} className={tab === 'learn' ? 'is-on' : ''} onClick={() => setTab('learn')}>
              📖 看教材
            </button>
            {challenges.map((c, i) => (
              <button key={c.id} type="button" role="tab" aria-selected={tab === i} className={tab === i ? 'is-on' : ''} onClick={() => setTab(i)} data-testid={`stu-tab-${i + 1}`}>
                {results[c.id]?.correct ? '✅' : results[c.id] ? '🟡' : '⬜'} {i + 1}. {CHALLENGE_TYPE_LABEL[c.type]}
              </button>
            ))}
            <button type="button" role="tab" aria-selected={tab === 'submit'} className={tab === 'submit' ? 'is-on' : ''} onClick={() => setTab('submit')} data-testid="stu-tab-submit">
              📮 繳交（{answered.length}/{challenges.length}）
            </button>
          </nav>

          {tab === 'learn' && (
            <>
              <LessonViewer project={a.lesson.project} />
              <div className="btn-row">
                <button type="button" className="btn primary" onClick={() => setTab(challenges.length ? 0 : 'submit')}>
                  開始作答 →
                </button>
              </div>
            </>
          )}

          {typeof tab === 'number' && challenges[tab] && (
            <div className="challenge-wrap">
              <ChallengeRunner
                lesson={a.lesson}
                challenge={challenges[tab]!}
                index={tab}
                total={challenges.length}
                previous={results[challenges[tab]!.id]}
                onResult={(r) => setResults((x) => ({ ...x, [r.challengeId]: r }))}
              />
              <div className="btn-row">
                <button type="button" className="btn" onClick={() => setTab(tab < challenges.length - 1 ? tab + 1 : 'submit')} data-testid="stu-next">
                  {tab < challenges.length - 1 ? '下一題 →' : '去繳交 →'}
                </button>
              </div>
            </div>
          )}

          {tab === 'submit' && (
            <section className="panel-section submit-box" data-testid="submit-box">
              <h2>繳交作答</h2>
              <p>
                已完成 {answered.length} / {challenges.length} 題，目前得分 <b>{sum.score}</b> / {maxScore}
                （每題以最後一次作答計分）。
              </p>
              {answered.length < challenges.length && <p className="muted">還有題目沒做，也可以先繳交。</p>}
              {error && <p className="form-error">{error}</p>}
              {submitted ? (
                <div className="result good" role="status" data-testid="submitted">
                  <strong>已繳交！</strong>
                  <span>
                    {submitted.score} / {submitted.maxScore} 分
                  </span>
                  {load.cloud ? <p>老師可以在雲端看到你的作答。回饋寫好後，會顯示在下方「我的紀錄」。</p> : <p>已下載結果檔，請依老師指示上傳或交給老師（檔名開頭為「作答結果」）。</p>}
                  <div className="btn-row">
                    {!load.cloud && (
                      <button type="button" className="btn" onClick={() => downloadResultFile(submitted)}>
                        再下載一次結果檔
                      </button>
                    )}
                    <button type="button" className="btn ghost" onClick={() => setSubmitted(null)}>
                      再交一次
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="btn primary wide" onClick={() => void submit()} disabled={submitting || !a.open || answered.length === 0} data-testid="stu-submit">
                  {submitting ? '繳交中…' : '確認繳交'}
                </button>
              )}

              <h3>我的紀錄</h3>
              {mine.length === 0 ? (
                <p className="muted small">還沒有繳交紀錄。</p>
              ) : (
                <ul className="my-attempts">
                  {mine.map((m) => (
                    <li key={m.id}>
                      <span>
                        {new Date(m.submittedAt).toLocaleString('zh-TW', { hour12: false })}・<b>{m.score}</b>/{m.maxScore} 分
                      </span>
                      {m.teacherFeedback ? <p className="feedback">👩‍🏫 老師回饋：{m.teacherFeedback}</p> : <p className="muted small">老師尚未回饋</p>}
                    </li>
                  ))}
                </ul>
              )}
              {load.cloud && (
                <button type="button" className="btn ghost small" onClick={() => void refreshMine()}>
                  ↻ 重新整理回饋
                </button>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function downloadResultFile(att: Attempt) {
  const text = JSON.stringify({ format: 'basketball-tactics-lab/attempts', schemaVersion: 1, attempts: [att] }, null, 2);
  const name = `作答結果-${att.assignmentCode}-${att.student.className}-${att.student.seatNo}-${att.student.name}.json`.replace(/[\\/:*?"<>|\s]+/g, '_');
  downloadBlob(new Blob([text], { type: 'application/json' }), name);
}
