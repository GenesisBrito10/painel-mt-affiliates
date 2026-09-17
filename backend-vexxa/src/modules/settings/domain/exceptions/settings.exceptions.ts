// ─── Settings Domain Exceptions ───────────────────────────────────────────────
// Pure Error subclasses — no NestJS dependency.
// Mapped to HTTP status codes in HttpExceptionFilter.DOMAIN_EXCEPTION_MAP.

export class SettingNotFoundException extends Error {
  readonly name = 'SettingNotFoundException';

  constructor(key: string) {
    super(`Setting "${key}" not found`);
  }
}

export class SettingKeyInvalidException extends Error {
  readonly name = 'SettingKeyInvalidException';

  constructor(key: string) {
    super(`Setting key "${key}" is invalid. Must be lowercase letters and underscores only.`);
  }
}

export class SettingProtectedKeyException extends Error {
  readonly name = 'SettingProtectedKeyException';

  constructor(key: string) {
    super(`Setting "${key}" is a protected system setting and cannot be deleted.`);
  }
}
