import { describe, expect, it } from 'vitest';
import {
  buildSportingbetCampaignId,
  isSportingbetRowAvailable,
  normalizeSportingbetAffiliate,
  selectSequentialSportingbetRows,
  type SheetRow,
} from './sportingbet.types.js';

describe('Sportingbet identity', () => {
  it('removes whitespace while preserving case and accents', () => {
    expect(normalizeSportingbetAffiliate('  Eloá Rafael  Farias Viana ')).toBe(
      'EloáRafaelFariasViana',
    );
  });

  it('builds the canonical key from affiliate and unchanged link type', () => {
    expect(
      buildSportingbetCampaignId('Caio Fernandes Rocha Souza', 'Telegram'),
    ).toBe('CaioFernandesRochaSouza::Telegram');
  });

  it('requires identity, URL, and empty control fields for availability', () => {
    const row: SheetRow = {
      rowIndex: 2,
      affiliate: 'Caio Fernandes Rocha Souza',
      linkType: 'Telegram',
      link: 'https://example.com/telegram',
      status: '',
      email: '',
    };

    expect(isSportingbetRowAvailable(row)).toBe(true);
    expect(isSportingbetRowAvailable({ ...row, status: 'marcado' })).toBe(
      false,
    );
    expect(isSportingbetRowAvailable({ ...row, linkType: '' })).toBe(false);
  });

  it('starts after the highest controlled row instead of filling old gaps', () => {
    const row = (rowIndex: number, status = '', email = ''): SheetRow => ({
      rowIndex,
      affiliate: `Afiliado ${rowIndex}`,
      linkType: 'Telegram',
      link: `https://example.com/${rowIndex}`,
      status,
      email,
    });

    expect(
      selectSequentialSportingbetRows([
        row(2),
        row(12, 'marcado', 'old@example.com'),
        row(13),
        row(230),
      ]).map((item) => item.rowIndex),
    ).toEqual([13, 230]);
  });

  it('starts from the first data row when the tab has no assignments', () => {
    const rows: SheetRow[] = [
      {
        rowIndex: 3,
        affiliate: 'Segundo',
        linkType: 'Cadastro',
        link: 'https://example.com/3',
        status: '',
        email: '',
      },
      {
        rowIndex: 2,
        affiliate: 'Primeiro',
        linkType: 'Telegram',
        link: 'https://example.com/2',
        status: '',
        email: '',
      },
    ];

    expect(selectSequentialSportingbetRows(rows)[0]?.rowIndex).toBe(2);
  });
});
