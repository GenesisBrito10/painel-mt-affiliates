import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { LINK_WEBHOOK_HTTP_TIMEOUT_MS } from '../domain/types/link-webhook.types.js';

export interface WebhookPostResult {
  httpStatus: number;
  responseBody: string;
  // The exact signed request we sent — surfaced by the test sender so the
  // integrator can verify their signature-validation against real values.
  request: {
    headers: Record<string, string>;
    timestamp: string;
    body: string;
  };
}

/**
 * Low-level webhook HTTP sender. Signs the body with HMAC-SHA256 over
 * `${timestamp}.${body}` (timestamp included for replay protection) and treats
 * any non-2xx response as a failure (throws) so the queue retries.
 */
@Injectable()
export class LinkWebhookHttpService {
  async post(
    url: string,
    secret: string,
    payload: Record<string, unknown>,
    deliveryId: string,
  ): Promise<WebhookPostResult> {
    const body = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const event = String(payload['event'] ?? '');

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      LINK_WEBHOOK_HTTP_TIMEOUT_MS,
    );

    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'user-agent': 'Vallex-LinkWebhook/1.0',
        'x-vallex-event': event,
        'x-vallex-delivery-id': deliveryId,
        'x-vallex-timestamp': timestamp,
      };
      if (secret) {
        headers['x-vallex-signature'] =
          `sha256=${this.sign(secret, `${timestamp}.${body}`)}`;
      }

      const response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers,
        body,
      });
      const responseBody = await response.text();

      if (!response.ok) {
        throw new WebhookHttpError(
          `HTTP ${response.status}: ${responseBody.slice(0, 500)}`,
          response.status,
          responseBody,
        );
      }

      return {
        httpStatus: response.status,
        responseBody,
        request: { headers, timestamp, body },
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  sign(secret: string, base: string): string {
    return createHmac('sha256', secret).update(base).digest('hex');
  }
}

export class WebhookHttpError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number | null,
    readonly responseBody: string,
  ) {
    super(message);
    this.name = 'WebhookHttpError';
  }
}
