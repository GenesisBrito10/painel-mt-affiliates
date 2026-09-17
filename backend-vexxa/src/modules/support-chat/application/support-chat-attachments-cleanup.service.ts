import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FileUploadService } from '../../file-upload/file-upload.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const ORPHAN_TTL_MS = 24 * 60 * 60 * 1000;
const SUPPORT_PREFIX = 'support';
const DB_LOOKUP_BATCH = 500;

@Injectable()
export class SupportChatAttachmentsCleanupService {
  private readonly logger = new Logger(
    SupportChatAttachmentsCleanupService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly fileUpload: FileUploadService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, {
    timeZone: 'America/Sao_Paulo',
    name: 'support-chat-orphan-cleanup',
  })
  async runCleanup(): Promise<void> {
    try {
      const { scanned, deleted } = await this.cleanupOrphans();
      if (scanned > 0) {
        this.logger.log(
          `Orphan attachment scan complete — scanned=${scanned} deleted=${deleted}`,
        );
      }
    } catch (error) {
      this.logger.error(`Orphan cleanup failed: ${(error as Error).message}`);
    }
  }

  async cleanupOrphans(
    now = Date.now(),
  ): Promise<{ scanned: number; deleted: number }> {
    const candidates: Array<{ key: string; url: string }> = [];
    let scanned = 0;

    for await (const entry of this.fileUpload.listObjects(SUPPORT_PREFIX)) {
      scanned += 1;
      if (!entry.lastModified) continue;
      if (now - entry.lastModified.getTime() < ORPHAN_TTL_MS) continue;
      candidates.push({
        key: entry.key,
        url: this.fileUpload.buildPublicUrl(entry.key),
      });
    }

    let deleted = 0;
    for (let i = 0; i < candidates.length; i += DB_LOOKUP_BATCH) {
      const batch = candidates.slice(i, i + DB_LOOKUP_BATCH);
      const referenced = await this.prisma.supportMessage.findMany({
        where: { attachmentUrl: { in: batch.map((item) => item.url) } },
        select: { attachmentUrl: true },
      });
      const referencedSet = new Set(referenced.map((row) => row.attachmentUrl));
      const orphans = batch
        .filter((item) => !referencedSet.has(item.url))
        .map((item) => item.key);
      if (orphans.length > 0) {
        await this.fileUpload.deleteObjects(orphans);
        deleted += orphans.length;
      }
    }

    return { scanned, deleted };
  }
}
