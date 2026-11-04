import type { SupabaseClient } from '@supabase/supabase-js';
import type { TacticProject } from '@btl/shared-types';
import type { RemoteRecord } from '../storage/db';
import type { RemoteProjectStore, RemoteWrite } from '../sync/syncEngine';

interface Row {
  id: string;
  title: string;
  data: TacticProject;
  revision: number;
  last_operation_id: string | null;
  deleted: boolean;
  updated_at: string;
}

const COLS = 'id,title,data,revision,last_operation_id,deleted,updated_at';

function toRecord(r: Row): RemoteRecord {
  return { id: r.id, title: r.title, data: r.data, revision: r.revision, lastOperationId: r.last_operation_id, deleted: r.deleted, updatedAt: r.updated_at };
}

/** Supabase 版的雲端戰術存取（RLS 確保只會讀寫自己的資料） */
export class SupabaseProjectStore implements RemoteProjectStore {
  constructor(private readonly sb: SupabaseClient) {}

  async list(): Promise<RemoteRecord[]> {
    const { data, error } = await this.sb.from('projects').select(COLS);
    if (error) throw error;
    return (data as Row[]).map(toRecord);
  }

  async get(id: string): Promise<RemoteRecord | null> {
    const { data, error } = await this.sb.from('projects').select(COLS).eq('id', id).maybeSingle();
    if (error) throw error;
    return data ? toRecord(data as Row) : null;
  }

  async insert(w: RemoteWrite) {
    const { data, error } = await this.sb
      .from('projects')
      .insert({ id: w.id, title: w.title, data: w.data, deleted: w.deleted, last_operation_id: w.operationId, device_id: w.deviceId })
      .select('revision')
      .single();
    if (error) {
      if (error.code === '23505') return { ok: false as const };
      throw error;
    }
    return { ok: true as const, revision: (data as { revision: number }).revision };
  }

  async update(id: string, base: number, w: RemoteWrite) {
    const { data, error } = await this.sb
      .from('projects')
      .update({ title: w.title, data: w.data, deleted: w.deleted, revision: base + 1, last_operation_id: w.operationId, device_id: w.deviceId })
      .eq('id', id)
      .eq('revision', base)
      .select('revision');
    if (error) {
      if (error.code === '40001') return { ok: false as const };
      throw error;
    }
    const rows = data as { revision: number }[];
    return rows[0] ? { ok: true as const, revision: rows[0].revision } : { ok: false as const };
  }
}
