// Domain exceptions for Auth — pure TS, no NestJS/HTTP deps.
// Mapped to HTTP in HttpExceptionFilter.

export class InvalidCredentialsException extends Error {
  readonly name = 'InvalidCredentialsException';
  constructor() {
    super('Invalid email or password');
  }
}

export class AccountInactiveException extends Error {
  readonly name = 'AccountInactiveException';
  constructor() {
    super('Account is inactive or rejected');
  }
}

export class AccountPendingException extends Error {
  readonly name = 'AccountPendingException';
  constructor() {
    super('Account is pending approval. Please wait for an admin or your referrer to approve your registration.');
  }
}

export class AccountBlockedException extends Error {
  readonly name = 'AccountBlockedException';
  constructor() {
    super('Sua conta foi bloqueada por atividade suspeita. Entre em contato com o suporte para mais informações.');
  }
}

export class EmailAlreadyRegisteredException extends Error {
  readonly name = 'EmailAlreadyRegisteredException';
  constructor(email: string) {
    super(`Email "${email}" is already registered`);
  }
}

export class AccountLockedException extends Error {
  readonly name = 'AccountLockedException';
  constructor(remainingSeconds: number) {
    const minutes = Math.ceil(remainingSeconds / 60);
    super(`Conta temporariamente bloqueada por tentativas excessivas. Tente novamente em ${minutes} minuto(s).`);
  }
}

export class InvalidRefreshTokenException extends Error {
  readonly name = 'InvalidRefreshTokenException';
  constructor() {
    super('Invalid or expired refresh token');
  }
}
