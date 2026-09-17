export interface CorrectionPlanItem {
  requestId: string;
  affiliateLinkId: string;
  userId: string;
  campaignId: string;
  oldRequestCpa: number | null;
  oldLinkCpa: number | null;
}

export function parseSuperbetCampaign(rawUrl: string): {
  siteid: string;
  c: string;
  campaignId: string;
};

export function buildCorrectionPlan(input: {
  requests: Array<Record<string, unknown>>;
  affiliateLinks: Array<Record<string, unknown>>;
  expectedTargets: number;
}): CorrectionPlanItem[];

export function assertSafeImpact(input: {
  openWithdrawals: number;
  metricRows?: number;
}): true;
export function distribution(values: Iterable<unknown>): Record<string, number>;
