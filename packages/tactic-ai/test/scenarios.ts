import type { PlayerDef } from '@btl/shared-types';
import { createProject } from '@btl/tactic-engine';
import type { PlayerSample } from '@btl/video-engine';
import type { PossessionMark, ShotMark } from '../src';
import type { TruthEvent } from '../src';

/**
 * 測試情境：以分段直線描述每位球員的跑位（球場公尺座標，紅隊攻右邊籃框）。
 * 用來驗證偵測規則；不代表真實比賽影片。
 */
type Key = [number, number, number]; // [ms, x, y]

export function samplesFromPath(pid: string, team: 'red' | 'blue', jersey: number, keys: Key[], opts: { stepMs?: number; identity?: number; flags?: PlayerSample['flags']; source?: PlayerSample['positionSource'] } = {}): PlayerSample[] {
  const step = opts.stepMs ?? 100;
  const out: PlayerSample[] = [];
  const end = keys[keys.length - 1]![0];
  for (let t = keys[0]![0]; t <= end; t += step) {
    let i = 0;
    while (i < keys.length - 2 && keys[i + 1]![0] <= t) i++;
    const a = keys[i]!;
    const b = keys[Math.min(i + 1, keys.length - 1)]!;
    const k = b[0] === a[0] ? 0 : Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0])));
    out.push({
      timeMs: t,
      trackId: null,
      playerId: pid,
      team,
      jerseyNumber: jersey,
      courtPosition: { x: a[1] + (b[1] - a[1]) * k, y: a[2] + (b[2] - a[2]) * k },
      detectionConfidence: null,
      identityConfidence: opts.identity ?? 1,
      reviewStatus: 'confirmed',
      positionSource: opts.source ?? 'manual',
      flags: opts.flags ?? [],
    });
  }
  return out;
}

export function players(teamSize: 1 | 2 | 3 | 4 | 5 = 3): PlayerDef[] {
  return createProject({ teamSize }).players.filter((p) => p.slot < teamSize);
}

export interface Scenario {
  name: string;
  teamSize: 1 | 2 | 3 | 4 | 5;
  endMs: number;
  samples: Record<string, PlayerSample[]>;
  possession: PossessionMark[];
  shots: ShotMark[];
  truth: TruthEvent[];
}

const poss = (t: number, h: string | null, confirmed = true): PossessionMark => ({ id: `p${t}`, timeMs: t, holderId: h, confirmed });

/** 傳切：紅1 傳給紅2 → 紅1 空切 → 紅2 回傳 → 紅1 上籃得分 */
export function giveAndGo(opts: { uncertainCutter?: boolean } = {}): Scenario {
  const s: Record<string, PlayerSample[]> = {
    'red-1': samplesFromPath('red-1', 'red', 1, [[0, 19.7, 7.5], [1200, 19.7, 7.5], [2600, 26.0, 6.6], [3400, 26.3, 7.0], [4000, 26.3, 7.0]], opts.uncertainCutter ? { identity: 0.4, flags: ['overlap'], source: 'observed' } : {}),
    'red-2': samplesFromPath('red-2', 'red', 2, [[0, 22.5, 2.0], [4000, 22.5, 2.0]]),
    'red-3': samplesFromPath('red-3', 'red', 3, [[0, 22.5, 13.0], [4000, 22.5, 13.0]]),
    'blue-1': samplesFromPath('blue-1', 'blue', 1, [[0, 20.9, 7.4], [1200, 20.9, 7.0], [2600, 24.2, 6.3], [4000, 25.2, 6.8]]),
    'blue-2': samplesFromPath('blue-2', 'blue', 2, [[0, 23.4, 2.8], [4000, 23.4, 2.8]]),
    'blue-3': samplesFromPath('blue-3', 'blue', 3, [[0, 23.4, 12.2], [4000, 23.4, 12.2]]),
  };
  return {
    name: '傳切',
    teamSize: 3,
    endMs: 4000,
    samples: s,
    possession: [poss(0, 'red-1'), poss(1000, 'red-2'), poss(2800, 'red-1')],
    shots: [{ id: 'shot1', timeMs: 3400, shooterId: 'red-1', made: true, confirmed: true }],
    truth: [
      { type: 'pass', timeMs: 1000, players: ['red-1', 'red-2'] },
      { type: 'cut', timeMs: 2400, players: ['red-1'] },
      { type: 'pass', timeMs: 2800, players: ['red-2', 'red-1'] },
      { type: 'score', timeMs: 3400, players: ['red-1'] },
    ],
  };
}

/** 擋拆＋協防＋分球：紅3 掩護 → 紅1 突破 → 藍2 協防 → 分給底角紅2 → 紅2 投進 */
export function pickAndRollHelp(): Scenario {
  const s: Record<string, PlayerSample[]> = {
    'red-1': samplesFromPath('red-1', 'red', 1, [[0, 19.2, 7.5], [1000, 19.2, 7.5], [1600, 20.0, 5.5], [2400, 23.8, 5.9], [3000, 24.4, 6.2], [4500, 24.4, 6.2]]),
    'red-2': samplesFromPath('red-2', 'red', 2, [[0, 26.8, 1.2], [4500, 26.8, 1.2]]),
    'red-3': samplesFromPath('red-3', 'red', 3, [[0, 25.0, 5.0], [1000, 20.4, 6.3], [2200, 20.4, 6.3], [3600, 25.5, 8.6], [4500, 25.5, 8.6]]),
    'blue-1': samplesFromPath('blue-1', 'blue', 1, [[0, 20.4, 7.5], [1000, 20.4, 7.5], [1600, 20.9, 6.9], [2600, 20.9, 6.9], [3400, 22.4, 6.9], [4500, 22.4, 6.9]]),
    'blue-2': samplesFromPath('blue-2', 'blue', 2, [[0, 25.6, 2.0], [1600, 25.6, 2.0], [2600, 24.6, 5.2], [3600, 25.8, 2.4], [4500, 25.8, 2.4]]),
    'blue-3': samplesFromPath('blue-3', 'blue', 3, [[0, 25.6, 5.6], [1000, 21.6, 5.8], [2200, 21.6, 5.8], [3600, 25.0, 8.0], [4500, 25.0, 8.0]]),
  };
  return {
    name: '擋拆協防分球',
    teamSize: 3,
    endMs: 4500,
    samples: s,
    possession: [poss(0, 'red-1'), poss(3200, 'red-2')],
    shots: [{ id: 'shot2', timeMs: 4000, shooterId: 'red-2', made: true, confirmed: true }],
    truth: [
      { type: 'screen', timeMs: 1600, players: ['red-3', 'red-1'] },
      { type: 'drive', timeMs: 2400, players: ['red-1'] },
      { type: 'help', timeMs: 2500, players: ['blue-2', 'red-1'] },
      { type: 'cut', timeMs: 3000, players: ['red-3'] },
      { type: 'pass', timeMs: 3200, players: ['red-1', 'red-2'] },
      { type: 'score', timeMs: 4000, players: ['red-2'] },
    ],
  };
}

/** 5v5：弧頂突破、弱邊協防、分球；確認規則不受人數影響 */
export function fiveOnFiveDrive(): Scenario {
  const R: [string, Key[]][] = [
    ['red-1', [[0, 19.5, 7.5], [800, 19.5, 7.5], [2000, 24.3, 7.0], [3500, 24.3, 7.0]]],
    ['red-2', [[0, 22.5, 1.8], [3500, 22.5, 1.8]]],
    ['red-3', [[0, 22.5, 13.2], [3500, 22.5, 13.2]]],
    ['red-4', [[0, 27.0, 0.9], [3500, 27.0, 0.9]]],
    ['red-5', [[0, 27.0, 14.1], [3500, 27.0, 14.1]]],
  ];
  const B: [string, Key[]][] = [
    ['blue-1', [[0, 20.7, 7.5], [800, 20.7, 7.5], [2000, 21.8, 7.4], [3500, 21.8, 7.4]]],
    ['blue-2', [[0, 23.4, 2.6], [3500, 23.4, 2.6]]],
    ['blue-3', [[0, 23.4, 12.4], [800, 23.4, 12.4], [1900, 24.6, 8.6], [3500, 24.6, 8.6]]],
    ['blue-4', [[0, 26.2, 1.6], [3500, 26.2, 1.6]]],
    ['blue-5', [[0, 26.2, 13.4], [3500, 26.2, 13.4]]],
  ];
  const s: Record<string, PlayerSample[]> = {};
  for (const [id, k] of [...R, ...B]) s[id] = samplesFromPath(id, id.startsWith('red') ? 'red' : 'blue', Number(id.slice(-1)), k);
  return {
    name: '5v5 突破協防',
    teamSize: 5,
    endMs: 3500,
    samples: s,
    possession: [poss(0, 'red-1'), poss(2400, 'red-3')],
    shots: [],
    truth: [
      { type: 'drive', timeMs: 1800, players: ['red-1'] },
      { type: 'help', timeMs: 1900, players: ['blue-3', 'red-1'] },
      { type: 'pass', timeMs: 2400, players: ['red-1', 'red-3'] },
    ],
  };
}
