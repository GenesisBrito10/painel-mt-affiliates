import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type {
  IAuthRepository,
  AuthUserView,
  CreatedUserView,
} from '../../domain/repositories/auth.repository.js';

@Injectable()
export class AuthPrismaRepository implements IAuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<AuthUserView | null> {
    return this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        password: true,
        role: true,
        status: true,
        active: true,
        isExternal: true,
      },
    });
  }

  async findByReferralCode(code: string): Promise<{ id: string } | null> {
    return this.prisma.user.findFirst({
      where: {
        referralCode: code,
        active: true,
        status: 'APPROVED',
        deletedAt: null,
      },
      select: { id: true },
    });
  }

  async findAdminIds(): Promise<string[]> {
    const admins = await this.prisma.user.findMany({
      where: {
        role: { in: [UserRole.ADMIN, UserRole.SUPERADMIN] },
        active: true,
      },
      select: { id: true },
    });
    return admins.map((a) => a.id);
  }

  async createUser(data: {
    name: string;
    email: string;
    password: string;
    referralCode: string;
    referredById?: string;
  }): Promise<CreatedUserView> {
    return this.prisma.user.create({
      data,
      select: { id: true, email: true, role: true },
    });
  }
}
