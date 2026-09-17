import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AffiliateApiService } from './affiliate-api.service.js';
import type { AffiliateApiTokenOwner } from './dto/affiliate-api.dto.js';

export interface AffiliateApiRequest extends FastifyRequest {
  affiliateApiOwner: AffiliateApiTokenOwner;
}

@Injectable()
export class AffiliateApiTokenGuard implements CanActivate {
  constructor(private readonly service: AffiliateApiService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AffiliateApiRequest>();
    const authorization = request.headers.authorization;
    const token = this.extractBearerToken(authorization);
    if (!token) throw new UnauthorizedException('Token da API não informado');

    request.affiliateApiOwner = await this.service.validateApiToken(token);
    return true;
  }

  private extractBearerToken(header: string | undefined): string | null {
    if (!header) return null;
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
    return token.trim();
  }
}
