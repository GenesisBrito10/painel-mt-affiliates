import { PrismaClient, LedgerEventType, LedgerEventStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Starting Financial Ledger seed...');

  // 1. Clear existing ledger
  await prisma.financialLedger.deleteMany({});
  console.log('Cleared existing financial_ledger entries.');

  // 2. Insert Direct CPA
  const cpaInserted = await prisma.$executeRaw`
    INSERT INTO financial_ledger (
      id, "userId", "eventType", status, amount, "bettingHouse", "campaignId", "eventDate", "createdAt"
    )
    SELECT 
      gen_random_uuid(),
      al."userId",
      'COMMISSION_CPA'::"LedgerEventType",
      'CONFIRMED'::"LedgerEventStatus",
      (COALESCE(al.cpa, 0) * ad."cpaQualified"),
      ad."bettingHouse",
      ad."campaignId",
      ad.date,
      NOW()
    FROM affiliate_data ad
    JOIN affiliate_links al ON al."campaignId" = ad."campaignId" AND al."bettingHouse" = ad."bettingHouse"
    WHERE ad."cpaQualified" > 0 AND COALESCE(al.cpa, 0) > 0;
  `;
  console.log(`✅ Inserted ${cpaInserted} direct CPA ledger entries.`);

  // 3. Insert Direct RevShare
  const revInserted = await prisma.$executeRaw`
    INSERT INTO financial_ledger (
      id, "userId", "eventType", status, amount, "bettingHouse", "campaignId", "eventDate", "createdAt"
    )
    SELECT 
      gen_random_uuid(),
      al."userId",
      'COMMISSION_REVSHARE'::"LedgerEventType",
      'CONFIRMED'::"LedgerEventStatus",
      (COALESCE(al.revshare, 0) / 100.0 * ad."revShare"),
      ad."bettingHouse",
      ad."campaignId",
      ad.date,
      NOW()
    FROM affiliate_data ad
    JOIN affiliate_links al ON al."campaignId" = ad."campaignId" AND al."bettingHouse" = ad."bettingHouse"
    WHERE ad."revShare" > 0 AND COALESCE(al.revshare, 0) > 0;
  `;
  console.log(`✅ Inserted ${revInserted} direct RevShare ledger entries.`);

  // 4. Insert Withdrawals (Approved)
  // We insert them as negative amounts
  const withdrawalsInserted = await prisma.$executeRaw`
    INSERT INTO financial_ledger (
      id, "userId", "eventType", status, amount, "bettingHouse", "referenceId", "referenceType", "eventDate", "createdAt"
    )
    SELECT 
      gen_random_uuid(),
      "userId",
      'WITHDRAWAL_APPROVED'::"LedgerEventType",
      'CONFIRMED'::"LedgerEventStatus",
      -amount,
      "bettingHouse",
      id,
      'WithdrawalRequest',
      "createdAt"::date,
      "createdAt"
    FROM withdrawal_requests
    WHERE status = 'APPROVED';
  `;
  console.log(`✅ Inserted ${withdrawalsInserted} approved withdrawal ledger entries.`);

  // 5. Insert Bonus Balances
  const bonusInserted = await prisma.$executeRaw`
    INSERT INTO financial_ledger (
      id, "userId", "eventType", status, amount, "eventDate", "createdAt", "description"
    )
    SELECT 
      gen_random_uuid(),
      id,
      'BONUS_CREDIT'::"LedgerEventType",
      'CONFIRMED'::"LedgerEventStatus",
      "bonusBalance",
      NOW()::date,
      NOW(),
      'Historical Bonus Balance'
    FROM users
    WHERE "bonusBalance" > 0;
  `;
  console.log(`✅ Inserted ${bonusInserted} bonus credit ledger entries.`);

  console.log('✅ Financial Ledger seed completed (Direct Commissions, Withdrawals, Bonuses).');
  console.log('⚠️  Note: Network commissions and Fraud deductions require complex tree traversal and were skipped in this raw SQL seed. They will be generated via the application service going forward.');
}

main()
  .catch((e) => {
    console.error('❌ Error during seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
