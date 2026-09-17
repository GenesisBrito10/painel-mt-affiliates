import { Injectable } from '@nestjs/common';
import { DashboardBalanceService } from './dashboard-balance.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { JwtPayload } from '../../auth/domain/auth.types.js';
import type { EarningsOverviewDto, EarningsLedgerQueryDto } from './dto/earnings.dto.js';
import { WithdrawalStatus } from '@prisma/client';

@Injectable()
export class EarningsOverviewService {
  constructor(
    private readonly balanceService: DashboardBalanceService,
    private readonly prisma: PrismaService,
  ) {}

  async getOverview(
    user: JwtPayload,
    query: Pick<EarningsLedgerQueryDto, 'startDate' | 'endDate' | 'bettingHouse'>,
  ): Promise<EarningsOverviewDto> {
    const balance = await this.balanceService.getBalance(user, query);

    const pendingSum = await this.prisma.withdrawalRequest.aggregate({
      where: {
        userId: user.sub,
        status: WithdrawalStatus.PENDING,
        ...(query.bettingHouse ? { bettingHouse: query.bettingHouse } : {}),
      },
      _sum: { amount: true },
    });

    const withdrawalsPending = pendingSum._sum.amount?.toNumber() ?? 0;

    return {
      availableBalance: balance.netBalance, // already post-fee in DashboardBalanceService
      formula: {
        ownCpa: balance.cpa,
        ownRevshare: balance.rev,
        networkCpa: balance.networkCpa,
        networkRevshare: balance.networkRev,
        bonusBalance: balance.bonusBalance,
        grossTotal: balance.cpa + balance.rev + balance.networkCpa + balance.networkRev + balance.bonusBalance,
        fraudDeductionDirect: balance.fraudDeduction,
        fraudDeductionNetwork: balance.networkFraudDeduction,
        totalFraudDeduction: balance.totalFraudDeduction,
        withdrawalsApproved: balance.approvedWithdrawals,
        withdrawalsPending,
        netBalance: balance.balance, // pre-fee in DashboardBalanceService
        withdrawalFee: balance.withdrawalFee,
        withdrawalFeeRate: balance.withdrawalFeeRate,
        availableBalance: balance.netBalance,
      },
      perHouse: balance.perHouse,
      depositInfo: balance.depositInfo,
      meta: {
        lastUpdatedAt: new Date().toISOString(),
        validationStatus: 'synced',
      },
    };
  }
}
