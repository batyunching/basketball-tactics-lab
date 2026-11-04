import type { SupabaseClient } from '@supabase/supabase-js';
import type { Assignment, Attempt, ChallengeResult, Lesson, StudentIdentity } from '@btl/shared-types';
import { lessonSchema } from '@btl/data-schemas';
import { getLesson } from '@btl/lesson-library';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆的 0/O、1/I

export function makeCode(len = 6): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export interface AssignmentDraft {
  title: string;
  message: string;
  challengeIds: string[];
}

export function buildAssignment(lesson: Lesson, d: AssignmentDraft, code = makeCode()): Assignment {
  return {
    id: newId('asg'),
    code,
    title: d.title.trim() || lesson.title,
    message: d.message.trim(),
    lessonId: lesson.id,
    lesson,
    challengeIds: d.challengeIds.filter((id) => lesson.challenges.some((c) => c.id === id)),
    open: true,
    createdAt: new Date().toISOString(),
  };
}

/** 學生看到的題目（依任務選擇的題目與順序） */
export function assignmentChallenges(a: Assignment) {
  return a.challengeIds.map((id) => a.lesson.challenges.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => !!c);
}

export function appBaseUrl(): string {
  return `${location.origin}${location.pathname}`;
}

/** 雲端任務連結：學生端以代碼向雲端讀取教材快照 */
export function cloudLink(code: string): string {
  return `${appBaseUrl()}#/s/${code}`;
}

/**
 * 本機任務連結（未設定雲端時）：只帶教材 id 與題目，教材內容來自系統內建，
 * 學生無法透過連結修改教材。
 */
export function localLink(a: Assignment): string {
  const q = new URLSearchParams({ k: a.code, t: a.title, c: a.challengeIds.join(',') });
  if (a.message) q.set('m', a.message);
  return `${appBaseUrl()}#/p/${encodeURIComponent(a.lessonId)}?${q.toString()}`;
}

export function assignmentFromLocalLink(lessonId: string, query: URLSearchParams): Assignment | null {
  const lesson = getLesson(lessonId);
  if (!lesson) return null;
  const code = (query.get('k') ?? '').toUpperCase();
  const ids = (query.get('c') ?? '').split(',').filter(Boolean);
  const a = buildAssignment(
    lesson,
    { title: query.get('t') ?? lesson.title, message: query.get('m') ?? '', challengeIds: ids.length ? ids : lesson.challenges.map((c) => c.id) },
    /^[A-Z0-9]{4,12}$/.test(code) ? code : 'LOCAL0',
  );
  return { ...a, id: `local-${a.code}` };
}

// ─────────────────────────── 雲端 ───────────────────────────

interface AssignmentRow {
  id: string;
  code: string;
  title: string;
  message: string;
  lesson_id: string;
  payload: { lesson: Lesson; challengeIds: string[] };
  open: boolean;
  created_at: string;
  owner_id?: string;
}

function rowToAssignment(r: AssignmentRow): Assignment | null {
  const lesson = lessonSchema.safeParse(r.payload?.lesson);
  if (!lesson.success) return null;
  return {
    id: r.id,
    code: r.code,
    title: r.title,
    message: r.message,
    lessonId: r.lesson_id,
    lesson: lesson.data as Lesson,
    challengeIds: Array.isArray(r.payload.challengeIds) ? r.payload.challengeIds : [],
    open: r.open,
    createdAt: r.created_at,
    ...(r.owner_id ? { ownerId: r.owner_id } : {}),
  };
}

export async function createCloudAssignment(sb: SupabaseClient, a: Assignment): Promise<Assignment> {
  for (let i = 0; i < 4; i++) {
    const code = i === 0 ? a.code : makeCode();
    const { data, error } = await sb
      .from('assignments')
      .insert({ code, title: a.title, message: a.message, lesson_id: a.lessonId, payload: { lesson: a.lesson, challengeIds: a.challengeIds }, open: true })
      .select('*')
      .single();
    if (!error) {
      const out = rowToAssignment(data as AssignmentRow);
      if (out) return out;
      throw new Error('雲端回傳的任務格式不正確');
    }
    if (error.code !== '23505') throw error; // 代碼重複才重試
  }
  throw new Error('無法產生不重複的任務代碼，請再試一次');
}

export async function listCloudAssignments(sb: SupabaseClient): Promise<Assignment[]> {
  const { data, error } = await sb.from('assignments').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data as AssignmentRow[]).map(rowToAssignment).filter((x): x is Assignment => !!x);
}

export async function setCloudAssignmentOpen(sb: SupabaseClient, id: string, open: boolean): Promise<void> {
  const { error } = await sb.from('assignments').update({ open }).eq('id', id);
  if (error) throw error;
}

export async function deleteCloudAssignment(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.from('assignments').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchAssignmentByCode(sb: SupabaseClient, code: string): Promise<Assignment | null> {
  const { data, error } = await sb.rpc('get_assignment', { p_code: code });
  if (error) throw error;
  const row = (data as AssignmentRow[] | null)?.[0];
  return row ? rowToAssignment(row) : null;
}

interface AttemptRow {
  id: string;
  assignment_id: string;
  student_id: string;
  class_name: string;
  seat_no: string;
  student_name: string;
  results: ChallengeResult[];
  score: number | string;
  max_score: number | string;
  submitted_at: string;
  teacher_feedback: string;
  feedback_at: string | null;
}

function rowToAttempt(r: AttemptRow, a?: Pick<Assignment, 'code' | 'lessonId'>): Attempt {
  return {
    id: r.id,
    assignmentId: r.assignment_id,
    assignmentCode: a?.code ?? '',
    lessonId: a?.lessonId ?? '',
    student: { className: r.class_name, seatNo: r.seat_no, name: r.student_name },
    results: r.results,
    score: Number(r.score),
    maxScore: Number(r.max_score),
    submittedAt: r.submitted_at,
    teacherFeedback: r.teacher_feedback,
    feedbackAt: r.feedback_at,
    source: 'cloud',
  };
}

/** 學生沒有帳號：送出前以匿名身分登入（同一瀏覽器會沿用同一個匿名身分） */
export async function ensureStudentSession(sb: SupabaseClient): Promise<void> {
  const { data } = await sb.auth.getSession();
  if (data.session) return;
  const { error } = await sb.auth.signInAnonymously();
  if (error) throw error;
}

export async function submitCloudAttempt(sb: SupabaseClient, a: Assignment, student: StudentIdentity, results: ChallengeResult[], score: number, maxScore: number): Promise<Attempt> {
  await ensureStudentSession(sb);
  const { data, error } = await sb
    .from('attempts')
    .insert({ assignment_id: a.id, class_name: student.className, seat_no: student.seatNo, student_name: student.name, results, score, max_score: maxScore })
    .select('*')
    .single();
  if (error) throw error;
  return rowToAttempt(data as AttemptRow, a);
}

export async function listCloudAttempts(sb: SupabaseClient, a: Assignment): Promise<Attempt[]> {
  const { data, error } = await sb.from('attempts').select('*').eq('assignment_id', a.id).order('submitted_at', { ascending: false });
  if (error) throw error;
  return (data as AttemptRow[]).map((r) => rowToAttempt(r, a));
}

export async function listMyCloudAttempts(sb: SupabaseClient, a: Assignment): Promise<Attempt[]> {
  const { data: s } = await sb.auth.getSession();
  if (!s.session) return [];
  const { data, error } = await sb
    .from('attempts')
    .select('*')
    .eq('assignment_id', a.id)
    .eq('student_id', s.session.user.id)
    .order('submitted_at', { ascending: false });
  if (error) throw error;
  return (data as AttemptRow[]).map((r) => rowToAttempt(r, a));
}

export async function saveCloudFeedback(sb: SupabaseClient, attemptId: string, text: string): Promise<void> {
  const { error } = await sb.from('attempts').update({ teacher_feedback: text, feedback_at: new Date().toISOString() }).eq('id', attemptId);
  if (error) throw error;
}

// ─────────────────────────── 成績匯出 ───────────────────────────

export function attemptsToCsv(attempts: Attempt[], a: Assignment): string {
  const challenges = assignmentChallenges(a);
  const head = ['班級', '座號', '姓名', '總分', '滿分', ...challenges.map((c, i) => `第${i + 1}題 ${c.title}`), '繳交時間', '教師回饋'];
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = attempts.map((t) => [
    t.student.className,
    t.student.seatNo,
    t.student.name,
    t.score,
    t.maxScore,
    ...challenges.map((c) => {
      const r = t.results.find((x) => x.challengeId === c.id);
      return r ? `${r.score}/${r.maxScore}` : '-';
    }),
    new Date(t.submittedAt).toLocaleString('zh-TW', { hour12: false }),
    t.teacherFeedback,
  ]);
  return '﻿' + [head, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
}
