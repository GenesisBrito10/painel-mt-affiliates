import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { SettingsService } from './settings.service.js';
import {
  SETTINGS_REPOSITORY,
  type ISettingsRepository,
} from '../domain/ports/settings.repository.js';
import {
  SettingNotFoundException,
  SettingProtectedKeyException,
} from '../domain/exceptions/settings.exceptions.js';

// ─── Test Data ────────────────────────────────────────────────────────────────

const mockSetting = {
  id: 'uuid-1',
  key: 'withdrawal_block_active',
  value: 'false',
  label: 'Block withdrawals',
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ─── Repository Mock Factory ──────────────────────────────────────────────────

const makeRepo = (): Record<keyof ISettingsRepository, ReturnType<typeof vi.fn>> => ({
  findByKey: vi.fn(),
  findByKeys: vi.fn(),
  findAll: vi.fn(),
  upsert: vi.fn(),
  delete: vi.fn(),
});

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('SettingsService', () => {
  let service: SettingsService;
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(async () => {
    repo = makeRepo();
    const module = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: SETTINGS_REPOSITORY, useValue: repo },
      ],
    }).compile();
    service = module.get(SettingsService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── get() ──────────────────────────────────────────────────────────────────

  it('get() returns null for missing key', async () => {
    repo.findByKey.mockResolvedValue(null);
    expect(await service.get('missing_key')).toBeNull();
  });

  it('get() returns from cache on second call (0 extra DB queries)', async () => {
    repo.findByKey.mockResolvedValue(mockSetting);
    await service.get('withdrawal_block_active');
    await service.get('withdrawal_block_active');
    expect(repo.findByKey).toHaveBeenCalledTimes(1);
  });

  it('get() re-queries after cache TTL expires', async () => {
    vi.useFakeTimers();
    repo.findByKey.mockResolvedValue(mockSetting);

    await service.get('withdrawal_block_active');
    vi.advanceTimersByTime(31_000); // 31s > 30s TTL
    await service.get('withdrawal_block_active');

    expect(repo.findByKey).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  // ─── getRequired() ──────────────────────────────────────────────────────────

  it('getRequired() throws SettingNotFoundException for missing key', async () => {
    repo.findByKey.mockResolvedValue(null);
    await expect(service.getRequired('missing')).rejects.toThrow(SettingNotFoundException);
  });

  it('getRequired() returns value when key exists', async () => {
    repo.findByKey.mockResolvedValue(mockSetting);
    expect(await service.getRequired('withdrawal_block_active')).toBe('false');
  });

  // ─── getMany() ──────────────────────────────────────────────────────────────

  it('getMany() executes exactly 1 query for N cache-missing keys', async () => {
    const keys = ['key_a', 'key_b', 'key_c'];
    repo.findByKeys.mockResolvedValue(
      keys.map((k, i) => ({ ...mockSetting, id: `id-${i}`, key: k, value: `val-${k}` })),
    );
    const result = await service.getMany(keys);
    expect(repo.findByKeys).toHaveBeenCalledTimes(1);
    expect(result.size).toBe(3);
  });

  it('getMany() skips DB for already-cached keys', async () => {
    repo.findByKey.mockResolvedValue(mockSetting);
    await service.get('withdrawal_block_active'); // prime cache

    repo.findByKeys.mockResolvedValue([
      { ...mockSetting, id: 'id-2', key: 'min_withdrawal_amount', value: '100' },
    ]);
    const result = await service.getMany(['withdrawal_block_active', 'min_withdrawal_amount']);

    // Only 1 key was missing from cache → 1 findByKeys call with 1 key
    expect(repo.findByKeys).toHaveBeenCalledTimes(1);
    expect(repo.findByKeys).toHaveBeenCalledWith(['min_withdrawal_amount']);
    expect(result.size).toBe(2);
  });

  // ─── set() ──────────────────────────────────────────────────────────────────

  it('set() calls upsert and populates cache', async () => {
    const updated = { ...mockSetting, value: 'true' };
    repo.upsert.mockResolvedValue(updated);

    const result = await service.set({ key: 'withdrawal_block_active', value: 'true' });

    expect(repo.upsert).toHaveBeenCalledTimes(1);
    expect(result.value).toBe('true');

    // Subsequent get() should hit cache, not DB
    expect(await service.get('withdrawal_block_active')).toBe('true');
    expect(repo.findByKey).not.toHaveBeenCalled();
  });

  // ─── findByKey() ────────────────────────────────────────────────────────────

  it('findByKey() throws SettingNotFoundException when not found', async () => {
    repo.findByKey.mockResolvedValue(null);
    await expect(service.findByKey('missing')).rejects.toThrow(SettingNotFoundException);
  });

  it('findByKey() returns mapped response when found', async () => {
    repo.findByKey.mockResolvedValue(mockSetting);
    const result = await service.findByKey('withdrawal_block_active');
    expect(result.key).toBe('withdrawal_block_active');
    expect(result.value).toBe('false');
  });

  // ─── findAll() ──────────────────────────────────────────────────────────────

  it('findAll() returns mapped list', async () => {
    repo.findAll.mockResolvedValue([mockSetting]);
    const result = await service.findAll();
    expect(result).toHaveLength(1);
    expect(result[0]?.key).toBe('withdrawal_block_active');
  });

  // ─── delete() ───────────────────────────────────────────────────────────────

  it('delete() throws SettingProtectedKeyException for protected keys', async () => {
    await expect(service.delete('withdrawal_block_active')).rejects.toThrow(
      SettingProtectedKeyException,
    );
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('delete() throws SettingProtectedKeyException for min_withdrawal_amount', async () => {
    await expect(service.delete('min_withdrawal_amount')).rejects.toThrow(
      SettingProtectedKeyException,
    );
  });

  it('delete() throws SettingNotFoundException for non-existent key', async () => {
    repo.findByKey.mockResolvedValue(null);
    await expect(service.delete('non_existent_key')).rejects.toThrow(SettingNotFoundException);
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('delete() removes from cache after successful deletion', async () => {
    const nonProtectedSetting = { ...mockSetting, key: 'custom_key' };
    repo.findByKey.mockResolvedValue(nonProtectedSetting);
    repo.delete.mockResolvedValue(undefined);

    // Prime cache (call 1)
    await service.get('custom_key');
    expect(repo.findByKey).toHaveBeenCalledTimes(1);

    // Delete — internally calls findByKey to confirm existence (call 2)
    await service.delete('custom_key');
    expect(repo.delete).toHaveBeenCalledWith('custom_key');

    // Next get() should query DB again since cache was evicted (call 3)
    repo.findByKey.mockResolvedValue(null);
    const after = await service.get('custom_key');
    expect(after).toBeNull();
    expect(repo.findByKey).toHaveBeenCalledTimes(3);
  });
});
