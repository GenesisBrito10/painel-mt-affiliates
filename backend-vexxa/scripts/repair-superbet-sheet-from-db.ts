import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { google, sheets_v4 } from 'googleapis';

const SUPERBET = 'superbet';
const MARKED = 'marcado';

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

async function markRow(
  sheets: sheets_v4.Sheets,
  sheetId: string,
  sheetTab: string,
  rowIndex: number,
  email: string,
): Promise<void> {
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${sheetTab}!C${rowIndex}:D${rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[MARKED, email]] },
  });
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing');
  const adapter = new PrismaPg({ connectionString: url });
  const prisma = new PrismaClient({ adapter });

  let attempts = 0;
  while (attempts < 2) {
    try {
      await prisma.user.count();
      break;
    } catch (err) {
      attempts++;
      console.error(`DB attempt ${attempts} failed: ${(err as Error).message}`);
      if (attempts >= 2) {
        console.error('DB unreachable after 2 attempts. Aborting.');
        await prisma.$disconnect();
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const { sheets, sheetId, sheetTab } = buildSheets();
  const pool = await readPool(sheets, sheetId, sheetTab);
  const byLink = new Map<string, SheetRow>();
  for (const r of pool) if (r.link) byLink.set(r.link, r);
  console.log(`Pool rows: ${pool.length}, with link: ${byLink.size}`);

  const fulfilled = await prisma.linkRequest.findMany({
    where: {
      bettingHouseSlug: SUPERBET,
      status: 'FULFILLED',
      fulfilledByName: 'Sistema',
    },
    select: {
      id: true,
      userId: true,
      links: true,
      user: { select: { email: true } },
    },
  });
  console.log(`Auto-assigned fulfilled: ${fulfilled.length}`);

  let marked = 0;
  let alreadyOk = 0;
  let noUrl = 0;
  let notFound = 0;
  let errors = 0;

  for (let i = 0; i < fulfilled.length; i++) {
    const r = fulfilled[i]!;
    const links = (r.links as { url: string }[] | null) ?? [];
    const url = links[0]?.url ?? '';
    if (!url) {
      noUrl++;
      continue;
    }
    const row = byLink.get(url);
    if (!row) {
      notFound++;
      continue;
    }
    const expectedEmail = r.user.email;
    if (
      row.status === MARKED &&
      row.email.toLowerCase() === expectedEmail.toLowerCase()
    ) {
      alreadyOk++;
      continue;
    }

    if (marked > 0) await new Promise((res) => setTimeout(res, 1100));

    try {
      await markRow(sheets, sheetId, sheetTab, row.rowIndex, expectedEmail);
      marked++;
      console.log(
        `[${marked}] row ${row.rowIndex} ← ${expectedEmail} (was status='${row.status}', email='${row.email}')`,
      );
    } catch (err) {
      errors++;
      console.error(
        `  MARK FAILED row ${row.rowIndex} (${expectedEmail}): ${(err as Error).message}`,
      );
    }
  }

  console.log(
    `\n=== SUMMARY ===\n` +
      `total_auto_fulfilled: ${fulfilled.length}\n` +
      `already_ok: ${alreadyOk}\n` +
      `marked: ${marked}\n` +
      `errors: ${errors}\n` +
      `no_url_in_request: ${noUrl}\n` +
      `sheet_row_not_found: ${notFound}`,
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
