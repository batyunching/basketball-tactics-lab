import type { BallAnalysis, BallFrame, FrameDetections, HoopMark, Track, VideoAsset } from '@btl/video-engine';
import { BALL_RADIUS_PER_HEIGHT, analyzeBall, medianPlayerHeight, mergeBallFrames, sampleTimes, shotRefineWindows } from '@btl/video-engine';
import { computeBackground, detectBallFrames } from './detector';

/** 依片段長度建議籃球取樣率（顏色分析很快，可比球員偵測高） */
export function recommendedBallFps(clipMs: number): number {
  if (clipMs <= 60_000) return 10;
  if (clipMs <= 120_000) return 6;
  return 5;
}
/** 籃框附近精細分析的取樣率 */
export const REFINE_FPS = 30;

export type BallStage = 'background' | 'scan' | 'refine';
export const BALL_STAGE_LABEL: Record<BallStage, string> = {
  background: '建立背景',
  scan: '找籃球',
  refine: '精細分析出手',
};

/** 模型偵測到的 sports ball 也當成候選（分數稍微加權） */
export function modelBallFrames(frames: FrameDetections[]): BallFrame[] {
  return frames
    .filter((f) => f.balls?.length)
    .map((f) => ({
      timeMs: f.timeMs,
      candidates: f.balls!.map((b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2, r: (b.w + b.h) / 4, score: Math.min(1, 0.35 + b.score), source: 'model' as const })),
    }));
}

export interface BallRunInput {
  url: string;
  asset: VideoAsset;
  frameH: number;
  playerFrames: FrameDetections[];
  tracks: Track[];
  hoop: HoopMark | null;
  fps?: number;
  signal?: AbortSignal;
  onProgress?: (stage: BallStage, done: number, total: number) => void;
}

/**
 * 籃球分析：
 *  1. 由片段中 25 張畫面建立背景
 *  2. 每秒 5～10 張找橘色圓形候選，加上模型偵測到的球
 *  3. 有籃框位置時，球接近籃框的時段改用每秒 30 張再找一次（看清楚是否穿過籃框）
 *  4. 追蹤、持球、出手與進球判定
 */
export async function runBallAnalysis(i: BallRunInput): Promise<BallAnalysis> {
  const clipMs = i.asset.trimEndMs - i.asset.trimStartMs;
  const fps = i.fps ?? recommendedBallFps(clipMs);
  const expectedR = medianPlayerHeight(i.tracks, i.frameH) * BALL_RADIUS_PER_HEIGHT;
  i.onProgress?.('background', 0, 1);
  const background = await computeBackground(i.url, i.asset, i.signal);
  const times = sampleTimes(i.asset.trimStartMs, i.asset.trimEndMs, fps);
  let frames = await detectBallFrames(i.url, times, { expectedR, background, signal: i.signal, onProgress: (d, t) => i.onProgress?.('scan', d, t) });
  frames = mergeBallFrames(frames, modelBallFrames(i.playerFrames));
  if (i.hoop) {
    const coarse = analyzeBall(frames, i.tracks, i.hoop, i.frameH, fps);
    const have = new Set(frames.map((f) => f.timeMs));
    const fine: number[] = [];
    for (const [s, e] of shotRefineWindows(coarse.points, i.hoop)) {
      for (let t = Math.max(i.asset.trimStartMs, s); t <= Math.min(i.asset.trimEndMs, e); t += 1000 / REFINE_FPS) {
        const ms = Math.round(t);
        if (!have.has(ms)) {
          have.add(ms);
          fine.push(ms);
        }
      }
    }
    if (fine.length) {
      const extra = await detectBallFrames(i.url, fine, { expectedR, background, signal: i.signal, onProgress: (d, t) => i.onProgress?.('refine', d, t) });
      frames = mergeBallFrames(frames, extra);
    }
  }
  return analyzeBall(frames, i.tracks, i.hoop, i.frameH, fps);
}

/** 估計籃球分析需要的秒數（一般電腦每張約 0.05 秒） */
export function estimateBallSec(clipMs: number, fps: number): number {
  return Math.round((clipMs / 1000) * fps * 0.05 + 3);
}
