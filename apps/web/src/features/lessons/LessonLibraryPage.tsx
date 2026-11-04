import { CATEGORY_LABEL, LESSONS } from '@btl/lesson-library';
import { CHALLENGE_TYPE_LABEL } from '@btl/tactic-engine';
import { navigate } from '../../app/router';

const STARS = ['', '★☆☆', '★★☆', '★★★'];

/** 教材庫（M07）：六套戰術教材 */
export function LessonLibraryPage() {
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
    </div>
  );
}
