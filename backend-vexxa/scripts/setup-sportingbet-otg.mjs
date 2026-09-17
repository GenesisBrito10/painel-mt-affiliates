/**
 * Sportingbet provider cutover: Betboard -> OTG.
 *
 *   node scripts/setup-sportingbet-otg.mjs          # dry-run
 *   node scripts/setup-sportingbet-otg.mjs --apply  # transactional write
 *
 * Credentials are read from ignored .env variables and are never printed.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

try {
  process.loadEnvFile?.('.env');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const APPLY = process.argv.includes('--apply');
const HOUSE = 'sportingbet';
const OTG_ACCOUNT_NAME = 'SPORTINGBET OTG';
const OTG_PROVIDER = 'otg';
const OLD_PROVIDER = 'betboard';
const OTG_API_BASE = 'https://affiliate-api-prd.partnersotg.com/api/v1';
const OTG_BOOKMAKER_ID = 'cmm5dhdqm000e19b58dqc549a';

const requiredEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variavel obrigatoria ausente: ${name}`);
  return value;
};

const deriveKey = (raw) => createHash('sha256').update(raw).digest();

const encrypt = (plaintext, rawKey) => {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(rawKey), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString('base64')).join(':');
};

const decrypt = (encoded, rawKey) => {
  const [iv, tag, data] = encoded
    .split(':')
    .map((part) => Buffer.from(part, 'base64'));
  if (!iv || !tag || !data) throw new Error('Formato criptografado invalido');
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(rawKey), iv);
  decipher.setAuthTag(tag);
  return decipher.update(data).toString('utf8') + decipher.final('utf8');
};

const databaseUrl = requiredEnv('DATABASE_URL');
const encryptionKey = requiredEnv('ENCRYPTION_KEY');
const email = requiredEnv('SPORTINGBET_OTG_EMAIL');
const password = requiredEnv('SPORTINGBET_OTG_PASSWORD');
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

const readState = () =>
  prisma.providerAccount.findMany({
    where: { provider: { in: [OLD_PROVIDER, OTG_PROVIDER] } },
    select: {
      id: true,
      name: true,
      provider: true,
      active: true,
      encryptedPassword: true,
      houses: {
        select: {
          id: true,
          bettingHouseSlug: true,
          bookmarkerId: true,
          active: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

async function verifyFinalState() {
  const activeOtg = await prisma.providerAccountHouse.findMany({
    where: {
      bettingHouseSlug: HOUSE,
      active: true,
      providerAccount: { provider: OTG_PROVIDER, active: true },
    },
    select: {
      bookmarkerId: true,
      providerAccount: { select: { name: true } },
    },
  });
  const activeBetboard = await prisma.providerAccountHouse.count({
    where: {
      bettingHouseSlug: HOUSE,
      active: true,
      providerAccount: { provider: OLD_PROVIDER, active: true },
    },
  });
  const house = await prisma.bettingHouse.findUnique({
    where: { slug: HOUSE },
    select: { syncMode: true },
  });

  if (
    activeOtg.length !== 1 ||
    activeOtg[0]?.bookmarkerId !== OTG_BOOKMAKER_ID ||
    activeBetboard !== 0 ||
    house?.syncMode !== 'AUTO'
  ) {
    throw new Error('Auditoria final do cutover OTG falhou');
  }

  console.log(
    `AUDIT OK: otgAtivo=1 betboardAtivo=0 bookmakerId=${OTG_BOOKMAKER_ID} syncMode=AUTO`,
  );
}

async function main() {
  const house = await prisma.bettingHouse.findUnique({
    where: { slug: HOUSE },
    select: { id: true, active: true, syncMode: true },
  });
  if (!house) throw new Error(`Casa nao encontrada: ${HOUSE}`);

  const accounts = await readState();
  const oldAccounts = accounts.filter(
    (candidate) => candidate.provider === OLD_PROVIDER,
  );
  const oldAssociations = oldAccounts.flatMap((candidate) =>
    candidate.houses
      .filter(
        (association) =>
          association.bettingHouseSlug === HOUSE && association.active,
      )
      .map((association) => ({
        associationId: association.id,
        accountId: candidate.id,
        accountName: candidate.name,
      })),
  );
  const existingOtg = accounts.find(
    (candidate) =>
      candidate.provider === OTG_PROVIDER &&
      candidate.name === OTG_ACCOUNT_NAME,
  );

  console.log(
    `${APPLY ? 'APPLY' : 'DRY-RUN'} house=${HOUSE} active=${house.active} syncMode=${house.syncMode}`,
  );
  console.log(
    `OTG account: ${existingOtg?.id ?? '(create)'} -> active, bookmakerId=${OTG_BOOKMAKER_ID}`,
  );
  console.log(`Betboard associations to deactivate: ${oldAssociations.length}`);
  for (const association of oldAssociations) {
    console.log(
      `  association=${association.associationId} account=${association.accountId} (${association.accountName})`,
    );
  }

  if (!APPLY) {
    console.log('DRY-RUN: nenhuma alteracao gravada; use --apply.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    let encryptedPassword = null;
    if (existingOtg?.encryptedPassword) {
      try {
        if (
          decrypt(existingOtg.encryptedPassword, encryptionKey) === password
        ) {
          encryptedPassword = existingOtg.encryptedPassword;
        }
      } catch {
        encryptedPassword = null;
      }
    }
    encryptedPassword ??= encrypt(password, encryptionKey);

    const otgAccount = await tx.providerAccount.upsert({
      where: {
        uq_account_name_provider: {
          name: OTG_ACCOUNT_NAME,
          provider: OTG_PROVIDER,
        },
      },
      create: {
        name: OTG_ACCOUNT_NAME,
        provider: OTG_PROVIDER,
        apiBaseUrl: OTG_API_BASE,
        email,
        encryptedPassword,
        active: true,
      },
      update: {
        apiBaseUrl: OTG_API_BASE,
        email,
        encryptedPassword,
        active: true,
        lastError: null,
      },
      select: { id: true },
    });

    await tx.providerAccountHouse.upsert({
      where: {
        uq_account_house: {
          providerAccountId: otgAccount.id,
          bettingHouseSlug: HOUSE,
        },
      },
      create: {
        providerAccountId: otgAccount.id,
        bettingHouseSlug: HOUSE,
        bookmarkerId: OTG_BOOKMAKER_ID,
        extraConfig: {},
        active: true,
      },
      update: {
        bookmarkerId: OTG_BOOKMAKER_ID,
        extraConfig: {},
        active: true,
      },
    });

    if (oldAssociations.length > 0) {
      await tx.providerAccountHouse.updateMany({
        where: {
          id: { in: oldAssociations.map((item) => item.associationId) },
        },
        data: { active: false },
      });
    }

    for (const accountId of new Set(
      oldAssociations.map((item) => item.accountId),
    )) {
      const otherActiveHouses = await tx.providerAccountHouse.count({
        where: { providerAccountId: accountId, active: true },
      });
      if (otherActiveHouses === 0) {
        await tx.providerAccount.update({
          where: { id: accountId },
          data: { active: false },
        });
      }
    }

    await tx.bettingHouse.update({
      where: { slug: HOUSE },
      data: { syncMode: 'AUTO' },
    });
  });

  await verifyFinalState();
}

main()
  .catch((error) => {
    console.error(
      `FATAL: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
