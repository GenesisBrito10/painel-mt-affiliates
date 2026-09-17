import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { BetanoDiarioMetricsSheetService } from './betano-diario-metrics-sheet.service.js';

const LINK = 'https://kg-br.com/C.ashx?siteid=52769&c=VALLEX101';

describe('BetanoDiarioMetricsSheetService', () => {
  it('discovers dated tabs through today and excludes future or non-date tabs', async () => {
    const getMetadata = vi.fn().mockResolvedValue({
      data: {
        sheets: [
          { properties: { title: 'LINKS' } },
          { properties: { title: '02/09/2026' } },
          { properties: { title: '03/09/2026' } },
          { properties: { title: '04/09/2026' } },
        ],
      },
    });
    const batchGet = vi.fn().mockResolvedValue({
      data: {
        valueRanges: [
          {
            values: [
              [],
              ['LINKS', 'CLICKS', 'REGISTROS', 'FTDs', 'FTD AMOUNT', 'CPA'],
              [LINK, '1', '2', '3', '40,50', '1'],
            ],
          },
          {
            values: [
              [],
              ['LINKS', 'CLICKS', 'REGISTROS', 'FTDs', 'FTD AMOUNT', 'CPA'],
              [LINK, '', '', '', '', ''],
            ],
          },
        ],
      },
    });
    const service = new BetanoDiarioMetricsSheetService({} as ConfigService);
    Object.assign(service, {
      sheets: {
        spreadsheets: {
          get: getMetadata,
          values: { batchGet },
        },
      },
      sheetId: 'sheet-1',
    });

    const result = await service.readMetrics(
      new Date('2026-09-03T15:00:00.000Z'),
    );

    expect(batchGet).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-1',
      ranges: ["'02/09/2026'!A1:F", "'03/09/2026'!A1:F"],
    });
    expect(result.tabs).toEqual(['02/09/2026', '03/09/2026']);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ deposit: 40.5, cpaQualified: 1 });
  });

  it('returns no rows when the spreadsheet has no eligible dated tab', async () => {
    const batchGet = vi.fn();
    const service = new BetanoDiarioMetricsSheetService({} as ConfigService);
    Object.assign(service, {
      sheets: {
        spreadsheets: {
          get: vi.fn().mockResolvedValue({
            data: { sheets: [{ properties: { title: 'LINKS' } }] },
          }),
          values: { batchGet },
        },
      },
      sheetId: 'sheet-1',
    });

    await expect(service.readMetrics()).resolves.toEqual({
      tabs: [],
      rows: [],
      issues: [],
    });
    expect(batchGet).not.toHaveBeenCalled();
  });
});
