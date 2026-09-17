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
