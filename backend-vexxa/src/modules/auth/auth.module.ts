import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './application/auth.service.js';
import { AuthController } from './infrastructure/auth.controller.js';
import { JwtStrategy } from './infrastructure/strategies/jwt.strategy.js';
import { JwtAuthGuard } from './infrastructure/guards/jwt-auth.guard.js';
import { RolesGuard } from './infrastructure/guards/roles.guard.js';
import { AuthPrismaRepository } from './infrastructure/persistence/auth.prisma-repository.js';
import { AUTH_REPOSITORY } from './domain/repositories/auth.repository.js';
import { NotificationModule } from '../notification/notification.module.js';
import { MailModule } from '../mail/index.js';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const expiration = config.get<string>('JWT_EXPIRATION', '7d');
        return {
          secret: config.getOrThrow<string>('JWT_SECRET'),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          signOptions: { expiresIn: expiration as any },
        };
      },
    }),
    NotificationModule,
    MailModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
    { provide: AUTH_REPOSITORY, useClass: AuthPrismaRepository },
  ],
  exports: [JwtAuthGuard, RolesGuard, JwtModule, AuthService],
})
export class AuthModule {}
