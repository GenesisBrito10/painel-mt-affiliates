import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { BetanoDiarioSheetService } from './betano-diario-sheet.service.js';

describe('BetanoDiarioSheetService', () => {
  it('reads LINKS and writes only its resolved control cells', async () => {
    const get = vi.fn().mockResolvedValue({
      data: {
        values: [
          ['E-MAIL', 'LINK', 'STATUS'],
          ['', 'https://kg-br.com/C.ashx?siteid=52769&c=VALLEX101', ''],
        ],
      },
    });
    const batchUpdate = vi.fn().mockResolvedValue({ data: {} });
    const service = new BetanoDiarioSheetService({} as ConfigService);
    Object.assign(service, {
      sheets: { spreadsheets: { values: { get, batchUpdate } } },
      sheetId: 'sheet-1',
      sheetTab: 'LINKS',
    });

    const rows = await service.readPool();
    await service.markRowUsed(2, 'user@example.com');

    expect(get).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-1',
      range: "'LINKS'!A1:ZZ",
    });
    expect(rows[0]?.rowIndex).toBe(2);
    expect(batchUpdate).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-1',
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          { range: "'LINKS'!C2", values: [['marcado']] },
          { range: "'LINKS'!A2", values: [['user@example.com']] },
        ],
      },
    });
  });

  it('escapes apostrophes in tab names', async () => {
    const get = vi.fn().mockResolvedValue({
      data: { values: [['LINK', 'STATUS', 'E-MAIL']] },
    });
    const service = new BetanoDiarioSheetService({} as ConfigService);
    Object.assign(service, {
      sheets: { spreadsheets: { values: { get } } },
      sheetId: 'sheet-1',
      sheetTab: "LINK'S",
    });

    await service.readPool();

    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({ range: "'LINK''S'!A1:ZZ" }),
    );
  });
});
