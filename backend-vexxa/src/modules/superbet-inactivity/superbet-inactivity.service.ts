import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma, UserStatus } from '@prisma/client';
import { MailService } from '../mail/index.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  extractSuperbetCampaignId,
  SuperbetSheetService,
} from '../superbet-link-pool/index.js';

const SUPERBET_SLUG = 'superbet';
const BATCH_SIZE = 50;

type SuperbetUser = Prisma.UserGetPayload<{
  select: {
    id: true;
    name: true;
    email: true;
    status: true;
    active: true;
    superbetInactiveDays: true;
    affiliateLinks: {
      select: {
        id: true;
        campaignId: true;
      };
    };
  };
}>;

@Injectable()
export class SuperbetInactivityService {
  private readonly logger = new Logger(SuperbetInactivityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly sheetService: SuperbetSheetService,
  ) {}

  @Cron('0 6 * * *', {
    timeZone: 'America/Sao_Paulo',
    name: 'superbet-inactivity-compliance',
  })
  async handleDailyCheck(): Promise<void> {
    // PAUSED for correction — feature was suspending/blocking affiliates badly.
    // Re-enable only after the fix by setting SUPERBET_INACTIVITY_ENABLED=true.
    if (process.env['SUPERBET_INACTIVITY_ENABLED'] !== 'true') {
      this.logger.warn(
        'Superbet inactivity check is PAUSED (set SUPERBET_INACTIVITY_ENABLED=true to re-enable).',
      );
      return;
    }

    const targetDate = this.getYesterdayInSaoPaulo();
    this.logger.log(
      `Superbet inactivity check started for ${this.formatDate(targetDate)}.`,
    );

    let cursor: string | undefined;
    let processed = 0;

    for (;;) {
      const users = await this.findEligibleUsers(cursor);
      if (users.length === 0) break;

      for (const user of users) {
        await this.processUser(user, targetDate).catch((err: unknown) => {
          this.logger.error(
            `Superbet inactivity check failed for user ${user.id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
        processed += 1;
      }

      cursor = users.at(-1)?.id;
      if (users.length < BATCH_SIZE) break;
    }

    this.logger.log(
      `Superbet inactivity check finished. Processed ${processed} affiliate(s).`,
    );
  }

  async processUser(user: SuperbetUser, targetDate: Date): Promise<void> {
    const campaignIds = user.affiliateLinks
      .map((link) => link.campaignId)
      .filter(Boolean);

    if (campaignIds.length === 0) return;

    const hasProduction = await this.hasQftdForDate(campaignIds, targetDate);
    if (hasProduction) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          superbetInactiveDays: 0,
          superbetLastActiveAt: targetDate,
        },
      });
      return;
    }

    const nextInactiveDays = user.superbetInactiveDays + 1;

    if (nextInactiveDays >= 3) {
      await this.blockUser(user, targetDate, nextInactiveDays);
      await this.sendWarning(user, 3);
      return;
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { superbetInactiveDays: nextInactiveDays },
    });
    await this.sendWarning(user, nextInactiveDays === 1 ? 1 : 2);
  }

  private async findEligibleUsers(cursor?: string): Promise<SuperbetUser[]> {
    return this.prisma.user.findMany({
      where: {
        status: UserStatus.APPROVED,
        active: true,
        affiliateLinks: {
          some: { bettingHouse: SUPERBET_SLUG, deletedAt: null },
        },
      },
      orderBy: { id: 'asc' },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: BATCH_SIZE,
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        active: true,
        superbetInactiveDays: true,
        affiliateLinks: {
          where: { bettingHouse: SUPERBET_SLUG, deletedAt: null },
          select: { id: true, campaignId: true },
        },
      },
    });
  }

  private async hasQftdForDate(
    campaignIds: string[],
    targetDate: Date,
  ): Promise<boolean> {
    const nextDate = new Date(targetDate);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);

    const row = await this.prisma.affiliateData.findFirst({
      where: {
        bettingHouse: SUPERBET_SLUG,
        campaignId: { in: campaignIds },
        date: { gte: targetDate, lt: nextDate },
        qftd: { gt: 0 },
      },
      select: { id: true },
    });

    return Boolean(row);
  }

  private async blockUser(
    user: SuperbetUser,
    targetDate: Date,
    inactiveDays: number,
  ): Promise<void> {
    const linkIds = user.affiliateLinks.map((link) => link.id);
    const campaignIds = user.affiliateLinks.map((link) => link.campaignId);
    const blockedAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      // SOFT-DELETE (não deleteMany): preserva campaignId/link/cpa. Foi o
      // deleteMany aqui que causou a perda de ~2588 links. Hard-delete é
      // bloqueado pela extensão Prisma.
      await tx.affiliateLink.updateMany({
        where: {
          userId: user.id,
          bettingHouse: SUPERBET_SLUG,
          deletedAt: null,
        },
        data: { deletedAt: blockedAt },
      });
      await tx.user.update({
        where: { id: user.id },
        data: {
          status: UserStatus.BLOCKED,
          active: false,
          superbetInactiveDays: 0,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: null,
          userName: 'Sistema',
          userEmail: 'system@vexxa.local',
          action: 'SUPERBET_AUTO_BLOCK',
          resource: 'users',
          method: 'CRON',
          path: 'superbet-inactivity',
          details: {
            reason: '3_consecutive_days_without_qftd',
            targetUserId: user.id,
            targetUserEmail: user.email,
            inactiveDays,
            evaluationDate: this.formatDate(targetDate),
            blockedAt: blockedAt.toISOString(),
            removedAffiliateLinkIds: linkIds,
            removedCampaignIds: campaignIds,
          },
        },
      });
    });

    await this.releaseSheetRows(user, campaignIds);
  }

  private async releaseSheetRows(
    user: SuperbetUser,
    campaignIds: string[],
  ): Promise<void> {
    try {
      const rows = await this.sheetService.readPool();
      const matchedRows = rows.filter((row) => {
        const parsed = extractSuperbetCampaignId(row.link);
        if (!parsed) return false;
        return campaignIds.includes(`${parsed.siteid}-${parsed.c}`);
      });

      for (const row of matchedRows) {
        await this.sheetService.clearRowAssignment(row.rowIndex);
      }

      if (matchedRows.length > 0) {
        this.logger.log(
          `Released ${matchedRows.length} Superbet sheet row(s) for blocked user ${user.id}.`,
        );
      }
    } catch (err: unknown) {
      this.logger.error(
        `[INCONSISTÊNCIA] Superbet links were removed from DB for blocked user ${user.id}, but sheet cleanup failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async sendWarning(user: SuperbetUser, warning: 1 | 2 | 3) {
    const template = this.getEmailTemplate(user.name, warning);
    try {
      await this.mail.send({
        to: user.email,
        bcc: process.env['SUPERBET_INACTIVITY_EMAIL_COPY_TO'] || undefined,
        subject: template.subject,
        text: template.text,
        html: template.html,
      });
    } catch (err: unknown) {
      this.logger.warn(
        `Failed to send Superbet inactivity warning ${warning} to ${user.email}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private getEmailTemplate(name: string, warning: 1 | 2 | 3) {
    const panelUrl =
      process.env['AFFILIATE_PANEL_URL'] ||
      'https://affiliates.vallexgroup.com.br';
    const logoUrl = `${panelUrl.replace(/\/+$/, '')}/vallex-logo-white.png`;

    if (warning === 1) {
      const subject = '⚠️ Você está inativo na Superbet';
      const title = 'Primeiro aviso de inatividade';
      const message =
        'Identificamos que você não gerou nenhum QFTD na Superbet ontem. Este é o primeiro aviso da regra de inatividade.';
      const consequence =
        'Se a inatividade continuar por mais 2 dias consecutivos, seu link Superbet poderá ser removido automaticamente.';
      const action =
        'Acesse o painel e retome sua produção para manter seu link ativo.';

      return {
        subject,
        text: this.buildWarningText({
          name,
          title,
          message,
          consequence,
          action,
          panelUrl,
        }),
        html: this.buildWarningHtml({
          name,
          title,
          badge: 'Aviso 1 de 3',
          message,
          consequence,
          action,
          panelUrl,
          logoUrl,
        }),
      };
    }

    if (warning === 2) {
      const subject = '⚠️ Último aviso — link da Superbet será suspenso';
      const title = 'Último aviso antes da suspensão';
      const message =
        'Você está há 2 dias consecutivos sem gerar QFTD na Superbet.';
      const consequence =
        'Se não houver produção hoje, seu link Superbet será removido e seu acesso ao painel será bloqueado automaticamente.';
      const action = 'Produza hoje para evitar o bloqueio automático.';

      return {
        subject,
        text: this.buildWarningText({
          name,
          title,
          message,
          consequence,
          action,
          panelUrl,
        }),
        html: this.buildWarningHtml({
          name,
          title,
          badge: 'Aviso 2 de 3',
          message,
          consequence,
          action,
          panelUrl,
          logoUrl,
        }),
      };
    }

    const subject = '🔒 Sua conta foi bloqueada por inatividade';
    const title = 'Conta bloqueada por inatividade';
    const message =
      'Sua conta foi bloqueada por 3 dias consecutivos sem gerar QFTD na Superbet.';
    const consequence =
      'Seu link Superbet foi removido automaticamente e o acesso ao painel foi bloqueado.';
    const action =
      'Entre em contato com o suporte para solicitar a análise de reativação do seu acesso.';

    return {
      subject,
      text: this.buildWarningText({
        name,
        title,
        message,
        consequence,
        action,
      }),
      html: this.buildWarningHtml({
        name,
        title,
        badge: 'Aviso 3 de 3',
        message,
        consequence,
        action,
        logoUrl,
      }),
    };
  }

  private buildWarningText(input: {
    name: string;
    title: string;
    message: string;
    consequence: string;
    action: string;
    panelUrl?: string;
  }): string {
    return `Olá ${input.name},

${input.title}

${input.message}

${input.consequence}

${input.action}${input.panelUrl ? `\n\nAcessar painel: ${input.panelUrl}` : ''}

Equipe Vallex Company`;
  }

  private buildWarningHtml(input: {
    name: string;
    title: string;
    badge: string;
    message: string;
    consequence: string;
    action: string;
    panelUrl?: string;
    logoUrl: string;
  }): string {
    const name = this.escapeHtml(input.name);
    const title = this.escapeHtml(input.title);
    const badge = this.escapeHtml(input.badge);
    const message = this.escapeHtml(input.message);
    const consequence = this.escapeHtml(input.consequence);
    const action = this.escapeHtml(input.action);
    const panelUrl = input.panelUrl ? this.escapeHtml(input.panelUrl) : '';
    const logoUrl = this.escapeHtml(input.logoUrl);

    const cta = panelUrl
      ? `<a href="${panelUrl}" style="display:inline-block;background:#a28820;color:#ffffff;text-decoration:none;font-weight:700;border-radius:8px;padding:12px 18px;margin-top:8px;">Acessar painel</a>`
      : '';

    return `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#17202a;">
    <div style="display:none;max-height:0;overflow:hidden;">${title}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fb;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e6e9ef;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="background:#121820;color:#ffffff;padding:22px 24px;">
                <div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#d6c46f;">Superbet</div>
                <h1 style="margin:8px 0 0;font-size:22px;line-height:1.25;">${title}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <span style="display:inline-block;background:#fff7d6;color:#6d5700;font-size:12px;font-weight:700;border-radius:999px;padding:6px 10px;margin-bottom:16px;">${badge}</span>
                <p style="margin:0 0 14px;font-size:16px;line-height:1.55;">Olá ${name},</p>
                <p style="margin:0 0 14px;font-size:16px;line-height:1.55;">${message}</p>
                <p style="margin:0 0 14px;font-size:16px;line-height:1.55;">${consequence}</p>
                <p style="margin:0 0 18px;font-size:16px;line-height:1.55;">${action}</p>
                ${cta}
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;border-top:1px solid #eef1f6;padding-top:18px;">
                  <tr>
                    <td align="left" style="vertical-align:bottom;">
                      <img src="${logoUrl}" width="118" alt="Vallex Company" style="display:block;width:118px;max-width:118px;height:auto;border:0;outline:none;text-decoration:none;">
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  private getYesterdayInSaoPaulo(now: Date = new Date()): Date {
    const today = this.getSaoPauloDateString(now);
    const yesterday = new Date(`${today}T00:00:00.000Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    return yesterday;
  }

  private getSaoPauloDateString(date: Date): string {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'America/Sao_Paulo',
    }).format(date);
  }

  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
