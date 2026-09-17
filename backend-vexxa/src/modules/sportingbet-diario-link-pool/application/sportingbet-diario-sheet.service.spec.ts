import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { SportingbetDiarioSheetService } from './sportingbet-diario-sheet.service.js';

describe('SportingbetDiarioSheetService', () => {
  it('reads Diário and marks only the selected control cells', async () => {
    const get = vi.fn().mockResolvedValue({
      data: {
        values: [
          [
            'IDENTIFICAÇÃO',
            'Afiliado',
            'Tipo de Link',
            'URL',
            'STATUS',
            'EMAIL',
          ],
          [
            'CA DIARIO - SPORTINGBET 0001',
            'Bianca Rocha Lima',
            'Telegram',
            'https://brsportingbet.net/registro17631',
            '',
            '',
          ],
        ],
      },
    });
    const batchUpdate = vi.fn().mockResolvedValue({ data: {} });
    const service = new SportingbetDiarioSheetService({} as ConfigService);
    Object.assign(service, {
      sheets: { spreadsheets: { values: { get, batchUpdate } } },
      sheetId: 'sheet-1',
      sheetTab: 'Diário',
    });

    const rows = await service.readPool();
    await service.markRowUsed(2, 'user@example.com');

    expect(get).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-1',
      range: "'Diário'!A1:ZZ",
    });
    expect(rows[0]).toEqual({
      rowIndex: 2,
      affiliate: 'Bianca Rocha Lima',
      linkType: 'Telegram',
      link: 'https://brsportingbet.net/registro17631',
      status: '',
      email: '',
    });
    expect(batchUpdate).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-1',
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          { range: "'Diário'!E2", values: [['marcado']] },
          { range: "'Diário'!F2", values: [['user@example.com']] },
        ],
      },
    });
  });
});
