import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { ServerOptions } from 'socket.io';

export class RedisSocketIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisSocketIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(options: {
    host: string;
    port: number;
    password?: string;
    db?: number;
  }): Promise<void> {
    const pubClient = new Redis({
      host: options.host,
      port: options.port,
      password: options.password || undefined,
      db: options.db ?? 0,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
    const subClient = pubClient.duplicate();

    try {
      await Promise.all([pubClient.connect(), subClient.connect()]);
      this.adapterConstructor = createAdapter(pubClient, subClient);
      this.logger.log('Socket.io Redis adapter connected');
    } catch (error) {
      this.logger.warn(
        `Socket.io Redis adapter disabled: ${(error as Error).message}`,
      );
      pubClient.disconnect();
      subClient.disconnect();
    }
  }

  override createIOServer(port: number, options?: ServerOptions) {
    const rawOrigin = process.env['CORS_ORIGIN'];
    const origin = rawOrigin?.includes(',')
      ? rawOrigin.split(',').map((item) => item.trim()).filter(Boolean)
      : rawOrigin || 'http://localhost:3013';

    const server = super.createIOServer(port, {
      ...options,
      cors: {
        origin,
        credentials: true,
      },
    });

    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }

    return server;
  }
}
