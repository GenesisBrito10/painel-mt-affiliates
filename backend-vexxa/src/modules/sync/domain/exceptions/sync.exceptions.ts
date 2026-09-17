// Domain exceptions — framework-agnostic, mapped to HTTP status in HttpExceptionFilter

export class SyncAlreadyRunningException extends Error {
  constructor(bettingHouse: string) {
    super(`Sync already running for house "${bettingHouse}"`);
    this.name = 'SyncAlreadyRunningException';
  }
}

export class ProviderLoginFailedException extends Error {
  constructor(provider: string, reason: string) {
    super(`Login failed for provider "${provider}": ${reason}`);
    this.name = 'ProviderLoginFailedException';
  }
}

export class ProviderFetchFailedException extends Error {
  constructor(provider: string, date: string, reason: string) {
    super(`Fetch failed for provider "${provider}" on ${date}: ${reason}`);
    this.name = 'ProviderFetchFailedException';
  }
}

export class UnsupportedProviderException extends Error {
  constructor(provider: string) {
    super(`Provider "${provider}" is not supported`);
    this.name = 'UnsupportedProviderException';
  }
}
