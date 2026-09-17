import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

export class ConversationNotFoundException extends NotFoundException {
  constructor() {
    super('Conversa de suporte não encontrada.');
  }
}

export class InvalidMessageContentException extends BadRequestException {
  constructor() {
    super('A mensagem deve ter entre 1 e 2000 caracteres.');
  }
}

export class ConversationClosedException extends BadRequestException {
  constructor() {
    super('Esta conversa já foi encerrada.');
  }
}

export class ConversationAccessDeniedException extends ForbiddenException {
  constructor() {
    super('Você não tem acesso a esta conversa.');
  }
}

export class AgentAssignmentDeniedException extends ForbiddenException {
  constructor() {
    super('Apenas o agente atribuído pode responder ou encerrar esta conversa.');
  }
}

export class OutsideBusinessHoursException extends BadRequestException {
  constructor() {
    super(
      'O atendimento funciona de segunda a sexta, das 09h às 12h e das 14h às 18h.',
    );
  }
}

export class MessageNotFoundException extends NotFoundException {
  constructor() {
    super('Mensagem não encontrada.');
  }
}

export class MessageEditDeniedException extends ForbiddenException {
  constructor() {
    super('Você só pode editar suas próprias mensagens.');
  }
}
