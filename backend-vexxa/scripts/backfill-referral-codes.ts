import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';

function gen(): string {
  return randomBytes(4).toString('hex').toUpperCase();
}

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

  const users = await prisma.user.findMany({
    where: { referralCode: null, deletedAt: null },
    select: { id: true, email: true },
  });
  console.log(`Users without referralCode: ${users.length}`);

  let updated = 0;
  let errors = 0;

  for (const u of users) {
    let success = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = gen();
      try {
        await prisma.user.update({
          where: { id: u.id },
          data: { referralCode: code },
        });
        updated++;
        success = true;
        break;
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          continue;
        }
        throw e;
      }
    }
    if (!success) {
      errors++;
      console.error(`FAIL ${u.email}: 5 unique-conflict retries exhausted`);
    }
    if (updated % 200 === 0)
      console.log(`  progress: ${updated}/${users.length}`);
  }

  console.log(`\nDONE | updated=${updated} errors=${errors}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
