import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WithdrawalService } from './withdrawal.service.js';

/**
 * Cron que destrava saques presos em PROCESSING quando o webhook PayOut* do
 * gateway se perde. Delega a lógica (idempotente) a
 * {@link WithdrawalService.reconcileStuckProcessing}.
 */
@Injectable()
export class WithdrawalReconcileService {
  private readonly logger = new Logger(WithdrawalReconcileService.name);
  private running = false;

  constructor(private readonly withdrawals: WithdrawalService) {}

  @Cron(CronExpression.EVERY_5_MINUTES, {
    name: 'withdrawal-reconcile-stuck',
  })
  async run(): Promise<void> {
    // Evita sobreposição: muitos saques presos significam várias consultas ao
    // gateway, que podem ultrapassar a janela de 5 min entre ticks.
    if (this.running) {
      this.logger.warn('Reconcile já em andamento — pulando este tick.');
      return;
    }
    this.running = true;
    try {
      await this.withdrawals.reconcileStuckProcessing();
    } catch (err) {
      this.logger.error(
        `Reconcile cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
