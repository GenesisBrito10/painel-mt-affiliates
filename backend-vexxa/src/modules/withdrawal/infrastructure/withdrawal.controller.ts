import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { UserRole } from '@prisma/client';
import {
  JwtAuthGuard,
  RolesGuard,
  Roles,
  CurrentUser,
} from '../../auth/index.js';
import type { JwtPayload } from '../../auth/domain/auth.types.js';
import { WithdrawalService } from '../application/withdrawal.service.js';
import { IdempotencyInterceptor } from '../../../common/interceptors/idempotency.interceptor.js';
import {
  CreateWithdrawalDto,
  ListWithdrawalsQueryDto,
  UpdateWithdrawalStatusDto,
  ApproveWithdrawalDto,
  ManualPaymentDto,
} from '../application/dto/withdrawal.dto.js';

@ApiTags('withdrawals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'withdrawals', version: '1' })
export class WithdrawalController {
  constructor(private readonly withdrawalService: WithdrawalService) {}

  /**
   * POST /v1/withdrawals
   * Request a withdrawal for the full available balance.
   * Validates PIX, min amount, deposit compliance and 1/day rate limit.
   */
  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateWithdrawalDto) {
    return this.withdrawalService.create(user, dto);
  }

  /**
   * GET /v1/withdrawals
   * List withdrawals. Users see only their own; admins see all.
   * Supports pagination and optional date range filter.
   */
  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListWithdrawalsQueryDto,
  ) {
    return this.withdrawalService.list(user, query);
  }

  /**
   * GET /v1/withdrawals/rules
   * Per-casa withdrawal cadence rules + per-casa available balance for the
   * caller. Frontend uses this to render the casa selector with disabled
   * cards (out-of-window) and balance preview.
   */
  @Get('rules')
  listWithdrawalRules(@CurrentUser() user: JwtPayload) {
    return this.withdrawalService.listWithdrawalRules(user);
  }

  /**
   * GET /v1/withdrawals/panels  [ADMIN]
   * Lists provider accounts referenced by at least one AffiliateLink.
   * Used as filter source on the admin withdrawals page.
   */
  @Get('panels')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  listPanels() {
    return this.withdrawalService.listPanels();
  }

  /**
   * GET /v1/withdrawals/stats
   * Aggregated counts and sums (pending / approved / paid) respecting filters.
   * Same query schema as list endpoint.
   */
  @Get('stats')
  getStats(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListWithdrawalsQueryDto,
  ) {
    return this.withdrawalService.getStats(user, query);
  }

  /**
   * GET /v1/withdrawals/balance-breakdown/:userId  [ADMIN]
   * Returns full balance breakdown for any user (spread model + fraud + withdrawals).
   * Must be declared BEFORE :id to avoid route collision.
   */
  @Get('balance-breakdown/:userId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  getBalanceBreakdown(@Param('userId') userId: string) {
    return this.withdrawalService.getBalanceBreakdown(userId);
  }

  /**
   * PUT /v1/withdrawals/:id  [ADMIN]
   * Reject a pending withdrawal. Approval moved to POST :id/approve.
   */
  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  updateStatus(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateWithdrawalStatusDto,
  ) {
    return this.withdrawalService.updateStatus(id, user.sub, dto);
  }

  /**
   * POST /v1/withdrawals/:id/approve  [ADMIN]
   * Confirm a PENDING withdrawal — atomic transition + dispatch to HeartPay
   * gateway via POST /api/v1/client/payouts. confirmAmount must match server-side
   * originalAmount to defend against stale UI.
   */
  @Post(':id/approve')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @UseInterceptors(IdempotencyInterceptor)
  approve(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ApproveWithdrawalDto,
  ) {
    return this.withdrawalService.approveAndDispatch(id, user.sub, dto);
  }

  /**
   * POST /v1/withdrawals/:id/mark-paid  [ADMIN]
   * Manually mark a PENDING/APPROVED/PROCESSING withdrawal as COMPLETED,
   * bypassing the payment gateway (use when gateway is offline).
   */
  @Post(':id/mark-paid')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  markPaidManually(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ManualPaymentDto,
  ) {
    return this.withdrawalService.markPaidManually(id, user.sub, dto);
  }

  /**
   * GET /v1/withdrawals/:id/receipt
   * Fetch the HeartPay PIX OUT receipt (PNG, base64) for a COMPLETED/FAILED
   * withdrawal. Affiliates can only fetch their own; admins fetch any.
   */
  @Get(':id/receipt')
  getReceipt(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.withdrawalService.getReceipt(user, id);
  }
}
