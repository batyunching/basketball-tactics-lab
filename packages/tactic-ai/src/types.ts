import type { TeamId, Vec2 } from '@btl/shared-types';

/** 教師標記的球權（誰持球；null = 球在空中／地上／看不清楚） */
export interface PossessionMark {
  id: string;
  timeMs: number;
  holderId: string | null;
  /** 教師是否已確認 */
  confirmed: boolean;
}

/** 教師標記的出手（只有教師確認的進球才算得分，系統不臆測） */
export interface ShotMark {
  id: string;
  timeMs: number;
  shooterId: string;
  made: boolean;
  confirmed: boolean;
}

export type TacticalEventType = 'pass' | 'cut' | 'screen' | 'drive' | 'help' | 'turnover' | 'score' | 'shot';

export type Confidence = 'high' | 'medium' | 'low' | 'insufficient';

export type EventStatus = 'suggested' | 'confirmed' | 'rejected';

export interface EventPlayer {
  id: string;
  role: string;
}

/** AI 產生（或教師新增）的戰術事件 */
export interface TacticalEvent {
  id: string;
  type: TacticalEventType;
  startMs: number;
  endMs: number;
  /** 事件的關鍵時刻（轉教材時的步驟） */
  keyMs: number;
  team: TeamId | null;
  players: EventPlayer[];
  /** 可見事實（附數字的觀測） */
  evidence: string[];
  /** 戰術推論 */
  inference: string;
  /** 教學建議 */
  suggestion: string;
  confidence: Confidence;
  /** 0～1 的數值信心 */
  score: number;
  /** 證據不足的原因（confidence = insufficient 時必填） */
  insufficientReason?: string;
  status: EventStatus;
  /** 教師修改過文字 */
  edited: boolean;
  /** 教師手動新增（AI 漏抓） */
  manual: boolean;
  /** 給轉教材用的位置資訊 */
  geometry?: { from?: Vec2; to?: Vec2; at?: Vec2 };
  /** 子類型，例如 give-and-go、pick-and-roll、double-team */
  subtype?: string;
}

export interface AiReport {
  engineVersion: string;
  ranAt: string;
  events: TacticalEvent[];
  /** 得分關鍵摘要（只在有教師確認的進球時產生） */
  scoringKeys: ScoringKey[];
  /** 整體說明（例如：球權未確認、資料不足） */
  notes: string[];
}

export interface ScoringKey {
  shotId: string;
  timeMs: number;
  shooterId: string;
  /** 得分前 8 秒內與得分有關的事件 */
  chain: string[];
  summary: string;
}

export interface AiState {
  possession: PossessionMark[];
  shots: ShotMark[];
  report: AiReport | null;
}

export const EVENT_LABEL: Record<TacticalEventType, string> = {
  pass: '傳球',
  cut: '空切',
  screen: '掩護',
  drive: '突破',
  help: '協防',
  turnover: '失誤／攻守轉換',
  score: '得分',
  shot: '出手未進',
};

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: '高',
  medium: '中',
  low: '低',
  insufficient: '無法確認',
};
