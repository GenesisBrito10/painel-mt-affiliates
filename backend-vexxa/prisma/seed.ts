import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// ─── Bootstrap ───────────────────────────────────────────────────────────────

const adapter = new PrismaPg({
  connectionString: process.env['DATABASE_URL'] ?? '',
});
const prisma = new PrismaClient({ adapter });

// ─── BettingHouse seed data ───────────────────────────────────────────────────

const bettingHouses = [
  {
    slug: 'esportivabet',
    name: 'Esportivabet',
    apiBaseURL: '',
    syncSchedule: '0 */2 * * *',
  },
  { slug: 'mgm', name: 'MGM', apiBaseURL: '', syncSchedule: '0 */2 * * *' },
  {
    slug: 'superbet',
    name: 'Superbet',
    apiBaseURL: '',
    syncSchedule: '0 */2 * * *',
  },
  { slug: 'lottu', name: 'Lottu', apiBaseURL: '', syncSchedule: '0 */2 * * *' },
  {
    slug: 'betano',
    name: 'Betano',
    apiBaseURL: '',
    syncSchedule: '0 */2 * * *',
  },
  { slug: 'bodog', name: 'Bodog', apiBaseURL: '', syncSchedule: '0 */4 * * *' },
  {
    slug: 'bet365',
    name: 'Bet365',
    apiBaseURL: '',
    syncSchedule: '0 */4 * * *',
  },
  {
    slug: 'estrela-bet',
    name: 'Estrela Bet',
    apiBaseURL: '',
    syncSchedule: '0 */2 * * *',
  },
  {
    slug: 'mc-games',
    name: 'MC Games',
    apiBaseURL: '',
    syncSchedule: '0 */2 * * *',
  },
  {
    slug: 'onabet',
    name: 'Onabet',
    apiBaseURL: '',
    syncSchedule: '0 */2 * * *',
  },
] as const;

// ─── Settings seed data ───────────────────────────────────────────────────────

const settings = [
  {
    key: 'withdrawal_block_active',
    value: 'false',
    label: 'Block all withdrawals',
  },
  {
    key: 'min_withdrawal_amount',
    value: '100',
    label: 'Minimum withdrawal amount (R$)',
  },
  {
    key: 'min_avg_deposit_per_cpa',
    value: '70',
    label: 'Minimum avg deposit per CPA qualified (R$)',
  },
  {
    key: 'min_avg_deposit_warning',
    value: '',
    label: 'Warning message for avg deposit below threshold',
  },
  {
    key: 'deal_eligibility_window_days',
    value: '30',
    label: 'Deal eligibility window in days',
  },
  {
    key: 'audit_exclude_start',
    value: '2026-04-01',
    label: 'Audit exclusion period start date (YYYY-MM-DD)',
  },
  {
    key: 'audit_exclude_end',
    value: '2026-05-01',
    label: 'Audit exclusion period end date (YYYY-MM-DD)',
  },
] as const;

// ─── HouseLinkRule seed data (CPA auto-assignment, valores iniciais §9) ─────────

const houseLinkRules = [
  {
    houseSlug: 'superbet',
    ruleType: 'INVITER_DISCOUNT' as const,
    defaultCpa: 105,
    fallbackCpa: 105,
    inviterCpaThreshold: 105,
    inviterCpaDiscount: 10,
    rangeReferenceHouse: null as string | null,
    rangeTiers: [] as unknown,
    requireActiveLinkInHouses: false,
    requiredHouseSlugs: [] as string[],
    blockMessage: '',
  },
  {
    houseSlug: 'betnacional',
    ruleType: 'INVITER_DISCOUNT' as const,
    defaultCpa: 75,
    fallbackCpa: 75,
    inviterCpaThreshold: 80,
    inviterCpaDiscount: 5,
    rangeReferenceHouse: null as string | null,
    rangeTiers: [] as unknown,
    requireActiveLinkInHouses: false,
    requiredHouseSlugs: [] as string[],
    blockMessage: '',
  },
  {
    houseSlug: 'hiperbet',
    ruleType: 'INVITER_DISCOUNT' as const,
    defaultCpa: 40,
    fallbackCpa: 40,
    inviterCpaThreshold: 45,
    inviterCpaDiscount: 5,
    rangeReferenceHouse: null as string | null,
    rangeTiers: [] as unknown,
    requireActiveLinkInHouses: false,
    requiredHouseSlugs: [] as string[],
    blockMessage: '',
  },
  {
    houseSlug: 'esportivabet',
    ruleType: 'RANGE' as const,
    defaultCpa: 55,
    fallbackCpa: 55,
    inviterCpaThreshold: null as number | null,
    inviterCpaDiscount: 5,
    rangeReferenceHouse: 'superbet',
    rangeTiers: [
      { min: 116, max: 120, cpa: 65 },
      { min: 115, max: 115, cpa: 60 },
      { min: 100, max: 114, cpa: 55 },
      { min: null, max: 99, cpa: 50 },
    ] as unknown,
    requireActiveLinkInHouses: false,
    requiredHouseSlugs: [] as string[],
    blockMessage: '',
  },
] as const;

// ─── Seed functions ───────────────────────────────────────────────────────────

async function seedBettingHouses(): Promise<void> {
  console.log('🏠 Seeding betting houses...');
  for (const house of bettingHouses) {
    await prisma.bettingHouse.upsert({
      where: { slug: house.slug },
      create: {
        slug: house.slug,
        name: house.name,
        apiBaseURL: house.apiBaseURL,
        syncSchedule: house.syncSchedule,
      },
      update: { name: house.name },
    });
  }
  console.log(`✅ ${bettingHouses.length} betting houses seeded`);
}

async function seedSettings(): Promise<void> {
  console.log('⚙️  Seeding settings...');
  for (const s of settings) {
    await prisma.setting.upsert({
      where: { key: s.key },
      create: { key: s.key, value: s.value, label: s.label },
      update: {}, // never overwrite existing value — admin may have changed it
    });
  }
  console.log(`✅ ${settings.length} settings seeded`);
}

async function seedHouseLinkRules(): Promise<void> {
  console.log('🔗 Seeding house link rules...');
  for (const r of houseLinkRules) {
    await prisma.houseLinkRule.upsert({
      where: { houseSlug: r.houseSlug },
      create: {
        houseSlug: r.houseSlug,
        ruleType: r.ruleType,
        defaultCpa: r.defaultCpa,
        fallbackCpa: r.fallbackCpa,
        inviterCpaThreshold: r.inviterCpaThreshold ?? null,
        inviterCpaDiscount: r.inviterCpaDiscount,
        rangeReferenceHouse: r.rangeReferenceHouse,
        rangeTiers: r.rangeTiers as object,
        requireActiveLinkInHouses: r.requireActiveLinkInHouses,
        requiredHouseSlugs: [...r.requiredHouseSlugs],
        blockMessage: r.blockMessage,
        updatedByName: 'seed',
      },
      update: {}, // never overwrite — admin may have tuned values
    });
  }
  console.log(`✅ ${houseLinkRules.length} house link rules seeded`);
}

async function seedProviderAccounts(): Promise<void> {
  const requiredVars = ['SEED_VEXXA_EMAIL', 'SEED_VEXXA_PASSWORD'];
  const hasVars = requiredVars.every((v) => process.env[v]);

  if (!hasVars) {
    console.warn(
      '⚠️  ProviderAccount seed SKIPPED — env vars SEED_VEXXA_EMAIL / SEED_VEXXA_PASSWORD not set',
    );
    console.warn(
      '   Add them to .env and run pnpm prisma:seed again to seed provider accounts',
    );
    return;
  }

  console.log(
    '🔑 ProviderAccount seed requires ENCRYPTION_KEY — skipping (run via app after startup)',
  );
  // ProviderAccount seeding requires CryptoService (NestJS DI context).
  // Run manually via: POST /admin/provider-accounts with credentials.
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('🌱 VeXXa seed starting...');
  await seedBettingHouses();
  await seedSettings();
  await seedHouseLinkRules();
  await seedProviderAccounts();
  console.log('✅ Seed complete');
}

main()
  .catch((err: unknown) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
