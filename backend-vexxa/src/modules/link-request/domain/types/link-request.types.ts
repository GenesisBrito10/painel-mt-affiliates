// ─── Eligibility constants (ported from legacy deal-request-eligibility.ts) ─
export const DEAL_ELIGIBILITY_METRICS_SLUG = 'superbet';
export const DEFAULT_DEAL_ELIGIBILITY_WINDOW_DAYS = 30;
export const DEFAULT_DEAL_MIN_AVG_DEPOSIT_PER_FTD = 80;
export const DEFAULT_DEAL_MIN_QUALIFIED_FTD = 15;
export const DEAL_ELIGIBILITY_WINDOW_DAYS_SETTING =
  'deal_eligibility_window_days';

export function isDealEligibilityRequired(
  houseSlug: string,
  alreadyLinkedToHouse: boolean,
): boolean {
  return houseSlug === 'betano-diario' && !alreadyLinkedToHouse;
}

/** Houses that allow only 1 link request per account (any status, any deal) */
export const ONE_REQUEST_PER_ACCOUNT_HOUSES = ['mgm', 'esportivabet'] as const;

/**
 * Houses where campaignId extraction from URL is NOT automatic.
 * Admin or network leader must supply manualCampaignId in the body.
 * (esportivabet saiu: agora tem link-pool automático com extração própria.)
 */
export const MANUAL_CAMPAIGN_ID_HOUSES = ['mgm'] as const;

/**
 * Houses served by an auto-assign scheduler (link pool + sheet).
 * O CPA já vem resolvido (snapshot na LinkRequest); o cron atribui o link real.
 * NOTA (§40): constante operacional; futuramente derivável de
 * HouseLinkRule.autoAssignEnabled + assignment service registrado.
 */
export const POOL_HOUSES = [
  'superbet',
  'betnacional',
  'hiperbet',
  'betano',
  'betano-diario',
  'esportivabet',
  'sportingbet',
  'sportingbet-diario',
] as const;

// ─── Shapes ──────────────────────────────────────────────────────────────────

export interface LinkItem {
  label: string;
  url: string;
}

export interface LinkRequestListItem {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  /** Quem indicou o dono do link-request (espelha o "Indicador" dos afiliados). */
  referredBy: { id: string; name: string; email: string } | null;
  dealId: string | null;
  dealName: string | null;
  bettingHouseSlug: string;
  message: string;
  status: string; // PENDING | FULFILLED | REJECTED
  links: LinkItem[];
  adminNote: string;
  fulfilledAt: Date | null;
  fulfilledByName: string;
  createdAt: Date;
  // Snapshot do CPA resolvido (exibição admin).
  resolvedCpa: number | null;
  resolvedRevshare: number | null;
  resolvedRuleApplied: string | null;
  inviterCpa: number | null;
  requiredHouseSlugs: string[];
  missingHouseSlugs: string[];
  blockedReason: string | null;
  // Deals kind=FORM: respostas do formulário. No admin vem com os campos `secret`
  // (senha de terceiro) já descriptografados; null para deals LINK.
  formData?: Record<string, unknown> | null;
  // Tipo do deal associado (LINK padrão). Usado pelo admin para renderizar a
  // revisão de formulário em vez do fluxo de link.
  kind?: 'LINK' | 'FORM';
}

export interface LinkRequestCreateResult {
  id: string;
  userId: string;
  dealId: string | null;
  bettingHouseSlug: string;
  message: string;
  status: string;
  createdAt: Date;
}

export interface DealEligibilityResult {
  eligible: boolean;
  required: boolean;
  metricsHouseSlug: string;
  windowDays: number;
  minAvgDepositPerFtd: number;
  minQualifiedFtd: number;
  sumQualifiedFtd: number;
  sumCpaQualified: number;
  sumDeposit: number;
  sumFtds: number;
  avgDepositPerFtd: number | null;
  from: string;
  to: string;
  reasons: string[];
}

type DealEligibilitySnapshotBase = Omit<
  DealEligibilityResult,
  'eligible' | 'reasons' | 'minAvgDepositPerFtd' | 'minQualifiedFtd'
>;

export interface DealEligibilitySnapshot extends DealEligibilitySnapshotBase {
  missingSuperbetLink: boolean;
}
