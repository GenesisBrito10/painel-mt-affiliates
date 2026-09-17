import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import {
  CurrentUser,
  JwtAuthGuard,
  Roles,
  RolesGuard,
} from '../../auth/index.js';
import type { JwtPayload } from '../../auth/domain/auth.types.js';
import { readMultipartFile } from '../../file-upload/multipart.helper.js';
import { LoginModalService } from '../application/login-modal.service.js';
import {
  CreateLoginModalDto,
  ReorderLoginModalsDto,
  UpdateLoginModalDto,
} from '../application/dto/update-login-modal.dto.js';

@ApiTags('Login Modals')
@ApiBearerAuth()
@Controller({ path: 'login-modals', version: '1' })
@UseGuards(JwtAuthGuard)
export class LoginModalController {
  constructor(private readonly modals: LoginModalService) {}

  @Get()
  @ApiOperation({ summary: 'List enabled login modals for the current user' })
  list(@CurrentUser() user: JwtPayload) {
    return this.modals.listForUser(user);
  }
}

@ApiTags('Admin / Login Modals')
@ApiBearerAuth()
@Controller({ path: 'admin/login-modals', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPERADMIN)
export class AdminLoginModalController {
  constructor(private readonly modals: LoginModalService) {}

  @Get()
  @ApiOperation({ summary: 'List all login modals' })
  list() {
    return this.modals.listForAdmin();
  }

  @Post()
  @ApiOperation({ summary: 'Create login modal' })
  create(@Body() dto: CreateLoginModalDto) {
    return this.modals.create(dto);
  }

  @Post('upload-image')
  @ApiOperation({ summary: 'Upload login modal image to R2' })
  async uploadImage(@Req() req: FastifyRequest) {
    const file = await readMultipartFile(req);
    return this.modals.uploadImage(file);
  }

  @Patch('reorder')
  @ApiOperation({ summary: 'Reorder login modals' })
  reorder(@Body() dto: ReorderLoginModalsDto) {
    return this.modals.reorder(dto);
  }

  @Put(':key')
  @ApiOperation({ summary: 'Update login modal by key' })
  update(@Param('key') key: string, @Body() dto: UpdateLoginModalDto) {
    return this.modals.update(key, dto);
  }

  @Delete(':key')
  @ApiOperation({ summary: 'Delete login modal by key' })
  remove(@Param('key') key: string) {
    return this.modals.delete(key);
  }
}
