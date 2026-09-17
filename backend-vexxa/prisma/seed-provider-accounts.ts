// seed-provider-accounts.ts
// Popula provider_accounts e provider_account_houses com as credenciais do
// betboard-sync.ts legado, criptografando com o mesmo algoritmo do CryptoService.
//
// Credenciais extraídas de: api/src/services/betboard-sync.ts
// Algoritmo: AES-256-GCM, key = SHA-256(ENCRYPTION_KEY), formato: base64(iv):base64(tag):base64(data)

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createCipheriv, createHash, randomBytes } from 'crypto';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const DATABASE_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://vexxa_user:vexxa_password@localhost:5433/vexxa_db?schema=public';

const ENCRYPTION_KEY =
  process.env['ENCRYPTION_KEY'] ??
  'vexxa-dev-encryption-key-change-in-production!!';

const adapter = new PrismaPg({ connectionString: DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// ─── Crypto (mirrors CryptoService exactly) ──────────────────

function encrypt(plaintext: string): string {
  const key = createHash('sha256').update(ENCRYPTION_KEY).digest();
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((b) => b.toString('base64')).join(':');
}

// ─── Source data (from betboard-sync.ts) ─────────────────────
// Two accounts, each linked to specific houses via bookmarkerId

const PROVIDER_API_BASE = 'https://api-affiliates.mgaffiliates.site/api';

const accounts = [
  {
    name: 'VEXXA',
    provider: 'betboard',
    apiBaseUrl: PROVIDER_API_BASE,
    email: 'admin@vexxacompany.com',
    password: requireEnv('VEXXA_PROVIDER_PASSWORD'),
    // Houses this account is used for
    houses: [
      {
        bettingHouseSlug: 'esportivabet',
        bookmarkerId: '02510c60-e702-479e-ada2-017e0b77f762',
      },
    ],
  },
  {
    name: 'LHT',
    provider: 'betboard',
    apiBaseUrl: PROVIDER_API_BASE,
    email: 'lht@afiliadosexternos.com',
    password: requireEnv('LHT_PROVIDER_PASSWORD'),
    houses: [
      {
        bettingHouseSlug: 'mgm',
        bookmarkerId: '5c004b48-4213-4e1e-b028-01739154c10b',
      },
    ],
  },
] as const;

// ─── Main ────────────────────────────────────────────────────

async function main() {
  console.log('[ProviderAccount Seed] Starting...');
  console.log(`   Encrypting with ENCRYPTION_KEY: ${ENCRYPTION_KEY.slice(0, 8)}...`);

  let accountCount = 0;
  let houseCount = 0;

  for (const acc of accounts) {
    // Only encrypt the password — email is stored plaintext
    const encryptedPassword = encrypt(acc.password);

    const providerAccount = await prisma.providerAccount.upsert({
      where: { uq_account_name_provider: { name: acc.name, provider: acc.provider } },
      update: {
        email: acc.email,
        encryptedPassword,
        apiBaseUrl: acc.apiBaseUrl,
        active: true,
      },
      create: {
        name: acc.name,
        provider: acc.provider,
        apiBaseUrl: acc.apiBaseUrl,
        email: acc.email,
        encryptedPassword,
        active: true,
      },
    });

    console.log(`   [OK] ProviderAccount "${acc.name}" (${acc.provider}) — id: ${providerAccount.id}`);
    accountCount++;

    // Upsert each house linkage
    for (const house of acc.houses) {
      // Verify the betting house exists first
      const bettingHouseExists = await prisma.bettingHouse.findUnique({
        where: { slug: house.bettingHouseSlug },
      });
      if (!bettingHouseExists) {
        console.warn(
          `   [WARN] BettingHouse "${house.bettingHouseSlug}" not found — skipping linkage`,
        );
        continue;
      }

      await prisma.providerAccountHouse.upsert({
        where: {
          uq_account_house: {
            providerAccountId: providerAccount.id,
            bettingHouseSlug: house.bettingHouseSlug,
          },
        },
        update: {
          bookmarkerId: house.bookmarkerId,
          active: true,
        },
        create: {
          providerAccountId: providerAccount.id,
          bettingHouseSlug: house.bettingHouseSlug,
          bookmarkerId: house.bookmarkerId,
          extraConfig: {},
          active: true,
        },
      });

      console.log(
        `      └─ Linked to "${house.bettingHouseSlug}" (bookmarkerId: ${house.bookmarkerId})`,
      );
      houseCount++;
    }
  }

  console.log(`\n[OK] Done: ${accountCount} provider accounts, ${houseCount} house linkages`);
}

main()
  .catch((err) => {
    console.error('[FAIL] Provider account seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
