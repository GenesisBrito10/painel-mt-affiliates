/**
 * Extração do campaignId a partir da URL de divulgação do afiliado.
 *
 * O campaignId é a chave que casa o AffiliateLink com o dado bruto que o sync
 * grava em AffiliateData — se sair errado aqui, o dado chega no painel e nunca
 * encontra o link, deixando o afiliado sem CPA.
 *
 * Padrões suportados:
 *  - Superbet: ...C.ashx?siteid=X&c=Y → "X-Y"
 *  - Smartico (Bateu Bet): ...?afp=CODIGO → "CODIGO". A Smartico expõe `afp` e
 *    `afp1`..`afp5`; a dimensão que o sync lê é o bookmarkerId da casa.
 *
 * Espelha onUserLinkInput no admin (app/pages/affiliates/[id].vue).
 */

const SMARTICO_PARAMS = ['afp', 'afp1', 'afp2', 'afp3', 'afp4', 'afp5'];

export function extractCampaignIdFromUrl(url: string): string | null {
  let params: URLSearchParams;
  try {
    params = new URL(url.startsWith('http') ? url : `https://${url}`)
      .searchParams;
  } catch {
    return null;
  }

  const siteid = params.get('siteid');
  const c = params.get('c');
  if (siteid && c) return `${siteid}-${c}`;

  for (const name of SMARTICO_PARAMS) {
    const value = params.get(name)?.trim();
    if (value) return value;
  }

  return null;
}
