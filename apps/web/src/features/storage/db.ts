import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Formation, TacticProject } from '@btl/shared-types';

/**
 * 可替換的儲存介面：Phase 1 為 IndexedDB 實作；
 * Phase 2 可另寫 SupabaseRepository 並以同一介面接上同步佇列。
 */
export interface ProjectSummary {
  id: string;
  title: string;
  updatedAt: string;
  revision: number;
  courtMode: TacticProject['court']['mode'];
  teamSize: number;
  stepCount: number;
}

export interface TacticRepository {
  listProjects(): Promise<ProjectSummary[]>;
  getProject(id: string): Promise<TacticProject | undefined>;
  /** 寫入並由儲存層遞增 revision，回傳實際保存的版本 */
  saveProject(project: TacticProject): Promise<TacticProject>;
  deleteProject(id: string): Promise<void>;
  listFormations(): Promise<Formation[]>;
  replaceFormations(list: Formation[]): Promise<void>;
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta<T>(key: string, value: T): Promise<void>;
}

export interface SyncOperation {
  operationId: string;
  deviceId: string;
  entity: 'project' | 'formation';
  entityId: string;
  baseRevision: number;
  syncStatus: 'pending' | 'synced' | 'conflict';
  createdAt: string;
}

interface BtlDB extends DBSchema {
  projects: { key: string; value: TacticProject; indexes: { updatedAt: string } };
  formations: { key: string; value: Formation };
  meta: { key: string; value: unknown };
  /** 預留給 Phase 2 雲端同步佇列 */
  syncQueue: { key: string; value: SyncOperation };
}

export const DB_NAME = 'basketball-tactics-lab';
export const DB_VERSION = 1;

export class IndexedDbRepository implements TacticRepository {
  private dbp: Promise<IDBPDatabase<BtlDB>> | null = null;

  constructor(private readonly name = DB_NAME) {}

  private db(): Promise<IDBPDatabase<BtlDB>> {
    if (!this.dbp) {
      this.dbp = openDB<BtlDB>(this.name, DB_VERSION, {
        upgrade(db) {
          const projects = db.createObjectStore('projects', { keyPath: 'id' });
          projects.createIndex('updatedAt', 'updatedAt');
          db.createObjectStore('formations', { keyPath: 'id' });
          db.createObjectStore('meta');
          db.createObjectStore('syncQueue', { keyPath: 'operationId' });
        },
      });
    }
    return this.dbp;
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const all = await (await this.db()).getAll('projects');
    return all
      .map((p) => ({
        id: p.id,
        title: p.title,
        updatedAt: p.updatedAt,
        revision: p.revision,
        courtMode: p.court.mode,
        teamSize: p.teamSize,
        stepCount: p.steps.length,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getProject(id: string): Promise<TacticProject | undefined> {
    return (await this.db()).get('projects', id);
  }

  async saveProject(project: TacticProject): Promise<TacticProject> {
    const db = await this.db();
    const tx = db.transaction('projects', 'readwrite');
    const existing = await tx.store.get(project.id);
    const saved: TacticProject = {
      ...project,
      revision: Math.max(existing?.revision ?? 0, project.revision) + 1,
      updatedAt: new Date().toISOString(),
    };
    await tx.store.put(saved);
    await tx.done;
    return saved;
  }

  async deleteProject(id: string): Promise<void> {
    await (await this.db()).delete('projects', id);
  }

  async listFormations(): Promise<Formation[]> {
    const list = await (await this.db()).getAll('formations');
    return list.sort((a, b) => a.order - b.order);
  }

  async replaceFormations(list: Formation[]): Promise<void> {
    const db = await this.db();
    const tx = db.transaction('formations', 'readwrite');
    await tx.store.clear();
    for (const f of list) await tx.store.put(f);
    await tx.done;
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await (await this.db()).get('meta', key)) as T | undefined;
  }

  async setMeta<T>(key: string, value: T): Promise<void> {
    await (await this.db()).put('meta', value, key);
  }
}

export const repository: TacticRepository = new IndexedDbRepository();
