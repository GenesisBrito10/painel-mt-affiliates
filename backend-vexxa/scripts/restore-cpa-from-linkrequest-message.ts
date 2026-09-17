import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const SUPERBET = 'superbet';
const RE = /CPA\s+R\$(\d+(?:[.,]\d+)?)\s*\/\s*Rev\s*(\d+(?:[.,]\d+)?)%/i;

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

  const candidates = await prisma.linkRequest.findMany({
    where: {
      bettingHouseSlug: SUPERBET,
      status: 'PENDING',
      message: { contains: 'CPA R$' },
    },
    select: {
      id: true,
      userId: true,
      message: true,
      user: {
        select: {
          email: true,
          affiliateLinks: {
            where: { bettingHouse: SUPERBET },
            select: { id: true, cpa: true, revshare: true },
          },
        },
      },
    },
  });
  console.log(`PENDING superbet com message CPA: ${candidates.length}`);

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const r of candidates) {
    const m = r.message.match(RE);
    if (!m) {
      skipped++;
      continue;
    }
    const cpa = Number(m[1]!.replace(',', '.'));
    const rev = Number(m[2]!.replace(',', '.'));
    if (!Number.isFinite(cpa) || !Number.isFinite(rev)) {
      skipped++;
      continue;
    }

    try {
      const existing = r.user.affiliateLinks[0];
      if (existing) {
        if (existing.cpa != null && existing.revshare != null) {
          skipped++;
          continue;
        }
        await prisma.affiliateLink.update({
          where: { id: existing.id },
          data: {
            ...(existing.cpa == null ? { cpa } : {}),
            ...(existing.revshare == null ? { revshare: rev } : {}),
          },
        });
        updated++;
      } else {
        await prisma.affiliateLink.create({
          data: {
            userId: r.userId,
            bettingHouse: SUPERBET,
            campaignId: `pending_${SUPERBET}_${r.userId}`,
            affiliateId: '',
            cpa,
            revshare: rev,
          },
        });
        created++;
      }
      if ((created + updated) % 50 === 0) {
        console.log(
          `  progress: created=${created} updated=${updated} (${r.user.email})`,
        );
      }
    } catch (err) {
      errors++;
      console.error(`FAIL ${r.user.email}: ${(err as Error).message}`);
    }
  }

  console.log(
    `\n=== SUMMARY ===\n` +
      `total_candidates: ${candidates.length}\n` +
      `created: ${created}\n` +
      `updated: ${updated}\n` +
      `skipped: ${skipped}\n` +
      `errors: ${errors}`,
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
