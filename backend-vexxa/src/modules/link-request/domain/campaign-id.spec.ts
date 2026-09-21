import { describe, expect, it } from 'vitest';
import { extractCampaignIdFromUrl } from './campaign-id.js';

describe('extractCampaignIdFromUrl', () => {
  it('extrai o par siteid+c da Superbet', () => {
    expect(
      extractCampaignIdFromUrl(
        'https://wlsuperbet.adsrv.eacdn.com/C.ashx?siteid=32666&c=CAMPANHA',
      ),
    ).toBe('32666-CAMPANHA');
  });

  it('extrai o afp dos links da Bateu Bet', () => {
    expect(
      extractCampaignIdFromUrl(
        'https://go.aff.bateu.bet.br/ibqecrdp?afp=Tonny-aviator',
      ),
    ).toBe('Tonny-aviator');
  });

  it('decodifica e apara o valor do afp', () => {
    expect(
      extractCampaignIdFromUrl(
        'https://go.aff.bateu.bet.br/ibqecrdp?afp=Telegram+VIP',
      ),
    ).toBe('Telegram VIP');
  });

  it('aceita URL sem esquema', () => {
    expect(
      extractCampaignIdFromUrl('go.aff.bateu.bet.br/ibqecrdp?afp=Ivan-Dados'),
    ).toBe('Ivan-Dados');
  });

  it('aceita as dimensões numeradas afp1..afp5', () => {
    expect(extractCampaignIdFromUrl('https://x.com/a?afp2=MJM0001')).toBe(
      'MJM0001',
    );
  });

  it('prefere o par da Superbet quando a URL traz os dois padrões', () => {
    expect(
      extractCampaignIdFromUrl('https://x.com/a?siteid=1&c=B&afp=OUTRO'),
    ).toBe('1-B');
  });

  it('devolve null sem parâmetro conhecido, URL inválida ou afp vazio', () => {
    expect(
      extractCampaignIdFromUrl('https://go.aff.bateu.bet.br/ibqecrdp'),
    ).toBeNull();
    expect(extractCampaignIdFromUrl('')).toBeNull();
    expect(extractCampaignIdFromUrl('https://x.com/a?afp=%20')).toBeNull();
  });
});
