import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { NetworkController } from './infrastructure/network.controller.js';
import { NetworkService } from './application/network.service.js';
import {
  NetworkPrismaRepository,
  NETWORK_REPOSITORY,
} from './infrastructure/persistence/network.prisma-repository.js';

@Module({
  imports: [PrismaModule, SettingsModule],
  controllers: [NetworkController],
  providers: [
    NetworkService,
    {
      provide: NETWORK_REPOSITORY,
      useClass: NetworkPrismaRepository,
    },
  ],
  exports: [NetworkService],
})
export class NetworkModule {}
