import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import {
  assertRollbackState,
  sha256,
  stableJson,
  validateBackup,
} from './pinbet-diario-mensal-migration.mjs';

const backup = {
  tables: {
    links: [{ id: 'l1', cpa: '100.0000' }],
    withdrawals: [{ id: 'w1', status: 'PENDING' }],
  },
};

const manifestFor = (value: typeof backup) => ({
  backupSha256: sha256(stableJson(value)),
  counts: { links: 1, withdrawals: 1 },
});

describe('Pinbet migration backup guards', () => {
  it('rejects a changed hash or table count', () => {
    expect(() =>
      validateBackup(
        { ...backup, tables: { ...backup.tables, links: [] } },
        manifestFor(backup),
      ),
    ).toThrow(/hash/i);

    expect(() =>
      validateBackup(backup, {
        ...manifestFor(backup),
        counts: { links: 2, withdrawals: 1 },
      }),
    ).toThrow(/contagem/i);
  });

  it('rejects duplicate row ids', () => {
    const duplicated = {
      tables: {
        links: [
          { id: 'l1', cpa: '100.0000' },
          { id: 'l1', cpa: '200.0000' },
        ],
      },
    };
    expect(() =>
      validateBackup(duplicated, {
        backupSha256: sha256(stableJson(duplicated)),
        counts: { links: 2 },
      }),
    ).toThrow(/duplicados/i);
  });

  it('rejects rollback when current state drifted', () => {
    expect(() =>
      assertRollbackState(
        [{ id: 'w1', status: 'COMPLETED' }],
        [{ id: 'w1', status: 'FAILED' }],
      ),
    ).toThrow(/divergente/i);
  });

  it('serializes decimals and dates deterministically', () => {
    expect(
      JSON.parse(
        stableJson({
          amount: new Decimal('10.2300'),
          createdAt: new Date('2026-08-05T10:00:00.000Z'),
        }),
      ),
    ).toEqual({ amount: '10.23', createdAt: '2026-08-05T10:00:00.000Z' });
  });
});
