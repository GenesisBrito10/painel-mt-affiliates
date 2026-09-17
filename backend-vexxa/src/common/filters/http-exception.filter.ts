import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

export interface Rfc7807Error {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  timestamp: string;
}

// Domain exception → HTTP status mapping (no NestJS exceptions in domain layer)
const DOMAIN_EXCEPTION_MAP: Record<string, number> = {
  // User domain
  UserNotFoundException: HttpStatus.NOT_FOUND,
  BettingHouseNotFoundException: HttpStatus.NOT_FOUND,
  AffiliateLinkNotFoundException: HttpStatus.NOT_FOUND,
  EmailAlreadyInUseException: HttpStatus.CONFLICT,
  CpfAlreadyInUseException: HttpStatus.CONFLICT,
  DuplicateCampaignException: HttpStatus.CONFLICT,
  AdminNotFoundException: HttpStatus.FORBIDDEN,
  UserBlockedException: HttpStatus.CONFLICT,
  BlockNotAllowedException: HttpStatus.FORBIDDEN,
  UserNotBlockedException: HttpStatus.CONFLICT,
  // KYC domain
  InvalidCpfException: HttpStatus.BAD_REQUEST,
  UnderageException: HttpStatus.FORBIDDEN,
  ImmutableFieldException: HttpStatus.FORBIDDEN,
  OnboardingAlreadyCompleteException: HttpStatus.CONFLICT,
  // Auth domain
  InvalidCredentialsException: HttpStatus.UNAUTHORIZED,
  AccountInactiveException: HttpStatus.UNAUTHORIZED,
  AccountPendingException: HttpStatus.FORBIDDEN,
  AccountBlockedException: HttpStatus.FORBIDDEN,
  EmailAlreadyRegisteredException: HttpStatus.CONFLICT,
  AccountLockedException: 423,          // 423 Locked
  InvalidRefreshTokenException: HttpStatus.UNAUTHORIZED,
  // ProviderAccount domain
  ProviderAccountNotFoundException: HttpStatus.NOT_FOUND,
  HouseNotFoundException: HttpStatus.NOT_FOUND,
  HouseAlreadyAssociatedException: HttpStatus.CONFLICT,
  ProviderAccountConflictException: HttpStatus.CONFLICT,
  // Sync domain
  SyncAlreadyRunningException: HttpStatus.CONFLICT,
  ProviderLoginFailedException: HttpStatus.BAD_GATEWAY,
  ProviderFetchFailedException: HttpStatus.BAD_GATEWAY,
  UnsupportedProviderException: HttpStatus.UNPROCESSABLE_ENTITY,
  // Ranking domain
  PrizeNotFoundException: HttpStatus.NOT_FOUND,
  PrizeAlreadyFinalizedException: HttpStatus.CONFLICT,
  PrizeNotActiveException: HttpStatus.BAD_REQUEST,
  PrizeRedemptionBlockedException: HttpStatus.BAD_REQUEST,
  PrizeRevertBlockedException: HttpStatus.BAD_REQUEST,
  WinnerNotAuthorizedException: HttpStatus.FORBIDDEN,
  PrizeValidationException: HttpStatus.BAD_REQUEST,
  // Notification domain
  NotificationNotFoundException: HttpStatus.NOT_FOUND,
  NotificationAccessDeniedException: HttpStatus.FORBIDDEN,
  PushSubscriptionNotFoundException: HttpStatus.NOT_FOUND,
  PushSubscriptionAlreadyExistsException: HttpStatus.CONFLICT,
  // Settings domain
  SettingNotFoundException: HttpStatus.NOT_FOUND,
  SettingKeyInvalidException: HttpStatus.BAD_REQUEST,
  SettingProtectedKeyException: HttpStatus.FORBIDDEN,
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reply = ctx.getResponse<any>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = ctx.getRequest<any>();

    const status = this.resolveStatus(exception);
    const detail = this.extractDetail(exception, status);

    const body: Rfc7807Error = {
      type: `${this.getProblemBaseUrl(req)}/errors/${this.statusToSlug(status)}`,
      title: this.statusToTitle(status),
      status,
      detail,
      instance: req.url ?? '/',
      timestamp: new Date().toISOString(),
    };

    if (status >= 500) {
      this.logger.error(
        `[${status}] ${req.method ?? 'UNKNOWN'} ${req.url ?? '/'} — ${detail}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    // Fastify reply API: reply.status().header().send()
    reply.status(status).header('content-type', 'application/problem+json').send(body);
  }

  private getProblemBaseUrl(req: { protocol?: string; hostname?: string; headers?: Record<string, string | string[] | undefined> }): string {
    const configured = process.env['APP_PUBLIC_URL'];
    if (configured) return configured.replace(/\/$/, '');

    const forwardedProto = this.firstHeader(req.headers?.['x-forwarded-proto']);
    const forwardedHost = this.firstHeader(req.headers?.['x-forwarded-host']);
    const host = forwardedHost ?? this.firstHeader(req.headers?.['host']) ?? req.hostname ?? 'localhost:3011';
    const protocol = forwardedProto ?? req.protocol ?? 'http';

    return `${protocol}://${host}`;
  }

  private firstHeader(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
  }

  private resolveStatus(exception: unknown): number {
    if (exception instanceof HttpException) return exception.getStatus();
    if (exception instanceof Error) {
      const mapped = DOMAIN_EXCEPTION_MAP[exception.name];
      if (mapped !== undefined) return mapped;
    }
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private extractDetail(exception: unknown, status: number): string {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (typeof response === 'string') return response;
      if (typeof response === 'object' && response !== null) {
        const obj = response as Record<string, unknown>;
        if (Array.isArray(obj['message'])) {
          return (obj['message'] as string[]).join('; ');
        }
        if (typeof obj['message'] === 'string') return obj['message'];
      }
    }
    if (exception instanceof Error) return exception.message;
    return status >= 500 ? 'An unexpected error occurred' : 'Request failed';
  }

  private statusToSlug(status: number): string {
    const map: Record<number, string> = {
      400: 'bad-request',
      401: 'unauthorized',
      403: 'forbidden',
      404: 'not-found',
      409: 'conflict',
      422: 'unprocessable-entity',
      423: 'locked',
      429: 'too-many-requests',
      500: 'internal-server-error',
    };
    return map[status] ?? 'error';
  }

  private statusToTitle(status: number): string {
    const map: Record<number, string> = {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      409: 'Conflict',
      422: 'Unprocessable Entity',
      423: 'Locked',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
    };
    return map[status] ?? 'Error';
  }
}
