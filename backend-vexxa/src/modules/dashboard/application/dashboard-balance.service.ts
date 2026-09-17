import { Injectable, Logger } from '@nestjs/common';
import {
  PrismaService,
  type PrismaTransactionClient,
} from '../../prisma/prisma.service.js';
import { SettingsService } from '../../settings/index.js';
import { DashboardAccessService } from './dashboard-access.service.js';
import { dataSourceHouse } from '../domain/house-alias.js';
import {
  DASHBOARD_REPOSITORY,
  type IDashboardRepository,
} from '../domain/ports/dashboard.repository.js';
import { Inject } from '@nestjs/common';
import type {
  PerHouseBalance,
  AuditExclusion,
} from '../domain/types/dashboard.types.js';
import type {
  BalanceResponseDto,
  FraudDetailDto,
} from './dto/dashboard.dto.js';

import { WithdrawalStatus } from '@prisma/client';
import type { JwtPayload } from '../../auth/domain/auth.types.js';
import {
  calculatePinbetWithdrawalLimit,
  calculateSegmentedPinbetWithdrawalLimit,
  isPinbetHouse,
} from '../../withdrawal/domain/pinbet-withdrawal-limit.js';
import {
  pinbetDimensionForAdjustment,
  pinbetDimensionForLink,
  pinbetDimensionForWithdrawal,
  pinbetRateKey,
  type PinbetDimension,
} from '../../withdrawal/domain/pinbet-dimension.js';

// Depth of the referral tree that earns network spread for a head.
// Spread anchor stays the L1 ancestor regardless of depth (see loadNetworkMembers).
export const NETWORK_LEVEL_CAP = 10;

const rateKeyForNetworkLink = (link: {
  bettingHouse: string;
  campaignId: string;
  linkType?: string | null;
}) =>
  isPinbetHouse(link.bettingHouse)
    ? pinbetRateKey(link.bettingHouse, pinbetDimensionForLink(link))
    : link.bettingHouse;

const BALANCE_SETTINGS_KEYS = [
  'withdrawal_block_active',
  'withdrawal_block_start_date',
  'withdrawal_block_end_date',
  'min_avg_deposit_per_cpa',
  'min_avg_deposit_warning',
  'min_withdrawal_amount',
  'withdrawal_fee_rate',
  'ledger_cutover_date',
] as const;

@Injectable()
export class DashboardBalanceService {
  private readonly logger = new Logger(DashboardBalanceService.name);

  constructor(
    @Inject(DASHBOARD_REPOSITORY)
    private readonly repo: IDashboardRepository,
    private readonly access: DashboardAccessService,
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
  ) {}

  async getBalance(
    user: JwtPayload,
    query: { startDate?: string; endDate?: string; bettingHouse?: string },
    tx?: PrismaTransactionClient,
  ): Promise<BalanceResponseDto> {
    // When called inside a $transaction (e.g. withdrawal create with advisory
    // lock), `tx` keeps all reads on the same snapshot/connection so balance
    // cannot race with concurrent ledger writes.
    const db = tx ?? this.prisma;
    // ── Settings (1 batch query) ────────────────────────────────────────────
    const settingsMap = await this.settings.getMany([...BALANCE_SETTINGS_KEYS]);
    const auditActive = settingsMap.get('withdrawal_block_active') === 'true';
    const auditExclusion: AuditExclusion | undefined = auditActive
      ? {
          startDate: new Date(
            settingsMap.get('withdrawal_block_start_date') ?? '2026-04-01',
          ),
          endDate: new Date(
            settingsMap.get('withdrawal_block_end_date') ?? '2026-05-01',
          ),
        }
      : undefined;

    // Threshold global (fallback). O valor efetivo passa a ser POR CASA
    // (BettingHouse.minAvgDepositPerCpa) quando o balanço é filtrado por casa.
    const globalMinAvgDeposit = parseFloat(
      settingsMap.get('min_avg_deposit_per_cpa') ?? '70',
    );
    const warningMessage = settingsMap.get('min_avg_deposit_warning') ?? '';
    const minWithdrawalAmount = parseFloat(
      settingsMap.get('min_withdrawal_amount') ?? '100',
    );

    const hasDateFilter = !!(query.startDate || query.endDate);
    // Balance without date filter aggregates ALL-TIME data (not just current month)
    // This ensures earnings from previous months count toward the total balance
    let startDate = query.startDate
      ? new Date(`${query.startDate}T00:00:00.000Z`)
      : new Date('2020-01-01T00:00:00.000Z'); // epoch — all historical data
    const endDate = query.endDate
      ? new Date(`${query.endDate}T23:59:59.999Z`)
      : new Date();

    // Ledger cutover: at the settlement date everyone was paid out to zero, so the
    // available balance only counts earnings/withdrawals FROM the cutover forward.
    // Pre-cutover legacy data stays in the DB (audit) but never feeds the balance.
    // NOTE: this floors only the BALANCE earnings window — historical metrics
    // (FTD, deposits, CPA count) are surfaced by separate endpoints, not affected.
    const cutoverRaw = settingsMap.get('ledger_cutover_date');
    const cutoverDate = cutoverRaw
      ? new Date(`${cutoverRaw}T00:00:00.000Z`)
      : null;
    if (
      cutoverDate &&
      !isNaN(cutoverDate.getTime()) &&
      cutoverDate > startDate
    ) {
      startDate = cutoverDate;
    }

    // ── Balance cutover POR CASA (independente do cutover de SYNC) ──────────
    // Setting `balance_cutover_date_<slug>`: o SALDO daquela casa não conta
    // ganhos/saques anteriores a esta data — zera o histórico da casa sem tocar
    // no cutover global nem no cutover de sync. Efetivo = max(global, por-casa).
    const perHouseBalanceCutover = new Map<string, Date>();
    const bcRows = await db.setting.findMany({
      where: { key: { startsWith: 'balance_cutover_date_' } },
      select: { key: true, value: true },
    });
    for (const r of bcRows) {
      const slug = r.key.slice('balance_cutover_date_'.length);
      const d = new Date(`${r.value}T00:00:00.000Z`);
      if (slug && !isNaN(d.getTime())) perHouseBalanceCutover.set(slug, d);
    }
    // Efetivo por casa (para os saques). Ganhos usam campaignCutover (abaixo).
    const balanceCutoverFor = (slug: string): Date | null => {
      const h = perHouseBalanceCutover.get(slug);
      if (h && (!cutoverDate || h > cutoverDate)) return h;
      return cutoverDate;
    };

    // ── Load user with own links + fraudCounts ──────────────────────────────
    const dbUser = await db.user.findUniqueOrThrow({
      where: { id: user.sub },
      select: {
        id: true,
        bonusBalance: true,
        affiliateLinks: {
          where: { deletedAt: null },
          select: {
            campaignId: true,
            bettingHouse: true,
            linkType: true,
            cpa: true,
            revshare: true,
          },
        },
        fraudCounts: {
          select: { bettingHouse: true, count: true },
        },
        balanceAdjustments: {
          select: {
            bettingHouse: true,
            amount: true,
            pinbetDimension: true,
          },
        },
      },
    });

    const perHouse: Record<string, PerHouseBalance> = {};
    const pinbetObserved = new Map<string, Set<string>>();
    const pinbetIncomplete = new Set<string>();
    const pinbetNetPl = new Map<string, number>();
    const pinbetDimensionBalance = new Map<string, number>();
    const pinbetDimensionObserved = new Map<string, Set<string>>();
    const pinbetDimensionIncomplete = new Set<string>();
    const pinbetDimensionNetPl = new Map<string, number>();
    const dimensionKey = (house: string, dimension: PinbetDimension) =>
      pinbetRateKey(house, dimension);
    const rateKeyForLink = (link: {
      bettingHouse: string;
      campaignId: string;
      linkType?: string | null;
    }) =>
      isPinbetHouse(link.bettingHouse)
        ? dimensionKey(link.bettingHouse, pinbetDimensionForLink(link))
        : link.bettingHouse;
    const addPinbetBalance = (
      link: {
        bettingHouse: string;
        campaignId: string;
        linkType?: string | null;
      },
      amount: number,
    ) => {
      if (!isPinbetHouse(link.bettingHouse)) return;
      const key = dimensionKey(link.bettingHouse, pinbetDimensionForLink(link));
      pinbetDimensionBalance.set(
        key,
        (pinbetDimensionBalance.get(key) ?? 0) + amount,
      );
    };
    const ensurePinbetHouse = (house: string) => {
      if (!isPinbetHouse(house)) return;
      getOrCreateHouse(house);
    };
    const addPinbetMetric = (
      house: string,
      campaignId: string,
      netPl: number | null,
      complete: boolean,
      dimension: PinbetDimension,
    ) => {
      if (!isPinbetHouse(house)) return;
      const dimKey = dimensionKey(house, dimension);
      if (!complete || netPl === null) {
        pinbetIncomplete.add(house);
        pinbetDimensionIncomplete.add(dimKey);
        return;
      }
      const keys = pinbetObserved.get(house) ?? new Set<string>();
      if (keys.has(campaignId)) return;
      keys.add(campaignId);
      pinbetObserved.set(house, keys);
      pinbetNetPl.set(house, (pinbetNetPl.get(house) ?? 0) + netPl);
      const dimensionKeys =
        pinbetDimensionObserved.get(dimKey) ?? new Set<string>();
      if (!dimensionKeys.has(campaignId)) {
        dimensionKeys.add(campaignId);
        pinbetDimensionObserved.set(dimKey, dimensionKeys);
        pinbetDimensionNetPl.set(
          dimKey,
          (pinbetDimensionNetPl.get(dimKey) ?? 0) + netPl,
        );
      }
    };
    const getOrCreateHouse = (slug: string): PerHouseBalance => {
      if (!perHouse[slug]) {
        perHouse[slug] = {
          house: slug,
          cpa: 0,
          rev: 0,
          networkCpa: 0,
          networkRev: 0,
          adjustment: 0,
          fraudDeduction: 0,
          networkFraudDeduction: 0,
          total: 0,
        };
      }
      return perHouse[slug];
    };

    // Casas com conta compartilhada (ex.: esportiva-diario ⇐ esportivabet) têm o
    // affiliate_data tagueado na casa-FONTE. Quando há filtro por casa, buscar da
    // FONTE (dataSourceHouse) e escopar às campanhas do LINK dessa casa — senão o
    // filtro lê o bucket da casa (vazio) e zera ganho próprio/rede. Sem filtro,
    // busca tudo e o casamento por dataSourceHouse já atribui corretamente.
    const houseFilter = query.bettingHouse;
    const dataSourceFilter = houseFilter
      ? dataSourceHouse(houseFilter)
      : undefined;

    // Balance cutover por CAMPANHA (alias-safe): campanha → data, quando a casa do
    // LINK tem balance cutover POSTERIOR ao global (senão o startDate já cobre).
    // Preenchido com os links próprios agora e com os da rede antes do Step 2.
    const campaignCutover = new Map<string, Date>();
    const addCampaignCutover = (campaignId: string, house: string) => {
      const d = perHouseBalanceCutover.get(house);
      if (d && d > startDate) campaignCutover.set(campaignId, d);
    };
    for (const l of dbUser.affiliateLinks)
      addCampaignCutover(l.campaignId, l.bettingHouse);
    const cutoverArg = () =>
      campaignCutover.size > 0 ? campaignCutover : undefined;

    // ── Step 1: Own commission ──────────────────────────────────────────────
    const ownCampaignIds = dbUser.affiliateLinks.map((l) => l.campaignId);
    const ownDataCampaignIds = houseFilter
      ? dbUser.affiliateLinks
          .filter((l) => l.bettingHouse === houseFilter)
          .map((l) => l.campaignId)
      : ownCampaignIds;
    for (const l of dbUser.affiliateLinks) {
      if (!houseFilter || l.bettingHouse === houseFilter) {
        ensurePinbetHouse(l.bettingHouse);
      }
    }
    let myCpa = 0;
    let myRev = 0;

    if (ownDataCampaignIds.length > 0) {
      const aggRows = await this.repo.aggregatePerCampaignHouse(
        ownDataCampaignIds,
        dataSourceFilter,
        startDate,
        endDate,
        auditExclusion,
        cutoverArg(),
      );

      for (const row of aggRows) {
        const link = dbUser.affiliateLinks.find(
          (l) =>
            l.campaignId === row.campaignId &&
            dataSourceHouse(l.bettingHouse) === row.bettingHouse,
        );
        if (!link) continue;

        const cpaRate = link.cpa?.toNumber() ?? 0;
        const revRate = link.revshare?.toNumber() ?? 0;
        const houseCpa = cpaRate * row.cpaQualified;
        const houseRev = (revRate / 100) * row.revShare;

        myCpa += houseCpa;
        myRev += houseRev;

        // Bucket pela casa do LINK (saldo separado); a casa do dado pode ser
        // a casa-fonte (ex.: betano-diario lê dado tagueado betano).
        const h = getOrCreateHouse(link.bettingHouse);
        h.cpa += houseCpa;
        h.rev += houseRev;
        addPinbetBalance(link, houseCpa + houseRev);
        addPinbetMetric(
          link.bettingHouse,
          row.campaignId,
          row.netPl,
          row.pinbetMetricsComplete,
          pinbetDimensionForLink(link),
        );
      }
    }

    // ── Step 2: BFS network (NETWORK_LEVEL_CAP deep) — collect all members ──
    let networkCpa = 0;
    let networkRev = 0;

    const networkMembers = await this.loadNetworkMembers(user.sub, tx);

    if (networkMembers.length > 0) {
      const networkCampaignIds = [
        ...new Set(
          networkMembers.flatMap((m) =>
            (houseFilter
              ? m.links.filter((l) => l.bettingHouse === houseFilter)
              : m.links
            ).map((l) => l.campaignId),
          ),
        ),
      ];

      // Balance cutover das campanhas da rede (mesmo critério do Step 1).
      for (const m of networkMembers)
        for (const ml of m.links) {
          addCampaignCutover(ml.campaignId, ml.bettingHouse);
          if (!houseFilter || ml.bettingHouse === houseFilter) {
            ensurePinbetHouse(ml.bettingHouse);
          }
        }

      const networkAgg = await this.repo.aggregatePerCampaignHouse(
        networkCampaignIds,
        dataSourceFilter,
        startDate,
        endDate,
        auditExclusion,
        cutoverArg(),
      );

      // Map for O(1) lookup
      const networkAggMap = new Map<
        string,
        { cpaQualified: number; revShare: number }
      >();
      for (const row of networkAgg) {
        networkAggMap.set(`${row.campaignId}__${row.bettingHouse}`, {
          cpaQualified: row.cpaQualified,
          revShare: row.revShare,
        });
        const metricLink = networkMembers
          .flatMap((m) => m.links)
          .find(
            (l) =>
              l.campaignId === row.campaignId &&
              dataSourceHouse(l.bettingHouse) === row.bettingHouse,
          );
        if (metricLink) {
          addPinbetMetric(
            metricLink.bettingHouse,
            row.campaignId,
            row.netPl,
            row.pinbetMetricsComplete,
            pinbetDimensionForLink(metricLink),
          );
        }
      }

      // Earnings model:
      //  - REAL downline  → spread margin = myCpaRate - l1CpaRate (per house).
      //  - EXTERNAL (API) downline → the head earns the FULL rate of his own deal
      //    on that house (not the spread). The sub-user's own balance is separate
      //    and untouched.
      for (const member of networkMembers) {
        for (const ml of member.links) {
          const myLink = dbUser.affiliateLinks.find(
            (l) => rateKeyForLink(l) === rateKeyForLink(ml),
          );
          const myCpaRate = myLink?.cpa?.toNumber() ?? 0;
          const myRevRate = myLink?.revshare?.toNumber() ?? 0;

          const rateKey = rateKeyForLink(ml);
          const l1Cpa = member.l1CpaByHouse.get(rateKey) ?? 0;
          const l1Rev = member.l1RevByHouse.get(rateKey) ?? 0;

          const effCpaRate = member.isExternal
            ? myCpaRate
            : Math.max(0, myCpaRate - l1Cpa);
          const effRevRate = member.isExternal
            ? myRevRate
            : Math.max(0, myRevRate - l1Rev);

          if (effCpaRate <= 0 && effRevRate <= 0) continue;

          const data = networkAggMap.get(
            `${ml.campaignId}__${dataSourceHouse(ml.bettingHouse)}`,
          );
          if (!data) continue;

          const ncpa = effCpaRate * data.cpaQualified;
          const nrev = Math.max(0, (effRevRate / 100) * data.revShare);

          networkCpa += ncpa;
          networkRev += nrev;

          const h = getOrCreateHouse(ml.bettingHouse);
          h.networkCpa += ncpa;
          h.networkRev += nrev;
          addPinbetBalance(ml, ncpa + nrev);
        }
      }
    }

    // ── Step 3: Direct fraud deduction ────────────────────────────────────
    let myFraudDeduction = 0;
    const fraudDetails: FraudDetailDto[] = [];

    for (const fraud of dbUser.fraudCounts) {
      if (!fraud.count || fraud.count <= 0) continue;
      const link = dbUser.affiliateLinks.find(
        (l) => l.bettingHouse === fraud.bettingHouse,
      );
      const cpaRate = link?.cpa?.toNumber() ?? 0;
      const deduction = cpaRate * fraud.count;

      myFraudDeduction += deduction;
      getOrCreateHouse(fraud.bettingHouse).fraudDeduction += deduction;
      if (link) addPinbetBalance(link, -deduction);

      fraudDetails.push({
        bettingHouse: fraud.bettingHouse,
        fraudCount: fraud.count,
        deduction,
        source: 'direct',
      });
    }

    // ── Step 4: Network fraud deduction (spread margin × fraudCount) ───────
    let networkFraudDeduction = 0;

    for (const member of networkMembers) {
      for (const fraud of member.fraudCounts) {
        if (!fraud.count || fraud.count <= 0) continue;

        const memberLink = member.links.find(
          (l) => l.bettingHouse === fraud.bettingHouse,
        );
        const myLink = memberLink
          ? dbUser.affiliateLinks.find(
              (l) => rateKeyForLink(l) === rateKeyForLink(memberLink),
            )
          : dbUser.affiliateLinks.find(
              (l) => l.bettingHouse === fraud.bettingHouse,
            );
        const myCpaRate = myLink?.cpa?.toNumber() ?? 0;
        const l1Cpa = memberLink
          ? (member.l1CpaByHouse.get(rateKeyForLink(memberLink)) ?? 0)
          : (member.l1CpaByHouse.get(fraud.bettingHouse) ?? 0);
        // External downline earns the full rate → fraud is clawed back at the
        // full rate too; real downline keeps the spread margin.
        const effCpaRate = member.isExternal
          ? myCpaRate
          : Math.max(0, myCpaRate - l1Cpa);

        if (effCpaRate <= 0) continue;
        const deduction = effCpaRate * fraud.count;
        networkFraudDeduction += deduction;
        getOrCreateHouse(fraud.bettingHouse).networkFraudDeduction += deduction;
        if (memberLink) addPinbetBalance(memberLink, -deduction);
      }
    }

    // ── Step 5: Deposit compliance (por casa quando filtrado) ──────────────
    // Threshold é por casa (BettingHouse.minAvgDepositPerCpa); sem filtro de
    // casa cai no valor global. Média de depósito por CPA escopada à mesma casa.
    let minAvgDeposit = globalMinAvgDeposit;
    if (query.bettingHouse) {
      const houseCfg = await db.bettingHouse.findUnique({
        where: { slug: query.bettingHouse },
        select: { minAvgDepositPerCpa: true },
      });
      if (houseCfg?.minAvgDepositPerCpa != null) {
        minAvgDeposit = houseCfg.minAvgDepositPerCpa.toNumber();
      }
    }

    let avgDepositPerCpa = 0;
    let totalDeposit = 0;
    let totalCpaQ = 0;

    // Mesma casa-fonte/escopo do Step 1: sem aplicar dataSourceHouse() a média de
    // depósito de uma casa aliased (ex.: esportiva-diario) ficava 0 e bloqueava o
    // saque indevidamente.
    if (ownDataCampaignIds.length > 0) {
      const depositRows = await this.repo.aggregatePerCampaignHouse(
        ownDataCampaignIds,
        dataSourceFilter,
        startDate,
        endDate,
        auditExclusion,
        cutoverArg(),
      );
      for (const r of depositRows) {
        totalDeposit += r.deposit;
        totalCpaQ += r.cpaQualified;
      }
      if (totalCpaQ > 0) avgDepositPerCpa = totalDeposit / totalCpaQ;
    }

    const isNetworkHead = networkMembers.length > 0;
    const depositBelowMinimum =
      !isNetworkHead && avgDepositPerCpa < minAvgDeposit;

    // ── Step 6: Totals + withdrawal deduction ─────────────────────────────
    const totalFraudDeduction = myFraudDeduction + networkFraudDeduction;
    // Bônus é saldo GLOBAL do afiliado, não atrelado a uma casa. Quando o balanço
    // é filtrado por casa (bettingHouse) ele NÃO entra — senão o saldo da casa
    // fica inflado pelo bônus global (ex.: esportivabet sem ganhos retornava 325).
    const houseScoped = !!query.bettingHouse;
    const bonusBalance = houseScoped ? 0 : dbUser.bonusBalance.toNumber();

    // Ajuste manual agora é POR CASA (model BalanceAdjustment). Soma só o ajuste
    // da casa filtrada quando houseScoped; senão soma de todas. Entra no total da
    // respectiva casa (cria a entrada mesmo sem ganhos, p/ saldo só de ajuste).
    let balanceAdjustment = 0;
    for (const adj of dbUser.balanceAdjustments) {
      if (houseScoped && adj.bettingHouse !== query.bettingHouse) continue;
      const amt = adj.amount.toNumber();
      balanceAdjustment += amt;
      getOrCreateHouse(adj.bettingHouse).adjustment += amt;
      if (isPinbetHouse(adj.bettingHouse)) {
        const dimension = pinbetDimensionForAdjustment(
          adj.pinbetDimension,
          adj.bettingHouse,
        );
        const key = dimensionKey(adj.bettingHouse, dimension);
        pinbetDimensionBalance.set(
          key,
          (pinbetDimensionBalance.get(key) ?? 0) + amt,
        );
      }
    }

    for (const key of Object.keys(perHouse)) {
      const h = perHouse[key];
      h.total =
        h.cpa +
        h.rev +
        h.networkCpa +
        h.networkRev +
        h.adjustment -
        h.fraudDeduction -
        h.networkFraudDeduction;
    }

    // Withdrawals are money already paid out and are TAGGED by house, so each
    // one reduces the balance of the house it was made against. When filtered
    // by a specific house we deduct ONLY that house's withdrawals (before this
    // was skipped entirely, inflating the house's balance — e.g. superbet
    // earned R$1830 from the network and withdrew R$1830, yet showed R$1830
    // instead of R$0). The 'all'-tagged payouts are the pre-refactor settlement
    // ("Liquidacao pre-refatoracao"); they pay out PRE-cutover earnings (already
    // excluded from this ledger) so they must NEVER be deducted here.
    // The audit exclusion applies ONLY to earnings (affiliate_data).
    const withdrawals = await db.withdrawalRequest.findMany({
      where: {
        userId: user.sub,
        // PENDING/APPROVED/PROCESSING/COMPLETED hold the balance committed.
        // FAILED + REJECTED are excluded → balance auto-restored on rollback.
        status: {
          in: [
            WithdrawalStatus.PENDING,
            WithdrawalStatus.APPROVED,
            WithdrawalStatus.PROCESSING,
            WithdrawalStatus.COMPLETED,
          ],
        },
        // Cutover: pre-settlement withdrawals are closed; only post-cutover
        // (house-tagged) withdrawals deduct from the new per-house ledger.
        ...(cutoverDate ? { createdAt: { gte: cutoverDate } } : {}),
        // Scoped → only the filtered house's withdrawals. Unscoped → every
        // house-tagged withdrawal, excluding the 'all' settlement payouts.
        ...(query.bettingHouse
          ? { bettingHouse: query.bettingHouse }
          : { bettingHouse: { not: 'all' } }),
      },
      // originalAmount = gross before fee → full withdrawal cost deducted.
      // gatewayRefundedAmount = net portion the recipient returned via
      // PayOutRefunded; credited back to the affiliate's balance.
      select: {
        originalAmount: true,
        gatewayRefundedAmount: true,
        bettingHouse: true,
        status: true,
        createdAt: true,
        pinbetDimension: true,
      },
    });

    let withdrawalsApproved = 0;
    let withdrawalsPending = 0;
    const withdrawnByHouse = new Map<string, number>();
    const withdrawnByPinbetDimension = new Map<string, number>();
    for (const w of withdrawals) {
      // Balance cutover POR CASA: saques da casa anteriores ao cutover dela não
      // contam (histórico pré-cutover zerado junto com os ganhos). Casas sem
      // cutover por-casa já vêm filtradas pelo global na query.
      const hc = balanceCutoverFor(w.bettingHouse);
      if (hc && w.createdAt < hc) continue;
      const refunded = w.gatewayRefundedAmount?.toNumber() ?? 0;
      const amt = Math.max(0, w.originalAmount.toNumber() - refunded);
      if (w.status === WithdrawalStatus.PENDING) withdrawalsPending += amt;
      else withdrawalsApproved += amt;
      withdrawnByHouse.set(
        w.bettingHouse,
        (withdrawnByHouse.get(w.bettingHouse) ?? 0) + amt,
      );
      if (isPinbetHouse(w.bettingHouse)) {
        const dimension = pinbetDimensionForWithdrawal(
          w.pinbetDimension,
          w.bettingHouse,
        );
        const key = dimensionKey(w.bettingHouse, dimension);
        withdrawnByPinbetDimension.set(
          key,
          (withdrawnByPinbetDimension.get(key) ?? 0) + amt,
        );
        if (dimension !== 'COMBINED') {
          pinbetDimensionBalance.set(
            key,
            (pinbetDimensionBalance.get(key) ?? 0) - amt,
          );
        }
      }
      // getOrCreateHouse: reflect the deduction even when the house has no
      // current earnings (balance goes to 0/negative, clamped by callers).
      getOrCreateHouse(w.bettingHouse).total -= amt;
    }
    const approvedWithdrawals = withdrawalsApproved + withdrawalsPending;

    const baseGross =
      myCpa +
      myRev +
      networkCpa +
      networkRev +
      bonusBalance +
      balanceAdjustment;
    const grossBalance = Math.max(0, baseGross) - totalFraudDeduction;
    const netBalance = grossBalance - approvedWithdrawals;

    const periodGross =
      myCpa + myRev + networkCpa + networkRev - totalFraudDeduction;
    const periodBalance = Math.max(0, periodGross);

    // ── Sacável real (fonte única do "Disponível para saque") ─────────────
    // Diferente do netBalance (pool global): soma o saldo SACÁVEL por casa
    // (clamp ≥0, já líquido dos saques da casa) + o bônus DISPONÍVEL (bônus
    // concedido − saques de bônus). Evita o pooling do netBalance e o
    // double-count do bônus. É a mesma verdade das regras de saque.
    const bonusWithdrawn = withdrawals
      .filter((w) => w.bettingHouse === 'bonus')
      .reduce(
        (s, w) =>
          s +
          Math.max(
            0,
            w.originalAmount.toNumber() -
              (w.gatewayRefundedAmount?.toNumber() ?? 0),
          ),
        0,
      );
    const bonusAvailable = Math.max(0, bonusBalance - bonusWithdrawn);
    for (const h of Object.values(perHouse)) {
      if (h.house === 'pinbet-mensal') {
        const dimensions = ['AFP1', 'AFP2'] as const;
        const limited = calculateSegmentedPinbetWithdrawalLimit({
          segments: dimensions.map((dimension) => {
            const key = dimensionKey(h.house, dimension);
            const metricsComplete = !pinbetDimensionIncomplete.has(key);
            return {
              dimension,
              balance: pinbetDimensionBalance.get(key) ?? 0,
              netPl: metricsComplete
                ? (pinbetDimensionNetPl.get(key) ?? 0)
                : null,
              consumed: withdrawnByPinbetDimension.get(key) ?? 0,
              metricsComplete,
            };
          }),
          combinedConsumed:
            withdrawnByPinbetDimension.get(dimensionKey(h.house, 'COMBINED')) ??
            0,
        });
        h.netPl = limited.netPl;
        h.pinbetMetricsComplete = limited.restriction !== 'METRICS_SYNCING';
        h.netPlWithdrawalLimit = limited.netPlLimit;
        h.netPlLimitConsumed = limited.consumed;
        h.withdrawable = limited.withdrawable;
        h.withdrawalRestriction = limited.restriction;
        h.pinbetDimensions = limited.segments.map((segment) => ({
          dimension: segment.dimension,
          balance: segment.balance,
          netPl: segment.netPl,
          netPlWithdrawalLimit: segment.netPlLimit,
          netPlLimitConsumed: segment.consumed,
          withdrawable: segment.withdrawable,
          withdrawalRestriction: segment.restriction,
        }));
        continue;
      }
      const metricsComplete = isPinbetHouse(h.house)
        ? !pinbetIncomplete.has(h.house)
        : true;
      const limited = calculatePinbetWithdrawalLimit({
        house: h.house,
        balance: h.total,
        netPl: isPinbetHouse(h.house)
          ? metricsComplete
            ? (pinbetNetPl.get(h.house) ?? 0)
            : null
          : null,
        consumed: withdrawnByHouse.get(h.house) ?? 0,
        metricsComplete,
      });
      h.netPl = limited.netPl;
      h.pinbetMetricsComplete = metricsComplete;
      h.netPlWithdrawalLimit = limited.netPlLimit;
      h.netPlLimitConsumed = limited.consumed;
      h.withdrawable = limited.withdrawable;
      h.withdrawalRestriction = limited.restriction;
    }
    const houseWithdrawable = Object.values(perHouse)
      .filter((h) => h.house !== 'bonus')
      .reduce((s, h) => s + (h.withdrawable ?? Math.max(0, h.total)), 0);
    const withdrawableTotal =
      query.bettingHouse === 'bonus'
        ? bonusAvailable
        : query.bettingHouse
          ? houseWithdrawable
          : houseWithdrawable + bonusAvailable;

    // ── Pre-compute withdrawal fee for frontend display ──────────────────
    const rawFeeRate = parseFloat(
      settingsMap.get('withdrawal_fee_rate') ?? '0.06',
    );
    const withdrawalFeeRate = Math.min(
      1,
      Math.max(0, isNaN(rawFeeRate) ? 0.06 : rawFeeRate),
    );
    const withdrawalFee = parseFloat(
      (Math.max(0, netBalance) * withdrawalFeeRate).toFixed(2),
    );
    const netAfterFee = parseFloat(
      (Math.max(0, netBalance) - withdrawalFee).toFixed(2),
    );

    return {
      balance: netBalance,
      periodBalance,
      isFiltered: hasDateFilter || !!query.bettingHouse,
      baseGross, // raw earnings total before any deduction
      grossBalance, // baseGross - fraudDeduction
      approvedWithdrawals, // total deducted (approved + pending)
      withdrawalsApproved, // approved only
      withdrawalsPending, // pending only
      cpa: myCpa,
      rev: myRev,
      networkCpa,
      networkRev,
      networkTotal: networkCpa + networkRev,
      bonusBalance,
      balanceAdjustment,
      fraudDeduction: myFraudDeduction,
      networkFraudDeduction,
      totalFraudDeduction,
      fraudDetails,
      perHouse: Object.values(perHouse),
      minWithdrawalAmount,
      withdrawalFee,
      withdrawalFeeRate,
      netBalance: netAfterFee,
      // Disponível para saque (fonte única): casas sacáveis + bônus disponível.
      bonusAvailable,
      withdrawableTotal,
      withdrawableNet: parseFloat(
        (withdrawableTotal * (1 - withdrawalFeeRate)).toFixed(2),
      ),
      depositInfo: {
        avgDepositPerCpa: parseFloat(avgDepositPerCpa.toFixed(2)),
        totalDeposit: parseFloat(totalDeposit.toFixed(2)),
        totalCpaQualified: totalCpaQ,
        minAvgDeposit,
        belowMinimum: depositBelowMinimum,
        exemptByNetworkHead: isNetworkHead,
        warningMessage: depositBelowMinimum ? warningMessage : null,
      },
    };
  }

  /**
   * Loads all network members down to NETWORK_LEVEL_CAP levels with their
   * affiliate links, fraud counts, and L1 ancestor CPA/revshare per house
   * (spread model: head earns headCpa − l1AncestorCpa at every depth).
   */
  public async loadNetworkMembers(
    userId: string,
    tx?: PrismaTransactionClient,
  ): Promise<
    {
      id: string;
      level: number;
      isExternal: boolean;
      referredById: string | null;
      links: {
        campaignId: string;
        bettingHouse: string;
        linkType: string | null;
        cpa?: { toNumber(): number } | null;
        revshare?: { toNumber(): number } | null;
      }[];
      fraudCounts: { bettingHouse: string; count: number }[];
      l1CpaByHouse: Map<string, number>;
      l1RevByHouse: Map<string, number>;
    }[]
  > {
    const db = tx ?? this.prisma;

    // L1: direct referrals — fetch with their link rates (used as l1 anchor)
    const level1 = await db.user.findMany({
      where: { referredById: userId },
      select: {
        id: true,
        affiliateLinks: {
          where: { deletedAt: null },
          select: {
            campaignId: true,
            bettingHouse: true,
            linkType: true,
            cpa: true,
            revshare: true,
          },
        },
        fraudCounts: { select: { bettingHouse: true, count: true } },
      },
    });

    // Map: memberId → { l1CpaByHouse, l1RevByHouse }
    type L1Anchor = {
      cpaByHouse: Map<string, number>;
      revByHouse: Map<string, number>;
    };
    const memberL1 = new Map<string, L1Anchor>();
    const memberLevel = new Map<string, number>();
    const memberParent = new Map<string, string | null>();

    for (const l1 of level1) {
      const anchor: L1Anchor = { cpaByHouse: new Map(), revByHouse: new Map() };
      for (const link of l1.affiliateLinks) {
        const rateKey = rateKeyForNetworkLink(link);
        if (link.cpa && link.cpa.toNumber() > 0)
          anchor.cpaByHouse.set(rateKey, link.cpa.toNumber());
        if (link.revshare && link.revshare.toNumber() > 0)
          anchor.revByHouse.set(rateKey, link.revshare.toNumber());
      }
      memberL1.set(l1.id, anchor);
      memberLevel.set(l1.id, 1);
      memberParent.set(l1.id, userId);
    }

    // L2..NETWORK_LEVEL_CAP: BFS down the referral tree. The spread anchor stays
    // the L1 ancestor's rates at every depth (head earns headCpa − l1Cpa).
    let frontierIds = level1.map((m) => m.id);
    for (
      let lvl = 2;
      lvl <= NETWORK_LEVEL_CAP && frontierIds.length > 0;
      lvl++
    ) {
      const nextLevel = await db.user.findMany({
        where: { referredById: { in: frontierIds } },
        select: { id: true, referredById: true },
      });
      const nextIds: string[] = [];
      for (const m of nextLevel) {
        if (memberL1.has(m.id)) continue; // guard against cycles / re-entry
        const anchor = memberL1.get(m.referredById!);
        if (!anchor) continue;
        memberL1.set(m.id, anchor);
        memberLevel.set(m.id, lvl);
        memberParent.set(m.id, m.referredById);
        nextIds.push(m.id);
      }
      frontierIds = nextIds;
    }

    // Fetch full details only for members WITH links
    const allMemberIds = Array.from(memberL1.keys());
    if (allMemberIds.length === 0) return [];

    const members = await db.user.findMany({
      where: {
        id: { in: allMemberIds },
        affiliateLinks: { some: { deletedAt: null } },
      },
      select: {
        id: true,
        referredById: true,
        isExternal: true,
        affiliateLinks: {
          where: { deletedAt: null },
          select: {
            campaignId: true,
            bettingHouse: true,
            linkType: true,
            cpa: true,
            revshare: true,
          },
        },
        fraudCounts: { select: { bettingHouse: true, count: true } },
      },
    });

    return members.map((m) => {
      const anchor = memberL1.get(m.id)!;
      return {
        id: m.id,
        level: memberLevel.get(m.id) ?? 1,
        isExternal: m.isExternal,
        referredById: m.referredById ?? memberParent.get(m.id) ?? null,
        links: m.affiliateLinks,
        fraudCounts: m.fraudCounts,
        l1CpaByHouse: anchor.cpaByHouse,
        l1RevByHouse: anchor.revByHouse,
      };
    });
  }
}
