import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  Prisma,
  WithdrawalStatus,
  UserRole,
  NotificationType,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import {
  PrismaService,
  type PrismaTransactionClient,
} from '../../prisma/prisma.service.js';
import { SettingsService } from '../../settings/index.js';
import { DashboardBalanceService } from '../../dashboard/application/dashboard-balance.service.js';
import { NotificationService } from '../../notification/index.js';
import { PaymentGatewayService } from '../../payment-gateway/index.js';
import { WhatsappProofProducer } from '../../whatsapp/index.js';
import { LinkWebhookService } from '../../link-webhook/index.js';
import {
  ReceiptGeneratorService,
  type ReceiptData,
} from './receipt-generator.service.js';
import type {
  HeartPayPayoutEventData,
  HeartPayWebhookEventName,
  HeartPayWebhookPayload,
  PixKeyType,
} from '../../payment-gateway/index.js';
import type { JwtPayload } from '../../auth/domain/auth.types.js';
import {
  DEFAULT_WITHDRAWAL_FEE_RATE,
  WITHDRAWAL_SETTINGS_KEYS,
  deriveRefundState,
  type WithdrawalListItem,
  type WithdrawalCreateResult,
} from '../domain/types/withdrawal.types.js';
import {
  clampPagination,
  buildUserSearchWhere,
} from '../../../common/pagination/index.js';
import {
  isWithdrawalDayAllowed,
  nextWithdrawalDate,
  describeFrequency,
} from '../domain/withdrawal-frequency.js';
import type {
  CreateWithdrawalDto,
  ListWithdrawalsQueryDto,
  UpdateWithdrawalStatusDto,
  ApproveWithdrawalDto,
  ManualPaymentDto,
} from './dto/withdrawal.dto.js';

// Normalizes a stored pixKeyType to the internal PixKeyType enum.
// The DB stores the gateway/doc vocabulary (cpf/cnpj/email/phone/random),
// but internally chave aleatória is "EVP" — so "RANDOM" must map to "EVP",
// otherwise the payout is rejected on our side before reaching the gateway.
const PIX_KEY_TYPE_ALIASES: Readonly<Record<string, PixKeyType>> = {
  CPF: 'CPF',
  CNPJ: 'CNPJ',
  EMAIL: 'EMAIL',
  PHONE: 'PHONE',
  EVP: 'EVP',
  RANDOM: 'EVP',
};

function normalizePixKeyType(raw: string): PixKeyType | null {
  return PIX_KEY_TYPE_ALIASES[raw.trim().toUpperCase()] ?? null;
}
const MAX_RECEIPT_BASE64_BYTES = 2_000_000; // ~1.5 MB of PNG bytes after base64

// Saques PROCESSING mais antigos que isto são candidatos a reconcile — o
// webhook PayOut* provavelmente se perdeu. Janela folgada para não competir
// com a conclusão normal (webhook costuma chegar em segundos).
const STUCK_PROCESSING_THRESHOLD_MS = 10 * 60 * 1000; // 10 min

@Injectable()
export class WithdrawalService {
  private readonly logger = new Logger(WithdrawalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly balanceService: DashboardBalanceService,
    private readonly notificationService: NotificationService,
    private readonly paymentGateway: PaymentGatewayService,
    private readonly whatsappProofProducer: WhatsappProofProducer,
    private readonly receiptGenerator: ReceiptGeneratorService,
    private readonly linkWebhook: LinkWebhookService,
  ) {}

  /**
   * Fire-and-forget withdrawal.* webhook. Owner-scoped inside LinkWebhookService
   * (delivery goes only to the withdrawal owner's network). NEVER blocks/rolls
   * back the withdrawal — matches the notification/audit `.catch()` pattern.
   */
  private fireWithdrawalWebhook(
    kind: 'created' | 'status_changed',
    item: {
      id: string;
      userId: string;
      bettingHouse: string;
      amount: number;
      originalAmount: number;
      status: string;
      createdAt: Date | string;
    },
    opts?: { externalUserId?: string | null; previousStatus?: string | null },
  ): void {
    const payload = {
      withdrawalId: item.id,
      userId: item.userId,
      externalUserId: opts?.externalUserId ?? null,
      bettingHouse: item.bettingHouse,
      amount: item.amount,
      originalAmount: item.originalAmount,
      status: item.status,
      previousStatus: opts?.previousStatus ?? null,
      createdAt:
        item.createdAt instanceof Date
          ? item.createdAt.toISOString()
          : String(item.createdAt),
    };
    const op =
      kind === 'created'
        ? this.linkWebhook.emitWithdrawalCreated(payload)
        : this.linkWebhook.emitWithdrawalStatusChanged(payload);
    op.catch((err: unknown) =>
      this.logger.warn(
        `Withdrawal webhook (${kind}) failed for ${item.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // POST /v1/withdrawals
  // ─────────────────────────────────────────────────────────────────────────

  async create(
    user: JwtPayload,
    dto: CreateWithdrawalDto,
  ): Promise<WithdrawalCreateResult> {
    // ── Pre-transaction validations (read-only, no lock needed) ────────────

    // 1. Carregar user com dados de pagamento
    const dbUser = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.sub },
      select: {
        id: true,
        name: true,
        email: true,
        pixKey: true,
        pixKeyType: true,
        bankName: true,
        bankAgency: true,
        bankAccount: true,
        accountHolder: true,
        withdrawalBlocked: true,
      },
    });

    if (!dbUser.pixKey || !dbUser.pixKeyType) {
      throw new BadRequestException(
        'Dados de pagamento não configurados. Configure sua chave PIX antes de solicitar saque.',
      );
    }
    if (dbUser.withdrawalBlocked) {
      throw new ForbiddenException(
        'Seu saque está bloqueado. Entre em contato com o administrador.',
      );
    }

    // 2. Validar cadência da casa (weekly / biweekly / monthly / daily) +
    //    mínimo de CPAs qualificados. 'bonus' é virtual e sempre liberado.
    // Mínimo de saque por casa (null = usa o global); capturado p/ a validação
    // de saldo mínimo dentro da transação (house é block-scoped aqui).
    let houseMinWithdrawal: number | null = null;
    if (dto.bettingHouse !== 'bonus') {
      const house = await this.prisma.bettingHouse.findUnique({
        where: { slug: dto.bettingHouse },
        select: {
          name: true,
          withdrawalDay: true,
          withdrawalDayEnd: true,
          withdrawalDay2: true,
          withdrawalDay2End: true,
          withdrawalWeekday: true,
          minCpaToWithdraw: true,
          minWithdrawalAmount: true,
          withdrawalEnabled: true,
        },
      });
      houseMinWithdrawal = house?.minWithdrawalAmount?.toNumber() ?? null;

      if (house && !house.withdrawalEnabled) {
        throw new BadRequestException(
          `Saques para ${house.name} estão temporariamente desativados.`,
        );
      }

      if (house && !isWithdrawalDayAllowed(house)) {
        const next = nextWithdrawalDate(house);
        const freq = describeFrequency(house);
        const nextLabel = next
          ? ` Próxima janela: ${next.toLocaleDateString('pt-BR')}.`
          : '';
        throw new BadRequestException(
          `Saques para ${house.name} seguem cadência ${freq}.${nextLabel}`,
        );
      }

      if (house && house.minCpaToWithdraw > 0) {
        // Conta CPAs qualificados PRÓPRIOS + da REDE (downline) — o mínimo da
        // casa é atingível pela produção da rede, não só a individual.
        const cpaCount =
          (await this.totalCpaQualifiedByHouse(user.sub)).get(
            dto.bettingHouse,
          ) ?? 0;
        if (cpaCount < house.minCpaToWithdraw) {
          throw new BadRequestException(
            `Saque bloqueado: ${house.name} exige no mínimo ` +
              `${house.minCpaToWithdraw} CPAs qualificados para sacar. ` +
              `Você tem ${cpaCount} (seus + rede).`,
          );
        }
      }
    }

    // ── Serialized transaction with advisory lock ──────────────────────────
    // pg_advisory_xact_lock serializes all withdrawal attempts for the same
    // userId, preventing double-withdrawal from concurrent requests.
    // The lock is automatically released on COMMIT/ROLLBACK.
    const result = await this.prisma.$transaction(
      async (tx) => {
        // $executeRaw instead of $queryRaw — pg_advisory_xact_lock returns void,
        // which Prisma cannot deserialize as a query result.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${user.sub}))`;

        // 3. Rate limit: 1 saque ATIVO por dia POR CASA (inside lock to prevent
        // TOCTOU). REJECTED/FAILED don't count — user must be able to retry the
        // same day after an admin rejects or the gateway fails. O limite é por
        // casa: o afiliado pode sacar de cada casa uma vez por dia.
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const existingToday = await tx.withdrawalRequest.findFirst({
          where: {
            userId: user.sub,
            bettingHouse: dto.bettingHouse,
            createdAt: { gte: startOfDay },
            status: {
              in: [
                WithdrawalStatus.PENDING,
                WithdrawalStatus.APPROVED,
                WithdrawalStatus.PROCESSING,
                WithdrawalStatus.COMPLETED,
              ],
            },
          },
          select: { id: true },
        });
        if (existingToday) {
          // Caso especial: admin liberou 1 saque EXTRA nesta casa hoje.
          // Consome a liberação não usada (dentro do advisory lock → atômico).
          const release = await tx.withdrawalDayRelease.findFirst({
            where: {
              userId: user.sub,
              bettingHouse: dto.bettingHouse,
              releaseDate: { gte: startOfDay },
              consumedAt: null,
            },
            orderBy: { createdAt: 'asc' },
            select: { id: true },
          });
          if (!release) {
            throw new HttpException(
              'Limite de 1 saque por dia para esta casa atingido. Tente novamente amanhã.',
              HttpStatus.TOO_MANY_REQUESTS,
            );
          }
          await tx.withdrawalDayRelease.update({
            where: { id: release.id },
            data: { consumedAt: new Date() },
          });
        }

        // 4. Calcular saldo disponível ESCOPADO PELA CASA selecionada.
        // Uses this.prisma (not tx) — balance is aggregated from read-only data.
        // The advisory lock guarantees no other withdrawal for this user can
        // interleave between balance read and withdrawal write.
        //
        // Per-casa rules (CEO directive):
        //   - amount must reflect ONLY that casa's earnings (own + downline)
        //   - bonus is its own virtual casa (slug 'bonus') and never spills into
        //     other casas' balance — prevents cross-casa double-spend.
        const balanceData = await this.balanceService.getBalance(
          user,
          { bettingHouse: dto.bettingHouse },
          tx,
        );
        // Mínimo por casa tem precedência sobre o global (ex.: superbet-mensal R$1000).
        const minWithdrawalAmount =
          houseMinWithdrawal ?? balanceData.minWithdrawalAmount;
        const depositInfo = balanceData.depositInfo;

        let availableBalance: number;
        if (dto.bettingHouse === 'bonus') {
          // Bonus pool: coluna User.bonusBalance menos os saques de bônus
          // anteriores (status ativos, líquido de estornos).
          //
          // NÃO usar balanceData.bonusBalance: getBalance foi chamado com
          // { bettingHouse: 'bonus' } (houseScoped) e, nesse modo, o bônus é
          // ZERADO para não inflar o saldo por casa. Ler a coluna direto — senão
          // o bônus disponível sempre dá 0 e todo saque de bônus é bloqueado.
          const { bonusBalance } = await tx.user.findUniqueOrThrow({
            where: { id: user.sub },
            select: { bonusBalance: true },
          });
          const priorBonus = await tx.withdrawalRequest.aggregate({
            where: {
              userId: user.sub,
              bettingHouse: 'bonus',
              status: {
                in: [
                  WithdrawalStatus.PENDING,
                  WithdrawalStatus.APPROVED,
                  WithdrawalStatus.PROCESSING,
                  WithdrawalStatus.COMPLETED,
                ],
              },
            },
            _sum: { originalAmount: true, gatewayRefundedAmount: true },
          });
          const bonusWithdrawn =
            (priorBonus._sum.originalAmount?.toNumber() ?? 0) -
            (priorBonus._sum.gatewayRefundedAmount?.toNumber() ?? 0);
          availableBalance = Math.max(
            0,
            bonusBalance.toNumber() - bonusWithdrawn,
          );
        } else {
          // Per-casa available = saldo líquido DAQUELA casa, isolado:
          // own + rede (da casa) − saques tagueados (da casa) − fraude, pós-corte.
          // perHouse[].total já vem líquido por casa do balance global (sem rateio).
          const houseBalance = balanceData.perHouse.find(
            (h) => h.house === dto.bettingHouse,
          );
          if (houseBalance?.withdrawalRestriction === 'METRICS_SYNCING') {
            throw new BadRequestException(
              'As métricas da Pinbet ainda estão sendo sincronizadas. O saque será liberado assim que o histórico estiver completo.',
            );
          }
          if (houseBalance?.withdrawalRestriction === 'NET_PL_NON_POSITIVE') {
            throw new BadRequestException(
              'Saque indisponível: o Net P&L da Pinbet está zerado ou negativo. O limite é 80% do Net P&L positivo.',
            );
          }
          availableBalance = Math.max(
            0,
            houseBalance?.withdrawable ?? houseBalance?.total ?? 0,
          );
        }

        // 5. Validar saldo mínimo. Bônus não tem valor mínimo — qualquer valor
        // > 0 é sacável; as demais casas exigem o mínimo global.
        if (dto.bettingHouse === 'bonus') {
          if (availableBalance <= 0) {
            throw new BadRequestException(
              'Sem saldo de bônus disponível para saque.',
            );
          }
        } else if (availableBalance < minWithdrawalAmount) {
          const houseBalance = balanceData.perHouse.find(
            (h) => h.house === dto.bettingHouse,
          );
          const pinbetExplanation =
            houseBalance?.withdrawalRestriction === 'NET_PL_CAP'
              ? ` Na Pinbet, o disponível para saque é limitado a 80% do Net P&L positivo, descontando saques anteriores.`
              : '';
          throw new BadRequestException(
            `Saldo insuficiente nessa casa. Mínimo para saque: R$${minWithdrawalAmount.toFixed(2)}. ` +
              `Disponível: R$${availableBalance.toFixed(2)}.${pinbetExplanation}`,
          );
        }

        // 6. Validar deposit compliance (skip se isNetworkHead ou bettingHouse = 'bonus')
        if (
          dto.bettingHouse !== 'bonus' &&
          !depositInfo.exemptByNetworkHead &&
          depositInfo.belowMinimum
        ) {
          throw new BadRequestException(
            `Saque bloqueado: a média de depósito por CPA está em ` +
              `R$${depositInfo.avgDepositPerCpa.toFixed(2)}, ` +
              `abaixo do mínimo de R$${depositInfo.minAvgDeposit.toFixed(2)}. ` +
              `Operações com média abaixo desse valor estão sujeitas a bloqueio do link de afiliado.`,
          );
        }

        // 7. Calcular taxa e valor líquido — taxa configurável via Settings
        const settingsMap = await this.settings.getMany([
          ...WITHDRAWAL_SETTINGS_KEYS,
        ]);
        const rawRate = parseFloat(
          settingsMap.get('withdrawal_fee_rate') ??
            String(DEFAULT_WITHDRAWAL_FEE_RATE),
        );
        const feeRate = Math.min(
          1,
          Math.max(0, isNaN(rawRate) ? DEFAULT_WITHDRAWAL_FEE_RATE : rawRate),
        );
        const originalAmount = parseFloat(availableBalance.toFixed(2));
        const withdrawalFee = parseFloat((originalAmount * feeRate).toFixed(2));
        const amount = parseFloat((originalAmount - withdrawalFee).toFixed(2));

        // 8. Criar a solicitação de saque (inside transaction)
        const withdrawal = await tx.withdrawalRequest.create({
          data: {
            userId: user.sub,
            amount,
            originalAmount,
            withdrawalFee,
            bettingHouse: dto.bettingHouse,
            pinbetDimension:
              dto.bettingHouse === 'pinbet-mensal' ? 'COMBINED' : null,
            requestNote: dto.requestNote?.trim() ?? '',
            pixKeyType: dbUser.pixKeyType,
            pixKey: dbUser.pixKey,
            bankName: dbUser.bankName,
            bankAgency: dbUser.bankAgency,
            bankAccount: dbUser.bankAccount,
            accountHolder: dbUser.accountHolder,
            status: WithdrawalStatus.PENDING,
          },
          select: {
            id: true,
            amount: true,
            originalAmount: true,
            withdrawalFee: true,
            bettingHouse: true,
            requestNote: true,
            status: true,
            createdAt: true,
          },
        });

        return {
          id: withdrawal.id,
          amount: withdrawal.amount.toNumber(),
          originalAmount: withdrawal.originalAmount.toNumber(),
          withdrawalFee: withdrawal.withdrawalFee.toNumber(),
          bettingHouse: withdrawal.bettingHouse,
          requestNote: withdrawal.requestNote,
          status: withdrawal.status,
          createdAt: withdrawal.createdAt,
        };
      },
      { timeout: 15_000 },
    );

    // 9. Audit log (fire-and-forget — must NOT block or rollback the withdrawal)
    this.prisma.auditLog
      .create({
        data: {
          userId: user.sub,
          userName: dbUser.name,
          userEmail: dbUser.email,
          action: `Taxa de saque aplicada (${((result.withdrawalFee / result.originalAmount) * 100).toFixed(2)}%)`,
          resource: '/withdrawals',
          method: 'POST',
          path: '/v1/withdrawals',
          statusCode: 201,
          details: {
            withdrawalId: result.id,
            valorOriginal: result.originalAmount,
            taxaSaque: result.withdrawalFee,
            taxaPercentual: `${((result.withdrawalFee / result.originalAmount) * 100).toFixed(2)}%`,
            valorLiquido: result.amount,
            bettingHouse: dto.bettingHouse,
            requestNote: result.requestNote,
          },
        },
      })
      .catch((err) =>
        this.logger.warn(
          `AuditLog failed for withdrawal ${result.id}: ${err?.message}`,
        ),
      );

    this.fireWithdrawalWebhook('created', { ...result, userId: user.sub });

    return result;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Affiliate-API (external partner) withdrawal ledger
  // Operate on shadow "external" sub-users (User.isExternal = true). Reuse the
  // WithdrawalRequest model + virtual balance, but BYPASS the internal
  // eligibility gates (PIX/cadence/CPA/1-per-day) and the gateway: the partner
  // pays their own user and uses these rows as an audit ledger / history.
  // ───────────────────────────────────────────────────────────────────────

  /** Status transitions a partner may drive via the API (from → to matrix). */
  private static readonly EXTERNAL_STATUS_TRANSITIONS: Record<
    'processing' | 'completed' | 'rejected',
    { to: WithdrawalStatus; from: WithdrawalStatus[] }
  > = {
    processing: {
      to: WithdrawalStatus.PROCESSING,
      from: [WithdrawalStatus.PENDING],
    },
    completed: {
      to: WithdrawalStatus.COMPLETED,
      from: [WithdrawalStatus.PENDING, WithdrawalStatus.PROCESSING],
    },
    rejected: {
      to: WithdrawalStatus.REJECTED,
      from: [WithdrawalStatus.PENDING, WithdrawalStatus.PROCESSING],
    },
  };

  /**
   * Net available balance for a single casa (own + downline − tagged
   * withdrawals − fraude, pós-corte). Shared by create() and createForExternal.
   */
  private async computeAvailableHouseBalance(
    user: JwtPayload,
    bettingHouse: string,
    tx: PrismaTransactionClient,
  ): Promise<number> {
    const globalBalance = await this.balanceService.getBalance(user, {}, tx);
    const houseBal = globalBalance.perHouse.find(
      (h) => h.house === bettingHouse,
    );
    return Math.max(0, houseBal?.withdrawable ?? houseBal?.total ?? 0);
  }

  /**
   * Create a withdrawal on behalf of a partner's external sub-user. Saca o
   * saldo TOTAL disponível da casa (igual ao fluxo interno), mas sem taxa, sem
   * PIX real e sem as travas de elegibilidade. Idempotente por (subUser, casa):
   * rejeita se já houver um saque ativo.
   */
  async createForExternal(
    subUser: { id: string; name: string; externalId: string | null },
    dto: { bettingHouse: string; requestNote?: string },
  ): Promise<WithdrawalCreateResult> {
    const bettingHouse = dto.bettingHouse?.trim().toLowerCase();
    if (!bettingHouse) {
      throw new BadRequestException('bettingHouse é obrigatório.');
    }
    if (bettingHouse === 'bonus') {
      throw new BadRequestException('Saque de bônus não é suportado via API.');
    }

    const user: JwtPayload = {
      sub: subUser.id,
      email: '',
      role: UserRole.AFFILIATE,
    };

    const created = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${subUser.id}))`;

        // Rate limit: 1 saque por DIA por casa por usuário (igual ao fluxo
        // interno). Só conta o que foi criado HOJE em status ativo — saques de
        // dias anteriores (mesmo COMPLETED) NÃO bloqueiam o de hoje.
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const existingToday = await tx.withdrawalRequest.findFirst({
          where: {
            userId: subUser.id,
            bettingHouse,
            createdAt: { gte: startOfDay },
            status: {
              in: [
                WithdrawalStatus.PENDING,
                WithdrawalStatus.PROCESSING,
                WithdrawalStatus.COMPLETED,
              ],
            },
          },
          select: { id: true },
        });
        if (existingToday) {
          throw new HttpException(
            'Limite de 1 saque por dia para esta casa atingido. Tente novamente amanhã.',
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }

        const availableBalance = await this.computeAvailableHouseBalance(
          user,
          bettingHouse,
          tx,
        );
        if (availableBalance <= 0) {
          throw new BadRequestException(
            'Sem saldo disponível para saque nesta casa.',
          );
        }

        // Ledger row: fee off, sentinel PIX (never dispatched to the gateway).
        const originalAmount = parseFloat(availableBalance.toFixed(2));
        const withdrawal = await tx.withdrawalRequest.create({
          data: {
            userId: subUser.id,
            amount: originalAmount,
            originalAmount,
            withdrawalFee: 0,
            bettingHouse,
            pinbetDimension:
              bettingHouse === 'pinbet-mensal' ? 'COMBINED' : null,
            requestNote: dto.requestNote?.trim() ?? '',
            pixKeyType: 'API',
            pixKey: `ext:${subUser.externalId ?? subUser.id}`,
            accountHolder: subUser.name,
            status: WithdrawalStatus.PENDING,
          },
          select: {
            id: true,
            amount: true,
            originalAmount: true,
            withdrawalFee: true,
            bettingHouse: true,
            requestNote: true,
            status: true,
            createdAt: true,
          },
        });

        return {
          id: withdrawal.id,
          amount: withdrawal.amount.toNumber(),
          originalAmount: withdrawal.originalAmount.toNumber(),
          withdrawalFee: withdrawal.withdrawalFee.toNumber(),
          bettingHouse: withdrawal.bettingHouse,
          requestNote: withdrawal.requestNote,
          status: withdrawal.status,
          createdAt: withdrawal.createdAt,
        };
      },
      { timeout: 15_000 },
    );

    this.fireWithdrawalWebhook(
      'created',
      { ...created, userId: subUser.id },
      { externalUserId: subUser.externalId },
    );

    return created;
  }

  /** List external withdrawals scoped to a partner's own sub-users. */
  async listForExternal(
    ownerExternalIds: string[],
    query: ListWithdrawalsQueryDto,
  ): Promise<{
    data: WithdrawalListItem[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { page, limit, skip } = clampPagination(query, {
      defaultLimit: 20,
      maxLimit: 100,
    });
    if (ownerExternalIds.length === 0) {
      return { data: [], total: 0, page, limit };
    }

    const createdAt: { gte?: Date; lte?: Date } = {};
    if (query.startDate)
      createdAt.gte = new Date(`${query.startDate}T00:00:00.000Z`);
    if (query.endDate)
      createdAt.lte = new Date(`${query.endDate}T23:59:59.999Z`);
    const hasDateFilter = !!(query.startDate || query.endDate);
    const normalizedStatus = query.status?.toUpperCase() as
      | WithdrawalStatus
      | undefined;

    const where: Prisma.WithdrawalRequestWhereInput = {
      userId: { in: ownerExternalIds },
      ...(normalizedStatus ? { status: normalizedStatus } : {}),
      ...(query.bettingHouse ? { bettingHouse: query.bettingHouse } : {}),
      ...(hasDateFilter ? { createdAt } : {}),
    };

    const include = {
      user: { select: { name: true, email: true } },
      approvedBy: { select: { name: true, email: true } },
    } as const;

    const [items, total] = await Promise.all([
      this.prisma.withdrawalRequest.findMany({
        where,
        include,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.withdrawalRequest.count({ where }),
    ]);

    return { data: items.map((w) => this.toListItem(w)), total, page, limit };
  }

  /** Fetch one external withdrawal, scoped to a partner's own sub-users. */
  async getForExternal(
    withdrawalId: string,
    ownerExternalIds: string[],
  ): Promise<WithdrawalListItem> {
    const row =
      ownerExternalIds.length === 0
        ? null
        : await this.prisma.withdrawalRequest.findFirst({
            where: { id: withdrawalId, userId: { in: ownerExternalIds } },
            include: {
              user: { select: { name: true, email: true } },
              approvedBy: { select: { name: true, email: true } },
            },
          });
    if (!row) {
      throw new NotFoundException('Solicitação de saque não encontrada.');
    }
    return this.toListItem(row);
  }

  /**
   * Partner-driven status change (PROCESSING/COMPLETED/REJECTED) via the API.
   * Atomic compare-and-set scoped to the partner's own sub-users — a foreign id
   * or an out-of-matrix source status yields count===0. Balance is virtual:
   * COMPLETED keeps the reservation, REJECTED releases it automatically.
   */
  async setStatusForExternal(
    withdrawalId: string,
    ownerExternalIds: string[],
    dto: { status: 'processing' | 'completed' | 'rejected'; note?: string },
  ): Promise<WithdrawalListItem> {
    const transition =
      WithdrawalService.EXTERNAL_STATUS_TRANSITIONS[dto.status];
    if (!transition) {
      throw new BadRequestException(`Status inválido: ${dto.status}`);
    }
    if (ownerExternalIds.length === 0) {
      throw new NotFoundException('Solicitação de saque não encontrada.');
    }

    const result = await this.prisma.withdrawalRequest.updateMany({
      where: {
        id: withdrawalId,
        userId: { in: ownerExternalIds },
        status: { in: transition.from },
      },
      data: {
        status: transition.to,
        ...(dto.note !== undefined ? { adminNote: dto.note } : {}),
      },
    });

    if (result.count === 0) {
      const existing = await this.prisma.withdrawalRequest.findFirst({
        where: { id: withdrawalId, userId: { in: ownerExternalIds } },
        select: { status: true },
      });
      if (!existing) {
        throw new NotFoundException('Solicitação de saque não encontrada.');
      }
      throw new BadRequestException(
        `Transição inválida: ${existing.status} → ${transition.to}.`,
      );
    }

    const updated = await this.getForExternal(withdrawalId, ownerExternalIds);
    this.fireWithdrawalWebhook('status_changed', updated);
    return updated;
  }

  /**
   * Guard: internal/admin actions (approve/dispatch/mark-paid/reject) must never
   * touch an external API ledger row — they have sentinel PIX and would attempt
   * a real gateway payout to a fake key.
   */
  private async assertNotExternalWithdrawal(
    withdrawalId: string,
  ): Promise<void> {
    const row = await this.prisma.withdrawalRequest.findUnique({
      where: { id: withdrawalId },
      select: { user: { select: { isExternal: true } } },
    });
    if (row?.user.isExternal) {
      throw new BadRequestException(
        'Saque de API/externo não pode ser processado pelo painel interno.',
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /v1/withdrawals
  // ─────────────────────────────────────────────────────────────────────────

  async list(
    user: JwtPayload,
    query: ListWithdrawalsQueryDto,
  ): Promise<{
    data: WithdrawalListItem[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { page, limit, skip } = clampPagination(query, {
      defaultLimit: 20,
      maxLimit: 100,
    });

    const createdAt: { gte?: Date; lte?: Date } = {};
    if (query.startDate)
      createdAt.gte = new Date(`${query.startDate}T00:00:00.000Z`);
    if (query.endDate)
      createdAt.lte = new Date(`${query.endDate}T23:59:59.999Z`);
    const hasDateFilter = !!(query.startDate || query.endDate);

    const normalizedStatus = query.status?.toUpperCase() as
      | WithdrawalStatus
      | undefined;

    const where: Record<string, unknown> = {
      ...(user.role === UserRole.ADMIN || user.role === UserRole.SUPERADMIN
        ? {}
        : { userId: user.sub }),
      ...(normalizedStatus ? { status: normalizedStatus } : {}),
      ...(query.bettingHouse ? { bettingHouse: query.bettingHouse } : {}),
      ...(hasDateFilter ? { createdAt } : {}),
      ...(query.hasReceipt === 'yes'
        ? { gatewayReceiptFormat: { not: null } }
        : {}),
      ...(query.hasReceipt === 'no' ? { gatewayReceiptFormat: null } : {}),
      // Refund filter. "none" → no refund row; "any/partial/full" → any refund;
      // partial vs full split is applied in-memory after fetch because Prisma
      // cannot compare two columns (gatewayRefundedAmount vs originalAmount)
      // in a WHERE clause without raw SQL.
      ...(query.refundState === 'none' ? { gatewayRefundedAmount: null } : {}),
      ...(query.refundState === 'any' ||
      query.refundState === 'partial' ||
      query.refundState === 'full'
        ? { gatewayRefundedAmount: { not: null } }
        : {}),
    };

    const userClause: Record<string, unknown> = {};
    if (
      query.search &&
      (user.role === UserRole.ADMIN || user.role === UserRole.SUPERADMIN)
    ) {
      const userWhere = buildUserSearchWhere(query.search);
      if (userWhere) Object.assign(userClause, userWhere);
    }
    if (query.providerAccountId) {
      if (query.providerAccountId === '__none__') {
        // "Cabeças de rede": users sem AffiliateLink taggeado com painel
        userClause.affiliateLinks = {
          none: { providerAccountId: { not: null } },
        };
      } else {
        userClause.affiliateLinks = {
          some: { providerAccountId: query.providerAccountId },
        };
      }
    }
    // API/ledger withdrawals belong to shadow external sub-users and are never
    // dispatched through our gateway — by default they're excluded from the
    // admin list. The affiliate-detail "saques" tab opts in via includeExternal
    // to surface them (badged as external, with the partner who handled them).
    if (!query.includeExternal) {
      userClause.isExternal = false;
    }
    where.user = userClause;

    const selectFields = {
      id: true,
      userId: true,
      amount: true,
      originalAmount: true,
      withdrawalFee: true,
      bettingHouse: true,
      pixKeyType: true,
      pixKey: true,
      accountHolder: true,
      status: true,
      requestNote: true,
      adminNote: true,
      gatewayFailureReason: true,
      approvedAt: true,
      createdAt: true,
      gatewayId: true,
      gatewayStatus: true,
      gatewayReceiptFormat: true,
      gatewayRefundedAmount: true,
      user: {
        select: {
          name: true,
          email: true,
          externalEmail: true,
          isExternal: true,
          // Partner (referrer) who created/resolved an external withdrawal via API.
          referredBy: { select: { name: true, email: true } },
        },
      },
      approvedBy: { select: { name: true, email: true } },
    } as const;

    const refundStateNarrow =
      query.refundState === 'partial' || query.refundState === 'full';

    const mapRow = (
      w: Prisma.WithdrawalRequestGetPayload<{ select: typeof selectFields }>,
    ): WithdrawalListItem => {
      const originalAmount = w.originalAmount.toNumber();
      const refundedAmount = w.gatewayRefundedAmount?.toNumber() ?? null;
      return {
        id: w.id,
        userId: w.userId,
        userName: w.user.name,
        // Real e-mail for external sub-users (synthetic never surfaced).
        userEmail: w.user.externalEmail ?? w.user.email,
        amount: w.amount.toNumber(),
        originalAmount,
        withdrawalFee: w.withdrawalFee.toNumber(),
        bettingHouse: w.bettingHouse,
        pixKeyType: w.pixKeyType,
        pixKey: w.pixKey,
        accountHolder: w.accountHolder,
        status: w.status,
        requestNote: w.requestNote,
        adminNote: w.adminNote,
        gatewayFailureReason: w.gatewayFailureReason,
        approvedAt: w.approvedAt,
        approvedByName: w.approvedBy?.name ?? null,
        approvedByEmail: w.approvedBy?.email ?? null,
        createdAt: w.createdAt,
        hasReceipt: w.gatewayReceiptFormat !== null,
        refundedAmount,
        refundState: deriveRefundState(originalAmount, refundedAmount),
        isExternal: w.user.isExternal,
        // External (API) withdrawals carry no internal approver — the partner
        // (referrer) created/resolved them via the affiliate-API.
        externalApprovedByName: w.user.isExternal
          ? (w.user.referredBy?.name ?? null)
          : null,
        externalApprovedByEmail: w.user.isExternal
          ? (w.user.referredBy?.email ?? null)
          : null,
      };
    };

    if (refundStateNarrow) {
      // PARTIAL/FULL cannot be expressed in Prisma WHERE (column compare).
      // Fetch all rows that already passed the DB filter
      // (gatewayRefundedAmount IS NOT NULL — typically dozens, not millions),
      // narrow in-memory, then paginate.
      const all = await this.prisma.withdrawalRequest.findMany({
        where,
        select: selectFields,
        orderBy: { createdAt: 'asc' },
      });
      const narrowed = all
        .map(mapRow)
        .filter((row) =>
          query.refundState === 'partial'
            ? row.refundState === 'PARTIAL'
            : row.refundState === 'FULL',
        );
      const data = narrowed.slice(skip, skip + limit);
      return { data, total: narrowed.length, page, limit };
    }

    const [items, total] = await Promise.all([
      this.prisma.withdrawalRequest.findMany({
        where,
        select: selectFields,
        orderBy: { createdAt: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.withdrawalRequest.count({ where }),
    ]);

    const data: WithdrawalListItem[] = items.map(mapRow);

    return { data, total, page, limit };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /v1/withdrawals/panels  (admin only)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * List provider accounts (painéis) referenced by at least one AffiliateLink.
   * Used by the admin withdrawals page to populate the painel filter.
   */
  async listPanels(): Promise<
    Array<{ id: string; name: string; provider: string; active: boolean }>
  > {
    const accounts = await this.prisma.providerAccount.findMany({
      where: { affiliateLinks: { some: { deletedAt: null } } },
      select: { id: true, name: true, provider: true, active: true },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    return accounts;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /v1/withdrawals/stats  (admin only)
  // ─────────────────────────────────────────────────────────────────────────

  async getStats(
    user: JwtPayload,
    query: ListWithdrawalsQueryDto,
  ): Promise<{
    pending: { count: number; amount: number };
    approved: { count: number; amount: number };
    paid: { count: number; amount: number };
  }> {
    const createdAt: { gte?: Date; lte?: Date } = {};
    if (query.startDate)
      createdAt.gte = new Date(`${query.startDate}T00:00:00.000Z`);
    if (query.endDate)
      createdAt.lte = new Date(`${query.endDate}T23:59:59.999Z`);
    const hasDateFilter = !!(query.startDate || query.endDate);

    const baseWhere: Record<string, unknown> = {
      ...(user.role === UserRole.ADMIN || user.role === UserRole.SUPERADMIN
        ? {}
        : { userId: user.sub }),
      ...(query.bettingHouse ? { bettingHouse: query.bettingHouse } : {}),
      ...(hasDateFilter ? { createdAt } : {}),
    };

    const userClause: Record<string, unknown> = {};
    if (
      query.search &&
      (user.role === UserRole.ADMIN || user.role === UserRole.SUPERADMIN)
    ) {
      const userWhere = buildUserSearchWhere(query.search);
      if (userWhere) Object.assign(userClause, userWhere);
    }
    if (query.providerAccountId) {
      if (query.providerAccountId === '__none__') {
        // "Cabeças de rede": users sem AffiliateLink taggeado com painel
        userClause.affiliateLinks = {
          none: { providerAccountId: { not: null } },
        };
      } else {
        userClause.affiliateLinks = {
          some: { providerAccountId: query.providerAccountId },
        };
      }
    }
    // Exclude external/API ledger withdrawals from admin stats (see list()).
    userClause.isExternal = false;
    baseWhere.user = userClause;

    const grouped = await this.prisma.withdrawalRequest.groupBy({
      by: ['status'],
      where: baseWhere,
      _sum: { originalAmount: true },
      _count: { _all: true },
    });

    const result = {
      pending: { count: 0, amount: 0 },
      approved: { count: 0, amount: 0 },
      paid: { count: 0, amount: 0 },
    };

    for (const row of grouped) {
      const amount = row._sum.originalAmount?.toNumber() ?? 0;
      const count = row._count._all;
      if (row.status === WithdrawalStatus.PENDING) {
        result.pending.amount += amount;
        result.pending.count += count;
      } else if (
        row.status === WithdrawalStatus.APPROVED ||
        row.status === WithdrawalStatus.PROCESSING
      ) {
        result.approved.amount += amount;
        result.approved.count += count;
      } else if (row.status === WithdrawalStatus.COMPLETED) {
        result.approved.amount += amount;
        result.approved.count += count;
        result.paid.amount += amount;
        result.paid.count += count;
      }
    }

    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PUT /v1/withdrawals/:id  (admin only)
  // ─────────────────────────────────────────────────────────────────────────

  async updateStatus(
    withdrawalId: string,
    adminUserId: string,
    dto: UpdateWithdrawalStatusDto,
  ): Promise<WithdrawalListItem> {
    await this.assertNotExternalWithdrawal(withdrawalId);
    if (dto.status === 'approved') {
      throw new BadRequestException(
        'Aprovação requer confirmação de valor. Use POST /v1/withdrawals/:id/approve.',
      );
    }
    const newStatus = WithdrawalStatus.REJECTED;

    // Atomic compare-and-set: only transition if still PENDING.
    // Prevents TOCTOU when two admins approve concurrently — exactly one
    // UPDATE matches (count===1); the other observes count===0 and 400s.
    const transition = await this.prisma.withdrawalRequest.updateMany({
      where: { id: withdrawalId, status: WithdrawalStatus.PENDING },
      data: {
        status: newStatus,
        ...(dto.adminNote !== undefined ? { adminNote: dto.adminNote } : {}),
        approvedAt: new Date(),
        approvedById: adminUserId,
      },
    });

    if (transition.count === 0) {
      const existing = await this.prisma.withdrawalRequest.findUnique({
        where: { id: withdrawalId },
        select: { status: true },
      });
      if (!existing) {
        throw new NotFoundException('Solicitação de saque não encontrada.');
      }
      throw new BadRequestException(
        `Este saque já foi processado (status atual: ${existing.status}).`,
      );
    }

    const updated = await this.prisma.withdrawalRequest.findUniqueOrThrow({
      where: { id: withdrawalId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        approvedBy: { select: { name: true, email: true } },
      },
    });
    const withdrawal = updated;

    const amount = updated.amount.toNumber().toFixed(2);
    const noteSuffix = updated.adminNote
      ? ` Observação: ${updated.adminNote}`
      : '';
    this.notificationService
      .create({
        userId: withdrawal.userId,
        type: NotificationType.GENERAL,
        title: 'Saque recusado',
        message: `Seu saque de R$${amount} foi recusado.${noteSuffix}`,
        metadata: {
          withdrawalId,
          amount: updated.amount.toNumber(),
          pixKey: updated.pixKey,
          status: updated.status,
          adminNote: updated.adminNote,
        },
      })
      .catch((err: unknown) =>
        this.logger.warn(
          `Notification failed for withdrawal ${withdrawalId}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );

    const rejectedItem = this.toListItem(updated);
    this.fireWithdrawalWebhook('status_changed', rejectedItem, {
      previousStatus: 'PENDING',
    });
    return rejectedItem;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /v1/withdrawals/balance-breakdown/:userId  (admin only)
  // ─────────────────────────────────────────────────────────────────────────

  async getBalanceBreakdown(targetUserId: string) {
    // Verify user exists — explicit 404 instead of Prisma 500
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException(`Usuário ${targetUserId} não encontrado.`);
    }

    // Build a synthetic JwtPayload for the target user.
    // DashboardBalanceService only uses `user.sub` internally —
    // email and role don't affect the balance calculation.
    const syntheticPayload: JwtPayload = {
      sub: targetUserId,
      email: '',
      role: UserRole.AFFILIATE,
    };

    return this.balanceService.getBalance(syntheticPayload, {});
  }

  // ─────────────────────────────────────────────────────────────────────────
  // POST /v1/withdrawals/:id/approve  (admin only) — HeartPay gateway dispatch
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Atomic approval flow:
   *   1. CAS PENDING+gatewayId=null → APPROVED with approvedById/approvedAt.
   *   2. Validate confirmAmount matches stored originalAmount (defends against
   *      stale UI showing outdated values).
   *   3. POST /v1/transfers OUTSIDE any DB transaction (network IO must not
   *      hold locks). Payload amount = ((originalAmount - withdrawalFee) + 1) * 100.
   *   4. On gateway success → PROCESSING + persist gatewayId/response.
   *   5. On gateway failure → FAILED + balance auto-restored (FAILED is
   *      excluded from DashboardBalanceService deduction filter).
   */
  async approveAndDispatch(
    withdrawalId: string,
    adminUserId: string,
    dto: ApproveWithdrawalDto,
  ): Promise<WithdrawalListItem> {
    await this.assertNotExternalWithdrawal(withdrawalId);
    // 1. Atomic CAS — only one concurrent admin transitions PENDING → APPROVED.
    const transition = await this.prisma.withdrawalRequest.updateMany({
      where: {
        id: withdrawalId,
        status: WithdrawalStatus.PENDING,
        gatewayId: null,
      },
      data: {
        status: WithdrawalStatus.APPROVED,
        approvedAt: new Date(),
        approvedById: adminUserId,
        ...(dto.adminNote !== undefined ? { adminNote: dto.adminNote } : {}),
        gatewayAttempts: { increment: 1 },
      },
    });

    if (transition.count === 0) {
      const existing = await this.prisma.withdrawalRequest.findUnique({
        where: { id: withdrawalId },
        select: { status: true },
      });
      if (!existing) {
        throw new NotFoundException('Solicitação de saque não encontrada.');
      }
      throw new BadRequestException(
        `Este saque já foi processado (status atual: ${existing.status}).`,
      );
    }

    // 2. Reload with user relations.
    const withdrawal = await this.prisma.withdrawalRequest.findUniqueOrThrow({
      where: { id: withdrawalId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        approvedBy: { select: { name: true, email: true } },
      },
    });

    // 3. Validate confirmAmount against server state (stale-UI defense).
    const originalAmountNumber = withdrawal.originalAmount.toNumber();
    if (Math.abs(originalAmountNumber - dto.confirmAmount) > 0.005) {
      // Roll back the optimistic transition — back to PENDING for re-confirmation.
      await this.prisma.withdrawalRequest.updateMany({
        where: {
          id: withdrawalId,
          status: WithdrawalStatus.APPROVED,
          gatewayId: null,
        },
        data: {
          status: WithdrawalStatus.PENDING,
          approvedAt: null,
          approvedById: null,
        },
      });
      throw new BadRequestException(
        `Valor de confirmação (${dto.confirmAmount}) não corresponde ao valor original do saque (${originalAmountNumber.toFixed(2)}).`,
      );
    }

    // 4. Validate + normalize PIX key type recorded on the withdrawal request.
    //    "random" (gateway/doc term) maps to internal "EVP"; the gateway client
    //    then maps EVP back to "random" in the payload.
    const pixKeyType = normalizePixKeyType(withdrawal.pixKeyType);
    if (!pixKeyType) {
      await this.markFailed(
        withdrawalId,
        `Tipo de chave PIX inválido (${withdrawal.pixKeyType}).`,
        null,
      );
      throw new BadRequestException(
        `Tipo de chave PIX inválido: ${withdrawal.pixKeyType}.`,
      );
    }

    // 5. Compute payload amount in cents using Prisma.Decimal for precision.
    //    HeartPay's PIX OUT fee is deducted automatically from the `value`
    //    field we send (HeartPay returns `netAmount = value/100 - feeAmount`
    //    on the webhook). We therefore send exactly the net amount the
    //    affiliate should receive — no extra gateway-fee add-on.
    //    payload = (originalAmount - withdrawalFee) * 100
    const netDecimal = withdrawal.originalAmount.minus(
      withdrawal.withdrawalFee,
    );
    const payloadDecimal = netDecimal.mul(100);
    const amountCents = Math.round(payloadDecimal.toNumber());

    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      await this.markFailed(
        withdrawalId,
        `Valor de payload inválido (${amountCents}).`,
        null,
      );
      throw new BadRequestException(
        'Valor calculado para o gateway é inválido.',
      );
    }

    // 6. Verify HeartPay company balance can cover the payout before dispatching.
    const balanceCheck =
      await this.paymentGateway.checkSufficientBalance(amountCents);
    if (!balanceCheck.ok) {
      // Roll back the optimistic transition — back to PENDING for re-attempt later.
      await this.prisma.withdrawalRequest.updateMany({
        where: {
          id: withdrawalId,
          status: WithdrawalStatus.APPROVED,
          gatewayId: null,
        },
        data: {
          status: WithdrawalStatus.PENDING,
          approvedAt: null,
          approvedById: null,
        },
      });
      throw new BadRequestException(balanceCheck.reason);
    }

    // 7. Dispatch to gateway OUTSIDE any DB transaction.
    const result = await this.paymentGateway.createTransfer({
      withdrawalId,
      amountCents,
      pixKey: withdrawal.pixKey,
      pixKeyType,
    });

    if (!result.ok) {
      // HeartPay returns 409 when correlationID already exists in an active
      // payout — meaning a prior attempt (likely a retry after a network blip)
      // actually reached the gateway. DO NOT mark FAILED: the payout is real
      // and may already be processing. Flip to PROCESSING and wait for the
      // webhook. The retry loop in the client breaks on 409 with the existing
      // reference_code available in the response body.
      if (result.statusCode === 409) {
        const existingRef = this.extractExistingReferenceCode(result.response);
        await this.prisma.withdrawalRequest.updateMany({
          where: {
            id: withdrawalId,
            status: WithdrawalStatus.APPROVED,
            gatewayId: null,
          },
          data: {
            status: WithdrawalStatus.PROCESSING,
            gatewayProvider: this.paymentGateway.getActiveProvider(),
            ...(existingRef ? { gatewayId: existingRef } : {}),
            gatewayStatus: 'duplicate_correlation_id',
            gatewayRequest: result.requestPayload as Prisma.InputJsonValue,
            gatewayResponse: result.response as Prisma.InputJsonValue,
            gatewaySentAt: new Date(),
          },
        });
        this.logger.warn(
          `Withdrawal ${withdrawalId} hit HeartPay 409 — treating as in-flight payout (existingRef=${existingRef ?? 'unknown'}).`,
        );
        const refreshed409 =
          await this.prisma.withdrawalRequest.findUniqueOrThrow({
            where: { id: withdrawalId },
            include: {
              user: { select: { name: true, email: true } },
              approvedBy: { select: { name: true, email: true } },
            },
          });
        return this.toListItem(refreshed409);
      }

      await this.markFailed(
        withdrawalId,
        result.reason,
        result.response ?? null,
        result.requestPayload,
      );

      this.notificationService
        .create({
          userId: withdrawal.userId,
          type: NotificationType.WITHDRAWAL_FAILED,
          title: 'Saque com problema',
          message:
            'Não foi possível processar seu saque agora. Nossa equipe está verificando.',
          metadata: {
            withdrawalId,
            reason: result.reason,
            statusCode: result.statusCode ?? null,
          },
        })
        .catch((err: unknown) =>
          this.logger.warn(
            `Notification failed for withdrawal ${withdrawalId}: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );

      this.writeAuditLog({
        userId: withdrawal.userId,
        userName: withdrawal.user.name,
        userEmail: withdrawal.user.email,
        adminUserId,
        action: 'Saque — falha no gateway de pagamento',
        method: 'POST',
        path: `/v1/withdrawals/${withdrawalId}/approve`,
        statusCode: 502,
        details: {
          withdrawalId,
          gatewayProvider: this.paymentGateway.getActiveProvider(),
          reason: result.reason,
          statusCode: result.statusCode ?? null,
          requestPayload: result.requestPayload,
          response: this.redact(result.response),
        },
      });

      throw new HttpException(
        `Falha no gateway de pagamento: ${result.reason}`,
        HttpStatus.BAD_GATEWAY,
      );
    }

    // 7. Gateway accepted — flip to PROCESSING with persisted gateway snapshot.
    const updateAfterDispatch = await this.prisma.withdrawalRequest.updateMany({
      where: {
        id: withdrawalId,
        status: WithdrawalStatus.APPROVED,
      },
      data: {
        status: WithdrawalStatus.PROCESSING,
        gatewayProvider: this.paymentGateway.getActiveProvider(),
        gatewayId: result.response.id,
        gatewayStatus: result.response.status,
        gatewayRequest: result.requestPayload as Prisma.InputJsonValue,
        gatewayResponse: result.response as unknown as Prisma.InputJsonValue,
        gatewaySentAt: new Date(),
      },
    });

    if (updateAfterDispatch.count === 0) {
      // A webhook may have already moved status to COMPLETED/FAILED — that's
      // fine, log and continue. Don't roll back the gateway dispatch.
      this.logger.warn(
        `Withdrawal ${withdrawalId} status changed during gateway dispatch — webhook likely arrived first.`,
      );
    }

    this.writeAuditLog({
      userId: withdrawal.userId,
      userName: withdrawal.user.name,
      userEmail: withdrawal.user.email,
      adminUserId,
      action: 'Saque aprovado e enviado ao gateway',
      method: 'POST',
      path: `/v1/withdrawals/${withdrawalId}/approve`,
      statusCode: 200,
      details: {
        withdrawalId,
        gatewayProvider: this.paymentGateway.getActiveProvider(),
        gatewayId: result.response.id,
        gatewayStatus: result.response.status,
        amountCents,
        originalAmount: originalAmountNumber,
        withdrawalFee: withdrawal.withdrawalFee.toNumber(),
        gatewayFixedFee: 0,
        pixKeyType,
        requestPayload: result.requestPayload,
        responseSummary: {
          id: result.response.id,
          status: result.response.status,
          amount: result.response.amount,
          net_amount: result.response.net_amount,
          fee: result.response.fee,
        },
      },
    });

    this.notificationService
      .create({
        userId: withdrawal.userId,
        type: NotificationType.WITHDRAWAL_APPROVED,
        title: '💸 Saque aprovado',
        message: `Seu saque de R$${withdrawal.amount.toNumber().toFixed(2)} foi aprovado e está sendo processado.`,
        metadata: {
          withdrawalId,
          gatewayId: result.response.id,
          status: 'PROCESSING',
        },
      })
      .catch((err: unknown) =>
        this.logger.warn(
          `Notification failed for withdrawal ${withdrawalId}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );

    const refreshed = await this.prisma.withdrawalRequest.findUniqueOrThrow({
      where: { id: withdrawalId },
      include: {
        user: { select: { name: true, email: true } },
        approvedBy: { select: { name: true, email: true } },
      },
    });

    const dispatchedItem = this.toListItem(refreshed);
    this.fireWithdrawalWebhook('status_changed', dispatchedItem, {
      previousStatus: 'PENDING',
    });
    return dispatchedItem;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Gateway webhook handler  (called from PaymentGatewayWebhookController)
  // ─────────────────────────────────────────────────────────────────────────

  async handleGatewayWebhookEvent(
    payload: HeartPayWebhookPayload,
  ): Promise<{ processed: boolean; reason?: string }> {
    const eventName = payload?.event;
    const eventData: HeartPayPayoutEventData | undefined = payload?.data?.data;
    const referenceCode =
      eventData?.referenceCode ?? eventData?.correlationID ?? null;

    if (!eventName || !referenceCode) {
      this.logger.warn(
        `Webhook invalid payload: event=${eventName ?? 'n/a'} referenceCode=${referenceCode ?? 'n/a'}`,
      );
      return { processed: false, reason: 'invalid payload' };
    }

    // Idempotency key intentionally OMITS the timestamp so re-deliveries of
    // the same logical event (HeartPay can resend with refreshed timestamps)
    // collide on the unique constraint and are deduped at write time.
    const provider = this.paymentGateway.getActiveProvider();
    const eventKey = createHash('sha256')
      .update(`${provider}|${referenceCode}|${eventName}`)
      .digest('hex');

    // Persiste TODO evento autenticado primeiro (mesmo os não tratados), para
    // sempre conseguir confirmar que o webhook chegou. Idempotente — duplicatas
    // disparam P2002 e são puladas.
    try {
      await this.prisma.gatewayWebhookEvent.create({
        data: {
          provider,
          eventKey,
          event: eventName,
          gatewayId: referenceCode,
          rawPayload: payload as unknown as Prisma.InputJsonValue,
          status: 'received',
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return { processed: false, reason: 'duplicate event' };
      }
      throw err;
    }

    // Apenas eventos PayOut* mudam o estado do saque; demais ficam como
    // 'ignored' (mas já gravados acima para auditoria/observabilidade).
    if (
      eventName !== 'PayOutCompleted' &&
      eventName !== 'PayOutFailed' &&
      eventName !== 'PayOutRefunded'
    ) {
      await this.prisma.gatewayWebhookEvent.update({
        where: { eventKey },
        data: { status: 'ignored' },
      });
      this.logger.log(
        `Webhook ignored (no state change): event=${eventName} id=${referenceCode}`,
      );
      return { processed: false, reason: `ignored event: ${eventName}` };
    }

    // Try lookup by stored gatewayId (== referenceCode). If not found, fall
    // back to the local withdrawalId (correlationID == withdrawal.id when we
    // POST the payout).
    let withdrawal = await this.prisma.withdrawalRequest.findFirst({
      where: { gatewayId: referenceCode },
      select: {
        id: true,
        userId: true,
        amount: true,
        originalAmount: true,
        bettingHouse: true,
        createdAt: true,
      },
    });

    if (!withdrawal && eventData?.correlationID) {
      withdrawal = await this.prisma.withdrawalRequest.findUnique({
        where: { id: eventData.correlationID },
        select: {
          id: true,
          userId: true,
          amount: true,
          originalAmount: true,
          bettingHouse: true,
          createdAt: true,
        },
      });
    }

    if (!withdrawal) {
      await this.prisma.gatewayWebhookEvent.update({
        where: { eventKey },
        data: { status: 'orphan' },
      });
      this.logger.warn(`Webhook for unknown referenceCode=${referenceCode}`);
      return { processed: false, reason: 'unknown referenceCode' };
    }

    await this.prisma.gatewayWebhookEvent.update({
      where: { eventKey },
      data: { withdrawalId: withdrawal.id },
    });

    const gatewayStatus = eventData?.status ?? eventName;
    const endToEndId = eventData?.endToEndId ?? null;
    const completedAt = eventData?.completedAt
      ? new Date(eventData.completedAt)
      : new Date();
    const receiver = {
      name: eventData?.recipientName ?? null,
      document: eventData?.recipientDocument ?? null,
      bank: eventData?.recipientBank ?? null,
      bankIspb: eventData?.recipientBankIspb ?? null,
      branch: eventData?.recipientBranch ?? null,
      account: eventData?.recipientAccount ?? null,
    };

    if (eventName === 'PayOutCompleted') {
      const updated = await this.prisma.withdrawalRequest.updateMany({
        where: {
          id: withdrawal.id,
          status: {
            in: [WithdrawalStatus.APPROVED, WithdrawalStatus.PROCESSING],
          },
        },
        data: {
          status: WithdrawalStatus.COMPLETED,
          gatewayStatus,
          gatewayResponse: payload as unknown as Prisma.InputJsonValue,
          gatewayCompletedAt: completedAt,
          gatewayEndToEnd: endToEndId,
          gatewayReceiver: receiver as unknown as Prisma.InputJsonValue,
        },
      });

      // Persist the PIX OUT receipt right after we mark the withdrawal as
      // COMPLETED. HeartPay only emits the receipt for COMPLETED/FAILED
      // payouts; we fetch by correlationID (== withdrawal.id) and store the
      // PNG base64 inline so the affiliate can download it later without a
      // live call to the gateway.
      if (updated.count > 0) {
        // Gera o comprovante PRIMEIRO e SÓ ENTÃO enfileira o envio ao grupo
        // WhatsApp — garante que o PNG já esteja salvo em gatewayReceiptBase64
        // quando o job de envio rodar (senão cairia no fallback de texto).
        // Fire-and-forget: nada disso bloqueia o webhook nem o fluxo de saque.
        void this.fetchAndPersistReceipt(withdrawal.id)
          .catch((err: unknown) =>
            this.logger.warn(
              `Receipt persistence failed for withdrawal ${withdrawal.id}: ${err instanceof Error ? err.message : String(err)}`,
            ),
          )
          .finally(() => {
            this.whatsappProofProducer
              .enqueueProof(withdrawal.id)
              .catch((err: unknown) =>
                this.logger.warn(
                  `WhatsApp proof enqueue failed for withdrawal ${withdrawal.id}: ${err instanceof Error ? err.message : String(err)}`,
                ),
              );
          });

        this.notificationService
          .create({
            userId: withdrawal.userId,
            type: NotificationType.WITHDRAWAL_COMPLETED,
            title: '✅ Saque concluído',
            message: `Seu saque de R$${withdrawal.amount.toNumber().toFixed(2)} foi creditado com sucesso na sua conta.`,
            metadata: {
              withdrawalId: withdrawal.id,
              gatewayId: referenceCode,
              endToEnd: endToEndId,
              paidAt: eventData?.completedAt ?? null,
            },
          })
          .catch((err: unknown) =>
            this.logger.warn(
              `Completion notification failed for withdrawal ${withdrawal.id}: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );

        this.fireWithdrawalWebhook(
          'status_changed',
          {
            id: withdrawal.id,
            userId: withdrawal.userId,
            bettingHouse: withdrawal.bettingHouse,
            amount: withdrawal.amount.toNumber(),
            originalAmount: withdrawal.originalAmount.toNumber(),
            status: WithdrawalStatus.COMPLETED,
            createdAt: withdrawal.createdAt,
          },
          { previousStatus: 'PROCESSING' },
        );
      }
    } else if (eventName === 'PayOutFailed') {
      // PIX OUT genuinely failed at the provider (e.g. invalid key). HeartPay
      // credits the seller balance back; we mirror by marking FAILED locally
      // so DashboardBalanceService restores the affiliate's balance too.
      const failureReason =
        eventData?.errorMessage ?? 'Gateway reported PayOutFailed';

      const updated = await this.prisma.withdrawalRequest.updateMany({
        where: {
          id: withdrawal.id,
          status: {
            in: [WithdrawalStatus.APPROVED, WithdrawalStatus.PROCESSING],
          },
        },
        data: {
          status: WithdrawalStatus.FAILED,
          gatewayStatus,
          gatewayResponse: payload as unknown as Prisma.InputJsonValue,
          gatewayFailureReason: failureReason.slice(0, 1000),
        },
      });

      if (updated.count > 0) {
        this.notificationService
          .create({
            userId: withdrawal.userId,
            type: NotificationType.WITHDRAWAL_FAILED,
            title: 'Saque recusado',
            message:
              'Seu saque foi recusado pelo provedor de pagamento. O valor voltou ao seu saldo.',
            metadata: {
              withdrawalId: withdrawal.id,
              gatewayId: referenceCode,
              errorMessage: eventData?.errorMessage ?? null,
            },
          })
          .catch((err: unknown) =>
            this.logger.warn(
              `Failure notification failed for withdrawal ${withdrawal.id}: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );

        this.fireWithdrawalWebhook(
          'status_changed',
          {
            id: withdrawal.id,
            userId: withdrawal.userId,
            bettingHouse: withdrawal.bettingHouse,
            amount: withdrawal.amount.toNumber(),
            originalAmount: withdrawal.originalAmount.toNumber(),
            status: WithdrawalStatus.FAILED,
            createdAt: withdrawal.createdAt,
          },
          { previousStatus: 'PROCESSING' },
        );
      }
    } else if (eventName === 'PayOutRefunded') {
      // Refund: the recipient (affiliate) returned the PIX funds via their
      // bank app — partially or fully. HeartPay credits the seller balance
      // back; we credit the affiliate's local balance back too, proportional
      // to the refunded amount (DashboardBalanceService subtracts
      // gatewayRefundedAmount from each withdrawal's effective deduction).
      //
      // The PIX OUT fee (originalAmount - amount) is NOT restored because we
      // actually paid it to the provider regardless of the refund.
      const refundedAmount =
        typeof eventData?.refundedAmount === 'number'
          ? eventData.refundedAmount
          : typeof eventData?.amount === 'number'
            ? eventData.amount
            : null;
      const refundEndToEnd = eventData?.refundEndToEndId ?? null;
      const completedAtRefund = eventData?.completedAt
        ? new Date(eventData.completedAt)
        : new Date();

      if (refundedAmount === null) {
        this.logger.warn(
          `PayOutRefunded for withdrawal ${withdrawal.id} missing refundedAmount`,
        );
      }

      // Reload originalAmount to clamp refundedAmount inside the trusted DB
      // value — a malicious or buggy webhook with refundedAmount >>
      // originalAmount would otherwise drive the effective deduction to 0
      // and inflate the affiliate's balance.
      const fullRow = await this.prisma.withdrawalRequest.findUnique({
        where: { id: withdrawal.id },
        select: { originalAmount: true, status: true },
      });
      const originalAmount = fullRow?.originalAmount.toNumber() ?? 0;
      const clampedRefund =
        refundedAmount === null
          ? null
          : Math.max(0, Math.min(refundedAmount, originalAmount));

      if (
        fullRow &&
        fullRow.status !== WithdrawalStatus.COMPLETED &&
        fullRow.status !== WithdrawalStatus.PROCESSING
      ) {
        this.logger.warn(
          `PayOutRefunded ignored for withdrawal ${withdrawal.id}: status=${fullRow.status}`,
        );
        await this.prisma.gatewayWebhookEvent.update({
          where: { eventKey },
          data: { status: 'processed' },
        });
        return { processed: true, reason: 'refund ignored — status mismatch' };
      }

      await this.prisma.withdrawalRequest.updateMany({
        where: {
          id: withdrawal.id,
          // Only refund a withdrawal that is actually paid (or in-flight).
          // Prevents a spoofed/late webhook from inflating balance on a row
          // we've never paid (PENDING/REJECTED/FAILED).
          status: {
            in: [WithdrawalStatus.COMPLETED, WithdrawalStatus.PROCESSING],
          },
        },
        data: {
          // Status stays as-is. Balance service handles credit-back via
          // gatewayRefundedAmount.
          gatewayStatus: gatewayStatus || 'REFUNDED',
          gatewayResponse: payload as unknown as Prisma.InputJsonValue,
          ...(clampedRefund !== null
            ? { gatewayRefundedAmount: new Prisma.Decimal(clampedRefund) }
            : {}),
          gatewayRefundedAt: completedAtRefund,
          ...(refundEndToEnd ? { gatewayRefundEndToEnd: refundEndToEnd } : {}),
        },
      });

      if (clampedRefund !== null && clampedRefund > 0) {
        this.notificationService
          .create({
            userId: withdrawal.userId,
            type: NotificationType.GENERAL,
            title: 'Estorno de saque recebido',
            message: `Um estorno de R$${clampedRefund.toFixed(2)} foi processado para o saque #${withdrawal.id.slice(0, 8)}. O valor voltou ao seu saldo disponível.`,
            metadata: {
              withdrawalId: withdrawal.id,
              gatewayId: referenceCode,
              refundedAmount: clampedRefund,
              refundEndToEndId: refundEndToEnd,
            },
          })
          .catch((err: unknown) =>
            this.logger.warn(
              `Refund notification failed for withdrawal ${withdrawal.id}: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
      }

      this.writeAuditLog({
        userId: withdrawal.userId,
        userName: '',
        userEmail: '',
        adminUserId: null,
        action: 'Saque estornado pelo destinatário (PayOutRefunded)',
        method: 'POST',
        path: '/v1/webhooks/heartpay',
        statusCode: 200,
        details: {
          withdrawalId: withdrawal.id,
          gatewayId: referenceCode,
          refundedAmountRaw: refundedAmount,
          refundedAmountApplied: clampedRefund,
          originalAmount,
          refundEndToEndId: refundEndToEnd,
          provider: eventData?.provider ?? null,
        },
      });
    }

    await this.prisma.gatewayWebhookEvent.update({
      where: { eventKey },
      data: { status: 'processed' },
    });

    this.writeAuditLog({
      userId: withdrawal.userId,
      userName: '',
      userEmail: '',
      adminUserId: null,
      action: `Webhook gateway: ${eventName}`,
      method: 'POST',
      path: '/v1/webhooks/heartpay',
      statusCode: 200,
      details: {
        withdrawalId: withdrawal.id,
        gatewayId: referenceCode,
        event: eventName,
        gatewayStatus,
      },
    });

    return { processed: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Reconcile de saques presos em PROCESSING (webhook PayOut* perdido)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Varre saques PROCESSING antigos cujo webhook nunca chegou, consulta o
   * status real no gateway e aplica o MESMO fluxo do webhook via
   * {@link handleGatewayWebhookEvent} — marca COMPLETED/FAILED, notifica o
   * usuário, enfileira o comprovante WhatsApp e estorna o saldo no FAILED.
   *
   * Idempotente: `handleGatewayWebhookEvent` deduplica pelo `eventKey`
   * (heartpay|referenceCode|event), então se o webhook real chegar depois (ou
   * outra instância já reconciliou) o segundo processamento é descartado.
   */
  async reconcileStuckProcessing(): Promise<{
    checked: number;
    completed: number;
    failed: number;
  }> {
    const cutoff = new Date(Date.now() - STUCK_PROCESSING_THRESHOLD_MS);
    const stuck = await this.prisma.withdrawalRequest.findMany({
      where: {
        status: WithdrawalStatus.PROCESSING,
        gatewayId: { not: null },
        gatewaySentAt: { lt: cutoff },
      },
      select: { id: true, gatewayId: true },
      orderBy: { gatewaySentAt: 'asc' },
      take: 50,
    });

    let completed = 0;
    let failed = 0;

    for (const w of stuck) {
      const gatewayId = w.gatewayId;
      if (!gatewayId) continue;

      const res = await this.paymentGateway.getPayoutStatus(gatewayId);
      if (!res.ok) {
        this.logger.warn(
          `Reconcile: status query failed for ${w.id} (${gatewayId}): ${res.reason}`,
        );
        continue;
      }

      const gatewayStatus = res.data.status.toLowerCase();
      let event: HeartPayWebhookEventName | null = null;
      if (gatewayStatus === 'completed') {
        event = 'PayOutCompleted';
      } else if (gatewayStatus === 'failed' || gatewayStatus === 'rejected') {
        event = 'PayOutFailed';
      }

      // pending/processing/pending_approval → ainda em trânsito, deixa pra lá.
      if (!event) continue;

      const payload = this.buildSyntheticPayoutPayload(event, w.id, res.data);
      try {
        const result = await this.handleGatewayWebhookEvent(payload);
        if (result.processed) {
          if (event === 'PayOutCompleted') completed += 1;
          else failed += 1;
          this.logger.log(
            `Reconcile: ${w.id} (${gatewayId}) → ${event} (gateway=${gatewayStatus})`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `Reconcile: failed to apply ${event} for ${w.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (stuck.length > 0) {
      this.logger.log(
        `Reconcile: checked=${stuck.length} completed=${completed} failed=${failed}`,
      );
    }

    return { checked: stuck.length, completed, failed };
  }

  /**
   * Constrói um payload equivalente ao webhook HeartPay a partir do retorno de
   * `getPayoutStatus`, para reaproveitar integralmente o handler do webhook.
   * Marca `source: 'reconcile'` para distinguir na auditoria do `rawPayload`.
   */
  private buildSyntheticPayoutPayload(
    event: HeartPayWebhookEventName,
    withdrawalId: string,
    data: {
      reference_code: string;
      status: string;
      completed_at?: string | null;
      error_message?: string | null;
    },
  ): HeartPayWebhookPayload {
    return {
      event,
      timestamp: new Date().toISOString(),
      data: {
        data: {
          referenceCode: data.reference_code,
          correlationID: withdrawalId,
          status: data.status,
          completedAt: data.completed_at ?? undefined,
          errorMessage: data.error_message ?? undefined,
          source: 'reconcile',
        },
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // POST /v1/withdrawals/:id/mark-paid  (admin only) — manual gateway bypass
  // ─────────────────────────────────────────────────────────────────────────

  async markPaidManually(
    withdrawalId: string,
    adminUserId: string,
    dto: ManualPaymentDto,
  ): Promise<WithdrawalListItem> {
    await this.assertNotExternalWithdrawal(withdrawalId);
    const transition = await this.prisma.withdrawalRequest.updateMany({
      where: {
        id: withdrawalId,
        status: {
          in: [
            WithdrawalStatus.PENDING,
            WithdrawalStatus.APPROVED,
            WithdrawalStatus.PROCESSING,
          ],
        },
      },
      data: {
        status: WithdrawalStatus.COMPLETED,
        approvedAt: new Date(),
        approvedById: adminUserId,
        ...(dto.adminNote !== undefined ? { adminNote: dto.adminNote } : {}),
      },
    });

    if (transition.count === 0) {
      const existing = await this.prisma.withdrawalRequest.findUnique({
        where: { id: withdrawalId },
        select: { status: true },
      });
      if (!existing) {
        throw new NotFoundException('Solicitação de saque não encontrada.');
      }
      throw new BadRequestException(
        `Saque não pode ser marcado como pago manualmente (status atual: ${existing.status}).`,
      );
    }

    const updated = await this.prisma.withdrawalRequest.findUniqueOrThrow({
      where: { id: withdrawalId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        approvedBy: { select: { name: true, email: true } },
      },
    });

    const amount = updated.amount.toNumber().toFixed(2);
    this.notificationService
      .create({
        userId: updated.userId,
        type: NotificationType.GENERAL,
        title: 'Saque realizado',
        message: `Seu saque de R$${amount} foi processado.`,
        metadata: {
          withdrawalId,
          amount: updated.amount.toNumber(),
          status: updated.status,
        },
      })
      .catch((err: unknown) =>
        this.logger.warn(
          `Notification failed for withdrawal ${withdrawalId}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );

    this.writeAuditLog({
      userId: updated.userId,
      userName: updated.user.name,
      userEmail: updated.user.email,
      adminUserId,
      action: 'Saque marcado como pago manualmente (gateway offline)',
      method: 'POST',
      path: `/v1/withdrawals/${withdrawalId}/mark-paid`,
      statusCode: 200,
      details: {
        withdrawalId,
        amount: updated.amount.toNumber(),
        originalAmount: updated.originalAmount.toNumber(),
        adminNote: dto.adminNote,
      },
    });

    const paidItem = this.toListItem(updated);
    this.fireWithdrawalWebhook('status_changed', paidItem);
    return paidItem;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /v1/withdrawals/:id/receipt
  // Returns the HeartPay PIX OUT receipt (PNG base64) for COMPLETED/FAILED
  // withdrawals. Affiliates only see their own; admins see any.
  // ─────────────────────────────────────────────────────────────────────────

  async getReceipt(
    user: JwtPayload,
    withdrawalId: string,
  ): Promise<{ format: string; base64: string; endToEndId?: string }> {
    const withdrawal = await this.prisma.withdrawalRequest.findUnique({
      where: { id: withdrawalId },
      select: {
        id: true,
        userId: true,
        status: true,
        gatewayId: true,
        gatewayProvider: true,
        gatewayEndToEnd: true,
        gatewayReceiptBase64: true,
        gatewayReceiptFormat: true,
      },
    });
    if (!withdrawal) {
      throw new NotFoundException('Solicitação de saque não encontrada.');
    }

    const isAdmin =
      user.role === UserRole.ADMIN || user.role === UserRole.SUPERADMIN;
    if (!isAdmin && withdrawal.userId !== user.sub) {
      throw new ForbiddenException('Acesso negado.');
    }

    if (
      withdrawal.status !== WithdrawalStatus.COMPLETED &&
      withdrawal.status !== WithdrawalStatus.FAILED
    ) {
      throw new BadRequestException(
        `Comprovante disponível apenas para saques COMPLETED ou FAILED (atual: ${withdrawal.status}).`,
      );
    }

    // Prefer cached receipt persisted at webhook time.
    if (withdrawal.gatewayReceiptBase64 && withdrawal.gatewayReceiptFormat) {
      return {
        format: withdrawal.gatewayReceiptFormat,
        base64: withdrawal.gatewayReceiptBase64,
        ...(withdrawal.gatewayEndToEnd
          ? { endToEndId: withdrawal.gatewayEndToEnd }
          : {}),
      };
    }

    // Fall back to live fetch + opportunistic persist (e.g. legacy rows that
    // completed before the receipt-caching code shipped).
    const identifier = withdrawal.gatewayId ?? withdrawal.id;
    const result = await this.paymentGateway.getReceipt(identifier);
    if (!result.ok) {
      throw new HttpException(
        `Não foi possível obter o comprovante: ${result.reason}`,
        result.statusCode ?? HttpStatus.BAD_GATEWAY,
      );
    }
    if (result.receipt.base64.length <= MAX_RECEIPT_BASE64_BYTES) {
      await this.prisma.withdrawalRequest
        .updateMany({
          // Conditional write — avoid overwriting a cache populated by the
          // webhook-side fetchAndPersistReceipt running in parallel.
          where: { id: withdrawal.id, gatewayReceiptBase64: null },
          data: {
            gatewayReceiptBase64: result.receipt.base64,
            gatewayReceiptFormat: result.receipt.format,
            gatewayReceiptFetchedAt: new Date(),
          },
        })
        .catch(() => undefined);
    }

    return {
      format: result.receipt.format,
      base64: result.receipt.base64,
      ...(result.receipt.endToEndId
        ? { endToEndId: result.receipt.endToEndId }
        : {}),
    };
  }

  /**
   * Gera o comprovante PIX LOCALMENTE (a Vorexy não fornece comprovante) e
   * armazena como PNG base64 inline — reaproveitando todo o pipeline de
   * comprovante existente (download no painel + envio ao grupo WhatsApp via
   * URL assinada). Fire-and-forget: qualquer erro é logado e ignorado.
   */
  private async fetchAndPersistReceipt(withdrawalId: string): Promise<void> {
    const w = await this.prisma.withdrawalRequest.findUnique({
      where: { id: withdrawalId },
      select: {
        gatewayReceiptBase64: true,
        amount: true,
        pixKey: true,
        gatewayEndToEnd: true,
        gatewayReceiver: true,
        gatewayResponse: true,
        gatewayCompletedAt: true,
        createdAt: true,
        user: { select: { name: true } },
      },
    });
    if (!w || w.gatewayReceiptBase64) return;

    // Dados ricos vêm do payload do webhook (salvo em gatewayResponse).
    const ev = this.extractWebhookEventData(w.gatewayResponse);
    const receiver = (w.gatewayReceiver ?? {}) as {
      name?: string | null;
      document?: string | null;
    };

    const data: ReceiptData = {
      amountReais: w.amount.toNumber(),
      statusLabel: 'Concluída',
      dateLabel: new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'medium',
        timeZone: 'America/Sao_Paulo',
      }).format(w.gatewayCompletedAt ?? w.createdAt),
      clienteNome: receiver.name ?? w.user?.name ?? '—',
      clienteDoc: receiver.document ?? '—',
      pixKey: w.pixKey,
      endToEndId: w.gatewayEndToEnd ?? ev?.endToEndId ?? null,
      paymentId: ev?.providerPaymentId ?? null,
      transactionId: ev?.providerTransactionId ?? null,
      userId: ev?.userId ?? null,
    };

    let base64: string;
    try {
      const png = await this.receiptGenerator.renderPng(data);
      base64 = png.toString('base64');
    } catch (err) {
      this.logger.warn(
        `Falha ao gerar comprovante do saque ${withdrawalId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    if (base64.length > MAX_RECEIPT_BASE64_BYTES) {
      this.logger.warn(
        `Comprovante gerado grande demais para o saque ${withdrawalId} (${base64.length} bytes); pulando cache`,
      );
      return;
    }

    // Escrita condicional — só grava se ainda não houver comprovante.
    await this.prisma.withdrawalRequest.updateMany({
      where: { id: withdrawalId, gatewayReceiptBase64: null },
      data: {
        gatewayReceiptBase64: base64,
        gatewayReceiptFormat: 'png',
        gatewayReceiptFetchedAt: new Date(),
      },
    });
  }

  /** Extrai o HeartPayPayoutEventData de um gatewayResponse persistido. */
  private extractWebhookEventData(
    gatewayResponse: unknown,
  ): HeartPayPayoutEventData | undefined {
    if (!gatewayResponse || typeof gatewayResponse !== 'object')
      return undefined;
    const payload = gatewayResponse as { data?: { data?: unknown } };
    const ev = payload?.data?.data;
    return ev && typeof ev === 'object'
      ? (ev as HeartPayPayoutEventData)
      : undefined;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async markFailed(
    withdrawalId: string,
    reason: string,
    response: unknown,
    requestPayload?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.withdrawalRequest.updateMany({
      where: {
        id: withdrawalId,
        status: {
          in: [WithdrawalStatus.APPROVED, WithdrawalStatus.PROCESSING],
        },
      },
      data: {
        status: WithdrawalStatus.FAILED,
        gatewayProvider: this.paymentGateway.getActiveProvider(),
        gatewayFailureReason: reason.slice(0, 1000),
        ...(response !== null && response !== undefined
          ? { gatewayResponse: response as Prisma.InputJsonValue }
          : {}),
        ...(requestPayload !== undefined
          ? { gatewayRequest: requestPayload as Prisma.InputJsonValue }
          : {}),
      },
    });
  }

  private writeAuditLog(input: {
    userId: string;
    userName: string;
    userEmail: string;
    adminUserId: string | null;
    action: string;
    method: string;
    path: string;
    statusCode: number;
    details: Record<string, unknown>;
  }): void {
    this.prisma.auditLog
      .create({
        data: {
          userId: input.adminUserId ?? input.userId,
          userName: input.userName,
          userEmail: input.userEmail,
          action: input.action,
          resource: '/withdrawals',
          method: input.method,
          path: input.path,
          statusCode: input.statusCode,
          details: input.details as Prisma.InputJsonValue,
        },
      })
      .catch((err) =>
        this.logger.warn(
          `AuditLog failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
  }

  /**
   * Pulls the existing payout reference_code out of HeartPay's 409 body so we
   * can adopt the in-flight payout as our gatewayId and wait for the webhook
   * instead of marking FAILED. Tolerates several shapes of response.
   */
  private extractExistingReferenceCode(body: unknown): string | null {
    if (!body || typeof body !== 'object') return null;
    const b = body as Record<string, unknown>;
    const direct = b['existing_reference_code'] ?? b['existingReferenceCode'];
    if (typeof direct === 'string' && direct.length > 0) return direct;
    const data = b['data'];
    if (data && typeof data === 'object') {
      const nested = (data as Record<string, unknown>)['reference_code'];
      if (typeof nested === 'string' && nested.length > 0) return nested;
    }
    return null;
  }

  private redact(value: unknown): unknown {
    if (!value || typeof value !== 'object') return value;
    const clone = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
    for (const key of Object.keys(clone)) {
      if (/secret|password|key|token/i.test(key)) clone[key] = '[REDACTED]';
    }
    return clone;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /v1/withdrawals/rules
  // Per-casa cadence + per-casa available balance for the caller.
  // ─────────────────────────────────────────────────────────────────────────

  async listWithdrawalRules(user: JwtPayload): Promise<
    Array<{
      slug: string;
      name: string;
      frequencyLabel: string;
      allowedToday: boolean;
      nextWithdrawalDate: string | null;
      availableBalance: number;
      minCpaToWithdraw: number;
      minWithdrawalAmount: number;
      cpaCount: number;
      withdrawalEnabled: boolean;
      dayReleaseAvailable: boolean;
      financialBalance: number;
      netPl: number | null;
      netPlWithdrawalLimit: number | null;
      netPlLimitConsumed: number;
      withdrawalRestriction:
        | 'METRICS_SYNCING'
        | 'NET_PL_NON_POSITIVE'
        | 'NET_PL_CAP'
        | null;
    }>
  > {
    const [houses, balanceData] = await Promise.all([
      this.prisma.bettingHouse.findMany({
        // 'bonus' é casa virtual — tratada pelo push abaixo. Excluir a casa real
        // 'bonus' aqui evita DUAS entradas de bônus nas regras (card duplicado).
        where: { active: true, NOT: { slug: 'bonus' } },
        select: {
          slug: true,
          name: true,
          withdrawalDay: true,
          withdrawalDayEnd: true,
          withdrawalDay2: true,
          withdrawalDay2End: true,
          withdrawalWeekday: true,
          minCpaToWithdraw: true,
          minWithdrawalAmount: true,
          withdrawalEnabled: true,
        },
        orderBy: { name: 'asc' },
      }),
      this.balanceService.getBalance(user, {}),
    ]);

    // Map per-house earnings (own + network − fraud) by slug.
    const balanceBySlug = new Map<
      string,
      (typeof balanceData.perHouse)[number]
    >();
    for (const h of balanceData.perHouse) {
      balanceBySlug.set(h.house, h);
    }

    // Qualified CPA count per house (own production + network downline), to
    // gate houses that require a minimum (e.g. hiperbet ≥ 10).
    const cpaCountBySlug = await this.totalCpaQualifiedByHouse(user.sub);

    // Liberações de saque EXTRA não consumidas hoje (admin bypass do 1/dia/casa).
    // Sem isso o frontend trava a casa em "já sacou hoje" e o usuário nunca chega
    // a submeter o 2º saque que consumiria a liberação.
    const releaseStartOfDay = new Date();
    releaseStartOfDay.setHours(0, 0, 0, 0);
    const releases = await this.prisma.withdrawalDayRelease.findMany({
      where: {
        userId: user.sub,
        releaseDate: { gte: releaseStartOfDay },
        consumedAt: null,
      },
      select: { bettingHouse: true },
    });
    const releasedSlugs = new Set(releases.map((r) => r.bettingHouse));

    // Bonus is its own virtual casa: bonusBalance minus active bonus withdrawals.
    const bonusWd = await this.prisma.withdrawalRequest.aggregate({
      where: {
        userId: user.sub,
        bettingHouse: 'bonus',
        status: {
          in: [
            WithdrawalStatus.PENDING,
            WithdrawalStatus.APPROVED,
            WithdrawalStatus.PROCESSING,
            WithdrawalStatus.COMPLETED,
          ],
        },
      },
      _sum: { originalAmount: true, gatewayRefundedAmount: true },
    });
    const bonusAvailable = Math.max(
      0,
      balanceData.bonusBalance -
        ((bonusWd._sum.originalAmount?.toNumber() ?? 0) -
          (bonusWd._sum.gatewayRefundedAmount?.toNumber() ?? 0)),
    );

    // Per-casa available = saldo líquido isolado de cada casa (own + rede −
    // saques tagueados da casa − fraude), pós-corte. Sem rateio global.
    const now = new Date();
    const rules: Array<{
      slug: string;
      name: string;
      frequencyLabel: string;
      allowedToday: boolean;
      nextWithdrawalDate: string | null;
      availableBalance: number;
      minCpaToWithdraw: number;
      minWithdrawalAmount: number;
      cpaCount: number;
      withdrawalEnabled: boolean;
      dayReleaseAvailable: boolean;
      financialBalance: number;
      netPl: number | null;
      netPlWithdrawalLimit: number | null;
      netPlLimitConsumed: number;
      withdrawalRestriction:
        | 'METRICS_SYNCING'
        | 'NET_PL_NON_POSITIVE'
        | 'NET_PL_CAP'
        | null;
    }> = houses.map((h) => {
      const houseBalance = balanceBySlug.get(h.slug);
      const available = Math.max(
        0,
        houseBalance?.withdrawable ?? houseBalance?.total ?? 0,
      );
      const allowed = isWithdrawalDayAllowed(h, now);
      const next = nextWithdrawalDate(h, now);
      return {
        slug: h.slug,
        name: h.name,
        frequencyLabel: describeFrequency(h),
        allowedToday: allowed,
        nextWithdrawalDate: next ? next.toISOString() : null,
        availableBalance: parseFloat(available.toFixed(2)),
        minCpaToWithdraw: h.minCpaToWithdraw,
        // Mínimo por casa (null = global).
        minWithdrawalAmount:
          h.minWithdrawalAmount?.toNumber() ?? balanceData.minWithdrawalAmount,
        cpaCount: cpaCountBySlug.get(h.slug) ?? 0,
        withdrawalEnabled: h.withdrawalEnabled,
        dayReleaseAvailable: releasedSlugs.has(h.slug),
        financialBalance: Math.max(0, houseBalance?.total ?? 0),
        netPl: houseBalance?.netPl ?? null,
        netPlWithdrawalLimit: houseBalance?.netPlWithdrawalLimit ?? null,
        netPlLimitConsumed: houseBalance?.netPlLimitConsumed ?? 0,
        withdrawalRestriction: houseBalance?.withdrawalRestriction ?? null,
      };
    });

    // Append the virtual 'bonus' casa (always available, no cadence/CPA gate).
    if (bonusAvailable > 0) {
      rules.push({
        slug: 'bonus',
        name: 'Bônus',
        frequencyLabel: 'Diário',
        allowedToday: true,
        nextWithdrawalDate: null,
        availableBalance: parseFloat(bonusAvailable.toFixed(2)),
        minCpaToWithdraw: 0,
        minWithdrawalAmount: 0,
        cpaCount: 0,
        withdrawalEnabled: true,
        dayReleaseAvailable: false,
        financialBalance: bonusAvailable,
        netPl: null,
        netPlWithdrawalLimit: null,
        netPlLimitConsumed: 0,
        withdrawalRestriction: null,
      });
    }

    return rules;
  }

  /**
   * Qualified CPA count per house for the affiliate's own production (sum of
   * affiliate_data.cpaQualified across the user's links, grouped by house).
   */
  private async cpaQualifiedByHouse(
    userId: string,
  ): Promise<Map<string, number>> {
    const links = await this.prisma.affiliateLink.findMany({
      where: { userId },
      select: { campaignId: true },
    });
    const campaignIds = links.map((l) => l.campaignId);
    const result = new Map<string, number>();
    if (campaignIds.length === 0) return result;

    const rows = await this.prisma.affiliateData.groupBy({
      by: ['bettingHouse'],
      where: { campaignId: { in: campaignIds } },
      _sum: { cpaQualified: true },
    });
    for (const r of rows) {
      result.set(r.bettingHouse, r._sum.cpaQualified ?? 0);
    }
    return result;
  }

  /**
   * Qualified CPA count per house produced by the affiliate's NETWORK (downline,
   * up to the configured level cap). Sums `affiliateData.cpaQualified` over all
   * downline members' links, grouped by house. Reuses the BFS downline walk in
   * {@link DashboardBalanceService.loadNetworkMembers}.
   */
  private async networkCpaQualifiedByHouse(
    userId: string,
  ): Promise<Map<string, number>> {
    const members = await this.balanceService.loadNetworkMembers(userId);
    const campaignIds = [
      ...new Set(members.flatMap((m) => m.links.map((l) => l.campaignId))),
    ];
    const result = new Map<string, number>();
    if (campaignIds.length === 0) return result;

    const rows = await this.prisma.affiliateData.groupBy({
      by: ['bettingHouse'],
      where: { campaignId: { in: campaignIds } },
      _sum: { cpaQualified: true },
    });
    for (const r of rows) {
      result.set(r.bettingHouse, r._sum.cpaQualified ?? 0);
    }
    return result;
  }

  /**
   * Total qualified CPA per house = own production + network downline. Used to
   * gate houses with a `minCpaToWithdraw` requirement — o mínimo é atingível
   * pela produção da rede, não só pela individual.
   */
  private async totalCpaQualifiedByHouse(
    userId: string,
  ): Promise<Map<string, number>> {
    const [own, network] = await Promise.all([
      this.cpaQualifiedByHouse(userId),
      this.networkCpaQualifiedByHouse(userId),
    ]);
    const result = new Map(own);
    for (const [house, count] of network) {
      result.set(house, (result.get(house) ?? 0) + count);
    }
    return result;
  }

  private toListItem(
    w: Prisma.WithdrawalRequestGetPayload<{
      include: {
        user: { select: { name: true; email: true } };
        approvedBy: { select: { name: true; email: true } };
      };
    }>,
  ): WithdrawalListItem {
    const originalAmount = w.originalAmount.toNumber();
    const refundedAmount = w.gatewayRefundedAmount?.toNumber() ?? null;
    return {
      id: w.id,
      userId: w.userId,
      userName: w.user.name,
      userEmail: w.user.email,
      amount: w.amount.toNumber(),
      originalAmount,
      withdrawalFee: w.withdrawalFee.toNumber(),
      bettingHouse: w.bettingHouse,
      pixKeyType: w.pixKeyType,
      pixKey: w.pixKey,
      accountHolder: w.accountHolder,
      status: w.status,
      requestNote: w.requestNote,
      adminNote: w.adminNote,
      gatewayFailureReason: w.gatewayFailureReason,
      approvedAt: w.approvedAt,
      approvedByName: w.approvedBy?.name ?? null,
      approvedByEmail: w.approvedBy?.email ?? null,
      createdAt: w.createdAt,
      hasReceipt: w.gatewayReceiptFormat !== null,
      refundedAmount,
      refundState: deriveRefundState(originalAmount, refundedAmount),
    };
  }
}
