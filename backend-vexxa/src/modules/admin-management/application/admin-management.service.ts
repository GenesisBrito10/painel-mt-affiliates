import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  AdminManageableRole,
  ChangeAdminPasswordDto,
  CreateAdminDto,
  ListAdminsQueryDto,
  UpdateAdminDto,
} from './dto/admin-management.dto.js';

const ADMIN_ROLES: AdminManageableRole[] = [
  UserRole.SUPPORT,
  UserRole.ADMIN,
  UserRole.SUPERADMIN,
];

const BCRYPT_ROUNDS = 12;

export interface AdminListItem {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AdminManagementService {
  private readonly logger = new Logger(AdminManagementService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListAdminsQueryDto): Promise<{
    data: AdminListItem[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {
      role: query.role ? query.role : { in: ADMIN_ROLES },
      deletedAt: null,
    };

    if (query.search) {
      const term = query.search.trim();
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { email: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          active: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { data: items, total, page, limit };
  }

  async getById(id: string): Promise<AdminListItem> {
    const admin = await this.prisma.user.findFirst({
      where: { id, role: { in: ADMIN_ROLES }, deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!admin) throw new NotFoundException('Admin não encontrado.');
    return admin;
  }

  async create(
    actorRole: UserRole,
    dto: CreateAdminDto,
  ): Promise<AdminListItem> {
    if (dto.role === UserRole.SUPERADMIN && actorRole !== UserRole.SUPERADMIN) {
      throw new ForbiddenException(
        'Apenas superadmins podem criar outro superadmin.',
      );
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('E-mail já cadastrado.');
    }

    const hash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const created = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        password: hash,
        role: dto.role,
        status: 'APPROVED',
        active: true,
        profileCompleted: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    this.logger.log(`Admin created: ${created.email} (${created.role})`);
    return created;
  }

  async update(
    id: string,
    actorId: string,
    actorRole: UserRole,
    dto: UpdateAdminDto,
  ): Promise<AdminListItem> {
    const target = await this.getById(id);

    if (dto.role && id === actorId && dto.role !== target.role) {
      throw new ForbiddenException(
        'Você não pode alterar o próprio nível de acesso.',
      );
    }

    if (
      dto.role &&
      dto.role !== target.role &&
      actorRole !== UserRole.SUPERADMIN
    ) {
      throw new ForbiddenException(
        'Apenas superadmins podem alterar o nível de acesso.',
      );
    }

    if (
      target.role === UserRole.SUPERADMIN &&
      actorRole !== UserRole.SUPERADMIN
    ) {
      throw new ForbiddenException(
        'Apenas superadmins podem editar outro superadmin.',
      );
    }

    if (dto.email && dto.email !== target.email) {
      const conflict = await this.prisma.user.findUnique({
        where: { email: dto.email },
        select: { id: true },
      });
      if (conflict && conflict.id !== id) {
        throw new ConflictException('E-mail já cadastrado.');
      }
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.role !== undefined ? { role: dto.role } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return updated;
  }

  async changePassword(
    id: string,
    actorRole: UserRole,
    dto: ChangeAdminPasswordDto,
  ): Promise<void> {
    const target = await this.getById(id);
    if (
      target.role === UserRole.SUPERADMIN &&
      actorRole !== UserRole.SUPERADMIN
    ) {
      throw new ForbiddenException(
        'Apenas superadmins podem alterar a senha de outro superadmin.',
      );
    }
    const hash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id },
      data: { password: hash },
    });
    this.logger.log(`Admin password changed: ${id}`);
  }

  async softDelete(
    id: string,
    actorId: string,
    actorRole: UserRole,
  ): Promise<void> {
    if (id === actorId) {
      throw new ForbiddenException('Você não pode remover a própria conta.');
    }

    const target = await this.getById(id);

    if (
      target.role === UserRole.SUPERADMIN &&
      actorRole !== UserRole.SUPERADMIN
    ) {
      throw new ForbiddenException(
        'Apenas superadmins podem remover outro superadmin.',
      );
    }

    if (target.role === UserRole.SUPERADMIN) {
      const remaining = await this.prisma.user.count({
        where: {
          role: UserRole.SUPERADMIN,
          deletedAt: null,
          id: { not: id },
        },
      });
      if (remaining === 0) {
        throw new BadRequestException(
          'É necessário ao menos 1 superadmin ativo no sistema.',
        );
      }
    }

    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), active: false },
    });
    this.logger.log(`Admin soft-deleted: ${id}`);
  }
}
