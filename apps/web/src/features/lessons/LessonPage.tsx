import { useState } from 'react';
import type { ChallengeResult } from '@btl/shared-types';
import { CATEGORY_LABEL } from '@btl/lesson-library';
import { useAnyLesson } from './useLessons';
import { CHALLENGE_TYPE_LABEL, totalScore } from '@btl/tactic-engine';
import { navigate } from '../../app/router';
import { useStore } from '../../app/store';
import { ChallengeRunner } from '../challenges/ChallengeRunner';
import { openAsNewProject } from '../storage/persistence';
import { LessonViewer } from './LessonViewer';

/** 單一教材：動畫講解 + 三種互動題（教師試做或自學） */
export function LessonPage({ id }: { id: string }) {
  const lesson = useAnyLesson(id);
  const [tab, setTab] = useState<'learn' | number>('learn');
  const [results, setResults] = useState<Record<string, ChallengeResult>>({});
  if (lesson === undefined) return <div className="page muted">讀取教材中…</div>;
  if (!lesson) {
    return (
      <div className="page">
        <p>找不到這份教材。</p>
        <button type="button" className="btn" onClick={() => navigate('/lessons')}>
          回教材庫
        </button>
      </div>
    );
  }
  const done = Object.values(results);
  const sum = totalScore(done);
  const ch = typeof tab === 'number' ? lesson.challenges[tab] : undefined;

  return (
    <div className="page lesson-page">
      <header className="page-head row-between">
        <div>
          <button type="button" className="link muted" onClick={() => navigate('/lessons')}>
            ← 教材庫
          </button>
          <h1>
            {lesson.title} <small className="muted">{lesson.en}</small>
          </h1>
          <p className="muted">
            <span className={`cat ${lesson.category}`}>{CATEGORY_LABEL[lesson.category]}</span> {lesson.summary}
          </p>
        </div>
        <div className="btn-row">
          <button
            type="button"
            className="btn"
            onClick={async () => {
              await openAsNewProject(lesson.project, '（教材副本）');
              useStore.getState().showToast('已複製到白板，可自由修改（原教材不受影響）');
              navigate('/');
            }}
            data-testid="lesson-to-board"
          >
            ✎ 複製到白板修改
          </button>
          <button type="button" className="btn primary" onClick={() => navigate(`/teach?lesson=${lesson.id}`)} data-testid="lesson-publish">
            📤 發布給學生
          </button>
        </div>
      </header>

      <nav className="tabs" role="tablist" aria-label="教材內容">
        <button type="button" role="tab" aria-selected={tab === 'learn'} className={tab === 'learn' ? 'is-on' : ''} onClick={() => setTab('learn')}>
          📖 動畫講解
        </button>
        {lesson.challenges.map((c, i) => (
          <button key={c.id} type="button" role="tab" aria-selected={tab === i} className={tab === i ? 'is-on' : ''} onClick={() => setTab(i)} data-testid={`tab-challenge-${i + 1}`}>
            {results[c.id]?.correct ? '✅' : results[c.id] ? '🟡' : '⬜'} {i + 1}. {CHALLENGE_TYPE_LABEL[c.type]}
          </button>
        ))}
        {done.length > 0 && (
          <span className="tab-score">
            練習得分 {sum.score} / {lesson.challenges.reduce((a, c) => a + c.points, 0)}
          </span>
        )}
      </nav>

      {tab === 'learn' ? (
        <div className="lesson-learn">
          <LessonViewer project={lesson.project} />
          <aside className="lesson-side">
            <section className="panel-section">
              <h2>學習目標</h2>
              <ul className="bullets">
                {lesson.objectives.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            </section>
            <section className="panel-section">
              <h2>動作要點</h2>
              <ol className="bullets">
                {lesson.keyPoints.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ol>
            </section>
            <button type="button" className="btn primary wide" onClick={() => setTab(0)}>
              開始挑戰 →
            </button>
          </aside>
        </div>
      ) : (
        ch && (
          <div className="challenge-wrap">
            <ChallengeRunner
              lesson={lesson}
              challenge={ch}
              index={tab as number}
              total={lesson.challenges.length}
              previous={results[ch.id]}
              onResult={(r) => setResults((x) => ({ ...x, [ch.id]: r }))}
            />
            <div className="btn-row">
              {(tab as number) < lesson.challenges.length - 1 && (
                <button type="button" className="btn" onClick={() => setTab((tab as number) + 1)}>
                  下一題 →
                </button>
              )}
            </div>
          </div>
        )
      )}
    </div>
  );
}
