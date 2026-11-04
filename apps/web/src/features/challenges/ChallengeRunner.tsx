import { useEffect, useMemo, useRef, useState } from 'react';
import type { Challenge, ChallengeResult, Lesson, Vec2 } from '@btl/shared-types';
import {
  CHALLENGE_TYPE_LABEL,
  challengeSetupHolder,
  challengeSetupPositions,
  easeInOutCubic,
  getPlayerDef,
  gradeChallenge,
  lerpVec,
} from '@btl/tactic-engine';
import { CourtView, type ZoneMark } from '../court/CourtView';
import { TEAM_LABEL } from '../players/PlayerToken';

interface Props {
  lesson: Lesson;
  challenge: Challenge;
  index: number;
  total: number;
  /** 每次檢查答案都回報（最後一次為準） */
  onResult: (r: ChallengeResult) => void;
  previous?: ChallengeResult;
}

function playerName(lesson: Lesson, id: string): string {
  const d = getPlayerDef(lesson.project, id);
  return d ? `${TEAM_LABEL[d.teamId]}${d.jerseyNumber}` : id;
}

/** 三種互動題：站位挑戰、跑位預測、戰術選擇 */
export function ChallengeRunner({ lesson, challenge: c, index, total, onResult, previous }: Props) {
  const { project } = lesson;
  const setup = useMemo(() => challengeSetupPositions(project, c), [project, c]);
  const holder = challengeSetupHolder(project, c);
  const [positions, setPositions] = useState<Record<string, Vec2>>(setup);
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<ChallengeResult | null>(null);
  const [tries, setTries] = useState(previous?.tries ?? 0);
  const [hint, setHint] = useState(false);
  const [moved, setMoved] = useState<Set<string>>(new Set());
  const [reveal, setReveal] = useState(0); // 揭曉答案動畫 0～1
  const raf = useRef(0);

  useEffect(() => {
    setPositions(setup);
    setSelected([]);
    setResult(null);
    setHint(false);
    setMoved(new Set());
    setReveal(0);
    setTries(previous?.tries ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const check = () => {
    const answer =
      c.type === 'placement'
        ? { type: 'placement' as const, positions: Object.fromEntries(c.movable.map((id) => [id, positions[id]!])) }
        : c.type === 'predict'
          ? { type: 'predict' as const, position: positions[c.playerId]! }
          : { type: 'choice' as const, selected };
    const r = gradeChallenge(c, answer, tries + 1);
    setTries(tries + 1);
    setResult(r);
    onResult(r);
    if (c.type === 'predict') {
      // 揭曉：其他球員移動到答案步驟，學生的猜測留下殘影
      const start = performance.now();
      const anim = (now: number) => {
        const k = Math.min(1, (now - start) / 1400);
        setReveal(k);
        if (k < 1) raf.current = requestAnimationFrame(anim);
      };
      raf.current = requestAnimationFrame(anim);
    }
  };

  const retry = () => {
    cancelAnimationFrame(raf.current);
    setResult(null);
    setReveal(0);
    if (c.type !== 'choice') {
      setPositions(setup);
      setMoved(new Set());
    }
  };

  // 顯示的球員位置
  let shownPlayers = positions;
  let ghosts: { id: string; pos: Vec2; ok: boolean }[] = [];
  let zones: ZoneMark[] = [];
  let shownHolder = holder;
  if (c.type === 'predict' && result) {
    const target = project.steps[c.answerStepIndex]!;
    const e = easeInOutCubic(reveal);
    shownPlayers = Object.fromEntries(Object.entries(setup).map(([id, p]) => [id, lerpVec(p, target.players[id] ?? p, e)]));
    ghosts = [{ id: c.playerId, pos: positions[c.playerId]!, ok: result.correct }];
    zones = c.targets.map((z) => ({ zone: z, ok: result.correct ? true : undefined }));
    if (reveal >= 1) shownHolder = target.ball.holderId;
  } else if (c.type === 'placement' && result) {
    zones = c.movable.flatMap((id) => (c.targets[id] ?? []).map((z) => ({ zone: z, ok: result.details[id] ? true : undefined })));
  } else if (hint && c.type === 'placement') {
    // 提示只給「大概範圍」：取第一個判定區放大
    zones = c.movable.map((id) => c.targets[id]?.[0]).filter((z): z is NonNullable<typeof z> => !!z).map((z) => ({ zone: { ...z, r: z.r * 1.8 }, ok: false }));
  }

  const draggable = result ? [] : c.type === 'placement' ? c.movable : c.type === 'predict' ? [c.playerId] : [];
  const canCheck = c.type === 'choice' ? selected.length > 0 : c.type === 'predict' ? moved.has(c.playerId) : moved.size > 0;
  const step = project.steps[c.stepIndex];

  return (
    <article className="challenge" data-testid={`challenge-${c.type}`} aria-labelledby={`ch-${c.id}`}>
      <header className="challenge-head">
        <span className={`type-badge ${c.type}`}>{CHALLENGE_TYPE_LABEL[c.type]}</span>
        <span className="muted small">
          第 {index + 1} / {total} 題・{c.points} 分{tries > 0 ? `・已作答 ${tries} 次` : ''}
        </span>
      </header>
      <h3 id={`ch-${c.id}`}>{c.title}</h3>
      <p className="prompt">{c.prompt}</p>
      {c.type !== 'choice' && !result && (
        <p className="muted small drag-tip">
          👆 拖曳有黃色虛線圈的球員：
          {(c.type === 'placement' ? c.movable : [c.playerId]).map((id) => playerName(lesson, id)).join('、')}
        </p>
      )}

      <div className="challenge-court" data-court={project.court.mode}>
        <CourtView
          project={project}
          players={shownPlayers}
          holderId={shownHolder}
          annotations={c.type === 'choice' ? (step?.annotations ?? []) : []}
          draggable={draggable}
          onMove={(id, pos) => {
            setPositions((p) => ({ ...p, [id]: pos }));
            setMoved((m) => new Set(m).add(id));
          }}
          zones={zones}
          ghosts={ghosts}
          playerMarks={c.type === 'placement' && result ? result.details : {}}
          label={`${c.title}：${c.prompt}`}
          testId="challenge-court"
        />
      </div>

      {c.type === 'choice' && (
        <fieldset className="options" disabled={!!result}>
          <legend className="muted small">{c.multiple ? '可複選' : '單選'}</legend>
          {c.options.map((o) => {
            const on = selected.includes(o.id);
            const verdict = result ? (c.correct.includes(o.id) ? 'right' : on ? 'wrong' : '') : '';
            return (
              <label key={o.id} className={`option ${on ? 'is-on' : ''} ${verdict}`}>
                <input
                  type={c.multiple ? 'checkbox' : 'radio'}
                  name={`opt-${c.id}`}
                  checked={on}
                  onChange={() => setSelected((s) => (c.multiple ? (on ? s.filter((x) => x !== o.id) : [...s, o.id]) : [o.id]))}
                />
                <span>{o.text}</span>
                {verdict === 'right' && <em>✓ 合理</em>}
                {verdict === 'wrong' && <em>✗</em>}
              </label>
            );
          })}
        </fieldset>
      )}

      {hint && c.hint && !result && <p className="hint">💡 {c.hint}</p>}

      {result && (
        <div className={`result ${result.correct ? 'good' : result.ratio > 0 ? 'partial' : 'bad'}`} role="status" data-testid="challenge-result">
          <strong>{result.correct ? '答對了！' : result.ratio > 0 ? '部分正確' : '再想想看'}</strong>
          <span>
            {result.score} / {result.maxScore} 分
          </span>
          {c.type === 'placement' && (
            <ul>
              {c.movable.map((id) => (
                <li key={id}>
                  {result.details[id] ? '✓' : '✗'} {playerName(lesson, id)}
                </li>
              ))}
            </ul>
          )}
          <p>{c.explanation}</p>
        </div>
      )}

      <div className="btn-row challenge-actions">
        {!result ? (
          <>
            <button type="button" className="btn primary" onClick={check} disabled={!canCheck} data-testid="check-answer">
              檢查答案
            </button>
            {c.hint && (
              <button type="button" className="btn ghost" onClick={() => setHint(true)} disabled={hint}>
                💡 提示
              </button>
            )}
          </>
        ) : (
          <button type="button" className="btn" onClick={retry} data-testid="retry">
            ↺ 再試一次
          </button>
        )}
      </div>
    </article>
  );
}
