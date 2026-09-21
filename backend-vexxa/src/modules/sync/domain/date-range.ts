/**
 * Expande um intervalo [from, to] (ambos inclusivos, YYYY-MM-DD) na lista de
 * dias que o orchestrator recebe como `dates`.
 *
 * Serve o backfill manual: provedores marcados como `current-day-only` (a
 * Smartico, por exemplo) ignoram o histórico no cron e só aceitam dias
 * anteriores quando as datas vêm explícitas.
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

/** Teto de segurança: uma janela absurda vira muitas chamadas ao provedor. */
export const MAX_BACKFILL_DAYS = 400;

export class InvalidDateRangeError extends Error {}

const isValidDate = (value: string): boolean =>
  DATE_PATTERN.test(value) &&
  new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;

export function expandDateRange(from: string, to: string): string[] {
  if (!isValidDate(from) || !isValidDate(to)) {
    throw new InvalidDateRangeError(
      'Datas devem estar no formato YYYY-MM-DD e ser válidas',
    );
  }
  if (from > to) {
    throw new InvalidDateRangeError('dateFrom não pode ser depois de dateTo');
  }

  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor <= end) {
    if (dates.length >= MAX_BACKFILL_DAYS) {
      throw new InvalidDateRangeError(
        `Intervalo maior que ${MAX_BACKFILL_DAYS} dias`,
      );
    }
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}
