import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const HIPERBET = 'hiperbet';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing');
  const adapter = new PrismaPg({ connectionString: url });
  const prisma = new PrismaClient({ adapter });

  for (let i = 0; i < 2; i++) {
    try {
      await prisma.user.count();
      break;
    } catch (e) {
      console.error(`DB attempt ${i + 1}: ${(e as Error).message}`);
      if (i === 1) {
        await prisma.$disconnect();
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // Order createdAt ASC → primeiros têm prioridade no auto-assign cron.
  const fulfilled = await prisma.linkRequest.findMany({
    where: { bettingHouseSlug: HIPERBET, status: 'FULFILLED' },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      userId: true,
      createdAt: true,
      user: { select: { email: true } },
    },
  });
  console.log(`Hiperbet FULFILLED requests: ${fulfilled.length}`);

  let reverted = 0;
  let resetLinks = 0;
  let errors = 0;

  for (const r of fulfilled) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.linkRequest.update({
          where: { id: r.id },
          data: {
            status: 'PENDING',
            fulfilledAt: null,
            fulfilledById: null,
            fulfilledByName: '',
            links: [],
          },
        });
        const link = await tx.affiliateLink.findFirst({
          where: { userId: r.userId, bettingHouse: HIPERBET },
          select: { id: true },
        });
        if (link) {
          await tx.affiliateLink.update({
            where: { id: link.id },
            data: {
              campaignId: `pending_${HIPERBET}_${r.userId}`,
              affiliateId: '',
            },
          });
          resetLinks++;
        }
      });
      reverted++;
      if (reverted % 50 === 0) {
        console.log(`  progress: ${reverted}/${fulfilled.length}`);
      }
    } catch (err) {
      errors++;
      console.error(
        `FAIL ${r.user.email} (req=${r.id}): ${(err as Error).message}`,
      );
    }
  }

  console.log(
    `\n=== SUMMARY ===\n` +
      `total: ${fulfilled.length}\n` +
      `reverted: ${reverted}\n` +
      `affiliate_link_reset: ${resetLinks}\n` +
      `errors: ${errors}`,
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
