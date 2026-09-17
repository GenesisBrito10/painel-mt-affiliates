import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  icon?: string;
}

export interface PushSubscriptionData {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

@Injectable()
export class WebPushService {
  private readonly logger = new Logger(WebPushService.name);

  constructor(private readonly config: ConfigService) {
    webpush.setVapidDetails(
      this.config.getOrThrow<string>('VAPID_EMAIL'),
      this.config.getOrThrow<string>('VAPID_PUBLIC_KEY'),
      this.config.getOrThrow<string>('VAPID_PRIVATE_KEY'),
    );
  }

  getPublicKey(): string {
    return this.config.getOrThrow<string>('VAPID_PUBLIC_KEY');
  }

  /**
   * Send a push notification to a single subscription.
   * Returns false if the subscription is expired (410 Gone) and should be deleted.
   * Returns true on success.
   */
  async send(subscription: PushSubscriptionData, payload: PushPayload): Promise<boolean> {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
        },
        JSON.stringify(payload),
      );
      return true;
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number })?.statusCode;

      // 410 Gone or 404 = subscription expired/unregistered — caller should delete it
      if (statusCode === 410 || statusCode === 404) {
        this.logger.debug(`Push subscription ${subscription.id} expired (${statusCode}), marking for removal`);
        return false;
      }

      this.logger.warn(
        `Push send failed for ${subscription.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return true; // Non-expiry error — keep subscription
    }
  }
}
