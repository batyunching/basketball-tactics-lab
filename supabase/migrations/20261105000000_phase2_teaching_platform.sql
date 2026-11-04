-- ════════════════════════════════════════════════════════════════════
-- 籃球戰術教學平台 Phase 2：雲端同步、任務發布、學生作答
-- 角色：
--   教師 = 以 Email 登入的使用者（非匿名）
--   學生 = 匿名登入（Supabase Anonymous Sign-in），不需建立帳號
-- 原則：學生只能透過任務代碼讀取教材快照、只能新增／讀取自己的作答；
--       不能讀取或修改任何教師資料。所有規則由 RLS 在資料庫端強制執行。
-- ════════════════════════════════════════════════════════════════════

create or replace function public.is_teacher()
returns boolean
language sql
stable
as $$
  select auth.uid() is not null
     and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
$$;

-- ─────────────── 教師戰術（同步用） ───────────────
create table if not exists public.projects (
  id text primary key check (char_length(id) between 1 and 100),
  owner_id uuid not null default auth.uid(),
  title text not null default '' check (char_length(title) <= 200),
  data jsonb not null check (pg_column_size(data) < 2000000),
  revision integer not null default 1 check (revision >= 1),
  last_operation_id text,
  device_id text,
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists projects_owner_idx on public.projects (owner_id, updated_at desc);

-- 修訂版只能 +1（伺服器端的 compare-and-swap 保護），擁有者不可更改
create or replace function public.projects_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
  else
    if new.revision <> old.revision + 1 then
      raise exception 'revision_conflict' using errcode = '40001';
    end if;
    new.owner_id := old.owner_id;
    new.id := old.id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists projects_guard on public.projects;
create trigger projects_guard before insert or update on public.projects
  for each row execute function public.projects_guard();

alter table public.projects enable row level security;
drop policy if exists projects_select on public.projects;
drop policy if exists projects_insert on public.projects;
drop policy if exists projects_update on public.projects;
create policy projects_select on public.projects for select to authenticated
  using (owner_id = auth.uid() and public.is_teacher());
create policy projects_insert on public.projects for insert to authenticated
  with check (owner_id = auth.uid() and public.is_teacher());
create policy projects_update on public.projects for update to authenticated
  using (owner_id = auth.uid() and public.is_teacher())
  with check (owner_id = auth.uid());
revoke all on public.projects from anon, authenticated;
grant select, insert, update on public.projects to authenticated;

-- ─────────────── 任務（教師發布的教材快照） ───────────────
create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  owner_id uuid not null default auth.uid(),
  title text not null check (char_length(title) between 1 and 120),
  message text not null default '' check (char_length(message) <= 1000),
  lesson_id text not null,
  payload jsonb not null check (pg_column_size(payload) < 2000000),
  open boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists assignments_owner_idx on public.assignments (owner_id, created_at desc);

alter table public.assignments enable row level security;
drop policy if exists assignments_owner_all on public.assignments;
create policy assignments_owner_all on public.assignments for all to authenticated
  using (owner_id = auth.uid() and public.is_teacher())
  with check (owner_id = auth.uid() and public.is_teacher());
revoke all on public.assignments from anon, authenticated;
grant select, insert, update, delete on public.assignments to authenticated;

-- 學生用代碼取得任務（不能列出全部任務，也看不到擁有者）
create or replace function public.get_assignment(p_code text)
returns table (id uuid, code text, title text, message text, lesson_id text, payload jsonb, open boolean, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.code, a.title, a.message, a.lesson_id, a.payload, a.open, a.created_at
  from public.assignments a
  where a.code = upper(trim(p_code))
$$;
revoke all on function public.get_assignment(text) from public;
grant execute on function public.get_assignment(text) to anon, authenticated;

create or replace function public.assignment_is_open(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select a.open from public.assignments a where a.id = p_id), false)
$$;
revoke all on function public.assignment_is_open(uuid) from public;
grant execute on function public.assignment_is_open(uuid) to authenticated;

-- ─────────────── 學生作答 ───────────────
create table if not exists public.attempts (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  student_id uuid not null default auth.uid(),
  class_name text not null check (char_length(trim(class_name)) between 1 and 20),
  seat_no text not null check (char_length(trim(seat_no)) between 1 and 10),
  student_name text not null check (char_length(trim(student_name)) between 1 and 30),
  results jsonb not null check (jsonb_typeof(results) = 'array' and pg_column_size(results) < 200000),
  score numeric not null check (score >= 0),
  max_score numeric not null check (max_score >= 0 and score <= max_score),
  submitted_at timestamptz not null default now(),
  teacher_feedback text not null default '' check (char_length(teacher_feedback) <= 2000),
  feedback_at timestamptz
);
create index if not exists attempts_assignment_idx on public.attempts (assignment_id, submitted_at desc);
create index if not exists attempts_student_idx on public.attempts (student_id);

alter table public.attempts enable row level security;
drop policy if exists attempts_student_insert on public.attempts;
drop policy if exists attempts_student_select on public.attempts;
drop policy if exists attempts_teacher_select on public.attempts;
drop policy if exists attempts_teacher_update on public.attempts;
-- 學生：只能替自己、在開放中的任務新增作答，且不能自己寫回饋
create policy attempts_student_insert on public.attempts for insert to authenticated
  with check (
    student_id = auth.uid()
    and public.assignment_is_open(assignment_id)
    and teacher_feedback = ''
    and feedback_at is null
  );
-- 學生：只能讀自己的作答（看老師回饋）
create policy attempts_student_select on public.attempts for select to authenticated
  using (student_id = auth.uid());
-- 教師：只能讀、回饋自己任務的作答
create policy attempts_teacher_select on public.attempts for select to authenticated
  using (exists (select 1 from public.assignments a where a.id = assignment_id and a.owner_id = auth.uid()));
create policy attempts_teacher_update on public.attempts for update to authenticated
  using (exists (select 1 from public.assignments a where a.id = assignment_id and a.owner_id = auth.uid()))
  with check (exists (select 1 from public.assignments a where a.id = assignment_id and a.owner_id = auth.uid()));
revoke all on public.attempts from anon, authenticated;
grant select, insert on public.attempts to authenticated;
-- 欄位層級：更新只允許回饋欄位（分數、答案不可被任何人改）
grant update (teacher_feedback, feedback_at) on public.attempts to authenticated;
