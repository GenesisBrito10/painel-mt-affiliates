export const SPORTINGBET_SLUG = 'sportingbet';
export const SPORTINGBET_LOCK_KEY = 'sportingbet:assign:lock';
export const SPORTINGBET_LOCK_TTL_SECONDS = 30;
export const SPORTINGBET_BACKOFF_DELAYS_MS = [200, 400, 800, 1600, 3200];
export const SPORTINGBET_MARKED_STATUS = 'marcado';

export const SPORTINGBET_SCHEDULER_LOCK_KEY = 'sportingbet:scheduler:lock';
export const SPORTINGBET_SCHEDULER_LOCK_TTL_SECONDS = 120;

export function normalizeSportingbetAffiliate(value: string): string {
  return value.trim().replace(/\s+/gu, '');
}

// Chave canônica compartilhada pela pool e pelo futuro extrator:
// response.affiliate + response.campaign.
export function buildSportingbetCampaignId(
  affiliate: string,
  linkType: string,
): string {
  return `${normalizeSportingbetAffiliate(affiliate)}::${linkType.trim()}`;
}

export interface SheetRow {
  rowIndex: number;
  affiliate: string;
  linkType: string;
  link: string;
  status: string;
  email: string;
}

export function isSportingbetRowAvailable(row: SheetRow): boolean {
  return Boolean(
    row.affiliate && row.linkType && row.link && !row.status && !row.email,
  );
}

export function selectSequentialSportingbetRows(rows: SheetRow[]): SheetRow[] {
  const lastControlledRow = rows.reduce(
    (last, row) =>
      row.status || row.email ? Math.max(last, row.rowIndex) : last,
    1,
  );

  return rows
    .filter((row) => row.rowIndex > lastControlledRow)
    .sort((a, b) => a.rowIndex - b.rowIndex);
}

export function selectAssignableSportingbetRows(rows: SheetRow[]): SheetRow[] {
  const sequentialRows = selectSequentialSportingbetRows(rows);
  const blockedIndex = sequentialRows.findIndex(
    (row) => !isSportingbetRowAvailable(row),
  );
  return blockedIndex === -1
    ? sequentialRows
    : sequentialRows.slice(0, blockedIndex);
}

export type AssignReason =
  | 'lock_busy'
  | 'pool_empty'
  | 'all_conflicts'
  | 'sheet_read_failed'
  | 'redis_unavailable'
  | 'request_not_found'
  | 'already_fulfilled'
  | 'pool_blocked'
  | 'sheet_write_failed';

export type AssignResult =
  | {
      assigned: true;
      campaignId: string;
      link: string;
      rowIndex: number;
      email: string;
    }
  | { assigned: false; reason: AssignReason };

export interface PoolStatus {
  total: number;
  available: number;
  used: number;
  inconsistencies: number;
}
