import type { TeamId, Vec2 } from '@btl/shared-types';
import {
  buildTimeline,
  dist,
  fmtSec,
  inPaint,
  indexAt,
  m1,
  name,
  nearestOpponent,
  teamOf,
  windowQuality,
  type AnalyzeInput,
  type Timeline,
} from './timeline';
import type { AiReport, Confidence, ScoringKey, TacticalEvent, TacticalEventType } from './types';

export const ENGINE_VERSION = 'rules-1.0';

/** 偵測門檻（公尺、秒）；集中在這裡方便依實拍資料調整 */
export const THRESHOLDS = {
  driveMinGain: 2.5,
  driveEndMax: 4.5,
  driveMinSpeed: 1.8,
  driveMaxSec: 2.5,
  cutMinGain: 3.0,
  cutEndMax: 4.0,
  cutMinSpeed: 2.2,
  cutMaxSec: 2.5,
  screenStillSpeed: 0.8,
  screenMinStillSec: 0.6,
  screenPassBy: 1.6,
  screenSeparationGain: 1.2,
  helpMinClose: 1.5,
  helpEndMax: 2.2,
  openReceiver: 2.0,
  scoringWindowSec: 8,
};

let seq = 0;
const eid = (t: TacticalEventType) => `ai-${t}-${Date.now().toString(36)}-${(++seq).toString(36)}`;

/** 證據品質 × 動作明顯程度 → 信心等級 */
export function grade(quality: number, strength: number): { confidence: Confidence; score: number } {
  const score = Math.round(Math.max(0, Math.min(1, quality * (0.6 + 0.4 * Math.max(0, Math.min(1, strength))))) * 100) / 100;
  const confidence: Confidence = score >= 0.75 ? 'high' : score >= 0.55 ? 'medium' : score >= 0.35 ? 'low' : 'insufficient';
  return { confidence, score };
}

function qualityReason(tl: Timeline, ids: string[], k0: number, k1: number): string {
  const parts = ids.map((id) => `${name(tl, id)} 位置可信度 ${Math.round(windowQuality(tl, id, k0, k1) * 100)}%`);
  return `這段時間的位置多為推估、內插或身分不確定（${parts.join('、')}），證據不足，無法確認。`;
}

function base(tl: Timeline, type: TacticalEventType, k0: number, k1: number, keyK: number, team: TeamId | null): Omit<TacticalEvent, 'players' | 'evidence' | 'inference' | 'suggestion' | 'confidence' | 'score'> {
  return {
    id: eid(type),
    type,
    startMs: tl.times[k0]!,
    endMs: tl.times[k1]!,
    keyMs: tl.times[keyK]!,
    team,
    status: 'suggested',
    edited: false,
    manual: false,
  };
}

function finalize(e: Omit<TacticalEvent, 'confidence' | 'score'>, g: { confidence: Confidence; score: number }, reason: string): TacticalEvent {
  if (g.confidence !== 'insufficient') return { ...e, ...g };
  return {
    ...e,
    ...g,
    insufficientReason: reason,
    inference: `證據不足，無法確認這是一次${e.type === 'cut' ? '空切' : e.type === 'drive' ? '突破' : e.type === 'screen' ? '掩護' : e.type === 'help' ? '協防' : e.type === 'pass' ? '傳球' : '戰術動作'}。${reason}`,
    suggestion: '請教師對照影片確認；必要時在「⑤ 人工關鍵影格」補上正確位置後重新分析。',
  };
}

/** 持球區段：連續由同一人持球的格子 */
function holderSegments(tl: Timeline): { id: string; k0: number; k1: number }[] {
  const segs: { id: string; k0: number; k1: number }[] = [];
  let cur: { id: string; k0: number; k1: number } | null = null;
  tl.holder.forEach((h, k) => {
    if (h && cur && cur.id === h) cur.k1 = k;
    else {
      if (cur) segs.push(cur);
      cur = h ? { id: h, k0: k, k1: k } : null;
    }
  });
  if (cur) segs.push(cur);
  return segs;
}

function pathLength(ps: (Vec2 | null)[], k0: number, k1: number): number {
  let s = 0;
  for (let k = k0 + 1; k <= k1; k++) {
    const a = ps[k - 1];
    const b = ps[k];
    if (a && b) s += dist(a, b);
  }
  return s;
}

// ─────────────────────────── 傳球、失誤 ───────────────────────────
function detectPasses(tl: Timeline): TacticalEvent[] {
  const out: TacticalEvent[] = [];
  const marks = tl.possession.filter((m) => m.holderId);
  for (let i = 1; i < marks.length; i++) {
    const a = marks[i - 1]!;
    const b = marks[i]!;
    if (a.holderId === b.holderId) continue;
    const ta = teamOf(tl, a.holderId);
    const tb = teamOf(tl, b.holderId);
    const k = indexAt(tl, b.timeMs);
    const kPrev = Math.max(0, indexAt(tl, b.timeMs) - Math.round(600 / tl.stepMs));
    const pa = tl.pos[a.holderId!]?.[kPrev] ?? null;
    const pb = tl.pos[b.holderId!]?.[k] ?? null;
    const confirmed = a.confirmed && b.confirmed;
    if (ta && tb && ta !== tb) {
      const evidence = [`${fmtSec(b.timeMs)} 球權由 ${name(tl, a.holderId!)}（${ta === 'red' ? '紅隊' : '藍隊'}）轉到 ${name(tl, b.holderId!)}（${tb === 'red' ? '紅隊' : '藍隊'}）${confirmed ? '，已由教師確認' : '，尚未經教師確認'}。`];
      const e = {
        ...base(tl, 'turnover', kPrev, k, k, tb),
        players: [
          { id: a.holderId!, role: '失去球權' },
          { id: b.holderId!, role: '取得球權' },
        ],
        evidence,
        inference: `${ta === 'red' ? '紅隊' : '藍隊'}失去球權，攻守轉換。`,
        suggestion: '回顧失誤前的傳球路線或持球位置，討論如何保護球；取得球權的一方可練習快速推進。',
      };
      out.push(finalize(e, confirmed ? { confidence: 'high', score: 0.9 } : { confidence: 'insufficient', score: 0.3 }, '球權轉換尚未經教師確認，無法確認是否為失誤或攻守轉換。'));
      continue;
    }
    if (!ta || ta !== tb) continue;
    const q = Math.min(windowQuality(tl, a.holderId!, kPrev, kPrev), windowQuality(tl, b.holderId!, k, k));
    const evidence = [`${fmtSec(b.timeMs)} 球權由 ${name(tl, a.holderId!)} 轉到 ${name(tl, b.holderId!)}${confirmed ? '（教師已確認）' : '（教師標記，尚未確認）'}。`];
    let inference = `${name(tl, a.holderId!)} 傳球給 ${name(tl, b.holderId!)}。`;
    let open = false;
    if (pa && pb) {
      evidence.push(`傳球距離約 ${m1(dist(pa, pb))} 公尺（${name(tl, a.holderId!)} 在距籃框 ${m1(dist(pa, tl.basket))} 公尺處，${name(tl, b.holderId!)} 在距籃框 ${m1(dist(pb, tl.basket))} 公尺處）。`);
      const near = nearestOpponent(tl, tb, k, pb);
      if (near) {
        evidence.push(`接球時最近的防守者 ${name(tl, near.id)} 距離 ${m1(near.d)} 公尺。`);
        open = near.d >= THRESHOLDS.openReceiver;
        inference += open ? `接球者身邊約 ${m1(near.d)} 公尺內沒有防守者，屬於有空檔的傳球。` : `接球時防守者貼得很近（${m1(near.d)} 公尺），接球後需要再創造空間。`;
      }
      if (inPaint(pb)) inference += '球被傳進禁區，直接威脅籃框。';
    } else {
      evidence.push('傳球當下有球員位置缺漏，無法計算傳球距離與接球空檔。');
    }
    const strength = pa && pb ? 1 : 0.3;
    const qq = (confirmed ? 1 : 0.55) * (pa && pb ? Math.max(q, 0.3) : 0.3);
    const e = {
      ...base(tl, 'pass', kPrev, k, k, ta),
      players: [
        { id: a.holderId!, role: '傳球者' },
        { id: b.holderId!, role: '接球者' },
      ],
      evidence,
      inference,
      suggestion: open ? '肯定傳球選擇：傳給最空的隊友。練習時可要求傳球前先看防守者的位置。' : '討論是否有更空的傳球對象；接球者可先做擺脫（V 字切、反跑）再接球。',
      geometry: { ...(pa ? { from: pa } : {}), ...(pb ? { to: pb } : {}) },
    };
    out.push(
      confirmed
        ? finalize(e, grade(qq, strength), qualityReasonSafe(tl, [a.holderId!, b.holderId!], kPrev, k))
        : finalize(e, { confidence: 'insufficient', score: Math.min(0.3, grade(qq, strength).score) }, '球權變化尚未經教師確認，無法確認這次傳球。'),
    );
  }
  return out;
}

function qualityReasonSafe(tl: Timeline, ids: string[], k0: number, k1: number) {
  return qualityReason(tl, ids.filter((id) => tl.pos[id]), k0, k1);
}

// ─────────────────────────── 突破 ───────────────────────────
function detectDrives(tl: Timeline): TacticalEvent[] {
  const out: TacticalEvent[] = [];
  const maxK = Math.round((THRESHOLDS.driveMaxSec * 1000) / tl.stepMs);
  for (const seg of holderSegments(tl)) {
    const team = teamOf(tl, seg.id);
    const ps = tl.pos[seg.id];
    if (!team || !ps) continue;
    let i = seg.k0;
    while (i < seg.k1) {
      const p0 = ps[i];
      if (!p0) {
        i++;
        continue;
      }
      let best: { j: number; gain: number } | null = null;
      for (let j = i + 2; j <= Math.min(seg.k1, i + maxK); j++) {
        const p1 = ps[j];
        if (!p1) continue;
        const gain = dist(p0, tl.basket) - dist(p1, tl.basket);
        const secs = ((j - i) * tl.stepMs) / 1000;
        const speed = pathLength(ps, i, j) / secs;
        if (gain >= THRESHOLDS.driveMinGain && dist(p1, tl.basket) <= THRESHOLDS.driveEndMax && speed >= THRESHOLDS.driveMinSpeed && (!best || gain > best.gain)) best = { j, gain };
      }
      if (!best) {
        i++;
        continue;
      }
      const j = best.j;
      const p1 = ps[j]!;
      const secs = ((j - i) * tl.stepMs) / 1000;
      const speed = pathLength(ps, i, j) / secs;
      const evidence = [
        `${fmtSec(tl.times[i]!)}～${fmtSec(tl.times[j]!)}，持球的 ${name(tl, seg.id)} 從距籃框 ${m1(dist(p0, tl.basket))} 公尺推進到 ${m1(dist(p1, tl.basket))} 公尺（${m1(secs)} 秒，平均 ${m1(speed)} 公尺／秒）。`,
      ];
      const defender = nearestOpponent(tl, team, i, p0);
      let beaten = false;
      if (defender) {
        const dEnd = tl.pos[defender.id]![j];
        if (dEnd) {
          beaten = dist(dEnd, tl.basket) > dist(p1, tl.basket) + 0.3;
          evidence.push(beaten ? `原本最近的防守者 ${name(tl, defender.id)} 在突破結束時離籃框比持球者更遠（被甩在身後）。` : `防守者 ${name(tl, defender.id)} 仍維持在持球者與籃框之間。`);
        }
      }
      if (inPaint(p1)) evidence.push('突破結束時持球者已進入禁區。');
      const q = Math.min(windowQuality(tl, seg.id, i, j), tl.holderConfirmed[i] ? 1 : 0.6);
      const e = {
        ...base(tl, 'drive', i, j, j, team),
        players: [{ id: seg.id, role: '突破者' }, ...(defender ? [{ id: defender.id, role: '直接防守者' }] : [])],
        evidence,
        inference: beaten ? `${name(tl, seg.id)} 運球突破甩開 ${defender ? name(tl, defender.id) : '防守者'}，直接攻擊籃框，迫使其他防守者收縮。` : `${name(tl, seg.id)} 持球往籃框推進，但防守者仍守在前方，突破未完全成功。`,
        suggestion: beaten ? '肯定第一步的速度；接著教學生觀察協防：協防靠過來時把球分給被放空的隊友。' : '練習第一步爆發與換手運球；若防守者站位好，可改用掩護或傳球製造優勢。',
        subtype: beaten ? 'beat-defender' : 'contained',
        geometry: { from: p0, to: p1 },
      };
      out.push(finalize(e, grade(q, Math.min(1, best.gain / 5)), qualityReasonSafe(tl, [seg.id], i, j)));
      i = j + 1;
    }
  }
  return out;
}

// ─────────────────────────── 空切 ───────────────────────────
function detectCuts(tl: Timeline): TacticalEvent[] {
  const out: TacticalEvent[] = [];
  const maxK = Math.round((THRESHOLDS.cutMaxSec * 1000) / tl.stepMs);
  const after = Math.round(2000 / tl.stepMs);
  for (const pl of tl.players) {
    const ps = tl.pos[pl.id]!;
    let i = 0;
    while (i < tl.times.length - 2) {
      const holder = tl.holder[i];
      const offense = teamOf(tl, holder ?? null);
      const p0 = ps[i];
      if (!p0 || !offense || offense !== pl.teamId || holder === pl.id) {
        i++;
        continue;
      }
      let best: { j: number; gain: number } | null = null;
      for (let j = i + 2; j <= Math.min(tl.times.length - 1, i + maxK); j++) {
        const p1 = ps[j];
        if (!p1 || tl.holder.slice(i, j + 1).includes(pl.id)) continue;
        const gain = dist(p0, tl.basket) - dist(p1, tl.basket);
        const secs = ((j - i) * tl.stepMs) / 1000;
        const speed = pathLength(ps, i, j) / secs;
        if (gain >= THRESHOLDS.cutMinGain && (dist(p1, tl.basket) <= THRESHOLDS.cutEndMax || inPaint(p1)) && speed >= THRESHOLDS.cutMinSpeed && (!best || gain > best.gain)) best = { j, gain };
      }
      if (!best) {
        i++;
        continue;
      }
      const j = best.j;
      const p1 = ps[j]!;
      const secs = ((j - i) * tl.stepMs) / 1000;
      const speed = pathLength(ps, i, j) / secs;
      const evidence = [`${fmtSec(tl.times[i]!)}～${fmtSec(tl.times[j]!)}，無球的 ${name(tl, pl.id)} 從距籃框 ${m1(dist(p0, tl.basket))} 公尺切到 ${m1(dist(p1, tl.basket))} 公尺（${m1(secs)} 秒，平均 ${m1(speed)} 公尺／秒）。`];
      const d = nearestOpponent(tl, pl.teamId, i, p0);
      let separated = false;
      if (d) {
        const dp1 = tl.pos[d.id]![j];
        if (dp1) {
          const gap = dist(p1, dp1);
          separated = gap - d.d >= 1;
          evidence.push(`與防守者 ${name(tl, d.id)} 的距離由 ${m1(d.d)} 公尺變為 ${m1(gap)} 公尺。`);
        }
      }
      // 切入後 2 秒內接到球？
      let received: string | null = null;
      for (let k = j; k <= Math.min(tl.times.length - 1, j + after); k++) {
        if (tl.holder[k] === pl.id) {
          const prev = tl.holder[Math.max(0, k - 1)];
          received = prev && prev !== pl.id ? prev : (tl.holder[i] ?? null);
          evidence.push(`切入後 ${m1(((k - j) * tl.stepMs) / 1000)} 秒接到 ${received ? name(tl, received) : '隊友'} 的傳球。`);
          break;
        }
      }
      // 切入前 2 秒內是否剛傳出球（傳切）
      let giveAndGo = false;
      for (let k = Math.max(0, i - after); k < i; k++) if (tl.holder[k] === pl.id) giveAndGo = true;
      if (giveAndGo) evidence.push(`切入前 2 秒內 ${name(tl, pl.id)} 剛把球傳出。`);
      const q = Math.min(windowQuality(tl, pl.id, i, j), tl.holderConfirmed[i] ? 1 : 0.6);
      const label = giveAndGo ? '傳切（Give-and-Go）' : '空切';
      const e = {
        ...base(tl, 'cut', i, j, j, pl.teamId),
        players: [{ id: pl.id, role: '空切者' }, ...(d ? [{ id: d.id, role: '防守者' }] : []), ...(received ? [{ id: received, role: '傳球者' }] : [])],
        evidence,
        inference: `${name(tl, pl.id)} 的${label}${separated ? '甩開了防守者' : ''}${received ? '，並成功接球，形成籃下機會。' : '，但沒有在 2 秒內接到球（可能是傳球時機未配合或傳球路線被阻斷）。'}`,
        suggestion: received
          ? '用這段影片示範「傳球後立刻移動」與切入時機；可讓學生找出防守者轉頭看球的瞬間。'
          : '討論持球者為何沒有傳出：切入路線是否被擋、時機是否太早；練習切入者舉手要球、持球者提早觀察。',
        subtype: giveAndGo ? 'give-and-go' : received ? 'cut-received' : 'cut',
        geometry: { from: p0, to: p1 },
      };
      out.push(finalize(e, grade(q, Math.min(1, best.gain / 5)), qualityReasonSafe(tl, [pl.id], i, j)));
      i = j + 1;
    }
  }
  return out;
}

// ─────────────────────────── 掩護 ───────────────────────────
function detectScreens(tl: Timeline): TacticalEvent[] {
  const out: TacticalEvent[] = [];
  const minStill = Math.round((THRESHOLDS.screenMinStillSec * 1000) / tl.stepMs);
  const rollK = Math.round(2500 / tl.stepMs);
  for (const s of tl.players) {
    const ps = tl.pos[s.id]!;
    let k = 1;
    while (k < tl.times.length) {
      const offense = teamOf(tl, tl.holder[k] ?? null);
      if (offense !== s.teamId) {
        k++;
        continue;
      }
      // 找連續靜止（站定）的區段
      let e = k;
      // 以 0.4 秒的位移判斷是否站定（比逐格速度更不受雜訊影響）
      const span = Math.max(1, Math.round(400 / tl.stepMs));
      while (e < tl.times.length) {
        const a = ps[Math.max(0, e - span)];
        const b = ps[e];
        if (!a || !b || dist(a, b) / ((Math.min(span, e) * tl.stepMs) / 1000) > THRESHOLDS.screenStillSpeed) break;
        e++;
      }
      const k0 = k - 1;
      const k1 = e - 1;
      if (k1 - k0 < minStill) {
        k = e + 1;
        continue;
      }
      const spot = ps[Math.round((k0 + k1) / 2)]!;
      // 被掩護者常在掩護者剛站定時經過：往前多看 0.6 秒
      const scan0 = Math.max(0, k0 - Math.round(600 / tl.stepMs));
      let found: TacticalEvent | null = null;
      for (const t of tl.players) {
        if (t.id === s.id || t.teamId !== s.teamId) continue;
        const tp = tl.pos[t.id]!;
        let km = -1;
        let dm = Infinity;
        for (let x = scan0; x <= Math.min(tl.times.length - 1, k1 + 2); x++) {
          const p = tp[x];
          if (p && dist(p, spot) < dm) {
            dm = dist(p, spot);
            km = x;
          }
        }
        if (km < 0 || dm > THRESHOLDS.screenPassBy) continue;
        const tStart = tp[scan0];
        if (!tStart) continue;
        const defender = nearestOpponent(tl, t.teamId, scan0, tStart, []);
        if (!defender) continue;
        const kEnd = Math.min(tl.times.length - 1, km + Math.round(1000 / tl.stepMs));
        const tEnd = tp[kEnd];
        const dEnd = tl.pos[defender.id]![kEnd];
        if (!tEnd || !dEnd) continue;
        const gain = dist(tEnd, dEnd) - defender.d;
        let dClose = Infinity;
        for (let x = scan0; x <= kEnd; x++) {
          const dp = tl.pos[defender.id]![x];
          if (dp) dClose = Math.min(dClose, dist(dp, spot));
        }
        if (gain < THRESHOLDS.screenSeparationGain || dClose > 1.8) continue;
        const onBall = tl.holder[km] === t.id;
        // 掩護後是否下順
        let roll = false;
        for (let x = k1 + 1; x <= Math.min(tl.times.length - 1, k1 + rollK); x++) {
          const p = ps[x];
          if (p && dist(spot, tl.basket) - dist(p, tl.basket) >= 2) roll = true;
        }
        const evidence = [
          `${fmtSec(tl.times[k0]!)} 起 ${name(tl, s.id)} 在距籃框 ${m1(dist(spot, tl.basket))} 公尺處站定約 ${m1(((k1 - k0) * tl.stepMs) / 1000)} 秒。`,
          `${onBall ? '持球的' : ''}${name(tl, t.id)} 從 ${name(tl, s.id)} 身旁 ${m1(dm)} 公尺處經過。`,
          `原本防守 ${name(tl, t.id)} 的 ${name(tl, defender.id)} 一度靠近掩護者到 ${m1(dClose)} 公尺內，與 ${name(tl, t.id)} 的距離由 ${m1(defender.d)} 公尺拉開到 ${m1(dist(tEnd, dEnd))} 公尺。`,
        ];
        if (roll) evidence.push(`掩護後 ${name(tl, s.id)} 轉身往籃框移動超過 2 公尺。`);
        const sub = onBall ? (roll ? 'pick-and-roll' : 'on-ball') : 'off-ball';
        const q = Math.min(windowQuality(tl, s.id, k0, k1), windowQuality(tl, t.id, scan0, kEnd), windowQuality(tl, defender.id, scan0, kEnd));
        const ev = {
          ...base(tl, 'screen', Math.min(scan0, k0), kEnd, km, s.teamId),
          players: [
            { id: s.id, role: '掩護者' },
            { id: t.id, role: onBall ? '持球者（被掩護）' : '被掩護者' },
            { id: defender.id, role: '被擋的防守者' },
          ],
          evidence,
          inference:
            sub === 'pick-and-roll'
              ? `${name(tl, s.id)} 替持球的 ${name(tl, t.id)} 設掩護後下順，形成擋拆（Pick and Roll）。`
              : sub === 'on-ball'
                ? `${name(tl, s.id)} 替持球的 ${name(tl, t.id)} 設持球掩護，幫助他甩開 ${name(tl, defender.id)}。`
                : `${name(tl, s.id)} 替無球的 ${name(tl, t.id)} 設無球掩護，讓他擺脫 ${name(tl, defender.id)}。`,
          suggestion:
            sub === 'off-ball'
              ? '示範掩護角度與被掩護者「先帶後切」的時機；提醒掩護者雙腳站穩、不能移動掩護。'
              : '討論持球者是否貼著掩護者過、掩護者何時轉身下順；防守方可討論換防或擠過的選擇。',
          subtype: sub,
          geometry: { at: spot, ...(tStart ? { from: tStart } : {}), ...(tEnd ? { to: tEnd } : {}) },
        };
        found = finalize(ev, grade(q, Math.min(1, gain / 3)), qualityReasonSafe(tl, [s.id, t.id, defender.id], scan0, kEnd));
        break;
      }
      if (found) out.push(found);
      k = e + 1;
    }
  }
  return out;
}

// ─────────────────────────── 協防 ───────────────────────────
function detectHelp(tl: Timeline, drives: TacticalEvent[]): TacticalEvent[] {
  const out: TacticalEvent[] = [];
  const after = Math.round(2000 / tl.stepMs);
  for (const d of drives) {
    if (d.confidence === 'insufficient') continue;
    const h = d.players[0]!.id;
    const primary = d.players.find((p) => p.role === '直接防守者')?.id;
    const team = d.team!;
    const i = indexAt(tl, d.startMs);
    const j = indexAt(tl, d.endMs);
    for (const def of tl.players) {
      if (def.teamId === team || def.id === primary) continue;
      const dp0 = tl.pos[def.id]![i];
      const hp0 = tl.pos[h]![i];
      if (!dp0 || !hp0) continue;
      const d0 = dist(dp0, hp0);
      let d1 = Infinity;
      let k1 = i;
      for (let k = i; k <= j; k++) {
        const a = tl.pos[def.id]![k];
        const b = tl.pos[h]![k];
        if (a && b && dist(a, b) < d1) {
          d1 = dist(a, b);
          k1 = k;
        }
      }
      if (d0 - d1 < THRESHOLDS.helpMinClose || d1 > THRESHOLDS.helpEndMax) continue;
      // 他原本防守的人（突破開始時離他最近的進攻球員，不含持球者）
      let man: { id: string; d: number } | null = null;
      for (const o of tl.players) {
        if (o.teamId !== team || o.id === h) continue;
        const op = tl.pos[o.id]![i];
        if (op && (!man || dist(op, dp0) < man.d)) man = { id: o.id, d: dist(op, dp0) };
      }
      const evidence = [`${fmtSec(tl.times[i]!)}～${fmtSec(tl.times[k1]!)}，${name(tl, h)} 突破時，${name(tl, def.id)} 向持球者靠近，距離由 ${m1(d0)} 公尺縮短到 ${m1(d1)} 公尺。`];
      let kick = false;
      if (man) {
        const op1 = tl.pos[man.id]![k1];
        const dp1 = tl.pos[def.id]![k1];
        if (op1 && dp1) evidence.push(`同時 ${name(tl, def.id)} 與原本防守的 ${name(tl, man.id)} 距離由 ${m1(man.d)} 公尺拉大到 ${m1(dist(op1, dp1))} 公尺。`);
        for (let k = k1; k <= Math.min(tl.times.length - 1, k1 + after); k++) if (tl.holder[k] === man.id) kick = true;
        if (kick) evidence.push(`之後 2 秒內球被分給 ${name(tl, man.id)}。`);
      }
      const q = Math.min(windowQuality(tl, def.id, i, k1), windowQuality(tl, h, i, k1));
      const e = {
        ...base(tl, 'help', i, k1, k1, def.teamId),
        players: [{ id: def.id, role: '協防者' }, { id: h, role: '被協防的持球者' }, ...(man ? [{ id: man.id, role: '協防者原本的防守對象' }] : [])],
        evidence,
        inference: kick
          ? `${name(tl, def.id)} 補位協防擋住突破，但 ${man ? name(tl, man.id) : '他原本的人'} 因此被放空並接到分球，防守輪轉不及。`
          : `${name(tl, def.id)} 離開自己的人補位協防，阻止 ${name(tl, h)} 直接上籃。`,
        suggestion: kick ? '防守教學：協防後要有隊友補位（輪轉），或協防者快速回位（Close-out）；進攻方可肯定「突破分球」。' : '肯定協防意識；提醒協防的同時要用餘光注意自己的人，必要時喊聲請隊友補位。',
        subtype: kick ? 'help-and-kick' : 'help',
      };
      out.push(finalize(e, grade(q, Math.min(1, (d0 - d1) / 4)), qualityReasonSafe(tl, [def.id, h], i, k1)));
    }
  }
  return out;
}

// ─────────────────────────── 得分與得分關鍵 ───────────────────────────
function detectShots(tl: Timeline, events: TacticalEvent[]): { events: TacticalEvent[]; keys: ScoringKey[] } {
  const out: TacticalEvent[] = [];
  const keys: ScoringKey[] = [];
  for (const s of tl.shots) {
    const k = indexAt(tl, s.timeMs);
    const p = tl.pos[s.shooterId]?.[k] ?? null;
    const team = teamOf(tl, s.shooterId);
    const evidence = [`${fmtSec(s.timeMs)} ${name(tl, s.shooterId)} 出手（教師標記${s.confirmed ? '並確認' : '，尚未確認'}：${s.made ? '進球' : '未進'}）。`];
    if (p) evidence.push(`出手位置距籃框約 ${m1(dist(p, tl.basket))} 公尺（${dist(p, tl.basket) > 6.75 ? '三分線外' : inPaint(p) ? '禁區內' : '三分線內'}）。`);
    if (!s.confirmed) {
      out.push(
        finalize(
          { ...base(tl, s.made ? 'score' : 'shot', k, k, k, team), players: [{ id: s.shooterId, role: '出手者' }], evidence, inference: '', suggestion: '' },
          { confidence: 'insufficient', score: 0.2 },
          '是否進球尚未經教師確認；系統不會自行判斷得分。',
        ),
      );
      continue;
    }
    const near = p && team ? nearestOpponent(tl, team, k, p) : null;
    if (near) evidence.push(`出手時最近的防守者 ${name(tl, near.id)} 距離 ${m1(near.d)} 公尺${near.d >= 1.5 ? '（空檔出手）' : '（有人干擾）'}。`);
    out.push({
      ...base(tl, s.made ? 'score' : 'shot', k, k, k, team),
      players: [{ id: s.shooterId, role: '出手者' }],
      evidence,
      inference: s.made ? `${name(tl, s.shooterId)} 得分。` : `${name(tl, s.shooterId)} 出手未進。`,
      suggestion: s.made ? '回看得分前的傳球與跑位，讓學生說出「這球為什麼能得分」。' : '討論出手選擇：是否有更好的傳球對象或更近的出手位置。',
      confidence: 'high',
      score: 0.95,
      ...(p ? { geometry: { at: p } } : {}),
    });
    if (!s.made) continue;
    const win = THRESHOLDS.scoringWindowSec * 1000;
    const chainEv = events
      .filter((e) => e.team === team && e.confidence !== 'insufficient' && e.endMs <= s.timeMs + 200 && e.endMs >= s.timeMs - win && ['pass', 'cut', 'screen', 'drive'].includes(e.type))
      .sort((a, b) => a.endMs - b.endMs);
    const chain = chainEv.map((e) => e.id);
    const desc = chainEv.map((e) => `${fmtSec(e.keyMs)} ${e.inference.replace(/。$/, '')}`);
    const involved = chainEv.filter((e) => e.players.some((p2) => p2.id === s.shooterId));
    const key = involved.find((e) => e.type === 'cut' || e.type === 'screen' || e.type === 'drive') ?? chainEv[chainEv.length - 1];
    const summary = chainEv.length
      ? `得分前 ${THRESHOLDS.scoringWindowSec} 秒的關鍵動作：${desc.join(' → ')}。最主要的得分關鍵是「${key ? key.inference.replace(/。.*$/, '') : '團隊傳導'}」。`
      : `得分前 ${THRESHOLDS.scoringWindowSec} 秒內沒有偵測到可信的傳球、空切、掩護或突破；可能是個人單打，或是軌跡資料不足，無法確認得分關鍵。`;
    keys.push({ shotId: s.id, timeMs: s.timeMs, shooterId: s.shooterId, chain, summary });
  }
  return { events: out, keys };
}

/** 主程式：由軌跡＋教師確認的球權／得分，產生戰術事件與繁中解說 */
export function analyzeTactics(input: AnalyzeInput): AiReport {
  const notes: string[] = [];
  const hasSamples = Object.values(input.samples).some((s) => s && s.length > 0);
  if (!hasSamples) notes.push('沒有任何球員軌跡（請先完成自動追蹤＋身分指派，或建立人工關鍵影格），無法分析。');
  if (!input.possession.length) notes.push('尚未標記球權：系統無法判斷哪一隊在進攻，因此不分析傳球、空切、掩護、突破與協防。請在影片上標記「誰持球」。');
  else if (input.possession.some((m) => !m.confirmed)) notes.push(`有 ${input.possession.filter((m) => !m.confirmed).length} 個球權標記尚未確認，相關事件信心會降低或標示無法確認。`);
  if (!input.shots.length) notes.push('尚未標記出手／得分：系統不會自行判斷是否進球，因此不產生得分關鍵分析。');
  if (!hasSamples) return { engineVersion: ENGINE_VERSION, ranAt: new Date().toISOString(), events: [], scoringKeys: [], notes };

  const tl = buildTimeline(input);
  const events: TacticalEvent[] = [];
  if (input.possession.length) {
    events.push(...detectPasses(tl));
    const drives = detectDrives(tl);
    events.push(...drives, ...detectCuts(tl), ...detectScreens(tl), ...detectHelp(tl, drives));
  }
  const shots = detectShots(tl, events);
  events.push(...shots.events);
  events.sort((a, b) => a.keyMs - b.keyMs || a.type.localeCompare(b.type));
  return { engineVersion: ENGINE_VERSION, ranAt: new Date().toISOString(), events, scoringKeys: shots.keys, notes };
}
