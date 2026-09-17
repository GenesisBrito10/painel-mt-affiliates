// ─── Notification Domain Exceptions ──────────────────────────────────────────
// Pure Error subclasses — no NestJS dependency.
// Mapped to HTTP status codes in HttpExceptionFilter.DOMAIN_EXCEPTION_MAP.

export class NotificationNotFoundException extends Error {
  readonly name = 'NotificationNotFoundException';

  constructor(id: string) {
    super(`Notification "${id}" not found`);
  }
}

export class NotificationAccessDeniedException extends Error {
  readonly name = 'NotificationAccessDeniedException';

  constructor() {
    super('You do not have permission to access this notification');
  }
}

export class PushSubscriptionNotFoundException extends Error {
  readonly name = 'PushSubscriptionNotFoundException';

  constructor(id: string) {
    super(`Push subscription "${id}" not found`);
  }
}

export class PushSubscriptionAlreadyExistsException extends Error {
  readonly name = 'PushSubscriptionAlreadyExistsException';

  constructor() {
    super('Push subscription already registered for this endpoint');
  }
}
