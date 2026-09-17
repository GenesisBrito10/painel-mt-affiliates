import { describe, expect, it } from 'vitest';
import * as repositoryModule from './sync.prisma-repository.js';

describe('active deal campaign extraction', () => {
  it('builds unique Betboard campaign ids from valid fulfilled links', () => {
    const extract = (
      repositoryModule as unknown as {
        extractBetboardCampaignIds: (links: unknown[]) => Set<string>;
      }
    ).extractBetboardCampaignIds;

    expect(extract).toBeTypeOf('function');
    expect(
      extract([
        [
          {
            label: 'Superbet',
            url: 'https://wlsuperbet.adsrv.eacdn.com/C.ashx?siteid=5565&c=MJM01',
          },
        ],
        [
          {
            url: 'https://wlsuperbet.adsrv.eacdn.com/C.ashx?c=MJM01&siteid=5565',
          },
          { url: 'not-a-url' },
          { label: 'missing-url' },
        ],
      ]),
    ).toEqual(new Set(['5565-MJM01']));
  });
});
