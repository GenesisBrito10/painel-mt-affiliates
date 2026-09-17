import { describe, it, expect } from 'vitest';
import {
  isWithdrawalDayAllowed,
  nextWithdrawalDate,
  describeFrequency,
  type WithdrawalSchedule,
} from './withdrawal-frequency.js';

const empty: WithdrawalSchedule = {
  withdrawalWeekday: null,
  withdrawalDay: null,
  withdrawalDayEnd: null,
  withdrawalDay2: null,
  withdrawalDay2End: null,
};

describe('isWithdrawalDayAllowed', () => {
  it('allows any day when no rule is set (daily)', () => {
    const now = new Date('2026-05-18T12:00:00Z');
    expect(isWithdrawalDayAllowed(empty, now)).toBe(true);
  });

  it('weekly: allows only the configured weekday', () => {
    const monOnly: WithdrawalSchedule = { ...empty, withdrawalWeekday: 1 };
    const monday = new Date('2026-05-18T09:00:00');
    const tuesday = new Date('2026-05-19T09:00:00');
    expect(isWithdrawalDayAllowed(monOnly, monday)).toBe(true);
    expect(isWithdrawalDayAllowed(monOnly, tuesday)).toBe(false);
  });

  it('weekly precedence: weekday wins over day-of-month windows', () => {
    const conflicting: WithdrawalSchedule = {
      ...empty,
      withdrawalWeekday: 1,
      withdrawalDay: 15,
      withdrawalDayEnd: 15,
    };
    const monday15 = new Date('2025-12-15T09:00:00');
    const wednesday15 = new Date('2026-04-15T09:00:00');
    expect(isWithdrawalDayAllowed(conflicting, monday15)).toBe(true);
    expect(isWithdrawalDayAllowed(conflicting, wednesday15)).toBe(false);
  });

  it('monthly window: allows days in range, blocks outside', () => {
    const win: WithdrawalSchedule = {
      ...empty,
      withdrawalDay: 1,
      withdrawalDayEnd: 3,
    };
    expect(isWithdrawalDayAllowed(win, new Date('2026-05-01T09:00:00'))).toBe(
      true,
    );
    expect(isWithdrawalDayAllowed(win, new Date('2026-05-03T09:00:00'))).toBe(
      true,
    );
    expect(isWithdrawalDayAllowed(win, new Date('2026-05-04T09:00:00'))).toBe(
      false,
    );
    expect(isWithdrawalDayAllowed(win, new Date('2026-05-31T09:00:00'))).toBe(
      false,
    );
  });

  it('biweekly: two monthly windows both allowed, gap blocked', () => {
    const hiperbet: WithdrawalSchedule = {
      ...empty,
      withdrawalDay: 1,
      withdrawalDayEnd: 2,
      withdrawalDay2: 15,
      withdrawalDay2End: 16,
    };
    expect(
      isWithdrawalDayAllowed(hiperbet, new Date('2026-05-01T09:00:00')),
    ).toBe(true);
    expect(
      isWithdrawalDayAllowed(hiperbet, new Date('2026-05-02T09:00:00')),
    ).toBe(true);
    expect(
      isWithdrawalDayAllowed(hiperbet, new Date('2026-05-15T09:00:00')),
    ).toBe(true);
    expect(
      isWithdrawalDayAllowed(hiperbet, new Date('2026-05-16T09:00:00')),
    ).toBe(true);
    expect(
      isWithdrawalDayAllowed(hiperbet, new Date('2026-05-10T09:00:00')),
    ).toBe(false);
    expect(
      isWithdrawalDayAllowed(hiperbet, new Date('2026-05-20T09:00:00')),
    ).toBe(false);
  });

  it('single-day window when end omitted', () => {
    const singleDay: WithdrawalSchedule = { ...empty, withdrawalDay: 5 };
    expect(
      isWithdrawalDayAllowed(singleDay, new Date('2026-05-05T09:00:00')),
    ).toBe(true);
    expect(
      isWithdrawalDayAllowed(singleDay, new Date('2026-05-06T09:00:00')),
    ).toBe(false);
  });
});

describe('nextWithdrawalDate', () => {
  it('returns null when no restriction is set', () => {
    expect(
      nextWithdrawalDate(empty, new Date('2026-05-18T12:00:00')),
    ).toBeNull();
  });

  it('returns today at 00:00 when today is allowed', () => {
    const monOnly: WithdrawalSchedule = { ...empty, withdrawalWeekday: 1 };
    const monday = new Date('2026-05-18T15:30:00');
    const next = nextWithdrawalDate(monOnly, monday);
    expect(next).not.toBeNull();
    expect(next!.getDay()).toBe(1);
    expect(next!.getHours()).toBe(0);
  });

  it('walks forward to the next allowed weekday', () => {
    const monOnly: WithdrawalSchedule = { ...empty, withdrawalWeekday: 1 };
    const tuesday = new Date('2026-05-19T15:00:00');
    const next = nextWithdrawalDate(monOnly, tuesday);
    expect(next).not.toBeNull();
    expect(next!.getDay()).toBe(1);
    expect(next!.getDate()).toBe(25);
  });

  it('jumps to next month window for biweekly', () => {
    const hiperbet: WithdrawalSchedule = {
      ...empty,
      withdrawalDay: 1,
      withdrawalDayEnd: 2,
      withdrawalDay2: 15,
      withdrawalDay2End: 16,
    };
    const day10 = new Date('2026-05-10T15:00:00');
    const next = nextWithdrawalDate(hiperbet, day10);
    expect(next).not.toBeNull();
    expect(next!.getDate()).toBe(15);
  });
});

describe('describeFrequency', () => {
  it('describes daily when nothing set', () => {
    expect(describeFrequency(empty)).toBe('Diário');
  });
  it('describes weekly when weekday set', () => {
    expect(describeFrequency({ ...empty, withdrawalWeekday: 1 })).toBe(
      'Semanal (Segunda)',
    );
  });
  it('describes monthly with one window', () => {
    expect(
      describeFrequency({ ...empty, withdrawalDay: 5, withdrawalDayEnd: 6 }),
    ).toBe('Mensal (dia 5-6)');
  });
  it('describes biweekly with two windows', () => {
    expect(
      describeFrequency({
        ...empty,
        withdrawalDay: 1,
        withdrawalDayEnd: 2,
        withdrawalDay2: 15,
        withdrawalDay2End: 16,
      }),
    ).toBe('Quinzenal (dias 1-2 e 15-16)');
  });
  it('describes a full-month window (1-31) as daily, not monthly', () => {
    expect(
      describeFrequency({ ...empty, withdrawalDay: 1, withdrawalDayEnd: 31 }),
    ).toBe('Diário');
  });
});
