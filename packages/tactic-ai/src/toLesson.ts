import type { Challenge, Lesson, PlayerDef, TacticProject, Vec2, Zone } from '@btl/shared-types';
import { addStep, clampToBounds, createProject, movePlayer, playableBounds, setBallHolder, updateStepMeta } from '@btl/tactic-engine';
import { positionAt, type PlayerSample } from '@btl/video-engine';
import { fmtSec } from './timeline';
import { EVENT_LABEL, type PossessionMark, type ScoringKey, type TacticalEvent } from './types';

/**
 * 把「教師確認過」的戰術事件轉成學生互動教材。
 * 只使用確認後的文字與球場座標；不含影片、追蹤編號、偵測框等原始資料。
 */
export interface LessonFromVideoInput {
  id: string;
  title: string;
  summary: string;
  teamSize: 1 | 2 | 3 | 4 | 5;
  samples: Record<string, PlayerSample[]>;
  events: TacticalEvent[];
  possession: PossessionMark[];
  scoringKeys: ScoringKey[];
  startMs: number;
  endMs: number;
}

const MAX_STEPS = 16;
const MAX_CHALLENGES = 6;

function label(players: PlayerDef[], id: string): string {
  const d = players.find((p) => p.id === id);
  return d ? `${d.teamId === 'red' ? '紅' : '藍'}${d.jerseyNumber}` : id;
}

function short(text: string, n = 280): string {
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}

function holderAt(marks: PossessionMark[], t: number): string | null {
  let h: string | null = null;
  for (const m of [...marks].sort((a, b) => a.timeMs - b.timeMs)) if (m.timeMs <= t + 50 && m.confirmed) h = m.holderId;
  return h;
}

export function buildLessonFromEvents(input: LessonFromVideoInput): Lesson {
  const confirmed = input.events.filter((e) => e.status === 'confirmed' && e.confidence !== 'insufficient').sort((a, b) => a.keyMs - b.keyMs);
  if (!confirmed.length) throw new Error('至少要有一個教師確認的事件，才能轉成教材');
  const bounds = playableBounds('half', 'right');

  // 步驟時間：事件開始＋關鍵時刻，合併 0.5 秒內的時間點
  const raw = [input.startMs, ...confirmed.flatMap((e) => [e.startMs, e.keyMs])].filter((t) => t >= input.startMs && t <= input.endMs).sort((a, b) => a - b);
  const times: number[] = [];
  for (const t of raw) if (!times.length || t - times[times.length - 1]! >= 500) times.push(t);
  while (times.length > MAX_STEPS) times.splice(1 + Math.floor((times.length - 2) / 2), 1);

  let project: TacticProject = createProject({ title: input.title, mode: 'half', teamSize: input.teamSize });
  const players = project.players.filter((p) => p.slot < input.teamSize);
  const stepOf = (t: number) => {
    let best = 0;
    times.forEach((x, i) => {
      if (Math.abs(x - t) < Math.abs(times[best]! - t)) best = i;
    });
    return best;
  };
  times.forEach((t, i) => {
    if (i > 0) project = addStep(project, i - 1);
    for (const p of players) {
      const s = positionAt(input.samples[p.id], t);
      if (s) project = movePlayer(project, i, p.id, s.courtPosition);
    }
    project = setBallHolder(project, i, holderAt(input.possession, t));
    const here = confirmed.filter((e) => stepOf(e.keyMs) === i);
    project = updateStepMeta(project, i, {
      title: here.length ? here.map((e) => EVENT_LABEL[e.type]).join('＋') : i === 0 ? '起始站位' : `影片 ${fmtSec(t)}`,
      durationMs: i > 0 ? Math.max(300, Math.min(10_000, t - times[i - 1]!)) : 1500,
      note: short(here.length ? here.map((e) => e.inference).join(' ') : `影片 ${fmtSec(t)} 的站位。`, 900),
    });
  });
  project = { ...project, id: `lesson-${input.id}` };

  // 題目：每個事件最多一題，依事件類型選題型
  const challenges: Challenge[] = [];
  const zone = (p: Vec2, r: number, lbl?: string): Zone => ({ ...clampToBounds(p, bounds), r, ...(lbl ? { label: lbl } : {}) });
  const used = new Set<string>();
  for (const e of [...confirmed].sort((a, b) => b.score - a.score)) {
    if (challenges.length >= MAX_CHALLENGES) break;
    const main = e.players[0]?.id;
    if (!main) continue;
    const kStart = stepOf(e.startMs);
    const kKey = stepOf(e.keyMs);
    const id = `${input.id}-${e.type}-${challenges.length + 1}`;
    if ((e.type === 'cut' || e.type === 'drive') && e.geometry?.to && kKey > kStart && !used.has(`move-${main}`)) {
      used.add(`move-${main}`);
      challenges.push({
        id,
        type: 'predict',
        title: `${label(players, main)} 下一步去哪？`,
        prompt: `影片 ${fmtSec(e.startMs)}。${e.type === 'cut' ? `無球的 ${label(players, main)}` : `持球的 ${label(players, main)}`} 接下來最好移動到哪裡？把他拖過去。`,
        stepIndex: kStart,
        playerId: main,
        targets: [zone(e.geometry.to, e.type === 'cut' ? 1.6 : 1.8, '影片中實際到達的位置')],
        answerStepIndex: kKey,
        explanation: short(`${e.inference} ${e.suggestion}`, 900),
        points: 10,
      });
    } else if (e.type === 'screen' && e.geometry?.at && !used.has('screen')) {
      used.add('screen');
      const before = Math.max(0, kStart - 1);
      const start = project.steps[before]!.players[main]!;
      const target = zone(e.geometry.at, 1.2, '掩護位置');
      if (Math.hypot(start.x - target.x, start.y - target.y) > target.r + 0.3) {
        challenges.push({
          id,
          type: 'placement',
          title: '站到掩護位置',
          prompt: `影片 ${fmtSec(e.startMs)}。把 ${label(players, main)} 拖到可以替 ${label(players, e.players[1]?.id ?? main)} 設掩護的位置。`,
          stepIndex: before,
          movable: [main],
          targets: { [main]: [target] },
          solutionStepIndex: kKey,
          explanation: short(`${e.inference} ${e.suggestion}`, 900),
          points: 10,
        });
      }
    } else if (e.type === 'pass' && e.players[1] && !used.has(`pass-${main}`)) {
      used.add(`pass-${main}`);
      const passer = players.find((p) => p.id === main)!;
      const mates = players.filter((p) => p.teamId === passer.teamId && p.id !== main);
      if (mates.length >= 2) {
        challenges.push({
          id,
          type: 'choice',
          title: '傳給誰？',
          prompt: `影片 ${fmtSec(e.startMs)}，${label(players, main)} 持球。這時最好的傳球對象是誰？`,
          stepIndex: Math.max(0, kKey - 1),
          options: mates.map((m) => ({ id: m.id, text: `${label(players, m.id)}` })),
          correct: [e.players[1].id],
          multiple: false,
          explanation: short(`${e.inference} ${e.suggestion}`, 900),
          points: 10,
        });
      }
    } else if (e.type === 'help' && !used.has('help')) {
      used.add('help');
      const helper = players.find((p) => p.id === main)!;
      const defenders = players.filter((p) => p.teamId === helper.teamId);
      if (defenders.length >= 2) {
        challenges.push({
          id,
          type: 'choice',
          title: '誰該協防？',
          prompt: `影片 ${fmtSec(e.startMs)}，${label(players, e.players[1]?.id ?? '')} 正在突破。哪一位防守者最適合補位協防？`,
          stepIndex: kStart,
          options: defenders.map((d) => ({ id: d.id, text: label(players, d.id) })),
          correct: [main],
          multiple: false,
          explanation: short(`${e.inference} ${e.suggestion}`, 900),
          points: 10,
        });
      }
    }
  }
  // 得分關鍵題
  const key = input.scoringKeys.find((k) => k.chain.some((id) => confirmed.some((e) => e.id === id)));
  if (key && challenges.length < MAX_CHALLENGES) {
    const chainEvents = confirmed.filter((e) => key.chain.includes(e.id));
    const types = [...new Set(chainEvents.map((e) => e.type))].filter((t) => ['pass', 'cut', 'screen', 'drive'].includes(t));
    const all = ['cut', 'screen', 'drive', 'pass'] as const;
    const distract = [
      { id: 'iso', text: '個人單打，沒有隊友配合' },
      { id: 'rebound', text: '搶到進攻籃板後補籃' },
    ];
    const options = [...all.map((t) => ({ id: t, text: ({ cut: '無球空切', screen: '掩護', drive: '持球突破', pass: '傳球找到空檔隊友' } as const)[t] })), ...distract];
    if (types.length) {
      challenges.push({
        id: `${input.id}-scoring-key`,
        type: 'choice',
        title: '這球為什麼能得分？',
        prompt: `影片 ${fmtSec(key.timeMs)} ${label(players, key.shooterId)} 得分。得分前有哪些關鍵動作？（可複選）`,
        stepIndex: stepOf(key.timeMs),
        options,
        correct: types,
        multiple: true,
        explanation: short(key.summary, 900),
        points: 10,
      });
    }
  }

  return {
    id: input.id,
    title: input.title,
    en: 'From Game Video',
    category: 'offense',
    difficulty: 2,
    summary: short(input.summary || `由比賽影片重建的戰術教材，共 ${confirmed.length} 個經教師確認的關鍵動作。`, 900),
    objectives: [...new Set(confirmed.map((e) => `看懂${EVENT_LABEL[e.type]}的時機與效果`))].slice(0, 5),
    keyPoints: confirmed.slice(0, 6).map((e) => short(`${fmtSec(e.keyMs)} ${EVENT_LABEL[e.type]}：${e.suggestion}`, 280)),
    project,
    challenges,
  };
}
