import type { Setting } from '@prisma/client';

// ─── Injection Token ──────────────────────────────────────────────────────────

export const SETTINGS_REPOSITORY = Symbol('ISettingsRepository');

// ─── Write Input ──────────────────────────────────────────────────────────────

export interface SettingCreateData {
  key: string;
  value: string;
  label?: string;
}

// ─── Repository Port ──────────────────────────────────────────────────────────

export interface ISettingsRepository {
  findByKey(key: string): Promise<Setting | null>;
  findByKeys(keys: string[]): Promise<Setting[]>;
  findAll(): Promise<Setting[]>;
  upsert(data: SettingCreateData): Promise<Setting>;
  delete(key: string): Promise<void>;
}
