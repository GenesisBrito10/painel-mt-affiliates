import { describe, expect, it } from 'vitest';
import {
  BetanoDiarioMetricsSchemaError,
  parseBetanoDiarioMetricTabDate,
  parseBetanoDiarioMetricsTab,
} from './betano-diario-metrics.parser.js';

const LINK =
  'https://kg-br.com/C.ashx?btag=x&affid=14620&siteid=52769&c=VALLEX101';

describe('Betano Diario dated metrics parser', () => {
  it('accepts only real dd/MM/yyyy dates', () => {
    expect(parseBetanoDiarioMetricTabDate('03/09/2026')).toEqual(
      new Date('2026-09-03T00:00:00.000Z'),
    );
    expect(parseBetanoDiarioMetricTabDate('31/02/2026')).toBeNull();
    expect(parseBetanoDiarioMetricTabDate('2026-09-03')).toBeNull();
    expect(parseBetanoDiarioMetricTabDate('LINKS')).toBeNull();
  });

  it('reads headers from row 2 and maps explicit metrics', () => {
    const parsed = parseBetanoDiarioMetricsTab('03/09/2026', [
      ['', 'VALLEX GROUP - BETANO'],
      ['LINKS', 'CLICKS', 'REGISTROS', 'FTDs', 'FTD AMOUNT', 'CPA'],
      [LINK, '3', '2', '1', 'R$ 20,00', '1'],
    ]);

    expect(parsed).toEqual({
      rows: [
        {
          tab: '03/09/2026',
          rowIndex: 3,
          date: new Date('2026-09-03T00:00:00.000Z'),
          link: LINK,
          campaignId: '52769-VALLEX101',
          affiliateId: '52769',
          clicks: 3,
          registrations: 2,
          ftds: 1,
          deposit: 20,
          cpaQualified: 1,
        },
      ],
      issues: [],
    });
  });

  it('skips rows with blank links or entirely blank metrics but persists explicit zeroes', () => {
    const parsed = parseBetanoDiarioMetricsTab('03/09/2026', [
      [],
      ['LINKS', 'CLICKS', 'REGISTROS', 'FTDs', 'FTD AMOUNT', 'CPA'],
      [LINK, '', '', '', '', ''],
      ['', '1', '1', '1', '20', '1'],
      [LINK, '0', '0', '0', '0', '0'],
    ]);

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      rowIndex: 5,
      clicks: 0,
      registrations: 0,
      ftds: 0,
      deposit: 0,
      cpaQualified: 0,
    });
  });

  it('reports invalid populated rows without converting them to zero', () => {
    const parsed = parseBetanoDiarioMetricsTab('03/09/2026', [
      [],
      ['LINKS', 'CLICKS', 'REGISTROS', 'FTDs', 'FTD AMOUNT', 'CPA'],
      [LINK, '-1', '2.5', 'x', 'R$ nope', '1'],
      ['https://example.com/no-campaign', '1', '2', '3', '4', '5'],
    ]);

    expect(parsed.rows).toEqual([]);
    expect(parsed.issues).toEqual([
      expect.objectContaining({ tab: '03/09/2026', rowIndex: 3 }),
      expect.objectContaining({ tab: '03/09/2026', rowIndex: 4 }),
    ]);
  });

  it.each([
    { headers: ['LINKS', 'CLICKS', 'REGISTROS', 'FTDs', 'CPA'] },
    {
      headers: [
        'LINKS',
        'CLICKS',
        'REGISTROS',
        'FTDs',
        'FTD AMOUNT',
        'CPA',
        'cpa',
      ],
    },
  ])('rejects missing or duplicate required headers', ({ headers }) => {
    expect(() =>
      parseBetanoDiarioMetricsTab('03/09/2026', [[], headers]),
    ).toThrow(BetanoDiarioMetricsSchemaError);
  });
});
