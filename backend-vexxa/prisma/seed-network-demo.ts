/**
 * Demo seed for testing the affiliate panel "Rede" tab locally.
 * Run: pnpm exec dotenv -e .env -- ts-node prisma/seed-network-demo.ts
 */
import { PrismaClient, LinkSource, UserRole, UserStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcrypt';

const adapter = new PrismaPg({
  connectionString: process.env['DATABASE_URL'] ?? '',
});
const prisma = new PrismaClient({ adapter });

const HEAD_EMAIL = 'rede@vallex.local';
const HEAD_PASSWORD = process.env['SEED_NETWORK_HEAD_PASSWORD'];
if (!HEAD_PASSWORD) {
  throw new Error('SEED_NETWORK_HEAD_PASSWORD is required');
}

const HOUSES = ['betano', 'superbet', 'betnacional', 'hiperbet'] as const;

const HOUSE_NAMES: Record<(typeof HOUSES)[number], string> = {
  betano: 'Betano',
  superbet: 'Superbet',
  betnacional: 'Betnacional',
  hiperbet: 'HiperBet',
};

type HouseRates = Record<(typeof HOUSES)[number], { cpa: number; rev: number }>;

const HEAD_RATES: HouseRates = {
  betano: { cpa: 120, rev: 30 },
  superbet: { cpa: 110, rev: 25 },
  betnacional: { cpa: 85, rev: 20 },
  hiperbet: { cpa: 50, rev: 15 },
};

async function upsertHouse(slug: (typeof HOUSES)[number]) {
  await prisma.bettingHouse.upsert({
    where: { slug },
    create: { slug, name: HOUSE_NAMES[slug], apiBaseURL: '', syncSchedule: '0 */2 * * *' },
    update: { name: HOUSE_NAMES[slug] },
  });
}

async function upsertAffiliate(input: {
  email: string;
  name: string;
  password: string;
  referredById?: string;
  status?: UserStatus;
  referralCode: string;
}) {
  const hash = await bcrypt.hash(input.password, 12);
  return prisma.user.upsert({
    where: { email: input.email },
    create: {
      email: input.email,
      name: input.name,
      password: hash,
      role: UserRole.AFFILIATE,
      status: input.status ?? UserStatus.APPROVED,
      active: true,
      ageVerified: true,
      profileCompleted: true,
      referralCode: input.referralCode,
      referredById: input.referredById,
    },
    update: {
      name: input.name,
      password: hash,
      status: input.status ?? UserStatus.APPROVED,
      active: true,
      referredById: input.referredById,
      deletedAt: null,
    },
  });
}

async function upsertLink(
  userId: string,
  house: (typeof HOUSES)[number],
  campaignId: string,
  rates: { cpa: number; rev: number },
) {
  const existing = await prisma.affiliateLink.findFirst({
    where: { userId, bettingHouse: house, deletedAt: null },
  });

  if (existing) {
    return prisma.affiliateLink.update({
      where: { id: existing.id },
      data: {
        campaignId,
        affiliateId: campaignId,
        cpa: rates.cpa,
        revshare: rates.rev,
        source: LinkSource.MANUAL,
        deletedAt: null,
      },
    });
  }

  return prisma.affiliateLink.create({
    data: {
      userId,
      bettingHouse: house,
      campaignId,
      affiliateId: campaignId,
      cpa: rates.cpa,
      revshare: rates.rev,
      source: LinkSource.MANUAL,
    },
  });
}

async function upsertAffiliateData(input: {
  campaignId: string;
  bettingHouse: (typeof HOUSES)[number];
  date: Date;
  clicks: number;
  registrations: number;
  ftds: number;
  cpaQualified: number;
  deposit: number;
  revShare: number;
  totalCommission: number;
}) {
  await prisma.affiliateData.upsert({
    where: {
      uq_affiliate_data: {
        campaignId: input.campaignId,
        bettingHouse: input.bettingHouse,
        date: input.date,
        campaignName: 'default',
        utmCampaign: '',
      },
    },
    create: {
      affiliateId: input.campaignId,
      campaignId: input.campaignId,
      bettingHouse: input.bettingHouse,
      date: input.date,
      clicks: input.clicks,
      registrations: input.registrations,
      ftds: input.ftds,
      cpaQualified: input.cpaQualified,
      deposit: input.deposit,
      revShare: input.revShare,
      totalCommission: input.totalCommission,
    },
    update: {
      clicks: input.clicks,
      registrations: input.registrations,
      ftds: input.ftds,
      cpaQualified: input.cpaQualified,
      deposit: input.deposit,
      revShare: input.revShare,
      totalCommission: input.totalCommission,
    },
  });
}

async function main() {
  console.log('🌐 Seeding Rede demo data...');

  for (const house of HOUSES) {
    await upsertHouse(house);
  }

  const head = await upsertAffiliate({
    email: HEAD_EMAIL,
    name: 'Kamila Brambati',
    password: HEAD_PASSWORD,
    referralCode: 'KAMILA001',
  });

  for (const house of HOUSES) {
    await upsertLink(head.id, house, `head-${house}`, HEAD_RATES[house]);
  }

  const member1 = await upsertAffiliate({
    email: 'angerleide.fake@vallex.local',
    name: 'Angerleide Domingos da Silva',
    password: 'Demo123456!',
    referredById: head.id,
    referralCode: 'ANGER001',
  });

  const member1Rates: HouseRates = {
    betano: { cpa: 100, rev: 25 },
    superbet: { cpa: 100, rev: 20 },
    betnacional: { cpa: 75, rev: 15 },
    hiperbet: { cpa: 40, rev: 10 },
  };

  for (const house of HOUSES) {
    await upsertLink(member1.id, house, `m1-${house}`, member1Rates[house]);
  }

  const member2 = await upsertAffiliate({
    email: 'carlos.fake@vallex.local',
    name: 'Carlos Eduardo Souza',
    password: 'Demo123456!',
    referredById: head.id,
    referralCode: 'CARLOS001',
  });

  const member2Rates: HouseRates = {
    betano: { cpa: 95, rev: 22 },
    superbet: { cpa: 90, rev: 18 },
    betnacional: { cpa: 70, rev: 12 },
    hiperbet: { cpa: 35, rev: 8 },
  };

  for (const house of HOUSES) {
    await upsertLink(member2.id, house, `m2-${house}`, member2Rates[house]);
  }

  const member3 = await upsertAffiliate({
    email: 'maria.fake@vallex.local',
    name: 'Maria Fernanda Lima',
    password: 'Demo123456!',
    referredById: head.id,
    status: UserStatus.PENDING,
    referralCode: 'MARIA001',
  });

  for (const house of HOUSES) {
    await upsertLink(member3.id, house, `m3-${house}`, {
      betano: { cpa: 90, rev: 20 },
      superbet: { cpa: 85, rev: 15 },
      betnacional: { cpa: 65, rev: 10 },
      hiperbet: { cpa: 30, rev: 5 },
    }[house]);
  }

  const member4 = await upsertAffiliate({
    email: 'joao.fake@vallex.local',
    name: 'João Pedro Alves',
    password: 'Demo123456!',
    referredById: head.id,
    referralCode: 'JOAO0001',
  });

  for (const house of HOUSES) {
    await upsertLink(member4.id, house, `m4-${house}`, {
      betano: { cpa: 98, rev: 24 },
      superbet: { cpa: 92, rev: 19 },
      betnacional: { cpa: 72, rev: 14 },
      hiperbet: { cpa: 38, rev: 9 },
    }[house]);
  }

  // Subindicados de Angerleide (L2)
  for (let i = 1; i <= 8; i++) {
    await upsertAffiliate({
      email: `sub${i}.fake@vallex.local`,
      name: `Subindicado ${i}`,
      password: 'Demo123456!',
      referredById: member1.id,
      referralCode: `SUB0000${i}`,
    });
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // Angerleide — cenário principal (similar ao print)
  await upsertAffiliateData({
    campaignId: 'm1-betano',
    bettingHouse: 'betano',
    date: today,
    clicks: 1412,
    registrations: 135,
    ftds: 86,
    cpaQualified: 86,
    deposit: 7317.46,
    revShare: -1008.94,
    totalCommission: 8600,
  });
  await upsertAffiliateData({
    campaignId: 'm1-superbet',
    bettingHouse: 'superbet',
    date: today,
    clicks: 420,
    registrations: 38,
    ftds: 22,
    cpaQualified: 18,
    deposit: 2100,
    revShare: 540.2,
    totalCommission: 2200,
  });
  await upsertAffiliateData({
    campaignId: 'm1-betnacional',
    bettingHouse: 'betnacional',
    date: today,
    clicks: 280,
    registrations: 24,
    ftds: 14,
    cpaQualified: 12,
    deposit: 980.5,
    revShare: 120,
    totalCommission: 900,
  });
  await upsertAffiliateData({
    campaignId: 'm1-hiperbet',
    bettingHouse: 'hiperbet',
    date: today,
    clicks: 95,
    registrations: 11,
    ftds: 6,
    cpaQualified: 5,
    deposit: 410,
    revShare: 45,
    totalCommission: 200,
  });

  // Carlos — bom mix CPA + RevShare
  await upsertAffiliateData({
    campaignId: 'm2-betano',
    bettingHouse: 'betano',
    date: today,
    clicks: 620,
    registrations: 58,
    ftds: 40,
    cpaQualified: 32,
    deposit: 4200,
    revShare: 1850.75,
    totalCommission: 5100,
  });
  await upsertAffiliateData({
    campaignId: 'm2-superbet',
    bettingHouse: 'superbet',
    date: today,
    clicks: 310,
    registrations: 29,
    ftds: 18,
    cpaQualified: 15,
    deposit: 1600,
    revShare: 920.4,
    totalCommission: 2400,
  });

  // João — fraude para testar card vermelho
  await upsertAffiliateData({
    campaignId: 'm4-betano',
    bettingHouse: 'betano',
    date: today,
    clicks: 180,
    registrations: 20,
    ftds: 12,
    cpaQualified: 10,
    deposit: 900,
    revShare: 300,
    totalCommission: 1200,
  });

  await prisma.fraudCount.upsert({
    where: { userId_bettingHouse: { userId: member4.id, bettingHouse: 'betano' } },
    create: { userId: member4.id, bettingHouse: 'betano', count: 3 },
    update: { count: 3 },
  });

  console.log('\n✅ Rede demo pronta!\n');
  console.log('Login no painel de afiliados (frontend):');
  console.log(`  E-mail: ${HEAD_EMAIL}`);
  console.log(`  Senha:  ${HEAD_PASSWORD}`);
  console.log('\nAbra: http://localhost:3005/earnings');
}

main()
  .catch((err: unknown) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
