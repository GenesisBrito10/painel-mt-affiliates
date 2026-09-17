import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { google, sheets_v4 } from 'googleapis';

const SUPERBET = 'superbet';
const MARKED = 'marcado';

const URL_LMM80 =
  'https://wlsuperbet.adsrv.eacdn.com/C.ashx?btag=a_32666b_431c_&affid=662&siteid=32666&adid=431&c=LMM80';
const URL_JTJ127 =
  'https://wlsuperbet.adsrv.eacdn.com/C.ashx?btag=a_32666b_431c_&affid=662&siteid=32666&adid=431&c=JTJ127';

interface SheetRow {
  rowIndex: number;
  link: string;
  status: string;
  email: string;
}

function buildSheets() {
  const sheetId = process.env.SUPERBET_SHEET_ID!;
  const sheetTab = process.env.SUPERBET_SHEET_TAB ?? 'Sheet1';
  const auth = new google.auth.GoogleAuth({
    credentials: {
      type: process.env.GOOGLE_TYPE,
      project_id: process.env.GOOGLE_PROJECT_ID,
      private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
      private_key: (process.env.GOOGLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      client_id: process.env.GOOGLE_CLIENT_ID,
      universe_domain: process.env.GOOGLE_UNIVERSE_DOMAIN ?? 'googleapis.com',
    } as Record<string, string>,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return { sheets: google.sheets({ version: 'v4', auth }), sheetId, sheetTab };
}

async function readPool(
  sheets: sheets_v4.Sheets,
  sheetId: string,
  sheetTab: string,
): Promise<SheetRow[]> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${sheetTab}!A2:D`,
  });
  const values = (res.data.values ?? []) as string[][];
  return values.map((row, i) => ({
    rowIndex: i + 2,
    link: (row[1] ?? '').trim(),
    status: (row[2] ?? '').trim(),
    email: (row[3] ?? '').trim(),
  }));
}

async function writeRow(
  sheets: sheets_v4.Sheets,
  sheetId: string,
  sheetTab: string,
  rowIndex: number,
  status: string,
  email: string,
): Promise<void> {
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${sheetTab}!C${rowIndex}:D${rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[status, email]] },
  });
}

function parseCampaign(url: string): {
  campaignId: string;
  affiliateId: string;
} {
  const u = new URL(url);
  const c = u.searchParams.get('c') ?? '';
  const affid = u.searchParams.get('affid') ?? '';
  return { campaignId: `${affid}-${c}`, affiliateId: affid };
}

async function ensureDb(prisma: PrismaClient): Promise<void> {
  for (let i = 1; i <= 2; i++) {
    try {
      await prisma.user.count();
      return;
    } catch (e) {
      console.error(`DB attempt ${i}: ${(e as Error).message}`);
      if (i === 2) {
        await prisma.$disconnect();
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function assignToUser(
  prisma: PrismaClient,
  email: string,
  url: string,
  cpa = 100,
  revshare = 0,
): Promise<{ userId: string }> {
  const { campaignId, affiliateId } = parseCampaign(url);
  const user = await prisma.user.findFirst({
    where: { email },
    select: { id: true },
  });
  if (!user) throw new Error(`user ${email} not found`);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.affiliateLink.findFirst({
      where: { userId: user.id, bettingHouse: SUPERBET },
      select: { id: true, cpa: true, revshare: true },
    });
    if (existing) {
      await tx.affiliateLink.update({
        where: { id: existing.id },
        data: {
          campaignId,
          affiliateId,
          ...(existing.cpa == null ? { cpa } : {}),
          ...(existing.revshare == null ? { revshare } : {}),
        },
      });
    } else {
      await tx.affiliateLink.create({
        data: {
          userId: user.id,
          bettingHouse: SUPERBET,
          campaignId,
          affiliateId,
          cpa,
          revshare,
        },
      });
    }
    const lr = await tx.linkRequest.findFirst({
      where: {
        userId: user.id,
        bettingHouseSlug: SUPERBET,
        status: 'PENDING',
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (lr) {
      await tx.linkRequest.update({
        where: { id: lr.id },
        data: {
          status: 'FULFILLED',
          fulfilledAt: new Date(),
          fulfilledByName: 'Sistema',
          adminNote: '',
          links: [{ label: '', url }],
        },
      });
    }
  });
  return { userId: user.id };
}

async function moveExistingOwnerToAnotherLink(
  prisma: PrismaClient,
  pool: SheetRow[],
  ownerUserId: string,
  oldUrl: string,
): Promise<{ newUrl: string; newRow: SheetRow; ownerEmail: string }> {
  const owner = await prisma.user.findUnique({
    where: { id: ownerUserId },
    select: { email: true },
  });
  if (!owner) throw new Error(`owner ${ownerUserId} not found`);

  const candidates = pool.filter(
    (r) => !r.status && !r.email && r.link && r.link !== oldUrl,
  );
  if (candidates.length === 0)
    throw new Error('no free sheet row to migrate owner');
  const newRow = candidates[0]!;
  const { campaignId, affiliateId } = parseCampaign(newRow.link);

  const conflict = await prisma.affiliateLink.findFirst({
    where: {
      campaignId,
      bettingHouse: SUPERBET,
      NOT: { userId: ownerUserId },
    },
    select: { userId: true },
  });
  if (conflict) {
    throw new Error(
      `chosen new campaignId ${campaignId} conflicts with user ${conflict.userId}`,
    );
  }

  await prisma.$transaction(async (tx) => {
    const existing = await tx.affiliateLink.findFirst({
      where: { userId: ownerUserId, bettingHouse: SUPERBET },
      select: { id: true },
    });
    if (existing) {
      await tx.affiliateLink.update({
        where: { id: existing.id },
        data: { campaignId, affiliateId },
      });
    }
    const lr = await tx.linkRequest.findFirst({
      where: {
        userId: ownerUserId,
        bettingHouseSlug: SUPERBET,
        status: 'FULFILLED',
      },
      orderBy: { fulfilledAt: 'desc' },
      select: { id: true },
    });
    if (lr) {
      await tx.linkRequest.update({
        where: { id: lr.id },
        data: { links: [{ label: '', url: newRow.link }] },
      });
    }
  });

  return { newUrl: newRow.link, newRow, ownerEmail: owner.email };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing');
  const adapter = new PrismaPg({ connectionString: url });
  const prisma = new PrismaClient({ adapter });
  await ensureDb(prisma);

  const { sheets, sheetId, sheetTab } = buildSheets();
  const pool = await readPool(sheets, sheetId, sheetTab);
  console.log(`pool rows: ${pool.length}`);

  // ── Step 1: assign LMM80 to camisff349 ─────────────────────────────────
  console.log('\n[1] camisff349@gmail.com → LMM80');
  const { campaignId: cidLMM } = parseCampaign(URL_LMM80);
  const lmmConflict = await prisma.affiliateLink.findFirst({
    where: { campaignId: cidLMM, bettingHouse: SUPERBET },
    select: { userId: true },
  });
  if (lmmConflict) {
    console.error(
      `  ABORT: ${cidLMM} already assigned to user ${lmmConflict.userId}`,
    );
  } else {
    await assignToUser(prisma, 'camisff349@gmail.com', URL_LMM80);
    const lmmRow = pool.find((r) => r.link === URL_LMM80);
    if (lmmRow) {
      await writeRow(
        sheets,
        sheetId,
        sheetTab,
        lmmRow.rowIndex,
        MARKED,
        'camisff349@gmail.com',
      );
      lmmRow.status = MARKED;
      lmmRow.email = 'camisff349@gmail.com';
      console.log(
        `  DB+sheet OK | campaignId=${cidLMM} | row=${lmmRow.rowIndex}`,
      );
    } else {
      console.warn(`  sheet row for ${URL_LMM80} not found`);
    }
  }

  // ── Step 2: handle JTJ127 ───────────────────────────────────────────────
  console.log('\n[2] sr.thiagofelipe@gmail.com → JTJ127');
  await new Promise((r) => setTimeout(r, 1100));
  const { campaignId: cidJTJ } = parseCampaign(URL_JTJ127);
  const jtjOwner = await prisma.affiliateLink.findFirst({
    where: { campaignId: cidJTJ, bettingHouse: SUPERBET },
    select: { userId: true, user: { select: { email: true } } },
  });

  if (jtjOwner) {
    console.log(
      `  current owner: ${jtjOwner.user?.email} (${jtjOwner.userId}) — migrating`,
    );
    const moved = await moveExistingOwnerToAnotherLink(
      prisma,
      pool,
      jtjOwner.userId,
      URL_JTJ127,
    );
    const oldRow = pool.find((r) => r.link === URL_JTJ127);
    if (oldRow) {
      await writeRow(sheets, sheetId, sheetTab, oldRow.rowIndex, '', '');
      oldRow.status = '';
      oldRow.email = '';
      console.log(`  cleared old row ${oldRow.rowIndex} (JTJ127)`);
      await new Promise((r) => setTimeout(r, 1100));
    }
    await writeRow(
      sheets,
      sheetId,
      sheetTab,
      moved.newRow.rowIndex,
      MARKED,
      moved.ownerEmail,
    );
    moved.newRow.status = MARKED;
    moved.newRow.email = moved.ownerEmail;
    console.log(
      `  migrated owner ${moved.ownerEmail} → row ${moved.newRow.rowIndex} (${moved.newUrl})`,
    );
    await new Promise((r) => setTimeout(r, 1100));
  } else {
    console.log('  JTJ127 was free');
  }

  await assignToUser(prisma, 'sr.thiagofelipe@gmail.com', URL_JTJ127);
  const jtjRow = pool.find((r) => r.link === URL_JTJ127);
  if (jtjRow) {
    await writeRow(
      sheets,
      sheetId,
      sheetTab,
      jtjRow.rowIndex,
      MARKED,
      'sr.thiagofelipe@gmail.com',
    );
    console.log(
      `  DB+sheet OK | campaignId=${cidJTJ} | row=${jtjRow.rowIndex}`,
    );
  } else {
    console.warn(`  sheet row for ${URL_JTJ127} not found`);
  }

  console.log('\nDONE');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
