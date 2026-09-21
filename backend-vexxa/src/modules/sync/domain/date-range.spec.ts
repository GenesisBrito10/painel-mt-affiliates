import { describe, expect, it } from 'vitest';
import {
  expandDateRange,
  InvalidDateRangeError,
  MAX_BACKFILL_DAYS,
} from './date-range.js';

describe('expandDateRange', () => {
  it('inclui as duas pontas do intervalo', () => {
    expect(expandDateRange('2026-09-19', '2026-09-21')).toEqual([
      '2026-09-19',
      '2026-09-20',
      '2026-09-21',
    ]);
  });

  it('aceita um único dia', () => {
    expect(expandDateRange('2026-09-21', '2026-09-21')).toEqual(['2026-09-21']);
  });

  it('atravessa virada de mês', () => {
    expect(expandDateRange('2026-02-27', '2026-03-01')).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
    ]);
  });

  it('inclui 29/02 em ano bissexto', () => {
    expect(expandDateRange('2024-02-28', '2024-03-01')).toEqual([
      '2024-02-28',
      '2024-02-29',
      '2024-03-01',
    ]);
  });

  it('recusa intervalo invertido', () => {
    expect(() => expandDateRange('2026-09-21', '2026-09-19')).toThrow(
      InvalidDateRangeError,
    );
  });

  it('recusa formato inválido e data inexistente', () => {
    expect(() => expandDateRange('21/09/2026', '2026-09-21')).toThrow(
      InvalidDateRangeError,
    );
    expect(() => expandDateRange('2026-02-30', '2026-03-01')).toThrow(
      InvalidDateRangeError,
    );
  });

  it(`recusa janela maior que ${MAX_BACKFILL_DAYS} dias`, () => {
    expect(() => expandDateRange('2020-01-01', '2026-01-01')).toThrow(
      InvalidDateRangeError,
    );
  });
});
