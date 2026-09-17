import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { WhatsappSendStatus, UserRole } from '@prisma/client';

import {
  renderTemplate,
  validateTemplate,
  sampleTemplateVars,
} from './application/whatsapp-template.js';
import { WhatsappReceiptUrlService } from './application/whatsapp-receipt-url.service.js';
import { WhatsappProofService } from './application/whatsapp-proof.service.js';
import { WhatsappSendHistoryService } from './application/whatsapp-send-history.service.js';
import { WhatsappProofProcessor } from './infrastructure/queues/whatsapp-proof.processor.js';
import { EvolutionApiError } from './domain/exceptions/whatsapp.exceptions.js';
import { proofJobId } from './domain/types/whatsapp.types.js';
import { RolesGuard } from '../auth/index.js';

// ─── 0. Template render + validação ──────────────────────────────────────────

describe('whatsapp-template', () => {
  it('renderiza variáveis conhecidas', () => {
    const out = renderTemplate(
      'Olá {{userName}} — {{amount}}',
      sampleTemplateVars(),
    );
    expect(out).toContain('Ricardo Rocha de Almeida');
    expect(out).toContain('R$');
  });

  it('valida e rejeita variável desconhecida', () => {
    expect(() => validateTemplate('Oi {{foo}}')).toThrow();
    expect(() => validateTemplate('Oi {{userName}}')).not.toThrow();
  });
});

// ─── 3. jobId scheme (envio automático) ──────────────────────────────────────

describe('jobId scheme', () => {
  it('envio automático inclui withdrawalId e groupId (multi-grupo, sem ":")', () => {
    expect(proofJobId('wd-123', '12036-0@g.us')).toBe(
      'whatsapp-proof__wd-123__12036-0-g-us',
    );
  });
});

// ─── 6 & 7. URL assinada expirada/inválida ───────────────────────────────────

describe('WhatsappReceiptUrlService', () => {
  const config = {
    get: (k: string) =>
      ({
        WHATSAPP_RECEIPT_SIGNING_SECRET: 'segredo-teste-super',
        WHATSAPP_PUBLIC_API_URL: 'https://api.mtafiliates.com.br',
      })[k],
  };
  const svc = new WhatsappReceiptUrlService(config as never);

  it('URL assinada válida verifica', () => {
    const url = svc.buildSignedUrl('wd-1')!;
    const u = new URL(url);
    const exp = Number(u.searchParams.get('exp'));
    const sig = u.searchParams.get('sig')!;
    expect(svc.verify('wd-1', exp, sig)).toBe(true);
  });

  it('URL assinada EXPIRADA não verifica', () => {
    const past = Date.now() - 1000;
    const url = svc.buildSignedUrl('wd-1')!;
    const sig = new URL(url).searchParams.get('sig')!;
    expect(svc.verify('wd-1', past, sig)).toBe(false);
  });

  it('URL assinada INVÁLIDA (sig adulterada) não verifica', () => {
    const url = svc.buildSignedUrl('wd-1')!;
    const exp = Number(new URL(url).searchParams.get('exp'));
    expect(svc.verify('wd-1', exp, 'deadbeef')).toBe(false);
  });
});

// ─── 4 & 5. Retry manual: reusa log, nunca em SENT ───────────────────────────

describe('WhatsappSendHistoryService.retry', () => {
  let prisma: { whatsappSendLog: { findUnique: ReturnType<typeof vi.fn> } };
  let producer: { enqueueRetry: ReturnType<typeof vi.fn> };
  let svc: WhatsappSendHistoryService;

  beforeEach(() => {
    prisma = { whatsappSendLog: { findUnique: vi.fn() } };
    producer = { enqueueRetry: vi.fn().mockResolvedValue(undefined) };
    svc = new WhatsappSendHistoryService(
      prisma as never,
      producer as never,
      {} as never,
    );
  });

  it('reaproveita o MESMO log (não cria novo) ao reenviar FAILED', async () => {
    const log = { id: 'log-1', status: WhatsappSendStatus.FAILED };
    prisma.whatsappSendLog.findUnique.mockResolvedValue(log);
    await svc.retry('log-1', 'admin-1');
    expect(producer.enqueueRetry).toHaveBeenCalledWith(log, 'admin-1');
  });

  it('NÃO permite retry de log SENT', async () => {
    prisma.whatsappSendLog.findUnique.mockResolvedValue({
      id: 'log-2',
      status: WhatsappSendStatus.SENT,
    });
    await expect(svc.retry('log-2', 'admin-1')).rejects.toThrow();
    expect(producer.enqueueRetry).not.toHaveBeenCalled();
  });
});

// ─── 8. /send/media com caption não dispara /send/text duplicado ─────────────

describe('WhatsappProofService.deliver (sem duplicar mensagem)', () => {
  function build(opts: {
    sendMedia?: boolean;
    receipt?: string | null;
    mediaImpl?: () => Promise<unknown>;
  }) {
    // PNG 1x1 válido — detectImageMime exige bytes de imagem reais p/ a via mídia.
    const PNG_1X1 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
    const prisma = {
      withdrawalRequest: {
        findUnique: vi.fn().mockResolvedValue({
          gatewayReceiptBase64:
            opts.receipt === undefined ? PNG_1X1 : opts.receipt,
        }),
      },
    };
    const evolution = {
      sendMedia: vi.fn(
        opts.mediaImpl ??
          (() => Promise.resolve({ ok: true, messageId: 'm1' })),
      ),
      sendText: vi.fn().mockResolvedValue({ ok: true, messageId: 't1' }),
    };
    const urls = {
      buildSignedUrl: vi.fn().mockReturnValue('https://x/r?sig=1'),
    };
    const settingsService = {
      getSettings: vi.fn().mockResolvedValue({
        sendMedia: opts.sendMedia ?? true,
        instanceToken: 'tok',
      }),
      resolveInstanceToken: vi.fn().mockResolvedValue('tok'),
    };
    const svc = new WhatsappProofService(
      prisma as never,
      evolution as never,
      urls as never,
      settingsService as never,
    );
    return { svc, evolution };
  }

  it('mídia OK → NÃO chama sendText (1 mensagem só)', async () => {
    const { svc, evolution } = build({});
    const r = await svc.deliver({
      groupId: 'g@g.us',
      caption: 'oi',
      withdrawalId: 'wd-1',
      isTest: false,
    });
    expect(evolution.sendMedia).toHaveBeenCalledTimes(1);
    expect(evolution.sendText).not.toHaveBeenCalled();
    expect(r.mediaSent).toBe(true);
    expect(r.textFallbackSent).toBe(false);
  });

  it('erro DEFINITIVO de mídia → fallback texto (1x)', async () => {
    const { svc, evolution } = build({
      mediaImpl: () =>
        Promise.reject(new EvolutionApiError('unsupported media format', 400)),
    });
    const r = await svc.deliver({
      groupId: 'g@g.us',
      caption: 'oi',
      withdrawalId: 'wd-1',
      isTest: false,
    });
    expect(evolution.sendText).toHaveBeenCalledTimes(1);
    expect(r.textFallbackSent).toBe(true);
    expect(r.fallbackReason).toBe('unsupported_media');
  });

  it('erro RECUPERÁVEL (500) → relança, NÃO faz fallback de texto', async () => {
    const { svc, evolution } = build({
      mediaImpl: () =>
        Promise.reject(new EvolutionApiError('server error', 500)),
    });
    await expect(
      svc.deliver({
        groupId: 'g@g.us',
        caption: 'oi',
        withdrawalId: 'wd-1',
        isTest: false,
      }),
    ).rejects.toBeInstanceOf(EvolutionApiError);
    expect(evolution.sendText).not.toHaveBeenCalled();
  });
});

// ─── 2 & 9. Processor: WAITING não consome attempts; circuit breaker ─────────

describe('WhatsappProofProcessor', () => {
  function buildProcessor(overrides: {
    status?: string;
    circuitOpenUntil?: Date | null;
  }) {
    const updateLog = vi.fn().mockResolvedValue({});
    const prisma = {
      whatsappSendLog: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'log-1',
          status: WhatsappSendStatus.PENDING,
          groupId: 'g@g.us',
          withdrawalId: 'wd-1',
          isTest: false,
          waitingConnectionSince: null,
          pausedSince: null,
        }),
        update: updateLog,
      },
    };
    const settingsService = {
      getSettings: vi.fn().mockResolvedValue({
        enabled: true,
        selectedGroupId: 'g@g.us',
        maxWaitConnectionMinutes: 1440,
        delayMaxSeconds: 90,
        failureCooldownSeconds: 1800,
        messageTemplate: 'oi {{userName}}',
      }),
      getConnectionState: vi.fn().mockResolvedValue({
        status: overrides.status ?? 'close',
        circuitOpenUntil: overrides.circuitOpenUntil ?? null,
      }),
      updateConnectionState: vi
        .fn()
        .mockResolvedValue({ consecutiveFailures: 1 }),
    };
    const proofService = { renderMessage: vi.fn(), deliver: vi.fn() };
    const connectionService = {
      syncStatus: vi.fn(),
      notifyCircuitOpen: vi.fn(),
    };
    const producer = { reschedule: vi.fn().mockResolvedValue(undefined) };
    const proc = new WhatsappProofProcessor(
      prisma as never,
      settingsService as never,
      proofService as never,
      connectionService as never,
      producer as never,
    );
    return { proc, prisma, producer, updateLog };
  }

  const job = {
    name: 'send-proof',
    data: { logId: 'log-1' },
    opts: { attempts: 5 },
    attemptsMade: 0,
  };

  it('desconectado → WAITING_CONNECTION, reagenda e NÃO incrementa attempts', async () => {
    const { proc, producer, updateLog } = buildProcessor({ status: 'close' });
    await proc.process(job as never);
    const statuses = updateLog.mock.calls.map((c) => c[0].data?.status);
    expect(statuses).toContain(WhatsappSendStatus.WAITING_CONNECTION);
    const incrementedAttempts = updateLog.mock.calls.some(
      (c) => c[0].data?.attempts !== undefined,
    );
    expect(incrementedAttempts).toBe(false);
    expect(producer.reschedule).toHaveBeenCalled();
  });

  it('circuit aberto → PAUSED + reagenda (sem tentativa)', async () => {
    const { proc, producer, updateLog } = buildProcessor({
      status: 'open',
      circuitOpenUntil: new Date(Date.now() + 600_000),
    });
    await proc.process(job as never);
    const statuses = updateLog.mock.calls.map((c) => c[0].data?.status);
    expect(statuses).toContain(WhatsappSendStatus.PAUSED);
    expect(producer.reschedule).toHaveBeenCalled();
  });
});

// ─── 1. Role guard nega não-admin ────────────────────────────────────────────

describe('RolesGuard (whatsapp admin)', () => {
  function ctx(role: UserRole) {
    return {
      switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
      getHandler: () => null,
      getClass: () => null,
    } as never;
  }

  it('nega AFFILIATE quando rota exige ADMIN', () => {
    const reflector = {
      getAllAndOverride: vi
        .fn()
        .mockReturnValue([UserRole.ADMIN, UserRole.SUPERADMIN]),
    };
    const guard = new RolesGuard(reflector as never);
    expect(() => guard.canActivate(ctx(UserRole.AFFILIATE))).toThrow(
      ForbiddenException,
    );
  });

  it('permite ADMIN', () => {
    const reflector = {
      getAllAndOverride: vi
        .fn()
        .mockReturnValue([UserRole.ADMIN, UserRole.SUPERADMIN]),
    };
    const guard = new RolesGuard(reflector as never);
    expect(guard.canActivate(ctx(UserRole.ADMIN))).toBe(true);
  });
});
