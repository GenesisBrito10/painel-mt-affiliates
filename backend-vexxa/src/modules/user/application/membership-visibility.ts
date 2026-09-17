export interface AgreementVisibilityRequest {
  bettingHouseSlug: string;
  dealId: string | null;
  status: string;
  deal: { active: boolean } | null;
  links: unknown;
}

function extractCampaignIds(links: unknown): string[] {
  if (!Array.isArray(links)) return [];

  return links.flatMap((link) => {
    if (
      typeof link !== 'object' ||
      link === null ||
      !('url' in link) ||
      typeof link.url !== 'string'
    ) {
      return [];
    }

    try {
      const url = new URL(link.url);
      const siteId = url.searchParams.get('siteid');
      const campaign = url.searchParams.get('c');
      return siteId && campaign ? [`${siteId}-${campaign}`] : [];
    } catch {
      return [];
    }
  });
}

export function filterLinksForActiveAgreements<
  T extends { bettingHouse: string; campaignId?: string | null },
>(links: T[], requests: AgreementVisibilityRequest[]): T[] {
  const fulfilled = requests.filter(
    (request) => request.status === 'FULFILLED',
  );
  const visibleRequests = fulfilled.filter(
    (request) => request.dealId === null || request.deal?.active === true,
  );
  const housesWithDealHistory = new Set(
    fulfilled
      .filter((request) => request.dealId !== null)
      .map((request) => request.bettingHouseSlug),
  );
  const visibleHouses = new Set(
    visibleRequests.map((request) => request.bettingHouseSlug),
  );
  const visibleCampaignsByHouse = new Map<string, Set<string>>();

  for (const request of visibleRequests) {
    const campaignIds = extractCampaignIds(request.links);
    if (campaignIds.length === 0) continue;

    const visibleCampaigns =
      visibleCampaignsByHouse.get(request.bettingHouseSlug) ?? new Set();
    campaignIds.forEach((campaignId) => visibleCampaigns.add(campaignId));
    visibleCampaignsByHouse.set(request.bettingHouseSlug, visibleCampaigns);
  }

  return links.filter((link) => {
    if (!housesWithDealHistory.has(link.bettingHouse)) return true;
    if (!visibleHouses.has(link.bettingHouse)) return false;

    const visibleCampaigns = visibleCampaignsByHouse.get(link.bettingHouse);
    if (!visibleCampaigns || visibleCampaigns.size === 0) return true;

    return (
      typeof link.campaignId === 'string' &&
      visibleCampaigns.has(link.campaignId)
    );
  });
}
