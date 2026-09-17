const asNumber = (value) => (value == null ? null : Number(value));

export function parseSuperbetCampaign(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
  } catch {
    throw new Error('URL Superbet invalida');
  }
  const siteid = parsed.searchParams.get('siteid');
  const c = parsed.searchParams.get('c');
  if (!siteid || !c) {
    throw new Error('URL Superbet sem siteid ou c');
  }
  return { siteid, c, campaignId: `${siteid}-${c}` };
}

const requestUrl = (request) => {
  if (!Array.isArray(request.links) || request.links.length !== 1) {
    throw new Error(`Pedido ${request.id} nao possui exatamente uma URL`);
  }
  const raw = request.links[0];
  const url = typeof raw === 'string' ? raw : raw?.url;
  if (typeof url !== 'string' || !url.trim()) {
    throw new Error(`Pedido ${request.id} possui URL invalida`);
  }
  return url;
};

export function buildCorrectionPlan({
  requests,
  affiliateLinks,
  expectedTargets,
}) {
  if (requests.length !== expectedTargets) {
    throw new Error(
      `Contagem divergente: esperado ${expectedTargets}, encontrado ${requests.length}`,
    );
  }

  const requestIds = new Set();
  const userIds = new Set();
  const campaignIds = new Set();

  return requests.map((request) => {
    if (requestIds.has(request.id)) {
      throw new Error(`Pedido duplicado: ${request.id}`);
    }
    requestIds.add(request.id);
    if (userIds.has(request.userId)) {
      throw new Error(`Usuario duplicado: ${request.userId}`);
    }
    userIds.add(request.userId);

    const { campaignId } = parseSuperbetCampaign(requestUrl(request));
    if (campaignIds.has(campaignId)) {
      throw new Error(`Campanha duplicada: ${campaignId}`);
    }
    campaignIds.add(campaignId);

    const matches = affiliateLinks.filter(
      (link) =>
        link.campaignId === campaignId && link.userId === request.userId,
    );
    const allCampaignMatches = affiliateLinks.filter(
      (link) => link.campaignId === campaignId,
    );
    if (matches.length !== 1 || allCampaignMatches.length !== 1) {
      throw new Error(
        `Mapeamento divergente para pedido ${request.id} e campanha ${campaignId}`,
      );
    }

    return {
      requestId: request.id,
      affiliateLinkId: matches[0].id,
      userId: request.userId,
      campaignId,
      oldRequestCpa: asNumber(request.resolvedCpa),
      oldLinkCpa: asNumber(matches[0].cpa),
    };
  });
}

export function assertSafeImpact({ openWithdrawals, metricRows = 0 }) {
  if (openWithdrawals !== 0) {
    throw new Error(
      `Existem ${openWithdrawals} saques abertos nos usuarios alvo`,
    );
  }
  if (metricRows !== 0) {
    throw new Error(
      `Existem ${metricRows} linhas de metricas nas campanhas alvo`,
    );
  }
  return true;
}

export const distribution = (values) =>
  Object.fromEntries(
    [...values]
      .map((value) => String(value))
      .reduce((counts, value) => {
        counts.set(value, (counts.get(value) ?? 0) + 1);
        return counts;
      }, new Map())
      .entries(),
  );
