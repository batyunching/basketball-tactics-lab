/**
 * 籃球戰術教學系統 — 共用型別
 * 所有座標一律為「球場公尺座標」：
 *   x：沿球場長邊 0 ～ 28（左底線 → 右底線）
 *   y：沿球場短邊 0 ～ 15（上邊線 → 下邊線）
 * 畫面像素只是顯示結果，不是真值。
 */

export const SCHEMA_VERSION = 1 as const;

export type TeamId = 'red' | 'blue';
export type CourtMode = 'half' | 'full';
/** 紅隊進攻方向；半場模式時即為畫面顯示的那一個籃框 */
export type AttackDirection = 'left' | 'right';
export type TeamSize = 1 | 2 | 3 | 4 | 5;

export interface Vec2 {
  x: number;
  y: number;
}

export interface CourtConfig {
  mode: CourtMode;
  lengthM: number;
  widthM: number;
  attackDirection: AttackDirection;
}

export interface TeamDef {
  id: TeamId;
  name: string;
  color: string;
}

/** 球員身分（不隨步驟改變）。id 穩定不變，背號只在同隊內唯一。 */
export interface PlayerDef {
  id: string;
  teamId: TeamId;
  /** 0～4：決定在 NvN 時是否出場（slot < teamSize） */
  slot: number;
  jerseyNumber: number;
  locked: boolean;
}

/** 單一步驟中的球員位置 */
export interface PlayerState {
  x: number;
  y: number;
}

/** 球的狀態：holderId 不為 null 時，球跟著持球者；否則停在 (x, y) */
export interface BallState {
  holderId: string | null;
  x: number;
  y: number;
}

export type TacticEvent =
  | { id: string; type: 'pass'; fromId: string; toId: string }
  | { id: string; type: 'dribble'; playerId: string }
  | { id: string; type: 'shot'; playerId: string }
  | { id: string; type: 'turnover'; fromTeam: TeamId; toTeam: TeamId };

export type TacticEventType = TacticEvent['type'];

export type AnnotationKind = 'run' | 'pass' | 'dribble' | 'screen' | 'circle' | 'zone';

/**
 * 戰術標註（皆為球場公尺座標）
 *  run／dribble：手繪路徑點
 *  pass／screen：起點、終點
 *  circle：圓心、圓周上一點
 *  zone：矩形兩對角
 */
export interface Annotation {
  id: string;
  kind: AnnotationKind;
  points: Vec2[];
  color: string;
}

export interface TacticStep {
  id: string;
  title: string;
  /** 從上一步移動到此步所需時間（毫秒）；第 1 步（索引 0）為起始站位，不使用 */
  durationMs: number;
  players: Record<string, PlayerState>;
  ball: BallState;
  offenseTeam: TeamId;
  events: TacticEvent[];
  annotations: Annotation[];
  note: string;
}

export interface TacticProject {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  title: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  court: CourtConfig;
  teamSize: TeamSize;
  teams: TeamDef[];
  players: PlayerDef[];
  steps: TacticStep[];
}

/** 預設隊形：保存雙方位置、球權、方向、人數與場地 */
export interface Formation {
  id: string;
  name: string;
  order: number;
  courtMode: CourtMode;
  teamSize: TeamSize;
  attackDirection: AttackDirection;
  offenseTeam: TeamId;
  players: Record<string, PlayerState>;
  ball: BallState;
  builtIn: boolean;
  updatedAt: string;
}

/** JSON 匯出格式 */
export interface ExportBundle {
  format: 'basketball-tactics-lab';
  schemaVersion: typeof SCHEMA_VERSION;
  exportedAt: string;
  /** 匯出時由第一步推導的初始球狀態（方便其他系統讀取），匯入時以 steps 為準 */
  ball?: BallState;
  project?: TacticProject;
  formations?: Formation[];
}
