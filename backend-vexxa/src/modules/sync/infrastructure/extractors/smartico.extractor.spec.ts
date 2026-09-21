import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { SmarticoExtractor } from './smartico.extractor.js';

describe('SmarticoExtractor Pinbet metrics', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps regular sync requests as one exclusive day', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const extractor = new SmarticoExtractor(new ConfigService());
    await extractor.fetchReports('token', '2026-07-21', 'afp1');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        'group_by=afp1&date_from=2026-07-21&date_to=2026-07-22',
      ),
      expect.any(Object),
    );
  });

  it('extracts every daily row from one initial backfill range using each row dt', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          data: [
            {
              dt: '2026-07-21T00:00:00.000Z',
              afp1: 'VALLEX0001',
              visit_count: 1,
              registration_count: 2,
              qftd_count: 3,
              ftd_count: 4,
              deposit_total: 10,
              withdrawal_total: 20,
              net_pl: 30,
              volume: 40,
              commissions_rev_share: 5,
            },
            {
              dt: '2026-07-24T00:00:00.000Z',
              afp1: 'VALLEX0002',
              visit_count: 6,
              registration_count: 7,
              qftd_count: 8,
              ftd_count: 9,
              deposit_total: 50,
              withdrawal_total: 60,
              net_pl: 70,
              volume: 80,
              commissions_rev_share: 10,
            },
          ],
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const extractor = new SmarticoExtractor(new ConfigService());
    const reports = await extractor.fetchReportsRange(
      'token',
      '2026-07-21',
      '2026-07-25',
      'afp1',
    );

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        'group_by=afp1&date_from=2026-07-21&date_to=2026-07-25',
      ),
      expect.any(Object),
    );
    expect(reports.map((report) => report.date.toISOString())).toEqual([
      '2026-07-21T00:00:00.000Z',
      '2026-07-24T00:00:00.000Z',
    ]);
  });

  it('rejects Smartico HTTP 291 so the orchestrator retries instead of accepting an empty report', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 291,
        text: () => Promise.resolve('{"message":"request throttled"}'),
        json: () => Promise.resolve({ data: [] }),
      }),
    );

    const extractor = new SmarticoExtractor(new ConfigService());

    await expect(
      extractor.fetchReports('token', '2026-07-25', 'afp1'),
    ).rejects.toThrow('HTTP 291');
  });

  it('extracts and rounds the operational metrics to two decimal places', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: [
              {
                dt: '2026-07-23T00:00:00.000Z',
                afp1: 'VALLEX0001',
                visit_count: 377,
                registration_count: 97,
                qftd_count: 74,
                ftd_count: 77,
                deposit_total: 3122.029998779297,
                withdrawal_total: 3125.9999923706055,
                net_pl: -68.25999727100134,
                volume: 7776.850036621094,
                commissions_rev_share: -6.8259995291009545,
              },
            ],
          }),
      }),
    );

    const extractor = new SmarticoExtractor(new ConfigService());
    const [report] = await extractor.fetchReports(
      'token',
      '2026-07-23',
      'afp1',
    );

    expect(report).toMatchObject({
      campaignId: 'VALLEX0001',
      deposit: 3122.03,
      netPl: -68.26,
      withdrawalTotal: 3126,
      volume: 7776.85,
    });
  });

  it('fetches afp1 and afp2 sequentially for the consolidated monthly house', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        json: () =>
          Promise.resolve({
            data: [
              {
                dt: '2026-08-05T00:00:00.000Z',
                afp1: 'VALLEX0001',
                qftd_count: 1,
              },
            ],
          }),
      })
      .mockResolvedValueOnce({
        status: 200,
        json: () =>
          Promise.resolve({
            data: [
              {
                dt: '2026-08-05T00:00:00.000Z',
                afp2: 'MJM0001',
                qftd_count: 2,
              },
            ],
          }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const extractor = new SmarticoExtractor(new ConfigService());
    const reports = await extractor.fetchReports(
      'token',
      '2026-08-05',
      'afp1, afp2',
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('group_by=afp1');
    expect(fetchMock.mock.calls[1]?.[0]).toContain('group_by=afp2');
    expect(reports.map((report) => report.campaignId)).toEqual([
      'VALLEX0001',
      'MJM0001',
    ]);
  });
});

describe('SmarticoExtractor multi-conta (Pinbet boapi7 / Bateu Bet boapi3)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const okFetch = (data: unknown[] = []) =>
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data }),
    });

  it('usa o token da conta e o host da conta, não o env legado', async () => {
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    const config = {
      get: vi.fn().mockReturnValue('token-legado-pinbet'),
    } as unknown as ConfigService;
    const extractor = new SmarticoExtractor(config);

    const session = await extractor.login({
      email: 'bateubet',
      password: 'token-bateubet',
      apiBaseUrl: 'https://boapi3.smartico.ai/api/',
    });
    await extractor.fetchReports(session, '2026-09-20', 'afp');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('https://boapi3.smartico.ai/api/af2_media_report_af');
    expect(url).toContain('group_by=afp');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'token-bateubet',
    );
  });

  it('cai no PINBET_SMARTICO_TOKEN e no host padrão quando a conta não traz token/URL', async () => {
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    const config = {
      get: vi.fn().mockReturnValue('token-legado-pinbet'),
    } as unknown as ConfigService;
    const extractor = new SmarticoExtractor(config);

    const session = await extractor.login({
      email: 'pinbet',
      password: '',
      apiBaseUrl: '',
    });
    await extractor.fetchReports(session, '2026-09-20', 'afp1');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('https://boapi7.smartico.ai/api/');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'token-legado-pinbet',
    );
  });

  it('ignora apiBaseUrl que não é da Smartico (contas antigas com URL do Betboard)', async () => {
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    const config = {
      get: vi.fn().mockReturnValue('token-legado-pinbet'),
    } as unknown as ConfigService;
    const extractor = new SmarticoExtractor(config);

    const session = await extractor.login({
      email: 'pinbet',
      password: 'token-da-conta',
      apiBaseUrl: 'https://api-affiliates.mgaffiliates.site/api',
    });
    await extractor.fetchReports(session, '2026-09-20', 'afp1');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('https://boapi7.smartico.ai/api/');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'token-legado-pinbet',
    );
  });

  it('extrai campanhas da dimensão `afp` e remove espaços do código', async () => {
    vi.stubGlobal(
      'fetch',
      okFetch([
        {
          dt: '2026-09-20T00:00:00.000Z',
          afp: 'Tonny-aviator ',
          visit_count: 35,
          registration_count: 3,
          qftd_count: 1,
          ftd_count: 1,
          deposit_total: 524,
          withdrawal_total: 1270,
          net_pl: -566.0750045776367,
          volume: 400.5,
          commissions_rev_share: -169.82,
        },
        { dt: '2026-09-20T00:00:00.000Z', afp: '', qftd_count: 9 },
      ]),
    );

    const extractor = new SmarticoExtractor(new ConfigService());
    const reports = await extractor.fetchReports('token', '2026-09-20', 'afp');

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      campaignId: 'Tonny-aviator',
      clicks: 35,
      qftd: 1,
      deposit: 524,
      netPl: -566.08,
    });
  });
});
