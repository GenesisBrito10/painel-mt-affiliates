import { afterEach, describe, expect, it, vi } from 'vitest';
import { BetboardExtractor } from './betboard.extractor.js';

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(payload),
    text: () => Promise.resolve(JSON.stringify(payload)),
  };
}

describe('BetboardExtractor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('redirects the retired Betboard API base for login and reports', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ accessToken: 'access-token' }))
      .mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    const extractor = new BetboardExtractor();
    const token = await extractor.login({
      email: 'affiliate@example.com',
      password: 'secret',
      apiBaseUrl: 'https://api.betboard.com.br/api',
    });
    await extractor.fetchReports(
      token,
      '2026-08-24',
      'aad5fd62-ee9a-4d36-8f72-6f363ca59e13',
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api-affiliates.mgaffiliates.site/api/login',
    );
    const reportUrl = new URL(fetchMock.mock.calls[1]?.[0] as string);
    expect(reportUrl.origin + reportUrl.pathname).toBe(
      'https://api-affiliates.mgaffiliates.site/api/reports/v2/details',
    );
  });
});
