/** Período padrão das consultas de link: início do mês corrente até hoje (horário BR). */
export function currentMonthRange(): { start: string; end: string; label: string } {
  const tz = 'America/Sao_Paulo';
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz });
  const end = fmt.format(new Date());
  const start = `${end.slice(0, 8)}01`;

  const [y, m] = start.split('-');
  const label = `${m}/${y}`;

  return { start, end, label };
}

/** Para queries Postgres (@db.Date): início do mês inclusive. */
export function currentMonthStartDate(): string {
  return currentMonthRange().start;
}
