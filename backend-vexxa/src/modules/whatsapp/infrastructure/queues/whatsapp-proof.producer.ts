import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { WhatsappSendStatus, type WhatsappSendLog } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { WhatsappSettingsService } from '../../application/whatsapp-settings.service.js';
import { WhatsappTargetGroupService } from '../../application/whatsapp-target-group.service.js';
import {
  buildTemplateVars,
  renderTemplate,
} from '../../application/whatsapp-template.js';
import {
  SEND_PROOF_JOB,
  STATUS_POLL_INTERVAL_MS,
  STATUS_POLL_JOB,
  STATUS_POLL_REPEAT_JOB_ID,
  WHATSAPP_QUEUE,
  detectImageMime,
  proofJobId,
  retryJobId,
  testJobId,
  waitRescheduleJobId,
} from '../../domain/types/whatsapp.types.js';

export interface SendProofJobData {
  logId: string;
  /** Só em teste: saque real de onde puxar o comprovante p/ enviar como mídia. */
  testReceiptWithdrawalId?: string;
}

// Comprovantes PENDING parados há mais que isto são re-enfileirados pelo sweep
// (o job nunca chegou à fila ou se perdeu). Folgado p/ não competir com envios
// recém-criados que já têm job ativo.
const STUCK_PROOF_THRESHOLD_MS = 10 * 60 * 1000; // 10 min

@Injectable()
export class WhatsappProofProducer {
  private readonly logger = new Logger(WhatsappProofProducer.name);

  constructor(
    @InjectQueue(WHATSAPP_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly settingsService: WhatsappSettingsService,
    private readonly targetGroupService: WhatsappTargetGroupService,
  ) {}

  // ─── Repeatable status poll (idempotente) ─────────────────────────────────

  async scheduleStatusPoll(): Promise<void> {
    await this.queue.add(
      STATUS_POLL_JOB,
      {},
      {
        repeat: { every: STATUS_POLL_INTERVAL_MS },
        jobId: STATUS_POLL_REPEAT_JOB_ID,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    this.logger.log('Repeatable WhatsApp status-poll registrado');
  }

  // ─── Enfileiramento ───────────────────────────────────────────────────────

  /** Random delay seguro (segundos → ms) entre min e max das settings. */
  private async randomDelayMs(): Promise<number> {
    const s = await this.settingsService.getSettings();
    const min = Math.max(0, s.delayMinSeconds);
    const max = Math.max(min, s.delayMaxSeconds);
    return (min + Math.floor(Math.random() * (max - min + 1))) * 1000;
  }

  /**
   * Resolve os grupos de destino. Fonte da verdade: tabela de target-groups
   * (multi-grupo, sem repetição). Fallback p/ o grupo único salvo em settings
   * (compatibilidade) quando não há nenhum target cadastrado.
   */
  private async resolveTargets(settings: {
    selectedGroupId: string | null;
    selectedGroupName: string | null;
  }): Promise<{ groupId: string; name: string }[]> {
    const saved = await this.targetGroupService.list();
    if (saved.length > 0) {
      return saved.map((g) => ({ groupId: g.groupId, name: g.name }));
    }
    if (settings.selectedGroupId) {
      return [
        {
          groupId: settings.selectedGroupId,
          name: settings.selectedGroupName ?? '',
        },
      ];
    }
    return [];
  }

  /**
   * Enfileira o envio do comprovante de um saque COMPLETED para TODOS os grupos
   * de destino — o mesmo comprovante em cada grupo. Idempotente por grupo: pula
   * se já existe log SENT/PROCESSING (dedupe via @@unique([withdrawalId, groupId])).
   */
  async enqueueProof(withdrawalId: string): Promise<void> {
    const withdrawal = await this.prisma.withdrawalRequest.findUnique({
      where: { id: withdrawalId },
      select: {
        id: true,
        amount: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });
    if (!withdrawal) {
      this.logger.warn(`Saque ${withdrawalId} não encontrado — não enfileira`);
      return;
    }

    const settings = await this.settingsService.getSettings();
    const targets = await this.resolveTargets(settings);
    if (targets.length === 0) {
      this.logger.warn(
        `Nenhum grupo de destino p/ saque ${withdrawalId} — skip`,
      );
      return;
    }

    const message = renderTemplate(
      settings.messageTemplate,
      buildTemplateVars({
        userName: withdrawal.user.name,
        userEmail: withdrawal.user.email,
        amount: Number(withdrawal.amount),
        withdrawalId,
        status: 'COMPLETED',
      }),
    );

    for (const target of targets) {
      const existing = await this.prisma.whatsappSendLog.findUnique({
        where: {
          withdrawalId_groupId: { withdrawalId, groupId: target.groupId },
        },
      });
      if (
        existing &&
        (existing.status === WhatsappSendStatus.SENT ||
          existing.status === WhatsappSendStatus.PROCESSING)
      ) {
        this.logger.debug(
          `Comprovante saque ${withdrawalId} grupo ${target.groupId} já enviado/processando — skip`,
        );
        continue;
      }

      const log = await this.prisma.whatsappSendLog.upsert({
        where: {
          withdrawalId_groupId: { withdrawalId, groupId: target.groupId },
        },
        create: {
          withdrawalId,
          userId: withdrawal.user.id,
          userName: withdrawal.user.name,
          userEmail: withdrawal.user.email,
          amount: withdrawal.amount,
          groupId: target.groupId,
          groupName: target.name,
          message,
          status: WhatsappSendStatus.PENDING,
        },
        update: {
          status: WhatsappSendStatus.PENDING,
          lastError: null,
          message,
          groupName: target.name,
        },
      });

      await this.addSendJob(log, proofJobId(withdrawalId, target.groupId));
    }
  }

  /**
   * Envio de teste (dry-run) — sem saque real, log isTest. Se `groupId` for
   * informado, testa aquele grupo específico (botão individual no admin);
   * senão, usa o primeiro grupo de destino resolvido.
   */
  async enqueueTest(
    adminId: string,
    groupId?: string,
  ): Promise<WhatsappSendLog> {
    const settings = await this.settingsService.getSettings();
    let targetId: string | null = groupId ?? null;
    let targetName = '';
    if (targetId) {
      const saved = await this.targetGroupService.list();
      targetName =
        saved.find((g) => g.groupId === targetId)?.name ??
        settings.selectedGroupName ??
        '';
    } else {
      const [first] = await this.resolveTargets(settings);
      targetId = first?.groupId ?? null;
      targetName = first?.name ?? '';
    }
    const message = renderTemplate(
      settings.messageTemplate,
      buildTemplateVars({
        userName: 'Teste Vallex Company',
        userEmail: 'teste@vallexgroup.com.br',
        amount: 413.6,
        withdrawalId: 'TESTE',
        status: 'COMPLETED',
      }),
    );
    // Pega um comprovante qualquer já existente no banco p/ testar o envio de
    // mídia (não grava em log.withdrawalId — é @unique e pertence ao saque real).
    // Pega um comprovante que seja IMAGEM de verdade (detecta por magic bytes —
    // gatewayReceiptFormat é só subtipo e pode estar errado). Busca candidatos
    // recentes e escolhe o primeiro cujos bytes são png/jpeg/webp.
    const candidates = await this.prisma.withdrawalRequest.findMany({
      where: { gatewayReceiptBase64: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 15,
      select: { id: true, gatewayReceiptBase64: true },
    });
    const receipt = candidates.find(
      (c) => c.gatewayReceiptBase64 && detectImageMime(c.gatewayReceiptBase64),
    );
    const log = await this.prisma.whatsappSendLog.create({
      data: {
        isTest: true,
        userName: 'Teste Vallex Company',
        groupId: targetId,
        groupName: targetName,
        message,
        status: WhatsappSendStatus.PENDING,
        createdByAdminId: adminId,
      },
    });
    await this.addSendJob(
      log,
      testJobId(log.id),
      0,
      receipt ? { testReceiptWithdrawalId: receipt.id } : undefined,
    ); // teste sem delay
    return log;
  }

  /** Reenvio manual — reaproveita o mesmo log (NÃO cria novo). */
  async enqueueRetry(log: WhatsappSendLog, adminId: string): Promise<void> {
    const updated = await this.prisma.whatsappSendLog.update({
      where: { id: log.id },
      data: {
        status: WhatsappSendStatus.PENDING,
        lastError: null,
        waitingConnectionSince: null,
        pausedSince: null,
        createdByAdminId: adminId,
      },
    });
    await this.addSendJob(updated, retryJobId(updated.id));
  }

  /**
   * Re-enfileira comprovantes presos em PENDING cujo job nunca chegou à fila
   * (ex.: enqueue falhou por jobId inválido) ou se perdeu. Só pega logs antigos
   * (> STUCK_PROOF_THRESHOLD_MS) para não competir com envios recém-criados que
   * já têm job ativo. Usa um jobId único (retryJobId inclui timestamp) para
   * garantir novo processamento mesmo que reste um job antigo retido na fila.
   * O `addSendJob` atualiza `updatedAt`, tirando o log da janela do próximo tick.
   */
  async requeuePendingProofs(): Promise<number> {
    const cutoff = new Date(Date.now() - STUCK_PROOF_THRESHOLD_MS);
    const stuck = await this.prisma.whatsappSendLog.findMany({
      where: {
        status: WhatsappSendStatus.PENDING,
        updatedAt: { lt: cutoff },
      },
      orderBy: { updatedAt: 'asc' },
      take: 50,
    });

    let requeued = 0;
    for (const log of stuck) {
      try {
        await this.addSendJob(log, retryJobId(log.id));
        requeued += 1;
      } catch (err) {
        this.logger.warn(
          `Requeue proof falhou p/ log ${log.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (requeued > 0) {
      this.logger.log(
        `Requeue: re-enfileirados ${requeued} comprovante(s) preso(s).`,
      );
    }
    return requeued;
  }

  /** Reagenda por desconexão/circuit aberto — NOVO job, não consome attempts. */
  async reschedule(logId: string, delayMs: number): Promise<void> {
    await this.queue.add(SEND_PROOF_JOB, { logId } satisfies SendProofJobData, {
      jobId: waitRescheduleJobId(logId),
      delay: delayMs,
      attempts: await this.maxAttempts(),
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: true,
      removeOnFail: false,
    });
  }

  private async maxAttempts(): Promise<number> {
    const s = await this.settingsService.getSettings();
    return Math.max(1, s.maxAttempts);
  }

  private async addSendJob(
    log: WhatsappSendLog,
    jobId: string,
    delayMs?: number,
    extra?: Omit<SendProofJobData, 'logId'>,
  ): Promise<void> {
    const delay = delayMs ?? (await this.randomDelayMs());
    await this.prisma.whatsappSendLog.update({
      where: { id: log.id },
      data: { jobId },
    });
    await this.queue.add(
      SEND_PROOF_JOB,
      { logId: log.id, ...extra } satisfies SendProofJobData,
      {
        jobId,
        delay,
        attempts: await this.maxAttempts(),
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }
}
