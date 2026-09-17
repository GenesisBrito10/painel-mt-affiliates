// Domain exceptions — pure TS, no NestJS/Prisma dependencies.
// Mapped to HTTP status codes in HttpExceptionFilter.

export class ProviderAccountNotFoundException extends Error {
  readonly name = 'ProviderAccountNotFoundException';
  constructor(id?: string) {
    super(id ? `Provider account "${id}" not found` : 'Provider account not found');
  }
}

export class HouseAlreadyAssociatedException extends Error {
  readonly name = 'HouseAlreadyAssociatedException';
  constructor(slug: string) {
    super(`House "${slug}" is already associated with this account`);
  }
}

export class ProviderAccountConflictException extends Error {
  readonly name = 'ProviderAccountConflictException';
  constructor(message: string) {
    super(message);
  }
}

export class HouseNotFoundException extends Error {
  readonly name = 'HouseNotFoundException';
  constructor(slug: string) {
    super(`Betting house "${slug}" not found`);
  }
}
