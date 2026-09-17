const TZ = 'America/Sao_Paulo';

/**
 * When true, isWithinBusinessHours() always returns true.
 * Toggled via admin endpoint for testing purposes.
 */
let businessHoursOverride = false;

export function setBusinessHoursOverride(enabled: boolean): void {
  businessHoursOverride = enabled;
}

export function getBusinessHoursOverride(): boolean {
  return businessHoursOverride;
}

function getSaoPauloDateInfo(now: Date): { isWeekday: boolean; minuteOfDay: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hourRaw = parts.find((p) => p.type === 'hour')?.value ?? '0';
  const minuteRaw = parts.find((p) => p.type === 'minute')?.value ?? '0';

  // '24' is returned instead of '0' by some runtimes at midnight
  const hour = parseInt(hourRaw, 10) % 24;
  const minute = parseInt(minuteRaw, 10);

  const isWeekday = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].includes(weekday);
  return { isWeekday, minuteOfDay: hour * 60 + minute };
}

/**
 * Returns true if `now` falls within business hours:
 * Monday–Friday, 09:00–12:00 and 14:00–18:00 (America/Sao_Paulo).
 */
export function isWithinBusinessHours(now: Date = new Date()): boolean {
  if (businessHoursOverride) return true;
  const { isWeekday, minuteOfDay } = getSaoPauloDateInfo(now);
  if (!isWeekday) return false;
  const morning = minuteOfDay >= 9 * 60 && minuteOfDay < 12 * 60;
  const afternoon = minuteOfDay >= 14 * 60 && minuteOfDay < 18 * 60;
  return morning || afternoon;
}

/**
 * Returns the start of the current calendar day in America/Sao_Paulo as a UTC Date.
 * Brazil abolished DST in 2019, so BRT is permanently UTC-3.
 */
export function getSaoPauloStartOfDay(now: Date = new Date()): Date {
  // sv-SE locale reliably formats dates as YYYY-MM-DD
  const dateStr = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(now);
  return new Date(`${dateStr}T00:00:00.000-03:00`);
}
