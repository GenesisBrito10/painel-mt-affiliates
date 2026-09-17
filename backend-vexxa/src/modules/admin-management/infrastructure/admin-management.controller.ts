import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  CurrentUser,
  JwtAuthGuard,
  type JwtPayload,
  Roles,
  RolesGuard,
} from '../../auth/index.js';
import { AdminManagementService } from '../application/admin-management.service.js';
import {
  ChangeAdminPasswordDto,
  CreateAdminDto,
  ListAdminsQueryDto,
  UpdateAdminDto,
} from '../application/dto/admin-management.dto.js';

@ApiTags('Admin Management')
@ApiBearerAuth()
@Controller({ path: 'admin/admins', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPERADMIN)
export class AdminManagementController {
  constructor(private readonly service: AdminManagementService) {}

  @Get()
  @ApiOperation({ summary: 'Listar admins/superadmins' })
  list(@Query() query: ListAdminsQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obter admin por id' })
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Criar novo admin' })
  create(@CurrentUser() actor: JwtPayload, @Body() dto: CreateAdminDto) {
    return this.service.create(actor.role, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar nome / email / role' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: JwtPayload,
    @Body() dto: UpdateAdminDto,
  ) {
    return this.service.update(id, actor.sub, actor.role, dto);
  }

  @Patch(':id/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Alterar senha' })
  async changePassword(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: JwtPayload,
    @Body() dto: ChangeAdminPasswordDto,
  ): Promise<void> {
    await this.service.changePassword(id, actor.role, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remover admin (soft delete)' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: JwtPayload,
  ): Promise<void> {
    await this.service.softDelete(id, actor.sub, actor.role);
  }
}
