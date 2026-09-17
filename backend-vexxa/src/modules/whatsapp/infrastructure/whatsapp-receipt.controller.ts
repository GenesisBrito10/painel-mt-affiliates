import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { PrismaService } from '../../prisma/prisma.service.js';
import { WhatsappReceiptUrlService } from '../application/whatsapp-receipt-url.service.js';
import { detectImageMime } from '../domain/types/whatsapp.types.js';

/**
 * Endpoint PÚBLICO (sem auth de usuário) que serve o PNG do comprovante para a
 * Evolution GO baixar no /send/media. Protegido por URL assinada (HMAC + exp).
 * Responde APENAS image/png — nunca dados do saque/usuário.
 */
@ApiExcludeController()
@Controller({ path: 'whatsapp', version: '1' })
export class WhatsappReceiptController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly urls: WhatsappReceiptUrlService,
  ) {}

  @Get('receipt/:withdrawalId')
  async getReceipt(
    @Param('withdrawalId') withdrawalId: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const expNum = Number.parseInt(exp ?? '', 10);
    if (!sig || !this.urls.verify(withdrawalId, expNum, sig)) {
      // URL inválida ou expirada — não vazar informação.
      throw new ForbiddenException('Assinatura inválida ou expirada.');
    }

    const row = await this.prisma.withdrawalRequest.findUnique({
      where: { id: withdrawalId },
      select: { gatewayReceiptBase64: true },
    });
    if (!row?.gatewayReceiptBase64) {
      throw new NotFoundException('Comprovante indisponível.');
    }

    const buffer = Buffer.from(row.gatewayReceiptBase64, 'base64');
    reply
      .header(
        'Content-Type',
        detectImageMime(row.gatewayReceiptBase64) ?? 'image/png',
      )
      .header('Cache-Control', 'private, max-age=60')
      .send(buffer);
  }
}
