import type { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';
import type { JwtPayload } from '../../../auth/index.js';

export function createSocketAuthMiddleware(jwtService: JwtService) {
  return (socket: Socket, next: (err?: Error) => void): void => {
    const authToken = socket.handshake.auth?.['token'];
    const header = socket.handshake.headers.authorization;
    const token =
      typeof authToken === 'string'
        ? authToken
        : header?.startsWith('Bearer ')
          ? header.slice('Bearer '.length)
          : null;

    if (!token) {
      next(new Error('Unauthorized'));
      return;
    }

    try {
      socket.data['user'] = jwtService.verify<JwtPayload>(token);
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  };
}
