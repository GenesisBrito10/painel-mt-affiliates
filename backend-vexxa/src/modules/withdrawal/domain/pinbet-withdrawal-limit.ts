import Decimal from 'decimal.js';
import type { PinbetTrackingDimension } from '@prisma/client';

export const PINBET_HOUSES = ['pinbet-diario', 'pinbet-mensal'] as const;
export type PinbetHouse = (typeof PINBET_HOUSES)[number];
export type PinbetWithdrawalRestriction =
  | 'METRICS_SYNCING'
  | 'NET_PL_NON_POSITIVE'
  | 'NET_PL_CAP';

export interface PinbetWithdrawalLimitInput {
  house: string;
  balance: number;
  netPl: number | null;
  consumed: number;
  metricsComplete: boolean;
}

export interface PinbetWithdrawalLimit {
  balance: number;
  netPl: number | null;
  netPlLimit: number | null;
  consumed: number;
  remainingNetPlLimit: number | null;
  withdrawable: number;
  restriction: PinbetWithdrawalRestriction | null;
}

export type PinbetLimitSegment = Omit<PinbetWithdrawalLimitInput, 'house'> & {
  dimension: Exclude<PinbetTrackingDimension, 'COMBINED'>;
};

export interface SegmentedPinbetWithdrawalLimitInput {
  segments: PinbetLimitSegment[];
  combinedConsumed: number;
}

export interface SegmentedPinbetWithdrawalLimit extends PinbetWithdrawalLimit {
  segments: Array<
    PinbetWithdrawalLimit & { dimension: PinbetLimitSegment['dimension'] }
  >;
}

export const isPinbetHouse = (house: string): house is PinbetHouse =>
  PINBET_HOUSES.includes(house as PinbetHouse);

const money = (value: Decimal.Value): number =>
  new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_DOWN).toNumber();

export function calculatePinbetWithdrawalLimit(
  input: PinbetWithdrawalLimitInput,
): PinbetWithdrawalLimit {
  const balance = Math.max(0, money(input.balance));
  const consumed = Math.max(0, money(input.consumed));

  if (!isPinbetHouse(input.house)) {
    return {
      balance,
      netPl: input.netPl,
      netPlLimit: null,
      consumed,
      remainingNetPlLimit: null,
      withdrawable: balance,
      restriction: null,
    };
  }

  if (!input.metricsComplete || input.netPl === null) {
    return {
      balance,
      netPl: null,
      netPlLimit: null,
      consumed,
      remainingNetPlLimit: null,
      withdrawable: 0,
      restriction: 'METRICS_SYNCING',
    };
  }

  const netPl = money(input.netPl);
  if (netPl <= 0) {
    return {
      balance,
      netPl,
      netPlLimit: 0,
      consumed,
      remainingNetPlLimit: 0,
      withdrawable: 0,
      restriction: 'NET_PL_NON_POSITIVE',
    };
  }

  const netPlLimit = money(new Decimal(netPl).mul(0.8));
  const remainingNetPlLimit = Math.max(
    0,
    money(new Decimal(netPlLimit).minus(consumed)),
  );
  const withdrawable = Math.min(balance, remainingNetPlLimit);

  return {
    balance,
    netPl,
    netPlLimit,
    consumed,
    remainingNetPlLimit,
    withdrawable,
    restriction: remainingNetPlLimit < balance ? 'NET_PL_CAP' : null,
  };
}

export function calculateSegmentedPinbetWithdrawalLimit(
  input: SegmentedPinbetWithdrawalLimitInput,
): SegmentedPinbetWithdrawalLimit {
  const segments = input.segments.map((segment) => ({
    dimension: segment.dimension,
    ...calculatePinbetWithdrawalLimit({
      ...segment,
      house: 'pinbet-mensal',
    }),
  }));
  const combinedConsumed = Math.max(0, money(input.combinedConsumed));
  const metricsComplete = segments.every(
    (segment) => segment.restriction !== 'METRICS_SYNCING',
  );
  const balanceBeforeCombined = money(
    segments.reduce(
      (total, segment) => total.plus(segment.balance),
      new Decimal(0),
    ),
  );
  const balance = Math.max(
    0,
    money(new Decimal(balanceBeforeCombined).minus(combinedConsumed)),
  );
  const netPl = metricsComplete
    ? money(
        segments.reduce(
          (total, segment) => total.plus(segment.netPl ?? 0),
          new Decimal(0),
        ),
      )
    : null;
  const netPlLimit = metricsComplete
    ? money(
        segments.reduce(
          (total, segment) => total.plus(segment.netPlLimit ?? 0),
          new Decimal(0),
        ),
      )
    : null;
  const consumed = money(
    segments
      .reduce((total, segment) => total.plus(segment.consumed), new Decimal(0))
      .plus(combinedConsumed),
  );
  const remainingNetPlLimit = metricsComplete
    ? Math.max(
        0,
        money(
          segments
            .reduce(
              (total, segment) => total.plus(segment.withdrawable),
              new Decimal(0),
            )
            .minus(combinedConsumed),
        ),
      )
    : null;
  const withdrawable = metricsComplete
    ? Math.min(balance, remainingNetPlLimit ?? 0)
    : 0;

  let restriction: PinbetWithdrawalRestriction | null = null;
  if (!metricsComplete) {
    restriction = 'METRICS_SYNCING';
  } else if (
    withdrawable === 0 &&
    segments.every((segment) => (segment.netPl ?? 0) <= 0)
  ) {
    restriction = 'NET_PL_NON_POSITIVE';
  } else if (withdrawable < balance) {
    restriction = 'NET_PL_CAP';
  }

  return {
    balance,
    netPl,
    netPlLimit,
    consumed,
    remainingNetPlLimit,
    withdrawable,
    restriction,
    segments,
  };
}
