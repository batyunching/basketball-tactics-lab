import { useState } from 'react';
import { CATEGORY_LABEL, LESSONS } from '@btl/lesson-library';
import { useStore } from '../../app/store';
import { repository } from '../storage/db';
import { useAllLessons } from './useLessons';
import { CHALLENGE_TYPE_LABEL } from '@btl/tactic-engine';
import { navigate } from '../../app/router';

const STARS = ['', '★☆☆', '★★☆', '★★★'];

/** 教材庫（M07）：六套戰術教材 */
export function LessonLibraryPage() {
  const { custom, reload } = useAllLessons();
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  return (
    <div className="page">
      <header className="page-head">
        <h1>戰術教材庫</h1>
        <p className="muted">六套常見戰術，每套都有分步動畫與三種互動題。可先自己播放講解，再發布給學生練習。</p>
      </header>
      <ul className="lesson-grid" data-testid="lesson-grid">
        {LESSONS.map((l, i) => (
          <li key={l.id} className={`lesson-card cat-${l.category}`}>
            <button type="button" className="lesson-open" onClick={() => navigate(`/lessons/${l.id}`)} data-testid={`lesson-${l.id}`}>
              <span className="lesson-no">{i + 1}</span>
              <span className="lesson-meta">
                <span className={`cat ${l.category}`}>{CATEGORY_LABEL[l.category]}</span>
                <span className="muted small">
                  {l.project.teamSize}v{l.project.teamSize}・{l.project.court.mode === 'half' ? '半場' : '全場'}・難度 {STARS[l.difficulty]}
                </span>
              </span>
              <strong className="lesson-title">{l.title}</strong>
              <small className="muted">{l.en}</small>
              <span className="lesson-summary">{l.summary}</span>
              <span className="lesson-foot muted small">
                {l.project.steps.length} 個步驟・{l.challenges.map((c) => CHALLENGE_TYPE_LABEL[c.type]).join('／')}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <section className="panel-section" data-testid="custom-lessons">
        <h2>我的教材（由比賽影片轉換）</h2>
        {custom.length === 0 ? (
          <p className="muted small">在「🎥 影片分析 → ⑦ AI 戰術分析」確認事件後，可轉成這裡的互動教材。</p>
        ) : (
          <ul className="assignment-list">
            {custom.map((l) => (
              <li key={l.id}>
                <div>
                  <button type="button" className="link" onClick={() => navigate(`/lessons/${l.id}`)}>
                    <strong>🎥 {l.title}</strong>
                  </button>
                  <span className="muted small">
                    {' '}
                    {l.project.steps.length} 個步驟・{l.challenges.length} 題・{new Date(l.createdAt).toLocaleDateString('zh-TW')}
                  </span>
                </div>
                <div className="btn-row">
                  <button type="button" className="btn tiny primary" onClick={() => navigate(`/lessons/${l.id}`)}>
                    開啟
                  </button>
                  <button type="button" className="btn tiny" onClick={() => navigate(`/teach?lesson=${l.id}`)}>
                    發布
                  </button>
                  <button
                    type="button"
                    className={`btn tiny ${confirmDel === l.id ? 'danger' : 'ghost'}`}
                    data-testid="custom-lesson-delete"
                    onClick={async () => {
                      if (confirmDel !== l.id) {
                        setConfirmDel(l.id);
                        return;
                      }
                      await repository.deleteCustomLesson(l.id);
                      setConfirmDel(null);
                      useStore.getState().showToast('已刪除教材（已發布給學生的任務快照不受影響）');
                      reload();
                    }}
                  >
                    {confirmDel === l.id ? '確認刪除' : '刪除'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
