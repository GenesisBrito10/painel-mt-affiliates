import { LedgerEventType, LedgerEventStatus } from '@prisma/client';

export interface EarningsLedgerFilter {
  userId: string;
  startDate?: Date;
  endDate?: Date;
  eventType?: LedgerEventType;
  bettingHouse?: string;
}

export interface EarningsPeriodSummary {
  totalCredits: number;
  totalDebits: number;
  netChange: number;
}
