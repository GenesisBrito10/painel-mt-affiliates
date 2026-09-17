import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LinkWebhookDeliveryStatus } from '@prisma/client';
import { LinkWebhookProcessor } from './link-webhook.processor.js';
import { WebhookHttpError } from '../../application/link-webhook-http.service.js';
import { LINK_WEBHOOK_MAX_ATTEMPTS } from '../../domain/types/link-webhook.types.js';

const makePrisma = () => ({
  linkWebhookDelivery: {
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
});

const makeJob = (attemptsMade: number) =>
  ({ data: { deliveryId: 'd1' }, attemptsMade }) as any;

describe('LinkWebhookProcessor', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let settings: { getSettingsRow: ReturnType<typeof vi.fn> };
  let http: { post: ReturnType<typeof vi.fn> };
  let processor: LinkWebhookProcessor;

  beforeEach(() => {
    prisma = makePrisma();
    settings = {
      getSettingsRow: vi.fn().mockResolvedValue({
        enabled: true,
        webhookUrl: 'https://hooks.partner.com',
        webhookSecret: 'secret',
      }),
    };
    http = { post: vi.fn() };
    processor = new LinkWebhookProcessor(
      prisma as any,
      settings as any,
      http as any,
    );
    prisma.linkWebhookDelivery.findUnique.mockResolvedValue({
      id: 'd1',
      ownerUserId: 'owner-1',
      status: LinkWebhookDeliveryStatus.PENDING,
      payload: { event: 'link_request.approved' },
    });
  });

  it('marks SUCCESS and records attempts on 2xx', async () => {
    http.post.mockResolvedValue({ httpStatus: 200, responseBody: 'ok' });

    await processor.process(makeJob(0));

    expect(prisma.linkWebhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd1' },
        data: expect.objectContaining({
          status: LinkWebhookDeliveryStatus.SUCCESS,
          httpStatus: 200,
          attempts: 1,
        }),
      }),
    );
  });

  it('keeps PENDING and rethrows on non-final failure (so BullMQ retries)', async () => {
    http.post.mockRejectedValue(new WebhookHttpError('HTTP 500', 500, 'boom'));

    await expect(processor.process(makeJob(0))).rejects.toBeInstanceOf(
      WebhookHttpError,
    );
    expect(prisma.linkWebhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: LinkWebhookDeliveryStatus.PENDING,
          httpStatus: 500,
          attempts: 1,
        }),
      }),
    );
  });

  it('marks FAILED on the final attempt', async () => {
    http.post.mockRejectedValue(new WebhookHttpError('HTTP 500', 500, 'boom'));

    await expect(
      processor.process(makeJob(LINK_WEBHOOK_MAX_ATTEMPTS - 1)),
    ).rejects.toBeInstanceOf(WebhookHttpError);
    expect(prisma.linkWebhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: LinkWebhookDeliveryStatus.FAILED,
          attempts: LINK_WEBHOOK_MAX_ATTEMPTS,
        }),
      }),
    );
  });

  it('skips already-SUCCESS deliveries', async () => {
    prisma.linkWebhookDelivery.findUnique.mockResolvedValue({
      id: 'd1',
      ownerUserId: 'owner-1',
      status: LinkWebhookDeliveryStatus.SUCCESS,
      payload: {},
    });

    await processor.process(makeJob(0));
    expect(http.post).not.toHaveBeenCalled();
  });

  it('fails without retry when target is disabled', async () => {
    settings.getSettingsRow.mockResolvedValue({
      enabled: false,
      webhookUrl: '',
      webhookSecret: '',
    });

    await processor.process(makeJob(0));
    expect(http.post).not.toHaveBeenCalled();
    expect(prisma.linkWebhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: LinkWebhookDeliveryStatus.FAILED,
        }),
      }),
    );
  });
});
