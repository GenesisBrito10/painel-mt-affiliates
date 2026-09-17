import { describe, expect, it } from 'vitest';
import {
  buildSportingbetOtgCutoverPlan,
  type CutoverAccountSnapshot,
} from './sportingbet-otg-cutover.js';

const account = (
  overrides: Partial<CutoverAccountSnapshot>,
): CutoverAccountSnapshot => ({
  id: 'account-id',
  name: 'Affiliates',
  provider: 'betboard',
  active: true,
  houses: [],
  ...overrides,
});

describe('buildSportingbetOtgCutoverPlan', () => {
  it('deactivates the replaced Betboard account when Sportingbet is its only active house', () => {
    const plan = buildSportingbetOtgCutoverPlan([
      account({
        id: 'betboard-id',
        houses: [
          {
            id: 'old-association',
            bettingHouseSlug: 'sportingbet',
            active: true,
          },
        ],
      }),
    ]);

    expect(plan).toEqual({
      otgAccountId: null,
      otgAssociationId: null,
      deactivateBetboardAssociationIds: ['old-association'],
      deactivateBetboardAccountIds: ['betboard-id'],
    });
  });

  it('keeps the Betboard account active when another active house still uses it', () => {
    const plan = buildSportingbetOtgCutoverPlan([
      account({
        id: 'betboard-id',
        houses: [
          {
            id: 'old-association',
            bettingHouseSlug: 'sportingbet',
            active: true,
          },
          {
            id: 'other-association',
            bettingHouseSlug: 'esportivabet',
            active: true,
          },
        ],
      }),
    ]);

    expect(plan.deactivateBetboardAssociationIds).toEqual(['old-association']);
    expect(plan.deactivateBetboardAccountIds).toEqual([]);
  });

  it('reuses an existing inactive OTG account and Sportingbet association', () => {
    const plan = buildSportingbetOtgCutoverPlan([
      account({
        id: 'otg-id',
        name: 'SPORTINGBET OTG',
        provider: 'otg',
        active: false,
        houses: [
          {
            id: 'otg-association',
            bettingHouseSlug: 'sportingbet',
            active: false,
          },
        ],
      }),
    ]);

    expect(plan.otgAccountId).toBe('otg-id');
    expect(plan.otgAssociationId).toBe('otg-association');
  });
});
