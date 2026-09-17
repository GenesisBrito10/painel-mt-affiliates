import { describe, expect, it } from 'vitest';
import {
  argumentValue,
  BETANO_DIARIO_RESET_TABLES,
  buildSheetControlRanges,
  compareResetManifest,
  partitionInventoryTables,
  resetQueryParams,
  resetSnapshotToken,
  summarizeMoney,
} from './reset-betano-diario.js';

describe('Betano Diario reset helpers', () => {
  it('reads reset arguments in spaced and equals forms', () => {
    expect(argumentValue(['node', 'script', '--snapshot-token', 'abc'], '--snapshot-token')).toBe(
      'abc',
    );
    expect(argumentValue(['node', 'script', '--snapshot-token=abc'], '--snapshot-token')).toBe(
      'abc',
    );
  });

  it('keeps dependent records before their parent records', () => {
    expect(
      BETANO_DIARIO_RESET_TABLES.indexOf('link_webhook_deliveries'),
    ).toBeLessThan(BETANO_DIARIO_RESET_TABLES.indexOf('link_requests'));
    expect(
      BETANO_DIARIO_RESET_TABLES.indexOf('affiliate_data_change_logs'),
    ).toBeLessThan(BETANO_DIARIO_RESET_TABLES.indexOf('affiliate_data'));
    expect(BETANO_DIARIO_RESET_TABLES.at(-1)).toBe('affiliate_links');
  });

  it('hashes snapshots deterministically without volatile metadata', () => {
    const left = resetSnapshotToken({
      generatedAt: 'one',
      tables: { b: 2, a: 1 },
    });
    const right = resetSnapshotToken({
      generatedAt: 'two',
      tables: { a: 1, b: 2 },
    });
    expect(left).toBe(right);
    expect(left).toMatch(/^[a-f0-9]{64}$/);
  });

  it('keeps the snapshot hash after dates are serialized to JSON', () => {
    const snapshot = {
      generatedAt: 'volatile',
      rows: [{ createdAt: new Date('2026-09-03T12:00:00.000Z') }],
    };

    expect(resetSnapshotToken(snapshot)).toBe(
      resetSnapshotToken(JSON.parse(JSON.stringify(snapshot))),
    );
  });

  it('reports manifest drift by table and fingerprint', () => {
    expect(
      compareResetManifest(
        { affiliate_data: { count: 2, fingerprint: 'a' } },
        { affiliate_data: { count: 3, fingerprint: 'b' } },
      ),
    ).toEqual(['affiliate_data: count 2 -> 3, fingerprint a -> b']);
  });

  it('reports unknown inventory tables instead of silently ignoring them', () => {
    expect(
      partitionInventoryTables(['affiliate_data', 'future_table']),
    ).toEqual({
      known: ['affiliate_data'],
      unknown: ['future_table'],
    });
  });

  it('binds only the parameters referenced by each reset predicate', () => {
    const campaigns = ['campaign-1'];

    expect(resetQueryParams('"bettingHouse" = $1', 'betano-diario', campaigns)).toEqual([
      'betano-diario',
    ]);
    expect(
      resetQueryParams(
        '"bettingHouse" = $1 OR "campaignId" = ANY($2::text[])',
        'betano-diario',
        campaigns,
      ),
    ).toEqual(['betano-diario', campaigns]);
  });

  it('adds decimal monetary totals safely', () => {
    expect(summarizeMoney(['10.10', '0.20', null])).toBe('10.30');
  });

  it('generates only STATUS and E-MAIL control-cell ranges', () => {
    expect(
      buildSheetControlRanges('LINKS', ['LINK', 'STATUS', 'E-MAIL'], 4),
    ).toEqual(["'LINKS'!B2:B4", "'LINKS'!C2:C4"]);
  });
});
