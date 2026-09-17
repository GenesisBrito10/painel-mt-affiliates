import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { auditExtension } from './prisma-audit.extension.js';

export type PrismaTransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    const adapter = new PrismaPg({
      connectionString: config.getOrThrow<string>('DATABASE_URL'),
      max: 30, // increased from 20 — admin dashboard + affiliate frontend concurrent load
      idleTimeoutMillis: 10_000, // 10s — release idle connections faster to prevent pool starvation
      connectionTimeoutMillis: 30_000, // 30s to acquire a connection before erroring
    });
    super({ adapter });

    // Aplica a extensão de auditoria e RETORNA o client estendido — assim a DI
    // entrega a instância estendida a todos os módulos, e TODA mudança de
    // cpa/revshare é logada + hard-delete de link/saque é bloqueado, sem
    // precisar refatorar os ~60 call sites. `this` (base, sem extensão) é
    // passado à extensão p/ rodar sub-queries/log sem recursão.
    return this.$extends(auditExtension(this)) as unknown as PrismaService;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Database disconnected');
  }
}
