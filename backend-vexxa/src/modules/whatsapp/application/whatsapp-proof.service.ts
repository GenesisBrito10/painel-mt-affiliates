import { Injectable, Logger } from '@nestjs/common';
import type { WhatsappSendLog, WhatsappSettings } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EvolutionClient } from '../infrastructure/clients/evolution.client.js';
import { WhatsappReceiptUrlService } from './whatsapp-receipt-url.service.js';
import { WhatsappSettingsService } from './whatsapp-settings.service.js';
import { buildTemplateVars, renderTemplate } from './whatsapp-template.js';
import { EvolutionApiError } from '../domain/exceptions/whatsapp.exceptions.js';
import type { FallbackReason } from '../domain/types/whatsapp.types.js';
import { detectImageMime } from '../domain/types/whatsapp.types.js';

export interface DeliverResult {
  messageId?: string;
  mediaSent: boolean;
  textFallbackSent: boolean;
  fallbackReason?: FallbackReason;
}

/**
 * Renderiza e entrega UMA mensagem ao grupo. Estratégia oficial: 1 mensagem de
 * mídia com caption via URL assinada. Fallback p/ texto SÓ em erro definitivo
 * de mídia; erro recuperável (timeout/rede/ambíguo) é relançado p/ retry.
 */
@Injectable()
export class WhatsappProofService {
  private readonly logger = new Logger(WhatsappProofService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly evolution: EvolutionClient,
    private readonly urls: WhatsappReceiptUrlService,
    private readonly settingsService: WhatsappSettingsService,
  ) {}

  /** Renderiza o template com os dados denormalizados do log. */
  renderMessage(log: WhatsappSendLog, settings: WhatsappSettings): string {
    const vars = buildTemplateVars({
      userName: log.userName,
      userEmail: log.userEmail ?? '',
      amount: log.amount ? Number(log.amount) : 0,
      withdrawalId: log.withdrawalId ?? log.id,
      status: 'COMPLETED',
      when: log.createdAt,
    });
    return renderTemplate(settings.messageTemplate, vars);
  }

  /**
   * Envia para o grupo. `groupId` é o JID (`...@g.us`). Lança EvolutionApiError
   * em erro recuperável. Retorna o resultado (mídia ou fallback de texto).
   */
  async deliver(params: {
    groupId: string;
    caption: string;
    withdrawalId: string | null;
    isTest: boolean;
    /** Em teste: saque real de onde puxar o comprovante (NÃO vira log.withdrawalId). */
    receiptWithdrawalId?: string | null;
  }): Promise<DeliverResult> {
    const settings = await this.settingsService.getSettings();
    const token = await this.settingsService.resolveInstanceToken();
    // Fonte do comprovante: saque real (envio normal) ou o emprestado p/ teste.
    const mediaWithdrawalId =
      params.withdrawalId ?? params.receiptWithdrawalId ?? null;
    const wantsMedia = settings.sendMedia && !!mediaWithdrawalId;

    if (wantsMedia) {
      const mediaOutcome = await this.tryMedia(
        params.groupId,
        params.caption,
        mediaWithdrawalId!,
        token,
      );
      if (mediaOutcome.sent) {
        return {
          messageId: mediaOutcome.messageId,
          mediaSent: true,
          textFallbackSent: false,
        };
      }
      // Erro DEFINITIVO de mídia → fallback texto (1 mensagem só).
      const text = await this.evolution.sendText({
        number: params.groupId,
        text: params.caption,
        instanceToken: token,
      });
      return {
        messageId: text.messageId,
        mediaSent: false,
        textFallbackSent: true,
        fallbackReason: mediaOutcome.reason,
      };
    }

    // Texto puro (teste / sendMedia desligado).
    const text = await this.evolution.sendText({
      number: params.groupId,
      text: params.caption,
      instanceToken: token,
    });
    return {
      messageId: text.messageId,
      mediaSent: false,
      textFallbackSent: false,
    };
  }

  /**
   * Tenta mídia. Retorna {sent:true} ou {sent:false, reason} para erro
   * DEFINITIVO de mídia. Erro RECUPERÁVEL é relançado (sobe p/ retry/backoff).
   */
  private async tryMedia(
    groupId: string,
    caption: string,
    withdrawalId: string,
    token: string | undefined,
  ): Promise<
    { sent: true; messageId?: string } | { sent: false; reason: FallbackReason }
  > {
    // Comprovante existe no DB?
    const row = await this.prisma.withdrawalRequest.findUnique({
      where: { id: withdrawalId },
      select: { gatewayReceiptBase64: true },
    });
    if (!row?.gatewayReceiptBase64) {
      return { sent: false, reason: 'receipt_not_found' };
    }
    // Não-imagem (PDF/JSON) → Evolution rejeita; cai p/ texto. Detecta por bytes
    // (gatewayReceiptFormat guarda só subtipo e pode estar errado/vazio).
    if (!detectImageMime(row.gatewayReceiptBase64)) {
      return { sent: false, reason: 'unsupported_media' };
    }

    const signedUrl = this.urls.buildSignedUrl(withdrawalId);
    if (!signedUrl) {
      return { sent: false, reason: 'signed_url_invalid' };
    }

    try {
      const res = await this.evolution.sendMedia({
        number: groupId,
        url: signedUrl,
        caption,
        instanceToken: token,
      });
      return { sent: true, messageId: res.messageId };
    } catch (err) {
      if (err instanceof EvolutionApiError && isDefinitiveMediaError(err)) {
        this.logger.warn(
          `Erro definitivo de mídia (withdrawal ${withdrawalId}), fallback texto: ${err.message}`,
        );
        return { sent: false, reason: 'unsupported_media' };
      }
      throw err; // recuperável → retry
    }
  }
}

/**
 * Erro definitivo de mídia = 4xx com sinal de formato/URL inválida. Timeout,
 * rede, 5xx e respostas ambíguas são recuperáveis (NÃO fazem fallback).
 */
function isDefinitiveMediaError(err: EvolutionApiError): boolean {
  if (err.statusCode === null) return false; // rede/timeout → recuperável
  if (err.statusCode >= 500) return false; // server → recuperável
  const m = err.message.toLowerCase();
  return (
    err.statusCode >= 400 &&
    /media|format|formato|unsupported|invalid url|url inválida|download|mime/.test(
      m,
    )
  );
}
