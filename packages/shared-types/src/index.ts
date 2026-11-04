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

// ═════════════════════════ Phase 2：教材、學生挑戰、任務、作答 ═════════════════════════

/** 判定區（球場公尺座標的圓）：學生答案落在任一判定區即算合理 */
export interface Zone {
  x: number;
  y: number;
  r: number;
  label?: string;
}

interface ChallengeBase {
  id: string;
  title: string;
  prompt: string;
  /** 題目顯示的戰術步驟 */
  stepIndex: number;
  hint?: string;
  /** 作答後顯示的教學說明 */
  explanation: string;
  points: number;
}

/** 站位挑戰：把指定球員拖到合理位置（每人可有多個合理區） */
export interface PlacementChallenge extends ChallengeBase {
  type: 'placement';
  movable: string[];
  targets: Record<string, Zone[]>;
  /** 題目開始時要先移開的球員位置（避免答案直接顯示在畫面上） */
  startPositions?: Record<string, Vec2>;
  /** 參考答案所在的步驟（預設為 stepIndex） */
  solutionStepIndex?: number;
}

/** 跑位預測：預測某位球員下一步會到哪裡 */
export interface PredictChallenge extends ChallengeBase {
  type: 'predict';
  playerId: string;
  targets: Zone[];
  /** 揭曉答案時播放到此步驟 */
  answerStepIndex: number;
  /** 題目畫面中覆寫的位置（例如持球者已換人、防守者尚未移動） */
  overrides?: Record<string, Vec2>;
  ballHolderOverride?: string | null;
}

/** 戰術選擇：單選或多選（允許多個合理答案） */
export interface ChoiceChallenge extends ChallengeBase {
  type: 'choice';
  options: { id: string; text: string }[];
  correct: string[];
  multiple: boolean;
}

export type Challenge = PlacementChallenge | PredictChallenge | ChoiceChallenge;
export type ChallengeType = Challenge['type'];

export type LessonCategory = 'offense' | 'defense' | 'transition';

export interface Lesson {
  id: string;
  title: string;
  en: string;
  category: LessonCategory;
  difficulty: 1 | 2 | 3;
  summary: string;
  objectives: string[];
  keyPoints: string[];
  project: TacticProject;
  challenges: Challenge[];
}

export type ChallengeAnswer =
  | { type: 'placement'; positions: Record<string, Vec2> }
  | { type: 'predict'; position: Vec2 }
  | { type: 'choice'; selected: string[] };

export interface ChallengeResult {
  challengeId: string;
  type: ChallengeType;
  score: number;
  maxScore: number;
  correct: boolean;
  /** 0～1 */
  ratio: number;
  /** 每位球員（placement）或每個選項（choice）的判定 */
  details: Record<string, boolean>;
  answer: ChallengeAnswer;
  tries: number;
}

/** 教師發布的任務（學生只能讀取快照，不能改原始教材） */
export interface Assignment {
  id: string;
  code: string;
  title: string;
  message: string;
  lessonId: string;
  /** 教材快照：學生看到的是發布當下的內容 */
  lesson: Lesson;
  challengeIds: string[];
  open: boolean;
  createdAt: string;
  ownerId?: string;
}

export interface StudentIdentity {
  className: string;
  seatNo: string;
  name: string;
}

export interface Attempt {
  id: string;
  assignmentId: string;
  assignmentCode: string;
  lessonId: string;
  student: StudentIdentity;
  results: ChallengeResult[];
  score: number;
  maxScore: number;
  submittedAt: string;
  teacherFeedback: string;
  feedbackAt: string | null;
  /** cloud = 已上傳雲端；local = 本機／匯入檔 */
  source: 'cloud' | 'local';
}
