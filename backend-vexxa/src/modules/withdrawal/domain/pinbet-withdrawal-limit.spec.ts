import { describe, expect, it } from 'vitest';
import {
  calculatePinbetWithdrawalLimit,
  calculateSegmentedPinbetWithdrawalLimit,
} from './pinbet-withdrawal-limit.js';

describe('calculatePinbetWithdrawalLimit', () => {
  it('keeps the normal balance rule for non-Pinbet houses', () => {
    expect(
      calculatePinbetWithdrawalLimit({
        house: 'betano',
        balance: 1000,
        netPl: null,
        consumed: 0,
        metricsComplete: false,
      }).withdrawable,
    ).toBe(1000);
  });

  it('limits gross withdrawal to 80% of positive Net P&L', () => {
    expect(
      calculatePinbetWithdrawalLimit({
        house: 'pinbet-diario',
        balance: 1000,
        netPl: 100,
        consumed: 0,
        metricsComplete: true,
      }),
    ).toMatchObject({
      netPl: 100,
      netPlLimit: 80,
      remainingNetPlLimit: 80,
      withdrawable: 80,
      restriction: 'NET_PL_CAP',
    });
  });

  it.each([-68.26, 0])(
    'blocks withdrawal when Net P&L is not positive (%s)',
    (netPl) => {
      expect(
        calculatePinbetWithdrawalLimit({
          house: 'pinbet-mensal',
          balance: 1000,
          netPl,
          consumed: 0,
          metricsComplete: true,
        }),
      ).toMatchObject({
        netPlLimit: 0,
        withdrawable: 0,
        restriction: 'NET_PL_NON_POSITIVE',
      });
    },
  );

  it('subtracts prior withdrawals and never exceeds current balance', () => {
    expect(
      calculatePinbetWithdrawalLimit({
        house: 'pinbet-diario',
        balance: 50,
        netPl: 100,
        consumed: 20,
        metricsComplete: true,
      }),
    ).toMatchObject({
      remainingNetPlLimit: 60,
      withdrawable: 50,
      restriction: null,
    });
  });

  it('blocks while historical metrics are incomplete', () => {
    expect(
      calculatePinbetWithdrawalLimit({
        house: 'pinbet-diario',
        balance: 1000,
        netPl: null,
        consumed: 0,
        metricsComplete: false,
      }),
    ).toMatchObject({
      withdrawable: 0,
      restriction: 'METRICS_SYNCING',
    });
  });
});

describe('calculateSegmentedPinbetWithdrawalLimit', () => {
  it('does not let one tracking dimension subsidize the cap of another', () => {
    expect(
      calculateSegmentedPinbetWithdrawalLimit({
        segments: [
          {
            dimension: 'AFP1',
            balance: 1000,
            netPl: 100,
            consumed: 0,
            metricsComplete: true,
          },
          {
            dimension: 'AFP2',
            balance: 0,
            netPl: 1000,
            consumed: 0,
            metricsComplete: true,
          },
        ],
        combinedConsumed: 0,
      }),
    ).toMatchObject({
      balance: 1000,
      withdrawable: 80,
      restriction: 'NET_PL_CAP',
    });
  });

  it('does not reduce a positive dimension with negative Net P&L from another', () => {
    expect(
      calculateSegmentedPinbetWithdrawalLimit({
        segments: [
          {
            dimension: 'AFP1',
            balance: 1000,
            netPl: 1000,
            consumed: 0,
            metricsComplete: true,
          },
          {
            dimension: 'AFP2',
            balance: 0,
            netPl: -500,
            consumed: 0,
            metricsComplete: true,
          },
        ],
        combinedConsumed: 0,
      }),
    ).toMatchObject({
      netPl: 500,
      withdrawable: 800,
      restriction: 'NET_PL_CAP',
    });
  });

  it('subtracts dimension and combined withdrawals exactly once', () => {
    expect(
      calculateSegmentedPinbetWithdrawalLimit({
        segments: [
          {
            dimension: 'AFP1',
            balance: 500,
            netPl: 1000,
            consumed: 100,
            metricsComplete: true,
          },
          {
            dimension: 'AFP2',
            balance: 300,
            netPl: 500,
            consumed: 50,
            metricsComplete: true,
          },
        ],
        combinedConsumed: 200,
      }),
    ).toMatchObject({
      balance: 600,
      consumed: 350,
      withdrawable: 600,
      restriction: null,
    });
  });
});
