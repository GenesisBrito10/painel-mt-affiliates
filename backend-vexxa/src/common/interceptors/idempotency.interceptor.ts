import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { Redis } from 'ioredis';
import type { FastifyRequest } from 'fastify';
import { REDIS_CLIENT } from '../../modules/shared/shared.module.js';

/**
 * IdempotencyInterceptor prevents duplicate submissions by locking the route for a specific user.
 * It uses Redis to acquire a lock based on the `userId` and the requested path.
 * If a request is already in progress, it rejects the new request with HTTP 409 Conflict.
 * The lock is released once the response is sent or an error occurs.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const user = (request as any).user;

    // If no user is authenticated, we cannot lock by userId. Just proceed.
    if (!user || !user.sub) {
      return next.handle();
    }

    // Key format: lock:idempotency:{userId}:{method}:{path}
    const lockKey = `lock:idempotency:${user.sub}:${request.method}:${request.routeOptions.url || request.url}`;
    
    // Acquire lock with a TTL of 30 seconds to prevent deadlocks if the app crashes
    const acquired = await this.redis.set(lockKey, 'locked', 'EX', 30, 'NX');

    if (!acquired) {
      throw new HttpException(
        'Sua solicitação anterior ainda está sendo processada. Por favor, aguarde.',
        HttpStatus.CONFLICT,
      );
    }

    return next.handle().pipe(
      finalize(() => {
        // Release the lock when the request finishes (success or error).
        // TTL of 30s ensures eventual release even if this fails.
        this.redis
          .del(lockKey)
          .catch((err: unknown) =>
            this.logger.warn(
              `Failed to release idempotency lock ${lockKey}: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
      }),
    );
  }
}
