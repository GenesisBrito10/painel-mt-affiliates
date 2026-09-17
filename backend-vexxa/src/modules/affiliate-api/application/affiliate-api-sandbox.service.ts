import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import type {
  AffiliateApiCreateLinkRequestDto,
  AffiliateApiCreateWithdrawalDto,
  AffiliateApiListWithdrawalsQueryDto,
  AffiliateApiMetricsQueryDto,
  AffiliateApiUpdateWithdrawalStatusDto,
  AffiliateApiUserQueryDto,
  IAffiliateApiOps,
} from './dto/affiliate-api.dto.js';

// ── Sandbox payload shapes (stored as JSON in affiliate_api_sandbox_records) ──
type SandboxUser = {
  externalId: string;
  name: string;
  email: string;
  status: string;
  createdAt: string;
};

type SandboxWithdrawal = {
  id: string;
  externalUserId: string;
  bettingHouse: string;
  amount: number;
  originalAmount: number;
  withdrawalFee: number;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'REJECTED';
  requestNote: string;
  createdAt: string;
  updatedAt: string;
};

const SEED_BALANCE = 1000; // deterministic per-house seed so withdrawals have funds
const DEFAULT_HOUSE = 'superbet';
const ACTIVE: SandboxWithdrawal['status'][] = [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
];
const TRANSITIONS: Record<
  'processing' | 'completed' | 'rejected',
  { to: SandboxWithdrawal['status']; from: SandboxWithdrawal['status'][] }
> = {
  processing: { to: 'PROCESSING', from: ['PENDING'] },
  completed: { to: 'COMPLETED', from: ['PENDING', 'PROCESSING'] },
  rejected: { to: 'REJECTED', from: ['PENDING', 'PROCESSING'] },
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * SANDBOX (test mode) implementation of the affiliate-API. Writes ONLY to
 * `affiliate_api_sandbox_records` — never to User / WithdrawalRequest /
 * AffiliateData — so test data is structurally isolated from production
 * balances, network earnings, admin views, rankings, metrics, and payouts.
 * Realistic responses + a per-token reset; nothing real persists.
 */
@Injectable()
export class AffiliateApiSandboxService implements IAffiliateApiOps {
  constructor(private readonly prisma: PrismaService) {}

  async createLinkRequestFromApi(
    ownerUserId: string,
    dto: AffiliateApiCreateLinkRequestDto,
  ) {
    const externalId = dto.externalUserId?.trim();
    if (!externalId) {
      throw new BadRequestException('externalUserId é obrigatório');
    }
    const user = await this.ensureSandboxUser(ownerUserId, externalId, {
      name: dto.userName,
      email: dto.userEmail,
    });
    return {
      id: `sbx_lr_${randomUUID()}`,
      status: 'PENDING',
      bettingHouseSlug: dto.bettingHouseSlug?.trim().toLowerCase() ?? null,
      dealId: dto.dealId ?? null,
      message: dto.message ?? null,
      createdAt: new Date().toISOString(),
      requester: {
        id: `sbx_${externalId}`,
        externalId,
        name: user.name,
        email: user.email,
      },
      sandbox: true,
    };
  }

  async getExternalUser(
    ownerUserId: string,
    externalUserId: string,
    query: AffiliateApiUserQueryDto,
  ) {
    const user = await this.getSandboxUser(ownerUserId, externalUserId);
    if (!user) {
      throw new NotFoundException('Usuário externo não encontrado (sandbox)');
    }
    const balance = await this.computeBalance(
      ownerUserId,
      externalUserId,
      query.bettingHouse?.trim().toLowerCase(),
    );
    return {
      user: {
        externalUserId: user.externalId,
        name: user.name,
        email: user.email,
        status: user.status,
        createdAt: user.createdAt,
      },
      balance,
      sandbox: true,
    };
  }

  async createWithdrawalFromApi(
    ownerUserId: string,
    dto: AffiliateApiCreateWithdrawalDto,
  ) {
    const externalId = dto.externalUserId?.trim();
    if (!externalId) {
      throw new BadRequestException('externalUserId é obrigatório');
    }
    const bettingHouse = dto.bettingHouse?.trim().toLowerCase();
    if (!bettingHouse) {
      throw new BadRequestException('bettingHouse é obrigatório.');
    }
    if (bettingHouse === 'bonus') {
      throw new BadRequestException('Saque de bônus não é suportado via API.');
    }

    await this.ensureSandboxUser(ownerUserId, externalId);
    const withdrawals = await this.loadWithdrawals(ownerUserId, externalId);

    // 1 saque por DIA por casa (mesma regra do fluxo live) — só conta o que foi
    // criado hoje em status ativo; saques de dias anteriores não bloqueiam.
    const today = new Date().toISOString().slice(0, 10);
    const hasToday = withdrawals.some(
      (w) =>
        w.bettingHouse === bettingHouse &&
        ACTIVE.includes(w.status) &&
        w.createdAt.slice(0, 10) === today,
    );
    if (hasToday) {
      throw new HttpException(
        'Limite de 1 saque por dia para esta casa atingido. Tente novamente amanhã.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const available = this.houseAvailable(withdrawals, bettingHouse);
    if (available <= 0) {
      throw new BadRequestException(
        'Sem saldo disponível para saque nesta casa.',
      );
    }

    const originalAmount = round2(available);
    const now = new Date().toISOString();
    const withdrawal: SandboxWithdrawal = {
      id: randomUUID(),
      externalUserId: externalId,
      bettingHouse,
      amount: originalAmount,
      originalAmount,
      withdrawalFee: 0,
      status: 'PENDING',
      requestNote: dto.requestNote?.trim() ?? '',
      createdAt: now,
      updatedAt: now,
    };

    await this.prisma.affiliateApiSandboxRecord.create({
      data: {
        ownerUserId,
        kind: 'withdrawal',
        externalId,
        refId: withdrawal.id,
        payload: withdrawal as unknown as Prisma.InputJsonValue,
      },
    });

    const balance = await this.computeBalance(ownerUserId, externalId);
    return { withdrawal, balance, sandbox: true };
  }

  async listWithdrawalsFromApi(
    ownerUserId: string,
    query: AffiliateApiListWithdrawalsQueryDto,
  ) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));

    let items = await this.loadWithdrawals(
      ownerUserId,
      query.externalUserId?.trim(),
    );

    const status = query.status?.toUpperCase();
    if (status) items = items.filter((w) => w.status === status);
    if (query.bettingHouse) {
      const house = query.bettingHouse.trim().toLowerCase();
      items = items.filter((w) => w.bettingHouse === house);
    }
    if (query.startDate)
      items = items.filter((w) => w.createdAt >= `${query.startDate}T00:00:00`);
    if (query.endDate)
      items = items.filter((w) => w.createdAt <= `${query.endDate}T23:59:59`);

    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const total = items.length;
    const data = items.slice((page - 1) * limit, (page - 1) * limit + limit);
    return { data, total, page, limit, sandbox: true };
  }

  async getWithdrawalFromApi(ownerUserId: string, withdrawalId: string) {
    const rec = await this.findWithdrawalRecord(ownerUserId, withdrawalId);
    if (!rec) {
      throw new NotFoundException('Solicitação de saque não encontrada.');
    }
    return rec.payload as unknown as SandboxWithdrawal;
  }

  async setWithdrawalStatusFromApi(
    ownerUserId: string,
    withdrawalId: string,
    dto: AffiliateApiUpdateWithdrawalStatusDto,
  ) {
    const transition = TRANSITIONS[dto.status];
    if (!transition) {
      throw new BadRequestException(`Status inválido: ${dto.status}`);
    }
    const rec = await this.findWithdrawalRecord(ownerUserId, withdrawalId);
    if (!rec) {
      throw new NotFoundException('Solicitação de saque não encontrada.');
    }
    const wd = rec.payload as unknown as SandboxWithdrawal;
    if (!transition.from.includes(wd.status)) {
      throw new BadRequestException(
        `Transição inválida: ${wd.status} → ${transition.to}.`,
      );
    }
    wd.status = transition.to;
    wd.updatedAt = new Date().toISOString();
    if (dto.note !== undefined) wd.requestNote = dto.note;
    await this.prisma.affiliateApiSandboxRecord.update({
      where: { id: rec.id },
      data: { payload: wd as unknown as Prisma.InputJsonValue },
    });
    return wd;
  }

  /** Deterministic realistic sample metrics — no production data touched. */
  async getMetrics(ownerUserId: string, query: AffiliateApiMetricsQueryDto) {
    const houseSlug = query.houseSlug ?? 'superbet';
    const summary = {
      clicks: 1200,
      registrations: 180,
      ftds: 60,
      deposits: 60,
      depositAmount: 9000,
      revShare: 0,
      qualifiedCpa: 34,
      cpaAmount: 3400,
      totalCommission: 4420,
    };
    return {
      filters: {
        startDate: query.startDate ?? null,
        endDate: query.endDate ?? null,
        houseSlug: query.houseSlug ?? null,
        affiliateId: query.affiliateId ?? null,
      },
      scope: { ownerUserId, includedAffiliateIds: [ownerUserId] },
      summary,
      records: [
        {
          date: '2026-06-22',
          houseSlug,
          houseName: houseSlug,
          affiliateId: ownerUserId,
          affiliateName: 'Sandbox',
          affiliateEmail: 'sandbox@example.com',
          level: 0,
          ...summary,
        },
      ],
      byHouse: [{ houseSlug, houseName: houseSlug, ...summary }],
      byDay: [{ date: '2026-06-22', ...summary }],
      byAffiliate: [
        {
          affiliateId: ownerUserId,
          affiliateName: 'Sandbox',
          affiliateEmail: 'sandbox@example.com',
          level: 0,
          ...summary,
        },
      ],
      sandbox: true,
    };
  }

  /** Wipe ALL sandbox data for this owner (test reset). */
  async reset(ownerUserId: string) {
    const { count } = await this.prisma.affiliateApiSandboxRecord.deleteMany({
      where: { ownerUserId },
    });
    return { success: true, deleted: count, sandbox: true };
  }

  // ── helpers ────────────────────────────────────────────────────────────

  private async getSandboxUser(
    ownerUserId: string,
    externalId: string,
  ): Promise<SandboxUser | null> {
    const rec = await this.prisma.affiliateApiSandboxRecord.findFirst({
      where: { ownerUserId, kind: 'user', externalId: externalId.trim() },
    });
    return rec ? (rec.payload as unknown as SandboxUser) : null;
  }

  private async ensureSandboxUser(
    ownerUserId: string,
    externalId: string,
    contact?: { name?: string; email?: string },
  ): Promise<SandboxUser> {
    const existing = await this.getSandboxUser(ownerUserId, externalId);
    if (existing) return existing;
    const user: SandboxUser = {
      externalId,
      name: contact?.name?.trim() || `External ${externalId}`,
      email:
        contact?.email?.trim().toLowerCase() ||
        `ext.${externalId}@sandbox.vallex.local`,
      status: 'APPROVED',
      createdAt: new Date().toISOString(),
    };
    await this.prisma.affiliateApiSandboxRecord.create({
      data: {
        ownerUserId,
        kind: 'user',
        externalId,
        payload: user as unknown as Prisma.InputJsonValue,
      },
    });
    return user;
  }

  private async loadWithdrawals(
    ownerUserId: string,
    externalId?: string,
  ): Promise<SandboxWithdrawal[]> {
    const recs = await this.prisma.affiliateApiSandboxRecord.findMany({
      where: {
        ownerUserId,
        kind: 'withdrawal',
        ...(externalId ? { externalId } : {}),
      },
    });
    return recs.map((r) => r.payload as unknown as SandboxWithdrawal);
  }

  private async findWithdrawalRecord(
    ownerUserId: string,
    withdrawalId: string,
  ) {
    return this.prisma.affiliateApiSandboxRecord.findFirst({
      where: { ownerUserId, kind: 'withdrawal', refId: withdrawalId },
    });
  }

  /** Available = seed − active (PENDING/PROCESSING/COMPLETED) withdrawals. */
  private houseAvailable(
    withdrawals: SandboxWithdrawal[],
    house: string,
  ): number {
    const used = withdrawals
      .filter((w) => w.bettingHouse === house && ACTIVE.includes(w.status))
      .reduce((sum, w) => sum + w.originalAmount, 0);
    return Math.max(0, SEED_BALANCE - used);
  }

  private async computeBalance(
    ownerUserId: string,
    externalId: string,
    house?: string,
  ) {
    const withdrawals = await this.loadWithdrawals(ownerUserId, externalId);
    const houses = new Set<string>();
    if (house) houses.add(house);
    for (const w of withdrawals) houses.add(w.bettingHouse);
    if (houses.size === 0) houses.add(DEFAULT_HOUSE);

    const perHouse = [...houses].map((h) => ({
      house: h,
      total: this.houseAvailable(withdrawals, h),
    }));
    const total = round2(perHouse.reduce((sum, h) => sum + h.total, 0));

    return {
      balance: total,
      withdrawableTotal: total,
      minWithdrawalAmount: 100,
      withdrawalFee: 0,
      withdrawalFeeRate: 0,
      bonusAvailable: 0,
      perHouse,
      depositInfo: { belowMinimum: false },
      sandbox: true,
    };
  }
}
