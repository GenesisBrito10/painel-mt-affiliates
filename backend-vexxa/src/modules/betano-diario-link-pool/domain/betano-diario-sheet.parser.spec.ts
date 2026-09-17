import { describe, expect, it } from 'vitest';
import {
  BetanoDiarioSheetSchemaError,
  parseBetanoDiarioPoolSheet,
} from './betano-diario-sheet.parser.js';

describe('parseBetanoDiarioPoolSheet', () => {
  it('parses the LINKS contract and preserves spreadsheet row indexes', () => {
    expect(
      parseBetanoDiarioPoolSheet([
        ['LINK', 'STATUS', 'E-MAIL'],
        ['https://kg-br.com/C.ashx?siteid=52769&c=VALLEX101', '', ''],
      ]),
    ).toEqual({
      columns: { status: 'B', email: 'C' },
      rows: [
        {
          rowIndex: 2,
          link: 'https://kg-br.com/C.ashx?siteid=52769&c=VALLEX101',
          status: '',
          email: '',
        },
      ],
    });
  });

  it('resolves trimmed case-insensitive headers in any order', () => {
    const parsed = parseBetanoDiarioPoolSheet([
      [' e-mail ', ' link ', ' status '],
      ['used@example.com', 'https://example.com', 'marcado'],
    ]);

    expect(parsed.columns).toEqual({ status: 'C', email: 'A' });
    expect(parsed.rows[0]).toMatchObject({
      rowIndex: 2,
      link: 'https://example.com',
      status: 'marcado',
      email: 'used@example.com',
    });
  });

  it.each([
    { values: [['LINK', 'STATUS']] },
    { values: [['LINK', 'STATUS', 'E-MAIL', 'status']] },
  ])('rejects missing or duplicate required headers', ({ values }) => {
    expect(() => parseBetanoDiarioPoolSheet(values)).toThrow(
      BetanoDiarioSheetSchemaError,
    );
  });
});
