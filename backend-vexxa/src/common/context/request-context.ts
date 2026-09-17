import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Origem de uma mudança de comissão (cpa/revshare). Usada pela extensão Prisma
 * de auditoria (prisma-audit.extension) para preencher CommissionLog.source.
 */
export type ChangeSource =
  | 'APPROVAL' // aprovação de afiliado (head/admin)
  | 'ASSIGNMENT' // atribuição automática (pools de link)
  | 'ADMIN_EDIT' // edição via painel admin
  | 'SYNC' // enriquecimento por sync da casa
  | 'RESTORE' // restauração/migração de dados
  | 'SCRIPT'; // script avulso / cron sem request

export interface ChangeContext {
  changedById?: string | null;
  source?: ChangeSource;
}

const als = new AsyncLocalStorage<ChangeContext>();

/**
 * Contexto ambiente da request/cron, propagado via AsyncLocalStorage.
 * - `run(ctx, fn)`: executa `fn` com o contexto ativo (ex.: interceptor por
 *   request, ou wrapper em crons/scripts).
 * - `get()`: lido pela extensão Prisma ao gravar CommissionLog.
 */
export const requestContext = {
  run<T>(ctx: ChangeContext, fn: () => T): T {
    return als.run(ctx, fn);
  },
  get(): ChangeContext | undefined {
    return als.getStore();
  },
};
