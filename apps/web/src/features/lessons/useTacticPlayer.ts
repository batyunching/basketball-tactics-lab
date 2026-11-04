import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TacticProject } from '@btl/shared-types';
import { segmentAt, stepTimes, totalDuration } from '@btl/tactic-engine';

interface PlayState {
  /** 停在第幾步（timeMs 為 null 時有效） */
  step: number;
  /** 播放或暫停中的時間點；null = 停在某一步 */
  timeMs: number | null;
  playing: boolean;
  /** 「下一步」只播一段：到這一步停下 */
  stopStep: number | null;
}

/** 教材播放器的本地播放狀態（與教師白板互不影響） */
export function useTacticPlayer(project: TacticProject) {
  const [st, setSt] = useState<PlayState>({ step: 0, timeMs: null, playing: false, stopStep: null });
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(false);
  const times = useMemo(() => stepTimes(project.steps), [project]);
  const total = totalDuration(project.steps);
  const last = project.steps.length - 1;
  const ref = useRef(st);
  ref.current = st;

  useEffect(() => setSt({ step: 0, timeMs: null, playing: false, stopStep: null }), [project]);

  useEffect(() => {
    if (!st.playing) return;
    let raf = 0;
    let prev = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(100, now - prev) * speed;
      prev = now;
      const cur = ref.current;
      let t = (cur.timeMs ?? 0) + dt;
      if (cur.stopStep !== null && t >= (times[cur.stopStep] ?? total)) {
        setSt({ step: cur.stopStep, timeMs: null, playing: false, stopStep: null });
        return;
      }
      if (t >= total) {
        if (loop && total > 0) t %= total;
        else {
          setSt({ step: last, timeMs: null, playing: false, stopStep: null });
          return;
        }
      }
      setSt({ ...cur, timeMs: t });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [st.playing, speed, loop, total, last, times]);

  const current = st.timeMs !== null ? (() => {
    const s = segmentAt(project.steps, st.timeMs);
    return s.local > 0 ? s.toIndex : s.fromIndex;
  })() : st.step;

  const play = useCallback(() => {
    if (last < 1) return;
    setSt((s) => ({
      ...s,
      playing: true,
      stopStep: null,
      timeMs: s.timeMs !== null && s.timeMs < total ? s.timeMs : s.step >= last ? 0 : (times[s.step] ?? 0),
    }));
  }, [last, total, times]);

  const pause = useCallback(() => setSt((s) => ({ ...s, playing: false })), []);

  const next = useCallback(() => {
    if (current >= last) return;
    setSt({ step: current, timeMs: times[current] ?? 0, playing: true, stopStep: current + 1 });
  }, [current, last, times]);

  const prev = useCallback(() => setSt({ step: Math.max(0, current - 1), timeMs: null, playing: false, stopStep: null }), [current]);

  const goto = useCallback((i: number) => setSt({ step: Math.max(0, Math.min(last, i)), timeMs: null, playing: false, stopStep: null }), [last]);

  const seek = useCallback((ms: number) => setSt((s) => ({ ...s, playing: false, stopStep: null, timeMs: Math.max(0, Math.min(total, ms)) })), [total]);

  return { step: st.step, current, timeMs: st.timeMs, playing: st.playing, speed, loop, total, times, setSpeed, setLoop, play, pause, next, prev, goto, seek };
}

export type TacticPlayer = ReturnType<typeof useTacticPlayer>;
