import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiExcludeEndpoint } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

import { WithdrawalService } from '../application/withdrawal.service.js';
import { PaymentGatewayService } from '../../payment-gateway/index.js';
import type {
  HeartPayPayoutEventData,
  HeartPayWebhookPayload,
  VorexyCashoutWebhookPayload,
} from '../../payment-gateway/index.js';

interface RawFastifyRequest extends FastifyRequest {
  rawBody?: string;
}

/**
 * Webhook CashOut (saques) da Vorexy. Serve em `/api/v1/webhooks/vorexy`.
 *
 * Vorexy NÃO assina os webhooks (sem HMAC). Camadas de segurança:
 *  1. Segredo opcional na URL (`?s=<VOREXY_WEBHOOK_SECRET>`) — config no painel.
 *  2. Dedup + lookup por `withdrawId` no DB (handler) — payload forjado com id
 *     inexistente vira "orphan" e não muda nada.
 *  3. Mudanças de saldo só em saques que existem e estão pagos/em processamento.
 *
 * O corpo Vorexy é adaptado para `HeartPayWebhookPayload` e processado pelo
 * mesmo `handleGatewayWebhookEvent` já testado (idempotência inclusa).
 */
@ApiTags('webhooks')
@Controller({ path: 'webhooks/vorexy', version: '1' })
export class VorexyWebhookController {
  private readonly logger = new Logger(VorexyWebhookController.name);

  constructor(
    private readonly withdrawalService: WithdrawalService,
    private readonly gateway: PaymentGatewayService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleWebhook(
    @Req() req: RawFastifyRequest,
    @Query('s') secretFromUrl: string | undefined,
    @Headers('x-webhook-event-id') eventId: string | undefined,
  ): Promise<{ received: boolean; idempotent: boolean; reason?: string }> {
    // 1. Segredo opcional na URL.
    const expectedSecret = this.gateway.getWebhookSecret();
    if (
      expectedSecret &&
      !this.constantTimeEqual(secretFromUrl ?? '', expectedSecret)
    ) {
      this.logger.warn('Vorexy webhook rejeitado: segredo inválido.');
      throw new UnauthorizedException('invalid webhook secret');
    }

    // 2. Parse do corpo.
    const rawBody = req.rawBody ?? '';
    let body: VorexyCashoutWebhookPayload;
    try {
      body = JSON.parse(rawBody) as VorexyCashoutWebhookPayload;
    } catch {
      throw new UnauthorizedException('invalid webhook payload');
    }

    if (body?.type !== 'cashout' || body?.withdrawId === undefined) {
      this.logger.log(
        `Vorexy webhook ignorado: type=${body?.type ?? 'n/a'} eventId=${eventId ?? 'n/a'}`,
      );
      return {
        received: true,
        idempotent: false,
        reason: 'not a cashout event',
      };
    }

    this.logger.log(
      `Vorexy webhook: withdrawId=${body.withdrawId} status=${body.status} eventId=${eventId ?? 'n/a'}`,
    );

    // 3. Adapta para o formato HeartPay e processa pelo handler comum.
    const mapped = this.toHeartPayPayload(body);
    const result =
      await this.withdrawalService.handleGatewayWebhookEvent(mapped);

    const idempotent = result.reason === 'duplicate event';
    if (!result.processed) {
      return {
        received: true,
        idempotent,
        reason: result.reason ?? 'not_processed',
      };
    }
    return { received: true, idempotent: false };
  }

  /** Mapeia status (lowercase) do webhook Vorexy → nome de evento HeartPay. */
  private mapStatusToEvent(status: string): string {
    switch (status) {
      case 'successful':
        return 'PayOutCompleted';
      case 'failure':
        return 'PayOutFailed';
      case 'refunded':
        return 'PayOutRefunded';
      default:
        return status; // pending/desconhecido → handler marca como 'ignored'
    }
  }

  private toHeartPayPayload(
    body: VorexyCashoutWebhookPayload,
  ): HeartPayWebhookPayload {
    const event = this.mapStatusToEvent(String(body.status));
    // O `user_id` da Vorexy vive dentro do providerPayload (JSON string) —
    // usado só para exibir no comprovante (bloco IDENTIFICAÇÃO).
    const userId = this.extractUserId(body.providerPayload);
    const eventData: HeartPayPayoutEventData = {
      referenceCode: String(body.withdrawId),
      status: String(body.providerStatus ?? body.status),
      value: body.valueInCents,
      amount: body.valueInCents,
      endToEndId: body.endToEndId ?? null,
      recipientName: body.receiver?.name ?? null,
      recipientDocument:
        body.receiver?.document ?? body.creditorDocument ?? null,
      errorMessage: body.providerErrorDescription ?? undefined,
      provider: body.provider,
      providerTransactionId: body.providerTid ?? null,
      providerPaymentId: body.providerPaymentId ?? null,
      userId,
      // Em refunded, a Vorexy reembolsa o valor cheio do saque.
      ...(body.status === 'refunded'
        ? { refundedAmount: body.valueInCents }
        : {}),
      ...(body.endToEndId ? { refundEndToEndId: body.endToEndId } : {}),
      ...(body.processedAt || body.providerConfirmedAt
        ? { completedAt: body.providerConfirmedAt ?? body.processedAt }
        : {}),
    };

    return {
      event,
      ...(body.processedAt ? { timestamp: body.processedAt } : {}),
      data: { data: eventData },
    };
  }

  /** Extrai `data.user_id` do providerPayload (string JSON ou objeto). */
  private extractUserId(
    providerPayload: string | Record<string, unknown> | null | undefined,
  ): string | null {
    if (!providerPayload) return null;
    try {
      const obj =
        typeof providerPayload === 'string'
          ? (JSON.parse(providerPayload) as Record<string, unknown>)
          : providerPayload;
      const data = obj?.['data'] as Record<string, unknown> | undefined;
      const userId = data?.['user_id'];
      return typeof userId === 'string' ? userId : null;
    } catch {
      return null;
    }
  }

  private constantTimeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ab.length !== bb.length || ab.length === 0) return false;
    try {
      return timingSafeEqual(ab, bb);
    } catch {
      return false;
    }
  }
}
