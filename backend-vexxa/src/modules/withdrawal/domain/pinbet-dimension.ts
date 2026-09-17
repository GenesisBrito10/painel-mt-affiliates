import type { PinbetTrackingDimension } from '@prisma/client';

export type PinbetDimension = PinbetTrackingDimension;

export function pinbetDimensionForLink(link: {
  linkType?: string | null;
  campaignId: string;
}): PinbetDimension {
  const explicit = link.linkType?.trim().toLowerCase();
  if (explicit === 'afp1') return 'AFP1';
  if (explicit === 'afp2') return 'AFP2';
  return link.campaignId.toUpperCase().startsWith('MJM') ? 'AFP2' : 'AFP1';
}

export function pinbetDimensionForWithdrawal(
  dimension: PinbetTrackingDimension | null | undefined,
  bettingHouse: string,
): PinbetDimension {
  if (dimension) return dimension;
  return bettingHouse === 'pinbet-diario' ? 'AFP1' : 'AFP2';
}

export function pinbetDimensionForAdjustment(
  dimension: PinbetDimension | null | undefined,
  bettingHouse: string,
): Exclude<PinbetDimension, 'COMBINED'> {
  if (dimension === 'AFP1') return 'AFP1';
  if (dimension === 'AFP2') return 'AFP2';
  return bettingHouse === 'pinbet-diario' ? 'AFP1' : 'AFP2';
}

export const pinbetRateKey = (
  house: string,
  dimension: PinbetDimension,
): string => `${house}::${dimension}`;
