import { Injectable } from '@nestjs/common';
import {
  Prisma,
  WhatsappSendStatus,
  type WhatsappSendLog,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { WhatsappProofProducer } from '../infrastructure/queues/whatsapp-proof.producer.js';
import { WhatsappSettingsService } from './whatsapp-settings.service.js';
import {
  WhatsappRetryNotAllowedException,
  WhatsappSendLogNotFoundException,
} from '../domain/exceptions/whatsapp.exceptions.js';

export interface ListHistoryQuery {
  status?: WhatsappSendStatus;
  from?: string; // ISO date
  to?: string; // ISO date
  search?: string; // userName/email
  page?: number;
  limit?: number;
}

const RETRYABLE: WhatsappSendStatus[] = [
  WhatsappSendStatus.FAILED,
  WhatsappSendStatus.CANCELLED,
  WhatsappSendStatus.WAITING_CONNECTION,
  WhatsappSendStatus.PAUSED,
];

@Injectable()
export class WhatsappSendHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly producer: WhatsappProofProducer,
    private readonly settingsService: WhatsappSettingsService,
  ) {}

  // ─── Listagem com filtros + paginação ─────────────────────────────────────

  async list(query: ListHistoryQuery): Promise<{
    data: WhatsappSendLog[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));

    const where: Prisma.WhatsappSendLogWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }
    if (query.search && query.search.trim()) {
      const s = query.search.trim();
      where.OR = [
        { userName: { contains: s, mode: 'insensitive' } },
        { userEmail: { contains: s, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.whatsappSendLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.whatsappSendLog.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async getById(id: string): Promise<WhatsappSendLog> {
    const log = await this.prisma.whatsappSendLog.findUnique({ where: { id } });
    if (!log) throw new WhatsappSendLogNotFoundException(id);
    return log;
  }

  // ─── Retry manual ──────────────────────────────────────────────────────────

  async retry(id: string, adminId: string): Promise<WhatsappSendLog> {
    const log = await this.getById(id);
    if (!RETRYABLE.includes(log.status)) {
      throw new WhatsappRetryNotAllowedException(log.status);
    }
    await this.producer.enqueueRetry(log, adminId);
    return this.getById(id);
  }

  // ─── Métricas ──────────────────────────────────────────────────────────────

  async metrics(): Promise<{
    total: number;
    sent: number;
    failed: number;
    pending: number;
    waitingConnection: number;
    paused: number;
    cancelled: number;
    successRate: number;
    lastSentAt: Date | null;
    lastFailureAt: Date | null;
    connectionStatus: string;
    circuitOpenUntil: Date | null;
  }> {
    const grouped = await this.prisma.whatsappSendLog.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const count = (s: WhatsappSendStatus): number =>
      grouped.find((g) => g.status === s)?._count._all ?? 0;

    const sent = count(WhatsappSendStatus.SENT);
    const failed = count(WhatsappSendStatus.FAILED);
    const pending =
      count(WhatsappSendStatus.PENDING) + count(WhatsappSendStatus.PROCESSING);
    const waiting = count(WhatsappSendStatus.WAITING_CONNECTION);
    const paused = count(WhatsappSendStatus.PAUSED);
    const cancelled = count(WhatsappSendStatus.CANCELLED);
    const total = sent + failed + pending + waiting + paused + cancelled;
    const finished = sent + failed;

    const [lastSent, lastFailure, state] = await Promise.all([
      this.prisma.whatsappSendLog.findFirst({
        where: { status: WhatsappSendStatus.SENT },
        orderBy: { sentAt: 'desc' },
        select: { sentAt: true },
      }),
      this.prisma.whatsappSendLog.findFirst({
        where: { status: WhatsappSendStatus.FAILED },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      }),
      this.settingsService.getConnectionState(),
    ]);

    return {
      total,
      sent,
      failed,
      pending,
      waitingConnection: waiting,
      paused,
      cancelled,
      successRate: finished > 0 ? Math.round((sent / finished) * 100) : 0,
      lastSentAt: lastSent?.sentAt ?? null,
      lastFailureAt: lastFailure?.updatedAt ?? null,
      connectionStatus: state.status,
      circuitOpenUntil: state.circuitOpenUntil,
    };
  }
}
