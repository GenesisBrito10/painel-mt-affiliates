/**
 * Per-casa withdrawal frequency rules.
 *
 * Cadence precedence: weekday > monthly windows > daily.
 *   1. weekly       — `withdrawalWeekday` set (0=Sun..6=Sat). Only that weekday.
 *   2. biweekly     — two monthly windows via `withdrawalDay/End` + `withdrawalDay2/End2`.
 *   3. monthly      — single window (`withdrawalDay/End` only).
 *   4. daily        — all fields null → no restriction.
 */

export interface WithdrawalSchedule {
  withdrawalWeekday: number | null;
  withdrawalDay: number | null;
  withdrawalDayEnd: number | null;
  withdrawalDay2: number | null;
  withdrawalDay2End: number | null;
}

const WEEKDAY_PT = [
  'Domingo',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
] as const;

function inRange(
  day: number,
  start: number | null,
  end: number | null,
): boolean {
  if (start == null) return false;
  return day >= start && day <= (end ?? start);
}

export function isWithdrawalDayAllowed(
  house: WithdrawalSchedule,
  now: Date = new Date(),
): boolean {
  if (house.withdrawalWeekday != null) {
    return now.getDay() === house.withdrawalWeekday;
  }
  if (house.withdrawalDay == null && house.withdrawalDay2 == null) return true;
  const day = now.getDate();
  return (
    inRange(day, house.withdrawalDay, house.withdrawalDayEnd) ||
    inRange(day, house.withdrawalDay2, house.withdrawalDay2End)
  );
}

/**
 * Returns the next Date (00:00 local) when withdrawals open for this house.
 * Returns the start of today if today is already allowed. Returns null when no
 * restriction is configured.
 */
export function nextWithdrawalDate(
  house: WithdrawalSchedule,
  now: Date = new Date(),
): Date | null {
  if (
    house.withdrawalWeekday == null &&
    house.withdrawalDay == null &&
    house.withdrawalDay2 == null
  ) {
    return null;
  }
  if (isWithdrawalDayAllowed(house, now)) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  // Walk forward up to 62 days — covers all monthly windows + weekday cases.
  const probe = new Date(now);
  probe.setHours(0, 0, 0, 0);
  for (let i = 1; i <= 62; i++) {
    probe.setDate(probe.getDate() + 1);
    if (isWithdrawalDayAllowed(house, probe)) return probe;
  }
  return null;
}

// A single window that spans day 1 → ≥31 covers every day of every month, so
// it is effectively daily (e.g. superbet 1-31) — not a monthly window.
function isFullMonthWindow(house: WithdrawalSchedule): boolean {
  return (
    house.withdrawalWeekday == null &&
    house.withdrawalDay2 == null &&
    house.withdrawalDay != null &&
    house.withdrawalDay <= 1 &&
    (house.withdrawalDayEnd ?? house.withdrawalDay) >= 31
  );
}

export function describeFrequency(house: WithdrawalSchedule): string {
  if (house.withdrawalWeekday != null) {
    const label =
      WEEKDAY_PT[house.withdrawalWeekday] ?? `dia ${house.withdrawalWeekday}`;
    return `Semanal (${label})`;
  }
  if (isFullMonthWindow(house)) return 'Diário';
  const windows: string[] = [];
  if (house.withdrawalDay != null) {
    const end = house.withdrawalDayEnd ?? house.withdrawalDay;
    windows.push(
      end !== house.withdrawalDay
        ? `${house.withdrawalDay}-${end}`
        : String(house.withdrawalDay),
    );
  }
  if (house.withdrawalDay2 != null) {
    const end = house.withdrawalDay2End ?? house.withdrawalDay2;
    windows.push(
      end !== house.withdrawalDay2
        ? `${house.withdrawalDay2}-${end}`
        : String(house.withdrawalDay2),
    );
  }
  if (windows.length === 2) return `Quinzenal (dias ${windows.join(' e ')})`;
  if (windows.length === 1) return `Mensal (dia ${windows[0]})`;
  return 'Diário';
}

export function describeNextWindow(
  house: WithdrawalSchedule,
  now: Date = new Date(),
): string {
  const next = nextWithdrawalDate(house, now);
  if (!next) return 'Liberado a qualquer momento';
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (next.getTime() === today.getTime()) return 'Liberado hoje';
  return `Próxima janela: ${next.toLocaleDateString('pt-BR')}`;
}
