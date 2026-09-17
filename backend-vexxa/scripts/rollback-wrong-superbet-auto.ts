import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { google, sheets_v4 } from 'googleapis';

const SUPERBET = 'superbet';

async function ensureDb(prisma: PrismaClient): Promise<boolean> {
  for (let i = 1; i <= 2; i++) {
    try {
      await prisma.user.count();
      return true;
    } catch (err) {
      console.error(
        `DB connectivity attempt ${i} failed: ${(err as Error).message}`,
      );
      if (i === 2) return false;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return false;
}

function buildSheets(): {
  sheets: sheets_v4.Sheets;
  sheetId: string;
  sheetTab: string;
} {
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
  const sheets = google.sheets({ version: 'v4', auth });
  return { sheets, sheetId, sheetTab };
}

interface SheetRow {
  rowIndex: number;
  link: string;
  status: string;
  email: string;
}

async function readPool(
  sheets: sheets_v4.Sheets,
  sheetId: string,
  sheetTab: string,
): Promise<SheetRow[]> {
  const range = `${sheetTab}!A2:D`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range,
  });
  const values = (res.data.values ?? []) as string[][];
  return values.map((row, i) => ({
    rowIndex: i + 2,
    link: (row[1] ?? '').trim(),
    status: (row[2] ?? '').trim(),
    email: (row[3] ?? '').trim(),
  }));
}

async function clearSheetRow(
  sheets: sheets_v4.Sheets,
  sheetId: string,
  sheetTab: string,
  rowIndex: number,
): Promise<void> {
  const range = `${sheetTab}!C${rowIndex}:D${rowIndex}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range,
    valueInputOption: 'RAW',
    requestBody: { values: [['', '']] },
  });
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing');
  const adapter = new PrismaPg({ connectionString: url });
  const prisma = new PrismaClient({ adapter });

  const ok = await ensureDb(prisma);
  if (!ok) {
    console.error('DB unreachable after 2 attempts. Aborting.');
    await prisma.$disconnect();
    process.exit(1);
  }

  const { sheets, sheetId, sheetTab } = buildSheets();
  console.log('Reading pool...');
  const pool = await readPool(sheets, sheetId, sheetTab);
  const byEmail = new Map<string, SheetRow>();
  const byLink = new Map<string, SheetRow>();
  for (const r of pool) {
    if (r.email) byEmail.set(r.email.toLowerCase(), r);
    if (r.link) byLink.set(r.link, r);
  }
  console.log(
    `Pool rows: ${pool.length}, with email: ${byEmail.size}, with link: ${byLink.size}`,
  );

  const wrong = await prisma.linkRequest.findMany({
    where: {
      bettingHouseSlug: SUPERBET,
      status: 'FULFILLED',
      fulfilledByName: 'Sistema',
      user: { referredById: { not: null } },
    },
    select: {
      id: true,
      userId: true,
      links: true,
      user: { select: { email: true } },
    },
  });
  console.log(`Wrong auto-assignments: ${wrong.length}`);

  let reverted = 0;
  let sheetCleared = 0;
  let sheetMissed = 0;
  let dbErrors = 0;
  let sheetErrors = 0;

  for (let i = 0; i < wrong.length; i++) {
    // Throttle ~1.1s entre iterações (Sheets API write quota: 60/min/user).
    if (i > 0) await new Promise((res) => setTimeout(res, 1100));
    const r = wrong[i]!;
    const email = r.user.email.toLowerCase();
    const requestLinks = (r.links as { url: string }[] | null) ?? [];
    const requestUrl = requestLinks[0]?.url ?? '';
    let sheetRow = byEmail.get(email);
    let sheetAlreadyCleared = false;
    if (!sheetRow && requestUrl) {
      const byLinkRow = byLink.get(requestUrl);
      if (byLinkRow && !byLinkRow.email && !byLinkRow.status) {
        sheetRow = byLinkRow;
        sheetAlreadyCleared = true;
      }
    }
    console.log(
      `\n[${i + 1}/${wrong.length}] ${email} | request=${r.id} | sheet_row=${sheetRow?.rowIndex ?? 'NOT FOUND'}${sheetAlreadyCleared ? ' (already cleared)' : ''}`,
    );

    if (!sheetRow) {
      sheetMissed++;
      console.warn(
        `  sheet row not found for email ${email} nor by URL; skipping DB revert to avoid orphaned link`,
      );
      continue;
    }

    if (!sheetAlreadyCleared) {
      try {
        await clearSheetRow(sheets, sheetId, sheetTab, sheetRow.rowIndex);
        sheetCleared++;
        console.log(`  sheet row ${sheetRow.rowIndex} cleared`);
      } catch (err) {
        sheetErrors++;
        console.error(
          `  SHEET CLEAR FAILED row ${sheetRow.rowIndex}: ${(err as Error).message}`,
        );
        continue;
      }
    } else {
      console.log(
        `  sheet row ${sheetRow.rowIndex} already cleared; skipping write`,
      );
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.linkRequest.update({
          where: { id: r.id },
          data: {
            status: 'PENDING',
            fulfilledAt: null,
            fulfilledById: null,
            fulfilledByName: '',
            links: [],
          },
        });
        const link = await tx.affiliateLink.findFirst({
          where: { userId: r.userId, bettingHouse: SUPERBET },
          select: { id: true },
        });
        if (link) {
          await tx.affiliateLink.update({
            where: { id: link.id },
            data: {
              campaignId: `manual_superbet_${r.userId}`,
              affiliateId: '',
            },
          });
        }
      });
      reverted++;
      console.log(
        `  DB reverted (linkRequest → PENDING; affiliateLink campaignId reset)`,
      );
    } catch (err) {
      dbErrors++;
      console.error(`  DB REVERT FAILED: ${(err as Error).message}`);
    }
  }

  console.log(
    `\n=== SUMMARY ===\n` +
      `total_wrong: ${wrong.length}\n` +
      `reverted: ${reverted}\n` +
      `sheet_cleared: ${sheetCleared}\n` +
      `sheet_not_found: ${sheetMissed}\n` +
      `sheet_errors: ${sheetErrors}\n` +
      `db_errors: ${dbErrors}`,
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
