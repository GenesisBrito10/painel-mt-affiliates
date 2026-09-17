import { describe, expect, it } from 'vitest';
import {
  pinbetDimensionForAdjustment,
  pinbetDimensionForLink,
  pinbetDimensionForWithdrawal,
  pinbetRateKey,
} from './pinbet-dimension.js';

describe('Pinbet dimension helpers', () => {
  it('uses explicit linkType before campaign fallback', () => {
    expect(
      pinbetDimensionForLink({
        linkType: 'afp2',
        campaignId: 'VALLEX0001',
      }),
    ).toBe('AFP2');
  });

  it('recognizes legacy campaign prefixes', () => {
    expect(
      pinbetDimensionForLink({ linkType: null, campaignId: 'VALLEX0028' }),
    ).toBe('AFP1');
    expect(
      pinbetDimensionForLink({ linkType: null, campaignId: 'MJM0042' }),
    ).toBe('AFP2');
  });

  it('falls back from legacy withdrawal and adjustment houses', () => {
    expect(pinbetDimensionForWithdrawal(null, 'pinbet-diario')).toBe('AFP1');
    expect(pinbetDimensionForWithdrawal(null, 'pinbet-mensal')).toBe('AFP2');
    expect(pinbetDimensionForAdjustment(null, 'pinbet-diario')).toBe('AFP1');
  });

  it('builds dimension-aware rate keys', () => {
    expect(pinbetRateKey('pinbet-mensal', 'AFP1')).toBe('pinbet-mensal::AFP1');
    expect(pinbetRateKey('pinbet-mensal', 'AFP2')).toBe('pinbet-mensal::AFP2');
  });
});
