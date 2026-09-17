import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { IEarningsRepository } from '../../domain/ports/earnings.repository.js';
import type { EarningsLedgerFilter, EarningsPeriodSummary } from '../../domain/types/earnings.types.js';
import { FinancialLedger, Prisma } from '@prisma/client';

@Injectable()
export class EarningsPrismaRepository implements IEarningsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private buildWhere(filter: EarningsLedgerFilter): Prisma.FinancialLedgerWhereInput {
    return {
      userId: filter.userId,
      ...(filter.eventType && { eventType: filter.eventType }),
      ...(filter.bettingHouse && { bettingHouse: filter.bettingHouse }),
      ...(filter.startDate || filter.endDate
        ? {
            eventDate: {
              ...(filter.startDate && { gte: filter.startDate }),
              ...(filter.endDate && { lte: filter.endDate }),
            },
          }
        : {}),
    };
  }

  async findLedgerEntries(
    filter: EarningsLedgerFilter,
    skip: number,
    take: number,
  ): Promise<FinancialLedger[]> {
    return this.prisma.financialLedger.findMany({
      where: this.buildWhere(filter),
      orderBy: [{ eventDate: 'desc' }, { createdAt: 'desc' }],
      skip,
      take,
    });
  }

  async countLedgerEntries(filter: EarningsLedgerFilter): Promise<number> {
    return this.prisma.financialLedger.count({
      where: this.buildWhere(filter),
    });
  }

  async getPeriodSummary(filter: EarningsLedgerFilter): Promise<EarningsPeriodSummary> {
    const where = this.buildWhere(filter);

    const agg = await this.prisma.financialLedger.aggregate({
      where,
      _sum: {
        amount: true,
      },
    });

    const credits = await this.prisma.financialLedger.aggregate({
      where: { ...where, amount: { gt: 0 } },
      _sum: { amount: true },
    });

    const debits = await this.prisma.financialLedger.aggregate({
      where: { ...where, amount: { lt: 0 } },
      _sum: { amount: true },
    });

    return {
      totalCredits: credits._sum.amount?.toNumber() ?? 0,
      totalDebits: debits._sum.amount?.toNumber() ?? 0,
      netChange: agg._sum.amount?.toNumber() ?? 0,
    };
  }
}
