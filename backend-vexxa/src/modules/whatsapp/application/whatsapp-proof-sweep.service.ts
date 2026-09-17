import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WhatsappProofProducer } from '../infrastructure/queues/whatsapp-proof.producer.js';

/**
 * Cron que re-enfileira comprovantes WhatsApp presos em PENDING (job nunca
 * chegou à fila ou se perdeu). Delega a
 * {@link WhatsappProofProducer.requeuePendingProofs}.
 */
@Injectable()
export class WhatsappProofSweepService {
  private readonly logger = new Logger(WhatsappProofSweepService.name);
  private running = false;

  constructor(private readonly producer: WhatsappProofProducer) {}

  @Cron(CronExpression.EVERY_5_MINUTES, {
    name: 'whatsapp-proof-requeue-stuck',
  })
  async run(): Promise<void> {
    if (this.running) {
      this.logger.warn(
        'Requeue de comprovantes já em andamento — pulando tick.',
      );
      return;
    }
    this.running = true;
    try {
      await this.producer.requeuePendingProofs();
    } catch (err) {
      this.logger.error(
        `Requeue cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
