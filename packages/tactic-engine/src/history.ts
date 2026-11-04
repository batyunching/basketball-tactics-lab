/** 以快照為基礎的復原／重做（不可變資料 + immer 結構共享，記憶體成本低） */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export const HISTORY_LIMIT = 100;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/** 推入新狀態；與現狀相同（同一參考）則忽略 */
export function pushHistory<T>(h: History<T>, next: T, limit = HISTORY_LIMIT): History<T> {
  if (next === h.present) return h;
  const past = [...h.past, h.present];
  if (past.length > limit) past.splice(0, past.length - limit);
  return { past, present: next, future: [] };
}

/** 手勢（拖曳）結束時：以手勢開始前的快照作為一筆紀錄 */
export function commitGesture<T>(h: History<T>, before: T, limit = HISTORY_LIMIT): History<T> {
  if (before === h.present) return h;
  const past = [...h.past, before];
  if (past.length > limit) past.splice(0, past.length - limit);
  return { past, present: h.present, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  const prev = h.past[h.past.length - 1];
  if (prev === undefined) return h;
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  const next = h.future[0];
  if (next === undefined) return h;
  return { past: [...h.past, h.present], present: next, future: h.future.slice(1) };
}

export function canUndo<T>(h: History<T>): boolean {
  return h.past.length > 0;
}

export function canRedo<T>(h: History<T>): boolean {
  return h.future.length > 0;
}
