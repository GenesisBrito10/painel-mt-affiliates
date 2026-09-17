import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Unauthenticated endpoints consumed by marketing/auth pages (e.g. the
 * "nossas casas parceiras" strip on the login screen). No @UseGuards here —
 * keep this controller limited to data that's safe to expose pre-login.
 */
@ApiTags('Public')
@Controller({ path: 'public', version: '1' })
export class PublicController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('betting-houses')
  @ApiOperation({ summary: 'Active betting houses for public branding (no auth)' })
  async listBettingHouses() {
    const houses = await this.prisma.bettingHouse.findMany({
      where: { active: true },
      select: { id: true, name: true, slug: true, logoUrl: true },
      orderBy: { name: 'asc' },
    });
    return { data: houses };
  }
}
