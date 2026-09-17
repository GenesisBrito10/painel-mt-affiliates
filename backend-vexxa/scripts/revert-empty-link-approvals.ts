import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const SUPERBET = 'superbet';

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
      console.error(`DB attempt ${i + 1} failed: ${(e as Error).message}`);
      if (i === 1) {
        await prisma.$disconnect();
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const wrong = await prisma.linkRequest.findMany({
    where: {
      bettingHouseSlug: SUPERBET,
      status: 'FULFILLED',
      NOT: { fulfilledByName: 'Sistema' },
      links: { equals: [] },
    },
    select: {
      id: true,
      userId: true,
      fulfilledByName: true,
      user: { select: { email: true } },
    },
  });
  console.log(
    `linkRequests FULFILLED com links vazios (manual): ${wrong.length}`,
  );

  let reverted = 0;
  let affiliateDeleted = 0;
  let errors = 0;

  for (let i = 0; i < wrong.length; i++) {
    const r = wrong[i]!;
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
        const placeholder = await tx.affiliateLink.findFirst({
          where: {
            userId: r.userId,
            bettingHouse: SUPERBET,
            campaignId: { startsWith: 'manual_superbet_' },
          },
          select: { id: true },
        });
        if (placeholder) {
          await tx.affiliateLink.delete({ where: { id: placeholder.id } });
          affiliateDeleted++;
        }
      });
      reverted++;
      if (reverted % 50 === 0) {
        console.log(`  progress: ${reverted}/${wrong.length}`);
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
      `total: ${wrong.length}\n` +
      `reverted: ${reverted}\n` +
      `affiliate_link_deleted: ${affiliateDeleted}\n` +
      `errors: ${errors}`,
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
