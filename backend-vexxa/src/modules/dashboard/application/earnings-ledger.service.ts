import { Injectable, Inject, StreamableFile } from '@nestjs/common';
import { EARNINGS_REPOSITORY } from '../domain/ports/earnings.repository.js';
import type { IEarningsRepository } from '../domain/ports/earnings.repository.js';
import type { EarningsLedgerQueryDto, LedgerPageDto } from './dto/earnings.dto.js';
import type { JwtPayload } from '../../auth/domain/auth.types.js';
import { Readable } from 'stream';
import type { LedgerEventType } from '@prisma/client';

@Injectable()
export class EarningsLedgerService {
  constructor(
    @Inject(EARNINGS_REPOSITORY)
    private readonly repo: IEarningsRepository,
  ) {}

  async getLedgerPage(
    user: JwtPayload,
    query: EarningsLedgerQueryDto,
  ): Promise<LedgerPageDto> {
    const filter = {
      userId: user.sub,
      startDate: query.startDate ? new Date(`${query.startDate}T00:00:00.000Z`) : undefined,
      endDate: query.endDate ? new Date(`${query.endDate}T23:59:59.999Z`) : undefined,
      eventType: query.eventType as LedgerEventType | undefined,
      bettingHouse: query.bettingHouse,
    };

    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;

    const [entries, total, summary] = await Promise.all([
      this.repo.findLedgerEntries(filter, skip, limit),
      this.repo.countLedgerEntries(filter),
      this.repo.getPeriodSummary(filter),
    ]);

    return {
      data: entries.map(e => ({
        id: e.id,
        date: e.eventDate.toISOString(),
        eventType: e.eventType,
        eventLabel: this.getEventLabel(e.eventType),
        amount: e.amount.toNumber(),
        bettingHouse: e.bettingHouse,
        sourceName: e.description, // fallback for sourceName
        status: e.status,
        referenceId: e.referenceId,
      })),
      total,
      page,
      limit,
      periodSummary: summary,
    };
  }

  async exportCsv(
    user: JwtPayload,
    query: Pick<EarningsLedgerQueryDto, 'startDate' | 'endDate' | 'eventType' | 'bettingHouse'>,
  ): Promise<StreamableFile> {
    const filter = {
      userId: user.sub,
      startDate: query.startDate ? new Date(`${query.startDate}T00:00:00.000Z`) : undefined,
      endDate: query.endDate ? new Date(`${query.endDate}T23:59:59.999Z`) : undefined,
      eventType: query.eventType as LedgerEventType | undefined,
      bettingHouse: query.bettingHouse,
    };

    // Export a large limit of recent events for CSV
    const entries = await this.repo.findLedgerEntries(filter, 0, 10000);

    let csvContent = 'ID,Date,Type,Label,Amount,Betting House,Status,Description,Reference\n';
    for (const e of entries) {
      csvContent += `${e.id},${e.eventDate.toISOString()},${e.eventType},${this.getEventLabel(e.eventType)},${e.amount.toNumber()},${e.bettingHouse ?? ''},${e.status},"${e.description.replace(/"/g, '""')}",${e.referenceId ?? ''}\n`;
    }

    const stream = Readable.from([Buffer.from(csvContent, 'utf-8')]);
    return new StreamableFile(stream, {
      type: 'text/csv',
      disposition: 'attachment; filename="financial_ledger_export.csv"',
    });
  }

  private getEventLabel(type: string): string {
    const labels: Record<string, string> = {
      COMMISSION_CPA: 'CPA Direto',
      COMMISSION_REVSHARE: 'RevShare Direto',
      NETWORK_CPA: 'CPA de Rede',
      NETWORK_REVSHARE: 'RevShare de Rede',
      FRAUD_DEDUCTION_DIRECT: 'Dedução Fraude (Direto)',
      FRAUD_DEDUCTION_NETWORK: 'Dedução Fraude (Rede)',
      WITHDRAWAL_APPROVED: 'Saque Aprovado',
      BONUS_CREDIT: 'Crédito de Bônus',
      MANUAL_ADJUSTMENT: 'Ajuste Manual',
    };
    return labels[type] || type;
  }
}
