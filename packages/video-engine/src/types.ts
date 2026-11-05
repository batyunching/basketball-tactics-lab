import type { TeamId, Vec2 } from '@btl/shared-types';

/** 影片中的像素座標（原始解析度） */
export interface Px {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Detection extends Box {
  score: number;
}

export type TeamGuess = TeamId | 'unknown';

export interface ColorGuess {
  team: TeamGuess;
  /** 0～1 */
  confidence: number;
}

export interface FrameDetections {
  timeMs: number;
  boxes: (Detection & { color: ColorGuess })[];
}

/** 不確定原因 */
export type UncertaintyFlag =
  | 'low-confidence' // 偵測信心低
  | 'overlap' // 與其他球員重疊，身分可能交換
  | 'out-of-court' // 換算後落在場外（可能校正不準或偵測到場邊的人）
  | 'team-uncertain' // 隊色判斷不明確
  | 'predicted' // 短暫消失，以速度推估
  | 'interpolated' // 兩個觀測點之間補上
  | 'no-calibration'; // 尚未校正，無法換算球場座標

export type PositionSource = 'observed' | 'interpolated' | 'predicted' | 'manual';
export type ReviewStatus = 'unreviewed' | 'confirmed' | 'corrected';

export interface TrackPoint {
  timeMs: number;
  box: Box;
  /** 腳底點（框底部中央）換算後的球場座標 */
  court: Vec2 | null;
  detectionConfidence: number;
  color: ColorGuess;
  source: 'observed' | 'predicted';
  flags: UncertaintyFlag[];
}

export interface Track {
  trackId: string;
  points: TrackPoint[];
  /** 整條軌跡的隊色多數決 */
  team: TeamGuess;
  teamConfidence: number;
}

export interface CalibrationPoint {
  landmarkId: string;
  image: Px;
  court: Vec2;
}

export interface Calibration {
  points: CalibrationPoint[];
  /** 影像 → 球場 的 3×3 單應性矩陣（列優先） */
  homography: number[] | null;
  /** 校正點的平均重投影誤差（公尺） */
  errorM: number | null;
  updatedAt: string;
}

export interface Keyframe {
  id: string;
  timeMs: number;
  /** 老師在這個時間點手動放置的球員位置 */
  players: Record<string, Vec2>;
  holderId?: string | null;
  note?: string;
}

/** 輸出用的標準軌跡樣本（符合計畫書欄位） */
export interface PlayerSample {
  timeMs: number;
  trackId: string | null;
  playerId: string;
  team: TeamId;
  jerseyNumber: number;
  courtPosition: Vec2;
  detectionConfidence: number | null;
  identityConfidence: number;
  reviewStatus: ReviewStatus;
  positionSource: PositionSource;
  flags: UncertaintyFlag[];
}

/** 影片資料（影片檔本身另存，只放在老師這台電腦） */
export interface VideoAsset {
  id: string;
  name: string;
  mime: string;
  size: number;
  durationMs: number;
  width: number;
  height: number;
  createdAt: string;
  /** 老師確認已取得校內必要授權 */
  consent: boolean;
  /** 分析片段（10～30 秒） */
  trimStartMs: number;
  trimEndMs: number;
}

export interface VideoAnalysis {
  videoId: string;
  teamSize: 1 | 2 | 3 | 4 | 5;
  calibration: Calibration | null;
  sampleFps: number;
  frames: FrameDetections[];
  /** 已換算球場座標並標記不確定原因的軌跡 */
  tracks: Track[];
  assignments: Record<string, string>;
  reviews: Record<string, ReviewStatus>;
  keyframes: Keyframe[];
  status: 'none' | 'done' | 'failed' | 'cancelled';
  modelVersion: string | null;
  analyzedAt: string | null;
  error: string | null;
  updatedAt: string;
}

export const MIN_CLIP_MS = 10_000;
export const MAX_CLIP_MS = 30_000;
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
export const ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

export function emptyAnalysis(videoId: string): VideoAnalysis {
  return {
    videoId,
    teamSize: 3,
    calibration: null,
    sampleFps: 5,
    frames: [],
    tracks: [],
    assignments: {},
    reviews: {},
    keyframes: [],
    status: 'none',
    modelVersion: null,
    analyzedAt: null,
    error: null,
    updatedAt: new Date().toISOString(),
  };
}

/** 檢查影片檔是否可接受；回傳錯誤訊息或 null */
export function validateVideoFile(f: { type: string; size: number; name: string }): string | null {
  const okType = ACCEPTED_VIDEO_TYPES.includes(f.type) || /\.(mp4|m4v|webm|mov)$/i.test(f.name);
  if (!okType) return '只接受 MP4、WebM 或 MOV 影片';
  if (f.size > MAX_VIDEO_BYTES) return '影片超過 500MB，請先剪短或降低解析度';
  if (f.size === 0) return '檔案是空的';
  return null;
}

/** 預設分析片段：從頭開始最多 30 秒 */
export function defaultTrim(durationMs: number): { trimStartMs: number; trimEndMs: number } {
  return { trimStartMs: 0, trimEndMs: Math.min(durationMs, MAX_CLIP_MS) };
}

/** 調整片段：長度限制在 10～30 秒（影片本身不足 10 秒時用全長） */
export function clampTrim(start: number, end: number, durationMs: number): { trimStartMs: number; trimEndMs: number } {
  const minLen = Math.min(MIN_CLIP_MS, durationMs);
  let s = Math.max(0, Math.min(start, durationMs - minLen));
  let e = Math.min(durationMs, Math.max(end, s + minLen));
  if (e - s > MAX_CLIP_MS) e = s + MAX_CLIP_MS;
  s = Math.round(s);
  e = Math.round(e);
  return { trimStartMs: s, trimEndMs: e };
}
