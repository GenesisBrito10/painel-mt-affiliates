import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg(process.env['DATABASE_URL']!);
const prisma = new PrismaClient({ adapter });

async function main() {
  const user = await prisma.user.findFirst({
    where: { email: 'jorginxcriaa@gmail.com' },
    select: {
      id: true,
      email: true,
      name: true,
      status: true,
      referredById: true,
      referredBy: {
        select: {
          id: true,
          email: true,
          name: true,
          affiliateLinks: {
            select: { bettingHouse: true, cpa: true, revshare: true },
          },
        },
      },
    },
  });

  if (!user) { console.log('Usuário não encontrado'); return; }

  console.log('\n=== USUÁRIO ===');
  console.log(`email: ${user.email}`);
  console.log(`name: ${user.name}`);
  console.log(`status: ${user.status}`);
  console.log(`referredById: ${user.referredById ?? 'null (sem convidante)'}`);

  if (user.referredBy) {
    console.log('\n=== CONVIDANTE ===');
    console.log(`email: ${user.referredBy.email}`);
    console.log(`name: ${user.referredBy.name}`);
    console.log(`links: ${user.referredBy.affiliateLinks.length}`);
    if (user.referredBy.affiliateLinks.length) {
      console.table(user.referredBy.affiliateLinks.map(l => ({
        casa: l.bettingHouse,
        cpa: l.cpa?.toString() ?? 'null',
        revshare: l.revshare?.toString() ?? 'null',
      })));
    } else {
      console.log('  → Convidante NÃO tem nenhum affiliate link');
    }
  } else {
    console.log('\n→ Usuário NÃO foi convidado por ninguém (referredById = null)');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
