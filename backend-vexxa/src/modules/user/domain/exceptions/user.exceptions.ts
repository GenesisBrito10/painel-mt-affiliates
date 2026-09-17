// Domain exceptions — pure TS, no NestJS/Prisma dependencies.
// The HttpExceptionFilter maps these to HTTP status codes.

export class UserNotFoundException extends Error {
  readonly name = 'UserNotFoundException';
  constructor(id?: string) {
    super(id ? `User "${id}" not found` : 'User not found');
  }
}

export class EmailAlreadyInUseException extends Error {
  readonly name = 'EmailAlreadyInUseException';
  constructor(email: string) {
    super(`Email "${email}" is already in use`);
  }
}

export class CpfAlreadyInUseException extends Error {
  readonly name = 'CpfAlreadyInUseException';
  constructor() {
    super('Este CPF já está cadastrado em outra conta.');
  }
}

export class AffiliateLinkNotFoundException extends Error {
  readonly name = 'AffiliateLinkNotFoundException';
  constructor() {
    super('Affiliate link not found or does not belong to this user');
  }
}

export class DuplicateCampaignException extends Error {
  readonly name = 'DuplicateCampaignException';
  constructor(campaignId: string, bettingHouse: string) {
    super(`Campaign "${campaignId}" already registered for house "${bettingHouse}"`);
  }
}

export class BettingHouseNotFoundException extends Error {
  readonly name = 'BettingHouseNotFoundException';
  constructor(slug: string) {
    super(`Betting house "${slug}" not found`);
  }
}

export class AdminNotFoundException extends Error {
  readonly name = 'AdminNotFoundException';
}

export class UserBlockedException extends Error {
  readonly name = 'UserBlockedException';
  constructor(id: string) {
    super(`User "${id}" is already blocked`);
  }
}

export class BlockNotAllowedException extends Error {
  readonly name = 'BlockNotAllowedException';
  constructor() {
    super('Você só pode bloquear seus convidados diretos.');
  }
}

export class UserNotBlockedException extends Error {
  readonly name = 'UserNotBlockedException';
  constructor(id: string) {
    super(`User "${id}" is not currently blocked`);
  }
}

export class InvalidCpfException extends Error {
  readonly name = 'InvalidCpfException';
  constructor() {
    super('O CPF informado é inválido. Verifique os dígitos e tente novamente.');
  }
}

export class UnderageException extends Error {
  readonly name = 'UnderageException';
  constructor() {
    super('É necessário ter 18 anos ou mais para utilizar a plataforma.');
  }
}

export class ImmutableFieldException extends Error {
  readonly name = 'ImmutableFieldException';
  constructor(field: string) {
    super(`O campo "${field}" não pode ser alterado após o cadastro. Entre em contato com o suporte.`);
  }
}

export class OnboardingAlreadyCompleteException extends Error {
  readonly name = 'OnboardingAlreadyCompleteException';
  constructor() {
    super('O cadastro de identidade já foi concluído e não pode ser refeito.');
  }
}
