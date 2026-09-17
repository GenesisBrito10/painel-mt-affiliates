import { Injectable, Inject, Logger } from '@nestjs/common';
import type { Setting } from '@prisma/client';
import {
  SETTINGS_REPOSITORY,
  type ISettingsRepository,
} from '../domain/ports/settings.repository.js';
import {
  SettingNotFoundException,
  SettingProtectedKeyException,
} from '../domain/exceptions/settings.exceptions.js';
import {
  SETTINGS_CACHE_TTL_MS,
  PROTECTED_SETTINGS_KEYS,
} from '../domain/types/settings.types.js';
import type { CreateSettingDto } from './dto/create-setting.dto.js';
import type { SettingResponseDto } from './dto/setting-response.dto.js';

// ─── In-Memory Cache ──────────────────────────────────────────────────────────

interface CacheEntry {
  value: string;
  expiresAt: number;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @Inject(SETTINGS_REPOSITORY)
    private readonly repo: ISettingsRepository,
  ) {}

  // ─── Public API (consumed cross-module) ─────────────────────────────────────

  /**
   * Get a setting value by key. Returns null if not found.
   * Second call within TTL window is served from cache (0 DB queries).
   */
  async get(key: string): Promise<string | null> {
    const cached = this.fromCache(key);
    if (cached !== undefined) return cached;

    const setting = await this.repo.findByKey(key);
    if (!setting) return null;

    this.toCache(key, setting.value);
    return setting.value;
  }

  /**
   * Get a setting value by key. Throws SettingNotFoundException if absent.
   */
  async getRequired(key: string): Promise<string> {
    const value = await this.get(key);
    if (value === null) throw new SettingNotFoundException(key);
    return value;
  }

  /**
   * Batch read — executes 1 query for N cache-missing keys.
   * Second call within TTL returns from cache (0 queries).
   */
  async getMany(keys: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const missing: string[] = [];

    for (const key of keys) {
      const cached = this.fromCache(key);
      if (cached !== undefined) {
        result.set(key, cached);
      } else {
        missing.push(key);
      }
    }

    if (missing.length > 0) {
      const rows = await this.repo.findByKeys(missing);
      for (const row of rows) {
        this.toCache(row.key, row.value);
        result.set(row.key, row.value);
      }
    }

    return result;
  }

  /**
   * Create or update a setting (upsert). Invalidates cache on write.
   */
  async set(dto: CreateSettingDto): Promise<SettingResponseDto> {
    const setting = await this.repo.upsert({
      key: dto.key,
      value: dto.value,
      label: dto.label,
    });
    this.toCache(setting.key, setting.value);
    return this.toResponse(setting);
  }

  /**
   * Get a single setting by key. Throws SettingNotFoundException if absent.
   */
  async findByKey(key: string): Promise<SettingResponseDto> {
    const setting = await this.repo.findByKey(key);
    if (!setting) throw new SettingNotFoundException(key);
    return this.toResponse(setting);
  }

  /**
   * List all settings ordered by key.
   */
  async findAll(): Promise<SettingResponseDto[]> {
    const settings = await this.repo.findAll();
    return settings.map((s) => this.toResponse(s));
  }

  /**
   * Delete a setting by key.
   * Protected system keys cannot be deleted.
   */
  async delete(key: string): Promise<void> {
    if (PROTECTED_SETTINGS_KEYS.has(key)) {
      throw new SettingProtectedKeyException(key);
    }

    const existing = await this.repo.findByKey(key);
    if (!existing) throw new SettingNotFoundException(key);

    await this.repo.delete(key);
    this.cache.delete(key);
    this.logger.log(`Setting deleted: ${key}`);
  }

  // ─── Cache helpers ────────────────────────────────────────────────────────

  private fromCache(key: string): string | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  private toCache(key: string, value: string): void {
    this.cache.set(key, { value, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS });
  }

  // ─── Mapper ───────────────────────────────────────────────────────────────

  private toResponse(s: Setting): SettingResponseDto {
    return { id: s.id, key: s.key, value: s.value, label: s.label, updatedAt: s.updatedAt };
  }
}
