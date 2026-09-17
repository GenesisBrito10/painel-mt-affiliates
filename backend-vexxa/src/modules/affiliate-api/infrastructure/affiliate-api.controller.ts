import {
  Controller,
  Body,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiAccessGuard, CurrentUser, JwtAuthGuard } from '../../auth/index.js';
import type { JwtPayload } from '../../auth/index.js';
import { AffiliateApiService } from '../application/affiliate-api.service.js';
import { AffiliateApiSandboxService } from '../application/affiliate-api-sandbox.service.js';
import {
  AffiliateApiTokenGuard,
  type AffiliateApiRequest,
} from '../application/affiliate-api-token.guard.js';
import {
  AffiliateApiCreateLinkRequestDto,
  AffiliateApiCreateWithdrawalDto,
  AffiliateApiListWithdrawalsQueryDto,
  AffiliateApiMetricsQueryDto,
  AffiliateApiTokenEnvDto,
  AffiliateApiUpdateWithdrawalStatusDto,
  AffiliateApiUserQueryDto,
  type IAffiliateApiOps,
} from '../application/dto/affiliate-api.dto.js';

@ApiTags('affiliate-api')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ApiAccessGuard)
@Controller({ path: 'affiliate-api', version: '1' })
export class AffiliateApiController {
  constructor(private readonly service: AffiliateApiService) {}

  @Get('token')
  getTokenStatus(@CurrentUser() user: JwtPayload) {
    return this.service.getTokenStatus(user.sub);
  }

  @Post('token')
  generateToken(
    @CurrentUser() user: JwtPayload,
    @Query() query: AffiliateApiTokenEnvDto,
  ) {
    return this.service.generateToken(user.sub, query.environment ?? 'live');
  }

  @Delete('token')
  revokeToken(
    @CurrentUser() user: JwtPayload,
    @Query() query: AffiliateApiTokenEnvDto,
  ) {
    return this.service.revokeToken(user.sub, query.environment ?? 'live');
  }

  @Get('affiliates')
  listAffiliates(@CurrentUser() user: JwtPayload) {
    return this.service.listAllowedAffiliates(user.sub);
  }
}

@ApiTags('affiliate-api-public')
@ApiBearerAuth()
@UseGuards(AffiliateApiTokenGuard)
@Controller({ path: 'affiliate-api', version: '1' })
export class AffiliateApiPublicController {
  constructor(
    private readonly service: AffiliateApiService,
    private readonly sandbox: AffiliateApiSandboxService,
  ) {}

  // Route to the live service or the isolated sandbox based on the token's
  // environment. The sandbox never touches production tables.
  private ops(request: AffiliateApiRequest): IAffiliateApiOps {
    return request.affiliateApiOwner.environment === 'test'
      ? this.sandbox
      : this.service;
  }

  @Get('metrics')
  getMetrics(
    @Req() request: AffiliateApiRequest,
    @Query() query: AffiliateApiMetricsQueryDto,
  ) {
    return this.ops(request).getMetrics(
      request.affiliateApiOwner.userId,
      query,
    );
  }

  @Post('link-requests')
  createLinkRequest(
    @Req() request: AffiliateApiRequest,
    @Body() dto: AffiliateApiCreateLinkRequestDto,
  ) {
    return this.ops(request).createLinkRequestFromApi(
      request.affiliateApiOwner.userId,
      dto,
    );
  }

  // ── Withdrawals ──────────────────────────────────────────────────────────

  @Get('users/:externalUserId')
  getUser(
    @Req() request: AffiliateApiRequest,
    @Param('externalUserId') externalUserId: string,
    @Query() query: AffiliateApiUserQueryDto,
  ) {
    return this.ops(request).getExternalUser(
      request.affiliateApiOwner.userId,
      externalUserId,
      query,
    );
  }

  @Post('withdrawals')
  createWithdrawal(
    @Req() request: AffiliateApiRequest,
    @Body() dto: AffiliateApiCreateWithdrawalDto,
  ) {
    return this.ops(request).createWithdrawalFromApi(
      request.affiliateApiOwner.userId,
      dto,
    );
  }

  @Get('withdrawals')
  listWithdrawals(
    @Req() request: AffiliateApiRequest,
    @Query() query: AffiliateApiListWithdrawalsQueryDto,
  ) {
    return this.ops(request).listWithdrawalsFromApi(
      request.affiliateApiOwner.userId,
      query,
    );
  }

  @Get('withdrawals/:id')
  getWithdrawal(@Req() request: AffiliateApiRequest, @Param('id') id: string) {
    return this.ops(request).getWithdrawalFromApi(
      request.affiliateApiOwner.userId,
      id,
    );
  }

  @Patch('withdrawals/:id/status')
  setWithdrawalStatus(
    @Req() request: AffiliateApiRequest,
    @Param('id') id: string,
    @Body() dto: AffiliateApiUpdateWithdrawalStatusDto,
  ) {
    return this.ops(request).setWithdrawalStatusFromApi(
      request.affiliateApiOwner.userId,
      id,
      dto,
    );
  }

  // Reset the caller's sandbox data. Only valid with a test token.
  @Delete('sandbox')
  resetSandbox(@Req() request: AffiliateApiRequest) {
    if (request.affiliateApiOwner.environment !== 'test') {
      throw new ForbiddenException(
        'Reset disponível apenas para token de teste (vex_test_).',
      );
    }
    return this.sandbox.reset(request.affiliateApiOwner.userId);
  }
}
