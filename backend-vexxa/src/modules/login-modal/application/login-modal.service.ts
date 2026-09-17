import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { LoginModalAudience, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { FileUploadService } from '../../file-upload/file-upload.service.js';
import type { MultipartFile } from '../../file-upload/multipart.helper.js';
import type { JwtPayload } from '../../auth/domain/auth.types.js';
import {
  CreateLoginModalDto,
  ReorderLoginModalsDto,
  UpdateLoginModalDto,
} from './dto/update-login-modal.dto.js';

const ADMIN_AUDIENCES = [
  LoginModalAudience.ADMIN,
  LoginModalAudience.SUPERADMIN,
];

@Injectable()
export class LoginModalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fileUpload: FileUploadService,
  ) {}

  async listForUser(user: JwtPayload) {
    const audiences = await this.resolveAudiences(user);
    const modals = await this.prisma.loginModal.findMany({
      where: {
        enabled: true,
        audience: { in: audiences },
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });

    return modals.map((modal) => ({
      ...modal,
      payload: this.filterPayloadByAudience(modal.payload, audiences),
    }));
  }

  async listForAdmin() {
    return this.prisma.loginModal.findMany({
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async create(dto: CreateLoginModalDto) {
    const title = dto.title.trim();
    const baseKey = this.slugify(title) || 'modal';
    const key = await this.nextAvailableKey(baseKey);
    const highest = await this.prisma.loginModal.findFirst({
      orderBy: { priority: 'desc' },
      select: { priority: true },
    });
    const priority = typeof dto.priority === 'number'
      ? dto.priority
      : (highest?.priority ?? 0) + 10;

    return this.prisma.loginModal.create({
      data: {
        key,
        enabled: false,
        audience: dto.audience ?? LoginModalAudience.AFFILIATE,
        priority,
        kind: 'notice',
        title,
        eyebrow: 'Novo aviso',
        description: '',
        icon: 'i-lucide-megaphone',
        actionLabel: 'Entendi',
        secondaryActionLabel: 'Agora não',
        actionUrl: null,
        accent: 'brand',
        storageKey: `login-modal-${key}-v1`,
        dismissScope: 'session',
        imageUrl: null,
        imageLayout: 'none',
        lockSeconds: 0,
        payload: {
          paragraphs: ['Escreva aqui o texto principal do aviso.'],
          blocks: [],
          steps: [],
          footer: '',
          actionIcon: 'i-lucide-check-circle',
        },
      },
    });
  }

  async update(key: string, dto: UpdateLoginModalDto) {
    const existing = await this.prisma.loginModal.findUnique({ where: { key } });
    if (!existing) throw new NotFoundException('Login modal not found');

    const data: Prisma.LoginModalUpdateInput = {};
    if (typeof dto.enabled === 'boolean') data.enabled = dto.enabled;
    if (typeof dto.audience === 'string') data.audience = dto.audience;
    if (typeof dto.priority === 'number') data.priority = dto.priority;
    if (typeof dto.kind === 'string') data.kind = dto.kind.trim() || existing.kind;
    if (typeof dto.title === 'string') data.title = dto.title.trim() || existing.title;
    if (typeof dto.eyebrow === 'string') data.eyebrow = dto.eyebrow.trim();
    if (typeof dto.description === 'string') data.description = dto.description.trim();
    if (typeof dto.icon === 'string') data.icon = dto.icon.trim();
    if (typeof dto.actionLabel === 'string') {
      data.actionLabel = dto.actionLabel.trim() || existing.actionLabel;
    }
    if (typeof dto.secondaryActionLabel === 'string') {
      data.secondaryActionLabel = dto.secondaryActionLabel.trim();
    }
    if (dto.actionUrl !== undefined) {
      data.actionUrl = dto.actionUrl ? dto.actionUrl.trim() : null;
    }
    if (typeof dto.accent === 'string') data.accent = dto.accent.trim() || existing.accent;
    if (typeof dto.storageKey === 'string') data.storageKey = dto.storageKey.trim();
    if (typeof dto.dismissScope === 'string') {
      data.dismissScope = dto.dismissScope.trim() || existing.dismissScope;
    }
    if (dto.imageUrl !== undefined) {
      data.imageUrl = dto.imageUrl ? dto.imageUrl.trim() : null;
    }
    if (typeof dto.imageLayout === 'string') data.imageLayout = dto.imageLayout;
    if (typeof dto.lockSeconds === 'number') data.lockSeconds = dto.lockSeconds;
    if (dto.payload !== undefined) data.payload = dto.payload as Prisma.InputJsonValue;

    return this.prisma.loginModal.update({
      where: { key },
      data,
    });
  }

  async reorder(dto: ReorderLoginModalsDto) {
    const keys = dto.items.map((item) => item.key);
    const uniqueKeys = new Set(keys);
    if (uniqueKeys.size !== keys.length) {
      throw new ConflictException('Duplicated login modal key in reorder request');
    }

    await this.prisma.$transaction(
      dto.items.map((item) => this.prisma.loginModal.update({
        where: { key: item.key },
        data: { priority: item.priority },
      })),
    );

    return this.listForAdmin();
  }

  async delete(key: string) {
    const existing = await this.prisma.loginModal.findUnique({ where: { key } });
    if (!existing) throw new NotFoundException('Login modal not found');
    await this.prisma.loginModal.delete({ where: { key } });
    return { success: true };
  }

  async uploadImage(file: MultipartFile) {
    return this.fileUpload.uploadObject({
      buffer: file.buffer,
      mimeType: file.mimeType,
      filename: file.filename,
      scopePrefix: 'login-modals',
    });
  }

  private slugify(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }

  private async nextAvailableKey(baseKey: string) {
    let key = baseKey;
    let suffix = 1;
    while (await this.prisma.loginModal.findUnique({ where: { key } })) {
      suffix += 1;
      key = `${baseKey}-${suffix}`;
    }
    return key;
  }

  private async resolveAudiences(user: JwtPayload): Promise<LoginModalAudience[]> {
    const base = [LoginModalAudience.ALL];

    if (user.role === UserRole.AFFILIATE) {
      const referrals = await this.prisma.user.count({
        where: { referredById: user.sub, deletedAt: null },
      });

      return referrals > 0
        ? [...base, LoginModalAudience.AFFILIATE, LoginModalAudience.HEAD_AFFILIATE]
        : [...base, LoginModalAudience.AFFILIATE];
    }

    if (user.role === UserRole.SUPPORT) return [...base, LoginModalAudience.SUPPORT];
    if (user.role === UserRole.SUPERADMIN) {
      return [...base, ...ADMIN_AUDIENCES];
    }

    return [...base, LoginModalAudience.ADMIN];
  }

  private filterPayloadByAudience(
    payload: Prisma.JsonValue,
    audiences: LoginModalAudience[],
  ): Prisma.JsonValue {
    if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
      return payload;
    }

    const objectPayload = payload as Record<string, unknown>;
    const blocks = objectPayload['blocks'];
    if (!Array.isArray(blocks)) return payload;

    return {
      ...objectPayload,
      blocks: blocks.filter((block) => {
        if (!block || typeof block !== 'object') return false;
        const audience = (block as Record<string, unknown>)['audience'];
        return typeof audience !== 'string'
          || audiences.includes(audience as LoginModalAudience);
      }),
    } as Prisma.JsonObject;
  }
}
