import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole, type WhatsappSettings } from '@prisma/client';
import {
  CurrentUser,
  JwtAuthGuard,
  Roles,
  RolesGuard,
} from '../../auth/index.js';
import type { JwtPayload } from '../../auth/domain/auth.types.js';
import { WhatsappConnectionService } from '../application/whatsapp-connection.service.js';
import { WhatsappSettingsService } from '../application/whatsapp-settings.service.js';
import { WhatsappTargetGroupService } from '../application/whatsapp-target-group.service.js';
import { EvolutionClient } from './clients/evolution.client.js';
import { WhatsappSendHistoryService } from '../application/whatsapp-send-history.service.js';
import { WhatsappProofProducer } from './queues/whatsapp-proof.producer.js';
import {
  renderTemplate,
  sampleTemplateVars,
  validateTemplate,
} from '../application/whatsapp-template.js';
import {
  AddTargetGroupDto,
  ListSendHistoryDto,
  PreviewTemplateDto,
  TestNumberDto,
  UpdateWhatsappSettingsDto,
} from '../application/dto/whatsapp.dto.js';

/** Endpoints admin do WhatsApp. SUPERADMIN é aceito explicitamente além de ADMIN. */
@ApiTags('whatsapp')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPERADMIN)
@Controller({ path: 'whatsapp', version: '1' })
export class WhatsappController {
  constructor(
    private readonly connection: WhatsappConnectionService,
    private readonly settings: WhatsappSettingsService,
    private readonly targetGroups: WhatsappTargetGroupService,
    private readonly history: WhatsappSendHistoryService,
    private readonly producer: WhatsappProofProducer,
    private readonly evolution: EvolutionClient,
  ) {}

  // ─── Conexão ───────────────────────────────────────────────────────────────

  @Get('status')
  @ApiOperation({
    summary: '[Admin] Status atual da conexão (atualiza via Evolution)',
  })
  status() {
    return this.connection.syncStatus();
  }

  @Post('connect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Cria/conecta a instância e retorna o QR' })
  connect() {
    return this.connection.connect();
  }

  @Get('qrcode')
  @ApiOperation({ summary: '[Admin] QR code para parear o número' })
  qrcode() {
    return this.connection.getQrCode();
  }

  @Post('reconnect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Reconecta a instância' })
  reconnect() {
    return this.connection.reconnect();
  }

  @Post('disconnect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Desconecta a instância' })
  disconnect() {
    return this.connection.disconnect();
  }

  @Post('reset-circuit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Zera o circuit breaker (retoma envios)' })
  resetCircuit() {
    return this.connection.resetCircuitBreaker();
  }

  @Post('refresh-instance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      '[Admin] Limpa o cache do token da instância e re-resolve ' +
      '(usar após reconectar a instância na Evolution)',
  })
  refreshInstance() {
    return this.connection.refreshInstanceCache();
  }

  @Get('groups')
  @ApiOperation({ summary: '[Admin] Lista grupos/comunidades disponíveis' })
  groups() {
    return this.connection.listGroups();
  }

  // ─── Grupos de destino (multi-grupo) ───────────────────────────────────────

  @Get('target-groups')
  @ApiOperation({
    summary: '[Admin] Grupos de destino salvos dos comprovantes',
  })
  targetGroupsList() {
    return this.targetGroups.list();
  }

  @Post('target-groups')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Admin] Adiciona um grupo de destino (sem repetição)',
  })
  addTargetGroup(@Body() dto: AddTargetGroupDto) {
    return this.targetGroups.add(dto.groupId, dto.name ?? '');
  }

  @Delete('target-groups/:groupId')
  @ApiOperation({ summary: '[Admin] Remove um grupo de destino' })
  async removeTargetGroup(@Param('groupId') groupId: string) {
    await this.targetGroups.remove(groupId);
    return { removed: true };
  }

  @Post('target-groups/:groupId/test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Envia teste para um grupo específico' })
  async testTargetGroup(
    @Param('groupId') groupId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const log = await this.producer.enqueueTest(user.sub, groupId);
    return { enqueued: true, logId: log.id };
  }

  // ─── Configuração ────────────────────────────────────────────────────────

  @Get('settings')
  @ApiOperation({ summary: '[Admin] Configuração atual' })
  async getSettings() {
    return toPublicSettings(await this.settings.getSettings());
  }

  @Put('settings')
  @ApiOperation({
    summary: '[Admin] Atualiza configuração (template, grupo, timing)',
  })
  async updateSettings(@Body() dto: UpdateWhatsappSettingsDto) {
    return toPublicSettings(await this.settings.updateSettings(dto));
  }

  @Post('settings/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Admin] Pré-visualiza o template com dados de exemplo',
  })
  async preview(@Body() dto: PreviewTemplateDto) {
    const settings = await this.settings.getSettings();
    const template = dto.template ?? settings.messageTemplate;
    validateTemplate(template);
    return { preview: renderTemplate(template, sampleTemplateVars()) };
  }

  @Post('test-send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Admin] Envia mensagem de teste ao grupo (dry-run)',
  })
  async testSend(@CurrentUser() user: JwtPayload) {
    const log = await this.producer.enqueueTest(user.sub);
    return { enqueued: true, logId: log.id };
  }

  @Post('test-number')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      '[Admin] Valida um número no WhatsApp (/user/check) e envia uma ' +
      'mensagem de teste real para confirmar a entrega',
  })
  async testNumber(@Body() dto: TestNumberDto) {
    const token = await this.settings.resolveInstanceToken();
    // Resolve as variantes BR (com/sem 9, sempre 55) e usa a que existe no
    // WhatsApp — a mesma forma é usada no envio real do alerta.
    const number = await this.evolution.resolveBrNumber(dto.number, token);
    if (!number) {
      return { valid: false, sent: false };
    }
    await this.evolution.sendText({
      number,
      text: '✅ Teste de alerta MT Affiliates: este número receberá os avisos de planilha de links cheia.',
      instanceToken: token,
    });
    return { valid: true, sent: true, number };
  }

  // ─── Histórico + métricas ────────────────────────────────────────────────

  @Get('metrics')
  @ApiOperation({ summary: '[Admin] Métricas de envio' })
  metrics() {
    return this.history.metrics();
  }

  @Get('send-history')
  @ApiOperation({
    summary: '[Admin] Histórico de envios (filtros + paginação)',
  })
  sendHistory(@Query() query: ListSendHistoryDto) {
    return this.history.list(query);
  }

  @Get('send-history/:id')
  @ApiOperation({ summary: '[Admin] Detalhe de um envio' })
  sendHistoryDetail(@Param('id') id: string) {
    return this.history.getById(id);
  }

  @Post('send-history/:id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Reenvia manualmente (reaproveita o log)' })
  retry(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.history.retry(id, user.sub);
  }
}

/** Remove campos sensíveis (instanceToken) da resposta ao frontend. */
function toPublicSettings(s: WhatsappSettings) {
  const { instanceToken: _omit, ...safe } = s;
  return safe;
}
