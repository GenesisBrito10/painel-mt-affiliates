import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { requestContext } from '../context/request-context.js';

/**
 * Popula o AsyncLocalStorage com { changedById, source } por request HTTP, para
 * que a extensão Prisma de auditoria saiba QUEM mudou um cpa/revshare.
 *
 * source padrão = 'ADMIN_EDIT' (qualquer write via painel). Fluxos específicos
 * (aprovação, atribuição automática, sync) sobrescrevem com requestContext.run()
 * aninhado, definindo a origem correta.
 *
 * `als.run(..., () => next.handle())` mantém o contexto ativo durante toda a
 * execução assíncrona do handler (AsyncLocalStorage propaga pelos awaits).
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context
      .switchToHttp()
      .getRequest<{ user?: { sub?: string; id?: string } }>();
    const changedById = req.user?.sub ?? req.user?.id ?? null;
    return requestContext.run({ changedById, source: 'ADMIN_EDIT' }, () =>
      next.handle(),
    );
  }
}
