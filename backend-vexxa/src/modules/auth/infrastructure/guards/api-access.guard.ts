import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { JwtPayload } from '../../domain/auth.types.js';

/**
 * Gates the API + Webhook features. Admin/superadmin always pass; any other
 * user must have been explicitly enabled by an admin (`User.apiAccessEnabled`).
 * Use AFTER JwtAuthGuard so `request.user` is populated.
 */
@Injectable()
export class ApiAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const user = request.user;
    if (!user) throw new ForbiddenException('Você não tem permissão');

    if (user.role === UserRole.ADMIN || user.role === UserRole.SUPERADMIN) {
      return true;
    }

    const row = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { apiAccessEnabled: true },
    });
    if (row?.apiAccessEnabled) return true;

    throw new ForbiddenException('Você não tem permissão');
  }
}
