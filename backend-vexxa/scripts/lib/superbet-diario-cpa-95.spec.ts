import { describe, expect, it } from 'vitest';
import {
  assertSafeImpact,
  buildCorrectionPlan,
  parseSuperbetCampaign,
} from './superbet-diario-cpa-95.mjs';

const request = (over: Record<string, unknown> = {}) => ({
  id: 'request-1',
  userId: 'user-1',
  resolvedCpa: 100,
  links: [
    {
      url: 'https://wlsuperbet.adsrv.eacdn.com/C.ashx?siteid=5565&c=MJM01',
    },
  ],
  ...over,
});

const affiliateLink = (over: Record<string, unknown> = {}) => ({
  id: 'link-1',
  userId: 'user-1',
  campaignId: '5565-MJM01',
  cpa: 100,
  ...over,
});

describe('Superbet Diario CPA 95 correction guards', () => {
  it('derives the canonical campaign id from siteid and c', () => {
    expect(
      parseSuperbetCampaign(
        'https://wlsuperbet.adsrv.eacdn.com/C.ashx?siteid=5565&c=MJM01',
      ),
    ).toEqual({ siteid: '5565', c: 'MJM01', campaignId: '5565-MJM01' });
    expect(() =>
      parseSuperbetCampaign('https://example.com/no-campaign'),
    ).toThrow(/siteid.*c/i);
  });

  it('maps every request to exactly one link owned by the same user', () => {
    expect(
      buildCorrectionPlan({
        requests: [request()],
        affiliateLinks: [affiliateLink()],
        expectedTargets: 1,
      }),
    ).toEqual([
      expect.objectContaining({
        requestId: 'request-1',
        affiliateLinkId: 'link-1',
        userId: 'user-1',
        campaignId: '5565-MJM01',
        oldRequestCpa: 100,
        oldLinkCpa: 100,
      }),
    ]);
  });

  it('rejects count drift, duplicate users, and mismatched link ownership', () => {
    expect(() =>
      buildCorrectionPlan({
        requests: [request()],
        affiliateLinks: [affiliateLink()],
        expectedTargets: 2,
      }),
    ).toThrow(/contagem/i);

    expect(() =>
      buildCorrectionPlan({
        requests: [request(), request({ id: 'request-2' })],
        affiliateLinks: [affiliateLink()],
        expectedTargets: 2,
      }),
    ).toThrow(/usuario duplicado/i);

    expect(() =>
      buildCorrectionPlan({
        requests: [request()],
        affiliateLinks: [affiliateLink({ userId: 'other-user' })],
        expectedTargets: 1,
      }),
    ).toThrow(/mapeamento/i);
  });

  it('rejects duplicate campaign links and open withdrawals', () => {
    expect(() =>
      buildCorrectionPlan({
        requests: [request()],
        affiliateLinks: [affiliateLink(), affiliateLink({ id: 'link-2' })],
        expectedTargets: 1,
      }),
    ).toThrow(/mapeamento/i);

    expect(() => assertSafeImpact({ openWithdrawals: 1 })).toThrow(
      /saques abertos/i,
    );
    expect(() =>
      assertSafeImpact({ openWithdrawals: 0, metricRows: 1 }),
    ).toThrow(/metricas/i);
    expect(assertSafeImpact({ openWithdrawals: 0, metricRows: 0 })).toBe(true);
  });
});
