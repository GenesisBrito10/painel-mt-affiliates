import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiExcludeEndpoint } from '@nestjs/swagger';

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { WithdrawalService } from '../application/withdrawal.service.js';
import { PaymentGatewayService } from '../../payment-gateway/index.js';
import type { HeartPayWebhookPayload } from '../../payment-gateway/index.js';

interface RawFastifyRequest extends FastifyRequest {
  rawBody?: string;
}

const MAX_TIMESTAMP_AGE_SECONDS = 300; // 5 min replay window
const MAX_CLOCK_SKEW_SECONDS = 60; // tolerate up to 1 min future skew

@ApiTags('webhooks')
@Controller({ path: 'webhooks/heartpay', version: '1' })
export class GatewayWebhookController {
  private readonly logger = new Logger(GatewayWebhookController.name);

  constructor(
    private readonly withdrawalService: WithdrawalService,
    private readonly gateway: PaymentGatewayService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleWebhook(
    @Req() req: RawFastifyRequest,
    @Headers('x-heartpay-signature') signature: string | undefined,
    @Headers('x-heartpay-timestamp') timestamp: string | undefined,
    @Headers('x-webhook-token') plainToken: string | undefined,
  ): Promise<{ received: boolean; test?: boolean; reason?: string }> {
    const rawBody = req.rawBody ?? '';
    if (!rawBody) {
      throw new UnauthorizedException('missing webhook body');
    }

    const token = this.gateway.getWebhookToken();

    // HeartPay supports two validation paths:
    //   1. Simple — `x-webhook-token` header equals the configured token.
    //   2. HMAC  — `X-HeartPay-Signature` is HMAC-SHA256(`${timestamp}.${rawBody}`)
    //              keyed by the configured token, with `X-HeartPay-Timestamp`.
    // Accept either; at least one must succeed.
    const plainOk = !!plainToken && this.constantTimeEqual(plainToken, token);

    let hmacOk = false;
    if (signature && timestamp) {
      const tsSeconds = Number.parseInt(timestamp, 10);
      if (!Number.isFinite(tsSeconds)) {
        throw new UnauthorizedException('invalid webhook timestamp');
      }
      const age = Math.floor(Date.now() / 1000) - tsSeconds;
      // Reject both stale events (age > window) and future-dated events
      // (age < 0) — a future timestamp would otherwise replay indefinitely
      // since the window check only catches positive ages.
      if (age < -MAX_CLOCK_SKEW_SECONDS || age > MAX_TIMESTAMP_AGE_SECONDS) {
        throw new UnauthorizedException('webhook timestamp out of range');
      }
      hmacOk = this.verifySignature(rawBody, timestamp, signature, token);
    }

    if (!plainOk && !hmacOk) {
      this.logger.warn('Webhook rejected: invalid credentials');
      throw new UnauthorizedException('invalid webhook credentials');
    }

    let payload: HeartPayWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as HeartPayWebhookPayload;
    } catch {
      throw new UnauthorizedException('invalid webhook payload');
    }

    // Observabilidade: registra TODO webhook autenticado que chega (event/id/
    // status), antes de qualquer filtro — assim sabemos se o gateway entregou.
    const evData = payload?.data?.data;
    const webhookId =
      evData?.referenceCode ?? evData?.correlationID ?? 'unknown';
    this.logger.log(
      `Webhook received: event=${payload?.event ?? 'unknown'} id=${webhookId} status=${evData?.status ?? 'n/a'}${payload?.test ? ' (test)' : ''}`,
    );

    if (payload?.test) {
      return { received: true, test: true };
    }

    const result =
      await this.withdrawalService.handleGatewayWebhookEvent(payload);
    if (!result.processed) {
      this.logger.debug(`Webhook not processed: ${result.reason ?? 'unknown'}`);
      return { received: true, reason: result.reason ?? 'not_processed' };
    }
    return { received: true };
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

  private verifySignature(
    rawBody: string,
    timestamp: string,
    signature: string,
    token: string,
  ): boolean {
    const signedPayload = `${timestamp}.${rawBody}`;
    const expected = createHmac('sha256', token)
      .update(signedPayload)
      .digest('hex');

    let a: Buffer;
    let b: Buffer;
    try {
      a = Buffer.from(signature, 'hex');
      b = Buffer.from(expected, 'hex');
    } catch {
      return false;
    }
    if (a.length !== b.length || a.length === 0) return false;
    try {
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }
}
