import { describe, expect, it } from 'vitest';
import { filterLinksForActiveAgreements } from './membership-visibility.js';

const link = (bettingHouse: string, campaignId?: string) => ({
  id: `link-${bettingHouse}-${campaignId ?? 'default'}`,
  bettingHouse,
  campaignId,
});

const request = (
  bettingHouseSlug: string,
  options: {
    dealId?: string | null;
    active?: boolean;
    status?: string;
    links?: unknown;
  } = {},
) => ({
  bettingHouseSlug,
  dealId: options.dealId === undefined ? 'deal-1' : options.dealId,
  status: options.status ?? 'FULFILLED',
  deal: options.dealId === null ? null : { active: options.active ?? false },
  links: options.links ?? [],
});

describe('filterLinksForActiveAgreements', () => {
  it('hides a house whose only fulfilled deal is inactive', () => {
    expect(
      filterLinksForActiveAgreements(
        [link('superbet')],
        [request('superbet', { active: false })],
      ),
    ).toEqual([]);
  });

  it('keeps a house with at least one fulfilled active deal', () => {
    const superbet = link('superbet');

    expect(
      filterLinksForActiveAgreements(
        [superbet],
        [
          request('superbet', { dealId: 'old-deal', active: false }),
          request('superbet', { dealId: 'new-deal', active: true }),
        ],
      ),
    ).toEqual([superbet]);
  });

  it('keeps standalone and unclassified links', () => {
    const standalone = link('sportingbet');
    const unclassified = link('betano');

    expect(
      filterLinksForActiveAgreements(
        [standalone, unclassified],
        [request('sportingbet', { dealId: null })],
      ),
    ).toEqual([standalone, unclassified]);
  });

  it('does not reactivate an inactive agreement from a pending active deal', () => {
    expect(
      filterLinksForActiveAgreements(
        [link('superbet')],
        [
          request('superbet', { dealId: 'old-deal', active: false }),
          request('superbet', {
            dealId: 'new-deal',
            active: true,
            status: 'PENDING',
          }),
        ],
      ),
    ).toEqual([]);
  });

  it('keeps only the campaign assigned by the active deal for the same house', () => {
    const oldCampaign = link('superbet', '32666-VALLEXBR221');
    const currentCampaign = link('superbet', '5565-MJM71');

    expect(
      filterLinksForActiveAgreements(
        [oldCampaign, currentCampaign],
        [
          request('superbet', {
            dealId: 'active-deal',
            active: true,
            links: [
              {
                url: 'https://wlsuperbet.adsrv.eacdn.com/C.ashx?siteid=5565&c=MJM71',
              },
            ],
          }),
        ],
      ),
    ).toEqual([currentCampaign]);
  });
});
