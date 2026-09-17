/**
 * Restore original MongoDB password hashes → PostgreSQL users.
 *
 * Matches users by email (case-insensitive) and overwrites the current
 * `password` field in Postgres with whatever hash is in Mongo.
 *
 * Safe to re-run — uses updateMany with 0 writes for users not found in PG.
 *
 * Run: npx tsx prisma/restore-passwords.ts
 */

import { MongoClient } from 'mongodb';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const MONGO_URI = process.env['MONGO_URI'] ?? '';
if (!MONGO_URI) throw new Error('MONGO_URI is required');

const DATABASE_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://vexxa_user:vexxa_password@localhost:5433/vexxa_db?schema=public';

const adapter = new PrismaPg({ connectionString: DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('\n🔐 Restore Passwords: MongoDB → PostgreSQL');
  console.log('─'.repeat(50));

  const mongo = new MongoClient(MONGO_URI);
  await mongo.connect();
  console.log('✅ Connected to MongoDB (mjmcompany)');

  const mongoUsers = await mongo
    .db('mjmcompany')
    .collection('users')
    .find({}, { projection: { email: 1, password: 1 } })
    .toArray();

  console.log(`📦 Found ${mongoUsers.length} users in MongoDB`);
  console.log('⚡ Running parallel updates...\n');

  const results = await Promise.allSettled(
    mongoUsers.map(async (doc) => {
      const email = (doc.email ?? '').toLowerCase().trim();
      const password = doc.password as string | undefined;

      if (!email) throw new Error('no_email');
      if (!password) throw new Error(`no_hash:${email}`);

      const result = await prisma.user.updateMany({
        where: { email },
        data: { password },
      });

      return { email, count: result.count };
    }),
  );

  let updated = 0;
  let notFound = 0;
  let noHash = 0;
  let noEmail = 0;
  let errors = 0;

  for (const r of results) {
    if (r.status === 'fulfilled') {
      if (r.value.count > 0) {
        updated++;
      } else {
        notFound++;
      }
    } else {
      const msg = r.reason?.message ?? '';
      if (msg === 'no_email') noEmail++;
      else if (msg.startsWith('no_hash:')) noHash++;
      else {
        errors++;
        console.error(`   ❌ ${msg}`);
      }
    }
  }

  console.log('─'.repeat(50));
  console.log('✅ Done!');
  console.log(`   Updated   : ${updated}`);
  console.log(`   Not in PG : ${notFound}`);
  console.log(`   No hash   : ${noHash}`);
  console.log(`   No email  : ${noEmail}`);
  console.log(`   Errors    : ${errors}`);

  await mongo.close();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});
