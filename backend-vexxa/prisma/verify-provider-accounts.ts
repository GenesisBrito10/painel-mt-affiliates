// verify-provider-accounts.ts - Run once to confirm decrypt works
import { createDecipheriv, createHash } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const ENCRYPTION_KEY =
  process.env['ENCRYPTION_KEY'] ?? 'vexxa-dev-encryption-key-change-in-production!!';
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://vexxa_user:vexxa_password@localhost:5433/vexxa_db?schema=public';

const adapter = new PrismaPg({ connectionString: DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function decrypt(encoded: string): string {
  const key = createHash('sha256').update(ENCRYPTION_KEY).digest();
  const parts = encoded.split(':');
  const [iv, tag, data] = parts.map((s) => Buffer.from(s, 'base64')) as [Buffer, Buffer, Buffer];
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data).toString('utf8') + decipher.final('utf8');
}

async function main() {
  const accounts = await prisma.providerAccount.findMany({ include: { houses: true } });
  console.log(`Found ${accounts.length} provider accounts:\n`);
  for (const acc of accounts) {
    // email is plaintext, only password is encrypted
    const pass = decrypt(acc.encryptedPassword);
    console.log(`Account: ${acc.name} (${acc.provider})`);
    console.log(`  Email:    ${acc.email}`);
    console.log(`  Password: ${pass.slice(0, 3)}${'*'.repeat(pass.length - 3)}`);
    console.log(`  Houses:   ${acc.houses.map((h) => `${h.bettingHouseSlug} → ${h.bookmarkerId}`).join(', ')}`);
    console.log();
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
