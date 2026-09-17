import { FinancialLedger } from '@prisma/client';
import type { EarningsLedgerFilter, EarningsPeriodSummary } from '../types/earnings.types.js';

export const EARNINGS_REPOSITORY = Symbol('IEarningsRepository');

export interface IEarningsRepository {
  /**
   * Find paginated ledger entries based on filters
   */
  findLedgerEntries(
    filter: EarningsLedgerFilter,
    skip: number,
    take: number
  ): Promise<FinancialLedger[]>;

  /**
   * Count total ledger entries for pagination
   */
  countLedgerEntries(filter: EarningsLedgerFilter): Promise<number>;

  /**
   * Get total credits, debits, and net change for a period
   */
  getPeriodSummary(filter: EarningsLedgerFilter): Promise<EarningsPeriodSummary>;
}
