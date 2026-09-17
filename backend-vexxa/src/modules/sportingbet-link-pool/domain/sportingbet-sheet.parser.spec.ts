import { describe, expect, it } from 'vitest';
import {
  parseSportingbetSheet,
  SportingbetSheetSchemaError,
} from './sportingbet-sheet.parser.js';

describe('parseSportingbetSheet', () => {
  it('maps the supplied layout by header name', () => {
    const values = [
      ['Data', 'Afiliado', 'Casa', 'Tipo de Link', 'URL', 'STATUS', 'EMAIL'],
      [
        '22/07/2026',
        'Caio Fernandes Rocha Souza',
        'Sportingbet',
        'Telegram',
        'https://example.com/tg',
        '',
        '',
      ],
    ];

    expect(parseSportingbetSheet(values)).toEqual({
      rows: [
        {
          rowIndex: 2,
          affiliate: 'Caio Fernandes Rocha Souza',
          linkType: 'Telegram',
          link: 'https://example.com/tg',
          status: '',
          email: '',
        },
      ],
      columns: { status: 'F', email: 'G' },
    });
  });

  it('accepts reordered headers and ignores unrelated columns', () => {
    const values = [
      ['EMAIL', 'URL', 'Tipo de Link', 'Afiliado', 'STATUS', 'Ignorado'],
      [
        '',
        'https://example.com/cadastro',
        'Cadastro',
        'Ana Ribeiro Dias',
        '',
        'x',
      ],
    ];

    expect(parseSportingbetSheet(values)).toEqual({
      rows: [
        {
          rowIndex: 2,
          affiliate: 'Ana Ribeiro Dias',
          linkType: 'Cadastro',
          link: 'https://example.com/cadastro',
          status: '',
          email: '',
        },
      ],
      columns: { status: 'E', email: 'A' },
    });
  });

  it('accepts the E-MAIL alias used by the Diário tab', () => {
    const values = [
      ['IDENTIFICAÇÃO', 'Afiliado', 'Tipo de Link', 'URL', 'STATUS', 'E-MAIL'],
      [
        'CA DIARIO - SPORTINGBET 0001',
        'Bianca Rocha Lima',
        'Telegram',
        'https://brsportingbet.net/registro17631',
        '',
        '',
      ],
    ];

    expect(parseSportingbetSheet(values)).toEqual({
      rows: [
        {
          rowIndex: 2,
          affiliate: 'Bianca Rocha Lima',
          linkType: 'Telegram',
          link: 'https://brsportingbet.net/registro17631',
          status: '',
          email: '',
        },
      ],
      columns: { status: 'E', email: 'F' },
    });
  });

  it('rejects a missing required header', () => {
    expect(() =>
      parseSportingbetSheet([['Afiliado', 'Tipo de Link', 'URL', 'STATUS']]),
    ).toThrowError(SportingbetSheetSchemaError);
  });

  it('rejects a duplicated required header', () => {
    expect(() =>
      parseSportingbetSheet([
        ['Afiliado', 'Tipo de Link', 'URL', 'STATUS', 'EMAIL', 'email'],
      ]),
    ).toThrowError(SportingbetSheetSchemaError);
  });
});
