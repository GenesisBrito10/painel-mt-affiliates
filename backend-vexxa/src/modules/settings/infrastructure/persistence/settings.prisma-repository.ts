import { Injectable } from '@nestjs/common';
import type { Setting } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type {
  ISettingsRepository,
  SettingCreateData,
} from '../../domain/ports/settings.repository.js';

@Injectable()
export class SettingsPrismaRepository implements ISettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Read ────────────────────────────────────────────────────────────────

  async findByKey(key: string): Promise<Setting | null> {
    return this.prisma.setting.findUnique({ where: { key } });
  }

  async findByKeys(keys: string[]): Promise<Setting[]> {
    return this.prisma.setting.findMany({ where: { key: { in: keys } } });
  }

  async findAll(): Promise<Setting[]> {
    return this.prisma.setting.findMany({ orderBy: { key: 'asc' } });
  }

  // ─── Write ───────────────────────────────────────────────────────────────

  async upsert(data: SettingCreateData): Promise<Setting> {
    return this.prisma.setting.upsert({
      where: { key: data.key },
      create: { key: data.key, value: data.value, label: data.label ?? '' },
      update: {
        value: data.value,
        ...(data.label !== undefined && { label: data.label }),
      },
    });
  }

  async delete(key: string): Promise<void> {
    await this.prisma.setting.delete({ where: { key } });
  }
}
