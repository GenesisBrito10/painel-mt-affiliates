import { Injectable, Logger } from '@nestjs/common';
import {
  type LinkAssignmentOutcome,
  type LinkAssignmentOrigin,
  type LinkAssignmentRuleApplied,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface LinkAssignmentLogEntry {
  linkRequestId?: string | null;
  userId: string;
  userName?: string;
  houseSlug: string;
  inviterId?: string | null;
  inviterCpa?: number | null;
  assignedCpa?: number | null;
  ruleApplied?: LinkAssignmentRuleApplied | null;
  outcome: LinkAssignmentOutcome;
  origin: LinkAssignmentOrigin;
  togglesApplied?: string[];
  requiredHouses?: string[];
  missingHouses?: string[];
  statusBefore?: string;
  statusAfter?: string;
  adminName?: string;
  reason?: string | null;
  message?: string;
}

/** Grava logs por solicitação (auditoria/suporte). Falha de log nunca quebra o fluxo. */
@Injectable()
export class LinkAssignmentLogService {
  private readonly logger = new Logger(LinkAssignmentLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: LinkAssignmentLogEntry): Promise<void> {
    try {
      await this.prisma.linkAssignmentLog.create({
        data: {
          linkRequestId: entry.linkRequestId ?? null,
          userId: entry.userId,
          userName: entry.userName ?? '',
          houseSlug: entry.houseSlug,
          inviterId: entry.inviterId ?? null,
          inviterCpa: entry.inviterCpa ?? null,
          assignedCpa: entry.assignedCpa ?? null,
          ruleApplied: entry.ruleApplied ?? null,
          outcome: entry.outcome,
          origin: entry.origin,
          togglesApplied: entry.togglesApplied ?? [],
          requiredHouses: entry.requiredHouses ?? [],
          missingHouses: entry.missingHouses ?? [],
          statusBefore: entry.statusBefore ?? '',
          statusAfter: entry.statusAfter ?? '',
          adminName: entry.adminName ?? '',
          reason: entry.reason ?? null,
          message: entry.message ?? '',
        },
      });
    } catch (err) {
      this.logger.error(
        `Falha ao gravar LinkAssignmentLog (${entry.outcome}/${entry.houseSlug}): ${(err as Error).message}`,
      );
    }
  }
}
