import { afterEach, describe, expect, it, vi } from 'vitest';
import { OtgExtractor } from './otg.extractor.js';

const credentials = {
  email: 'affiliate@example.com',
  password: 'top-secret-password',
  apiBaseUrl: 'https://affiliate-api.example.com/api/v1',
};

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(payload),
  };
}

describe('OtgExtractor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('logs in with configured credentials and returns data.access_token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        statusCode: 200,
        data: { access_token: 'otg-access-token' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const token = await new OtgExtractor().login(credentials);

    expect(token).toBe('otg-access-token');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://affiliate-api.example.com/api/v1/auth/login',
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: credentials.email,
          password: credentials.password,
        }),
      },
    );
  });

  it('fails login without leaking the password when access_token is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ statusCode: 200, data: { user: {} } }),
        ),
    );

    const promise = new OtgExtractor().login(credentials);

    await expect(promise).rejects.toThrow('missing data.access_token');
    await expect(promise).rejects.not.toThrow(credentials.password);
  });

  it('fetches all pages and maps the typed Sportingbet campaign identity', async () => {
    const fetchMock = vi.fn().mockImplementation((input: string) => {
      const page = new URL(input).searchParams.get('page');
      if (page === '1') {
        return Promise.resolve(
          jsonResponse({
            data: {
              rows: [
                {
                  affiliate: ' Caio Fernandes  Rocha Souza ',
                  campaign: ' Telegram ',
                  clicks: 23,
                  registrations: 7,
                  ftd: 2,
                  cpa_qual: 1,
                  deposits: 99.97,
                  bet_amount: 88.8,
                  ngr: 36.19,
                },
                {
                  affiliate: ' ',
                  campaign: 'Cadastro',
                  registrations: 9,
                },
              ],
              meta: { currentPage: 1, totalPages: 2, pageSize: 10000 },
            },
          }),
        );
      }
      return Promise.resolve(
        jsonResponse({
          data: {
            rows: [
              {
                affiliate: 'Maria Silva',
                campaign: 'Instagram',
                clicks: 'invalid',
                registrations: 'invalid',
                ftd: 1,
                cpa_qual: 0,
                deposits: 0,
                bet_amount: 'invalid',
                ngr: -15,
              },
            ],
            meta: { currentPage: 2, totalPages: 2, pageSize: 10000 },
          },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const reports = await new OtgExtractor().fetchReports(
      'access-token',
      '2026-07-27',
      'cmm5dhdqm000e19b58dqc549a',
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [input, init] of fetchMock.mock.calls) {
      const url = new URL(input as string);
      expect(url.pathname).toBe('/api/v1/agency/sportingbet-analytics');
      expect(Object.fromEntries(url.searchParams)).toMatchObject({
        initialDate: '2026-07-26',
        finalDate: '2026-07-26',
        scope: 'CAMPAIGNS',
        sortBy: 'affiliate',
        sortDirection: 'asc',
        pageSize: '10000',
      });
      expect(url.searchParams.has('bettingHouseId')).toBe(false);
      expect(url.searchParams.has('tab')).toBe(false);
      expect(url.searchParams.has('viewMode')).toBe(false);
      expect(init).toEqual({
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer access-token',
        },
      });
    }
    expect(reports).toHaveLength(2);
    expect(reports[0]).toEqual({
      campaignId: 'CaioFernandesRochaSouza::Telegram',
      affiliateId: 'CaioFernandesRochaSouza',
      date: new Date('2026-07-27T00:00:00.000Z'),
      clicks: 23,
      registrations: 7,
      ftds: 2,
      qftd: 1,
      deposit: 99.97,
      netPl: null,
      withdrawalTotal: null,
      volume: 88.8,
      revShare: 0,
      cpaQualified: 1,
      cpaValue: 0,
      totalCommission: 0,
    });
    expect(reports[1]).toMatchObject({
      campaignId: 'MariaSilva::Instagram',
      clicks: 0,
      registrations: 0,
      volume: 0,
      netPl: null,
      revShare: 0,
      cpaValue: 0,
      totalCommission: 0,
    });
  });

  it('keeps the logical report date while querying the previous OTG date', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          rows: [
            {
              affiliate: 'Maria Silva',
              campaign: 'Telegram',
              clicks: 1,
            },
          ],
          meta: { currentPage: 1, totalPages: 1, pageSize: 10000 },
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const reports = await new OtgExtractor().fetchReports(
      'access-token',
      '2026-07-30',
      'house-id',
    );

    const requestedUrl = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(requestedUrl.searchParams.get('initialDate')).toBe('2026-07-29');
    expect(requestedUrl.searchParams.get('finalDate')).toBe('2026-07-29');
    expect(reports[0]?.date).toEqual(new Date('2026-07-30T00:00:00.000Z'));
  });

  it('drops campaigns with every operational metric equal to zero', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: {
            rows: [
              {
                affiliate: 'Sem Movimento',
                campaign: 'Cadastro',
                clicks: 0,
                registrations: 0,
                ftd: 0,
                cpa_qual: 0,
                deposits: 0,
                bet_amount: 0,
              },
              {
                affiliate: 'Com Movimento',
                campaign: 'Instagram',
                clicks: 1,
                registrations: 0,
                ftd: 0,
                cpa_qual: 0,
                deposits: 0,
                bet_amount: 0,
              },
            ],
            meta: { currentPage: 1, totalPages: 1, pageSize: 10000 },
          },
        }),
      ),
    );

    const reports = await new OtgExtractor().fetchReports(
      'access-token',
      '2026-07-30',
      'house-id',
    );

    expect(reports).toHaveLength(1);
    expect(reports[0]?.campaignId).toBe('ComMovimento::Instagram');
  });

  it('rejects the whole report when a later page fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            rows: [],
            meta: { currentPage: 1, totalPages: 2 },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ message: 'failed' }, 503));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new OtgExtractor().fetchReports('access-token', '2026-07-27', 'house-id'),
    ).rejects.toThrow('page 2: HTTP 503');
  });

  it('accepts an empty current-day report with totalPages zero', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: {
            rows: [],
            meta: {
              currentPage: 1,
              totalPages: 0,
              totalRows: 0,
              pageSize: 10000,
            },
          },
        }),
      ),
    );

    await expect(
      new OtgExtractor().fetchReports('access-token', '2026-07-27', 'house-id'),
    ).resolves.toEqual([]);
  });
});
