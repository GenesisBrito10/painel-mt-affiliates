import { BadRequestException, NotFoundException } from '@nestjs/common';

/**
 * Erro vindo da Evolution GO. Mensagem já sanitizada (sem secrets/QR).
 * `definitiveMedia` indica falha de mídia que NÃO deve ser reprocessada
 * (cai no fallback de texto), distinta de erro recuperável (timeout/rede).
 */
export class EvolutionApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number | null = null,
    readonly definitiveMedia = false,
  ) {
    super(message);
    this.name = 'EvolutionApiError';
  }
}

export class WhatsappNotConfiguredException extends BadRequestException {
  constructor(detail = 'WhatsApp não configurado') {
    super(detail);
  }
}

export class WhatsappGroupNotSelectedException extends BadRequestException {
  constructor() {
    super('Nenhum grupo selecionado para envio dos comprovantes.');
  }
}

export class WhatsappSendLogNotFoundException extends NotFoundException {
  constructor(id: string) {
    super(`Registro de envio ${id} não encontrado.`);
  }
}

export class WhatsappRetryNotAllowedException extends BadRequestException {
  constructor(status: string) {
    super(`Reenvio não permitido para status ${status}.`);
  }
}
