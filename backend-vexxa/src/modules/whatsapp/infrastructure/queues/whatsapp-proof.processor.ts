import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { WhatsappSendStatus, type Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { WhatsappSettingsService } from '../../application/whatsapp-settings.service.js';
import { WhatsappProofService } from '../../application/whatsapp-proof.service.js';
import { WhatsappConnectionService } from '../../application/whatsapp-connection.service.js';
import {
  WhatsappProofProducer,
  type SendProofJobData,
} from './whatsapp-proof.producer.js';
import {
  SEND_PROOF_JOB,
  STATUS_POLL_JOB,
  WHATSAPP_QUEUE,
} from '../../domain/types/whatsapp.types.js';

@Processor(WHATSAPP_QUEUE, {
  concurrency: 1,
  limiter: { max: 1, duration: 20_000 },
})
export class WhatsappProofProcessor extends WorkerHost {
  private readonly logger = new Logger(WhatsappProofProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: WhatsappSettingsService,
    private readonly proofService: WhatsappProofService,
    private readonly connectionService: WhatsappConnectionService,
    private readonly producer: WhatsappProofProducer,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case SEND_PROOF_JOB:
        return this.handleSend(job as Job<SendProofJobData>);
      case STATUS_POLL_JOB:
        return this.handleStatusPoll();
      default:
        this.logger.warn(`Job desconhecido: ${job.name}`);
    }
  }

  // ─── Status poll ─────────────────────────────────────────────────────────

  private async handleStatusPoll(): Promise<void> {
    await this.connectionService.syncStatus();
  }

  // ─── Envio de comprovante ───────────────────────────────────────────────

  private async handleSend(job: Job<SendProofJobData>): Promise<void> {
    const { logId } = job.data;
    const log = await this.prisma.whatsappSendLog.findUnique({
      where: { id: logId },
    });
    if (!log) {
      this.logger.warn(`Log ${logId} não encontrado — skip`);
      return;
    }
    if (
      log.status === WhatsappSendStatus.SENT ||
      log.status === WhatsappSendStatus.CANCELLED
    ) {
      return; // idempotente
    }

    const settings = await this.settingsService.getSettings();
    const state = await this.settingsService.getConnectionState();
    const now = new Date();

    // 1. Desabilitado / sem grupo → CANCELLED (não consome tentativa).
    const groupId = log.groupId ?? settings.selectedGroupId;
    if (!settings.enabled || !groupId) {
      await this.mark(logId, WhatsappSendStatus.CANCELLED, {
        lastError: !settings.enabled
          ? 'Envios automáticos desabilitados.'
          : 'Nenhum grupo selecionado.',
      });
      return;
    }

    // 2. Circuit breaker aberto → PAUSED + reagenda (sem consumir tentativa).
    if (
      state.circuitOpenUntil &&
      state.circuitOpenUntil.getTime() > now.getTime()
    ) {
      await this.mark(logId, WhatsappSendStatus.PAUSED, {
        pausedSince: log.pausedSince ?? now,
      });
      const delay = Math.max(
        1000,
        state.circuitOpenUntil.getTime() - now.getTime(),
      );
      await this.producer.reschedule(logId, delay);
      return;
    }

    // 3. Desconectado → WAITING_CONNECTION + reagenda (com teto).
    if (state.status !== 'open') {
      const waitingSince = log.waitingConnectionSince ?? now;
      const elapsedMin = (now.getTime() - waitingSince.getTime()) / 60_000;
      if (elapsedMin > settings.maxWaitConnectionMinutes) {
        await this.mark(logId, WhatsappSendStatus.FAILED, {
          lastError: 'Tempo máximo aguardando conexão do WhatsApp excedido.',
        });
        return;
      }
      await this.mark(logId, WhatsappSendStatus.WAITING_CONNECTION, {
        waitingConnectionSince: waitingSince,
      });
      const delay = Math.max(settings.delayMaxSeconds, 60) * 1000;
      await this.producer.reschedule(logId, delay);
      return;
    }

    // 4. Conectado → tentativa REAL de envio.
    await this.mark(logId, WhatsappSendStatus.PROCESSING, {
      waitingConnectionSince: null,
      pausedSince: null,
      attempts: { increment: 1 },
    });

    const message = this.proofService.renderMessage(log, settings);

    try {
      const result = await this.proofService.deliver({
        groupId,
        caption: message,
        withdrawalId: log.withdrawalId,
        isTest: log.isTest,
        receiptWithdrawalId: job.data.testReceiptWithdrawalId ?? null,
      });

      await this.prisma.whatsappSendLog.update({
        where: { id: logId },
        data: {
          status: WhatsappSendStatus.SENT,
          sentAt: new Date(),
          message,
          lastError: null,
          evolutionResponse: {
            messageId: result.messageId ?? null,
            mediaSent: result.mediaSent,
            textFallbackSent: result.textFallbackSent,
            ...(result.fallbackReason
              ? { fallbackReason: result.fallbackReason }
              : {}),
          } as Prisma.InputJsonValue,
        },
      });
      // Sucesso → reset do circuit breaker.
      await this.settingsService.updateConnectionState({
        consecutiveFailures: 0,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const attemptsLeft = (job.opts.attempts ?? 1) - (job.attemptsMade + 1);
      const isLast = attemptsLeft <= 0;

      await this.prisma.whatsappSendLog.update({
        where: { id: logId },
        data: {
          status: isLast
            ? WhatsappSendStatus.FAILED
            : WhatsappSendStatus.PROCESSING,
          lastError: msg.slice(0, 1000),
        },
      });

      await this.bumpCircuitBreaker(settings.failureCooldownSeconds);
      throw err; // deixa o BullMQ aplicar backoff/retry
    }
  }

  /** Incrementa falhas consecutivas e abre o circuit breaker no limiar. */
  private async bumpCircuitBreaker(cooldownSeconds: number): Promise<void> {
    const threshold = Number(process.env['WHATSAPP_FAILURE_THRESHOLD'] ?? 5);
    const state = await this.settingsService.updateConnectionState({
      consecutiveFailures: { increment: 1 },
      lastErrorAt: new Date(),
    });
    const wasOpen =
      !!state.circuitOpenUntil && state.circuitOpenUntil.getTime() > Date.now();
    if (state.consecutiveFailures >= threshold && !wasOpen) {
      await this.settingsService.updateConnectionState({
        circuitOpenUntil: new Date(Date.now() + cooldownSeconds * 1000),
      });
      await this.connectionService.notifyCircuitOpen(state.consecutiveFailures);
      this.logger.warn(
        `Circuit breaker WhatsApp ABERTO após ${state.consecutiveFailures} falhas`,
      );
    }
  }

  private async mark(
    logId: string,
    status: WhatsappSendStatus,
    extra: Prisma.WhatsappSendLogUpdateInput = {},
  ): Promise<void> {
    await this.prisma.whatsappSendLog.update({
      where: { id: logId },
      data: { status, ...extra },
    });
  }
}
