import { useEffect } from 'react';
import { useStore } from '../../app/store';

/** requestAnimationFrame 驅動播放；分頁隱藏時自動暫停計時 */
export function usePlaybackLoop(): void {
  const playing = useStore((s) => s.playback.playing);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      useStore.getState().tick(dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}
