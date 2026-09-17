import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { SportingbetSheetService } from './sportingbet-sheet.service.js';

describe('SportingbetSheetService', () => {
  it('reads headers and marks only the selected row control cells', async () => {
    const get = vi.fn().mockResolvedValue({
      data: {
        values: [
          [
            'Data',
            'Afiliado',
            'Casa',
            'Tipo de Link',
            'URL',
            'STATUS',
            'EMAIL',
          ],
          [
            '22/07/2026',
            'Caio Fernandes Rocha Souza',
            'Sportingbet',
            'Telegram',
            'https://example.com/telegram',
            '',
            '',
          ],
          [
            '22/07/2026',
            'Caio Fernandes Rocha Souza',
            'Sportingbet',
            'Instagram',
            'https://example.com/instagram',
            '',
            '',
          ],
        ],
      },
    });
    const batchUpdate = vi.fn().mockResolvedValue({ data: {} });
    const service = new SportingbetSheetService({} as ConfigService);
    Object.assign(service, {
      sheets: { spreadsheets: { values: { get, batchUpdate } } },
      sheetId: 'sheet-1',
      sheetTab: 'Links',
    });

    const rows = await service.readPool();
    await service.markRowUsed(2, 'user@example.com');

    expect(get).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-1',
      range: 'Links!A1:ZZ',
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      rowIndex: 2,
      affiliate: 'Caio Fernandes Rocha Souza',
      linkType: 'Telegram',
      link: 'https://example.com/telegram',
      status: '',
      email: '',
    });
    expect(batchUpdate).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-1',
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          { range: 'Links!F2', values: [['marcado']] },
          { range: 'Links!G2', values: [['user@example.com']] },
        ],
      },
    });
  });
});
