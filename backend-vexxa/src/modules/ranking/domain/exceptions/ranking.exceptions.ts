// Domain exceptions — framework-agnostic, mapped to HTTP status in HttpExceptionFilter

export class PrizeNotFoundException extends Error {
  constructor(prizeId: string) {
    super(`Premiação "${prizeId}" não encontrada.`);
    this.name = 'PrizeNotFoundException';
  }
}

export class PrizeAlreadyFinalizedException extends Error {
  constructor(prizeId: string) {
    super(`Premiação "${prizeId}" já foi finalizada.`);
    this.name = 'PrizeAlreadyFinalizedException';
  }
}

export class PrizeNotActiveException extends Error {
  constructor(prizeId: string) {
    super(`Premiação "${prizeId}" não está ativa. Apenas premiações ativas podem ser editadas.`);
    this.name = 'PrizeNotActiveException';
  }
}

export class PrizeRedemptionBlockedException extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'PrizeRedemptionBlockedException';
  }
}

export class PrizeRevertBlockedException extends Error {
  constructor(prizeId: string) {
    super(
      `Não é possível reverter a premiação "${prizeId}": um ou mais vencedores já resgataram o prêmio.`,
    );
    this.name = 'PrizeRevertBlockedException';
  }
}

export class WinnerNotAuthorizedException extends Error {
  constructor(userId: string, prizeId: string) {
    super(`Usuário "${userId}" não é um vencedor da premiação "${prizeId}".`);
    this.name = 'WinnerNotAuthorizedException';
  }
}

export class PrizeValidationException extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'PrizeValidationException';
  }
}
