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
    slug: 'bateubet',
    name: 'Bateu Bet',
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

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('🌱 VeXXa seed starting...');
  await seedBettingHouses();
  await seedSettings();
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
