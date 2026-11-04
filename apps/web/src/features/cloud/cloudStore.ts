import { create } from 'zustand';
import type { SyncConflict } from '../storage/db';

export interface CloudUser {
  id: string;
  email: string | null;
  isAnonymous: boolean;
}

export type SyncState = 'disabled' | 'signed-out' | 'idle' | 'syncing' | 'offline' | 'error';

export interface CloudState {
  configured: boolean;
  user: CloudUser | null;
  sync: SyncState;
  pending: number;
  conflicts: SyncConflict[];
  lastSyncAt: string | null;
  error: string | null;
  dialogOpen: boolean;
  set: (patch: Partial<Omit<CloudState, 'set'>>) => void;
}

export const useCloud = create<CloudState>()((set) => ({
  configured: false,
  user: null,
  sync: 'disabled',
  pending: 0,
  conflicts: [],
  lastSyncAt: null,
  error: null,
  dialogOpen: false,
  set: (patch) => set(patch),
}));

export const isTeacherUser = (u: CloudUser | null): u is CloudUser => !!u && !u.isAnonymous;
