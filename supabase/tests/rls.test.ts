import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * 以 PGlite（WebAssembly 版 PostgreSQL）載入與正式環境相同的 migration，
 * 模擬 Supabase 的 anon／authenticated 角色與 JWT，驗證資料權限（RLS）。
 */
const TEACHER_A = '00000000-0000-4000-8000-00000000000a';
const TEACHER_B = '00000000-0000-4000-8000-00000000000b';
const STUDENT_1 = '00000000-0000-4000-8000-000000000001';
const STUDENT_2 = '00000000-0000-4000-8000-000000000002';

type Who = 'anon' | { sub: string; anonymous: boolean };
const teacherA: Who = { sub: TEACHER_A, anonymous: false };
const teacherB: Who = { sub: TEACHER_B, anonymous: false };
const student1: Who = { sub: STUDENT_1, anonymous: true };
const student2: Who = { sub: STUDENT_2, anonymous: true };

let db: PGlite;

const SUPABASE_SHIM = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
grant usage on schema auth, public to anon, authenticated;
grant execute on all functions in schema auth to anon, authenticated;
`;

async function as<T>(who: Who, fn: () => Promise<T>): Promise<T> {
  if (who === 'anon') {
    await db.exec(`select set_config('request.jwt.claims', '{"role":"anon"}', false); set role anon;`);
  } else {
    const claims = JSON.stringify({ sub: who.sub, role: 'authenticated', is_anonymous: who.anonymous });
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
    await db.exec('set role authenticated;');
  }
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claims', '', false);`);
  }
}

const q = (sql: string, params: unknown[] = []) => db.query<Record<string, unknown>>(sql, params);

async function expectDenied(p: Promise<unknown>) {
  await expect(p).rejects.toThrow(/row-level security|permission denied/);
}

let openId = '';
let closedId = '';

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_SHIM);
  const dir = join(import.meta.dirname, '..', 'migrations');
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(join(dir, f), 'utf8'));

  await as(teacherA, async () => {
    const r = await q(
      `insert into assignments (code, title, lesson_id, payload) values ('OPEN01', '傳切練習', 'give-and-go', '{}'), ('SHUT01', '已關閉', 'give-and-go', '{}') returning id, code`,
    );
    openId = r.rows.find((x) => x.code === 'OPEN01')!.id as string;
    closedId = r.rows.find((x) => x.code === 'SHUT01')!.id as string;
    await q(`update assignments set open = false where id = $1`, [closedId]);
  });
});

const attemptSql = `insert into attempts (assignment_id, class_name, seat_no, student_name, results, score, max_score) values ($1, '801', '5', '王小明', '[]', 20, 30) returning id`;

describe('任務（教師發布的教材）', () => {
  it('教師 B 看不到、改不了教師 A 的任務', async () => {
    await as(teacherB, async () => {
      expect((await q('select * from assignments')).rows).toHaveLength(0);
      const u = await q(`update assignments set title = '被改了' where id = $1 returning id`, [openId]);
      expect(u.rows).toHaveLength(0);
      const d = await q(`delete from assignments where id = $1 returning id`, [openId]);
      expect(d.rows).toHaveLength(0);
    });
  });

  it('學生不能列出任務、不能修改或刪除教師教材', async () => {
    await as(student1, async () => {
      expect((await q('select * from assignments')).rows).toHaveLength(0);
      expect((await q(`update assignments set title = 'x' where id = $1 returning id`, [openId])).rows).toHaveLength(0);
      expect((await q(`delete from assignments where id = $1 returning id`, [openId])).rows).toHaveLength(0);
      await expectDenied(q(`insert into assignments (code, title, lesson_id, payload) values ('HACK01', 'x', 'x', '{}')`));
    });
    await as(teacherA, async () => {
      const r = await q(`select title from assignments where id = $1`, [openId]);
      expect(r.rows[0]!.title).toBe('傳切練習');
    });
  });

  it('學生與未登入者可用代碼讀取任務（不分大小寫），但不會拿到擁有者資訊', async () => {
    for (const who of [student1, 'anon'] as Who[]) {
      await as(who, async () => {
        const r = await q(`select * from get_assignment('open01')`);
        expect(r.rows).toHaveLength(1);
        expect(r.rows[0]!.title).toBe('傳切練習');
        expect(r.rows[0]).not.toHaveProperty('owner_id');
      });
    }
  });

  it('未登入者不能直接查詢資料表', async () => {
    await as('anon', async () => {
      await expectDenied(q('select * from assignments'));
      await expectDenied(q('select * from attempts'));
      await expectDenied(q('select * from projects'));
    });
  });

  it('任務代碼格式受限制', async () => {
    await as(teacherA, async () => {
      await expect(q(`insert into assignments (code, title, lesson_id, payload) values ('bad', 'x', 'x', '{}')`)).rejects.toThrow(/check/);
    });
  });
});

describe('學生作答紀錄', () => {
  let attempt1 = '';

  it('學生可以替自己在開放中的任務新增作答', async () => {
    attempt1 = await as(student1, async () => (await q(attemptSql, [openId])).rows[0]!.id as string);
    expect(attempt1).toBeTruthy();
  });

  it('不能新增到已關閉的任務', async () => {
    await as(student1, async () => expectDenied(q(attemptSql, [closedId])));
  });

  it('不能冒用其他學生身分', async () => {
    await as(student1, async () =>
      expectDenied(
        q(
          `insert into attempts (assignment_id, student_id, class_name, seat_no, student_name, results, score, max_score) values ($1, $2, '801', '6', '冒名', '[]', 30, 30)`,
          [openId, STUDENT_2],
        ),
      ),
    );
  });

  it('不能自己寫入老師回饋', async () => {
    await as(student1, async () =>
      expectDenied(
        q(`insert into attempts (assignment_id, class_name, seat_no, student_name, results, score, max_score, teacher_feedback) values ($1, '801', '5', '王小明', '[]', 30, 30, '滿分！')`, [openId]),
      ),
    );
  });

  it('未登入者不能交作業', async () => {
    await as('anon', async () => expectDenied(q(attemptSql, [openId])));
  });

  it('學生只看得到自己的作答', async () => {
    await as(student2, async () => {
      await q(attemptSql, [openId]);
      const r = await q('select student_id from attempts');
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]!.student_id).toBe(STUDENT_2);
    });
  });

  it('學生不能修改分數、也不能改回饋', async () => {
    await as(student1, async () => {
      await expectDenied(q(`update attempts set score = 30 where id = $1`, [attempt1]));
      const r = await q(`update attempts set teacher_feedback = '我很棒' where id = $1 returning id`, [attempt1]);
      expect(r.rows).toHaveLength(0);
    });
  });

  it('教師 A 看得到自己任務的所有作答，可以寫回饋，但不能改分數', async () => {
    await as(teacherA, async () => {
      const r = await q('select * from attempts where assignment_id = $1', [openId]);
      expect(r.rows).toHaveLength(2);
      const u = await q(`update attempts set teacher_feedback = '空切時機很好', feedback_at = now() where id = $1 returning id`, [attempt1]);
      expect(u.rows).toHaveLength(1);
      await expectDenied(q(`update attempts set score = 0 where id = $1`, [attempt1]));
    });
    await as(student1, async () => {
      const r = await q('select teacher_feedback, score from attempts where id = $1', [attempt1]);
      expect(r.rows[0]).toMatchObject({ teacher_feedback: '空切時機很好' });
      expect(Number(r.rows[0]!.score)).toBe(20);
    });
  });

  it('教師 B 看不到、也不能回饋教師 A 任務的作答', async () => {
    await as(teacherB, async () => {
      expect((await q('select * from attempts')).rows).toHaveLength(0);
      expect((await q(`update attempts set teacher_feedback = 'x' where id = $1 returning id`, [attempt1])).rows).toHaveLength(0);
    });
  });

  it('分數不可大於滿分', async () => {
    await as(student1, async () => {
      await expect(
        q(`insert into attempts (assignment_id, class_name, seat_no, student_name, results, score, max_score) values ($1, '801', '5', '王小明', '[]', 99, 30)`, [openId]),
      ).rejects.toThrow(/check/);
    });
  });
});

describe('教師戰術同步（projects）', () => {
  it('只有擁有者可讀寫；匿名學生不能建立', async () => {
    await as(teacherA, async () => {
      await q(`insert into projects (id, title, data) values ('p1', '傳切', '{}')`);
    });
    await as(teacherB, async () => {
      expect((await q('select * from projects')).rows).toHaveLength(0);
      expect((await q(`update projects set title = 'x', revision = 2 where id = 'p1' returning id`)).rows).toHaveLength(0);
    });
    await as(student1, async () => {
      expect((await q('select * from projects')).rows).toHaveLength(0);
      await expectDenied(q(`insert into projects (id, title, data) values ('p2', 'x', '{}')`));
    });
  });

  it('修訂版只能 +1：舊版本覆寫會被拒絕（不靜默覆寫）', async () => {
    await as(teacherA, async () => {
      const ok = await q(`update projects set title = 'v2', revision = 2 where id = 'p1' and revision = 1 returning revision`);
      expect(ok.rows[0]!.revision).toBe(2);
      // 另一台裝置仍以 revision 1 為基準 → 條件不符，0 筆
      const stale = await q(`update projects set title = 'stale', revision = 2 where id = 'p1' and revision = 1 returning revision`);
      expect(stale.rows).toHaveLength(0);
      // 就算不加條件，跳號也會被觸發器拒絕
      await expect(q(`update projects set title = 'jump', revision = 9 where id = 'p1'`)).rejects.toThrow(/revision_conflict/);
      // 不能把戰術轉給別人
      await q(`update projects set owner_id = $1, revision = 3 where id = 'p1'`, [TEACHER_B]);
      const r = await q(`select owner_id, title from projects where id = 'p1'`);
      expect(r.rows[0]).toMatchObject({ owner_id: TEACHER_A, title: 'v2' });
    });
  });
});
