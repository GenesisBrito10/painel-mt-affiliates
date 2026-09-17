import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const QUEUE = 'link-webhook-delivery';

function maskErr(e) {
  return String(e).slice(0, 160);
}

async function main() {
  // 1) Status x attempts breakdown
  const grouped = await prisma.linkWebhookDelivery.groupBy({
    by: ['status', 'attempts'],
    _count: { _all: true },
    _min: { createdAt: true },
    _max: { createdAt: true },
    orderBy: [{ status: 'asc' }, { attempts: 'asc' }],
  });
  console.log('=== link_webhook_deliveries status x attempts ===');
  for (const r of grouped) {
    console.log(
      `${String(r.status).padEnd(8)} attempts=${r.attempts}  n=${r._count._all}  oldest=${r._min.createdAt?.toISOString?.()}  newest=${r._max.createdAt?.toISOString?.()}`,
    );
  }

  // 2) Sample of PENDING with error + event
  const pend = await prisma.linkWebhookDelivery.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    take: 15,
    select: {
      id: true,
      event: true,
      origin: true,
      attempts: true,
      ownerUserId: true,
      errorMessage: true,
      createdAt: true,
    },
  });
  console.log(`\n=== PENDING sample (${pend.length}) ===`);
  for (const r of pend) {
    console.log(
      `${r.createdAt?.toISOString?.()} | ${r.event} | ${r.origin} | att=${r.attempts} | owner=${r.ownerUserId ?? 'global'} | err=${r.errorMessage ?? 'null'} | id=${r.id}`,
    );
  }

  // 3) Settings rows (enabled / has url)
  try {
    const s = await prisma.linkWebhookSettings.findMany({
      select: { ownerUserId: true, enabled: true, webhookUrl: true },
    });
    console.log(`\n=== link_webhook_settings (${s.length}) ===`);
    for (const r of s)
      console.log(
        `owner=${r.ownerUserId ?? 'global'} enabled=${r.enabled} has_url=${!!(r.webhookUrl && r.webhookUrl.trim())}`,
      );
  } catch (e) {
    console.log('\nSettings query err:', maskErr(e));
  }

  // 4) Redis / BullMQ queue health
  console.log('\n=== Redis / BullMQ queue ===');
  const connection = new IORedis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number(process.env.REDIS_DB || 0),
    maxRetriesPerRequest: null,
    lazyConnect: true,
    connectTimeout: 4000,
  });
  try {
    await connection.connect();
    const pong = await connection.ping();
    console.log('Redis PING:', pong);
    const q = new Queue(QUEUE, { connection });
    const counts = await q.getJobCounts(
      'waiting',
      'active',
      'delayed',
      'failed',
      'completed',
      'paused',
    );
    console.log('Job counts:', JSON.stringify(counts));
    const isPaused = await q.isPaused();
    console.log('Queue paused:', isPaused);
    const workers = await q.getWorkers();
    console.log('Active workers attached:', workers.length);
    await q.close();
  } catch (e) {
    console.log('REDIS ERROR (queue unreachable / not consuming):', maskErr(e));
  } finally {
    connection.disconnect();
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('FATAL', maskErr(e));
  process.exit(1);
});
