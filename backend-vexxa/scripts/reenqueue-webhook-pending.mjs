/**
 * Reenfileira deliveries de webhook presas em PENDING.
 *
 * CONTEXTO: o producer antigo usava jobId `delivery:<id>` e o BullMQ >=5
 * lança "Custom Id cannot contain ':'", então o enqueue falhava e a linha
 * ficava PENDING com attempts=0 / errorMessage=null para sempre. Este script
 * reenfileira essas linhas com o jobId corrigido (`delivery_<id>`). O worker
 * vivo processa por id, então entrega mesmo antes do redeploy do producer.
 *
 * RODAR NO HOST DE PRODUÇÃO (Redis é localhost-only):
 *   node --env-file=.env scripts/reenqueue-webhook-pending.mjs
 *
 * Idempotente: jobId deduplica e o processor pula linhas já SUCCESS.
 * Só LÊ o DB; quem muda as linhas é o worker. Só ESCREVE jobs no Redis.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';

const QUEUE = 'link-webhook-delivery';
const MAX_ATTEMPTS = 6;
const BACKOFF_MS = 30_000;

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function s(e) {
  return String(e).slice(0, 200);
}

async function main() {
  const pending = await prisma.linkWebhookDelivery.findMany({
    where: { status: 'PENDING' },
    select: { id: true, event: true, origin: true, attempts: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`PENDING encontrados: ${pending.length}`);
  if (pending.length === 0) {
    await prisma.$disconnect();
    return;
  }

  const connection = new IORedis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number(process.env.REDIS_DB || 0),
    maxRetriesPerRequest: null,
  });
  const queue = new Queue(QUEUE, { connection });

  // Sanidade: provar que o enqueue agora funciona (jobId sem ':').
  const before = await queue.getJobCounts(
    'waiting',
    'active',
    'delayed',
    'failed',
    'completed',
  );
  console.log('Job counts ANTES:', JSON.stringify(before));

  let ok = 0;
  let fail = 0;
  for (const d of pending) {
    try {
      await queue.add(
        'deliver',
        { deliveryId: d.id },
        {
          jobId: `delivery_${d.id}`,
          attempts: MAX_ATTEMPTS,
          backoff: { type: 'exponential', delay: BACKOFF_MS },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      );
      ok++;
    } catch (e) {
      fail++;
      console.log(`  FALHOU enqueue ${d.id} (${d.event}): ${s(e)}`);
    }
  }
  console.log(`Enfileirados: ${ok}  | Falhas de enqueue: ${fail}`);

  // Aguarda o worker processar e relata transições (HTTP timeout = 15s).
  const ids = pending.map((p) => p.id);
  for (let i = 1; i <= 6; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    const grp = await prisma.linkWebhookDelivery.groupBy({
      by: ['status'],
      where: { id: { in: ids } },
      _count: { _all: true },
    });
    const counts = Object.fromEntries(grp.map((g) => [g.status, g._count._all]));
    console.log(`t+${i * 10}s ->`, JSON.stringify(counts));
    if (!counts.PENDING) {
      console.log('Todas saíram de PENDING.');
      break;
    }
  }

  const after = await queue.getJobCounts(
    'waiting',
    'active',
    'delayed',
    'failed',
    'completed',
  );
  console.log('Job counts DEPOIS:', JSON.stringify(after));

  await queue.close();
  connection.disconnect();
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('FATAL', s(e));
  process.exit(1);
});
