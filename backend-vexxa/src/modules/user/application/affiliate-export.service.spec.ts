import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { StreamableFile } from '@nestjs/common';
import { Readable } from 'stream';
import {
  UserService,
  AFFILIATE_EXPORT_MAX_ROWS,
  type AffiliateExportRow,
  type AffiliatesFilter,
} from './user.service.js';
import { AffiliateExportService } from './affiliate-export.service.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Builds a UserService with a mocked PrismaService. Only `$queryRawUnsafe` is
 * exercised by the export path, so the other deps are inert stubs.
 */
const makeUserService = (rawRows: unknown[] = []) => {
  const queryRawUnsafe = vi.fn().mockResolvedValue(rawRows);
  const prisma = { $queryRawUnsafe: queryRawUnsafe } as any;
  const repo = {} as any;
  const notificationService = {} as any;
  const redis = {} as any;
  const service = new UserService(repo, notificationService, prisma, redis);
  return { service, queryRawUnsafe };
};

/** Drains a StreamableFile's underlying stream into a single Buffer. */
const drain = async (file: StreamableFile): Promise<Buffer> => {
  const stream = file.getStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

const makeRow = (
  over: Partial<AffiliateExportRow> = {},
): AffiliateExportRow => ({
  name: 'Alice',
  email: 'alice@example.com',
  status: 'APPROVED',
  referralOriginLabel: 'Direto ao painel',
  referredBy: null,
  memberships: [],
  createdAt: new Date('2026-01-15T12:00:00Z'),
  ...over,
});

/** AffiliateExportService backed by a stubbed UserService.findAffiliatesForExport. */
const makeExportService = (rows: AffiliateExportRow[]) => {
  const findAffiliatesForExport = vi.fn().mockResolvedValue(rows);
  const userService = { findAffiliatesForExport } as unknown as UserService;
  return {
    service: new AffiliateExportService(userService),
    findAffiliatesForExport,
  };
};

// ─── UserService.buildAffiliatesQueryBase (filter respect) ────────────────────

describe('UserService.buildAffiliatesQueryBase', () => {
  const { service } = makeUserService();

  it('always scopes to non-deleted users with no extra params', () => {
    const { whereClause, params } = service.buildAffiliatesQueryBase({});
    expect(whereClause).toBe('u."deletedAt" IS NULL');
    expect(params).toEqual([]);
  });

  it('respects the search filter (name OR email ILIKE, wildcard param)', () => {
    const { whereClause, params } = service.buildAffiliatesQueryBase({
      search: 'bob',
    });
    expect(whereClause).toContain('u.name ILIKE $1');
    expect(whereClause).toContain('u.email ILIKE $1');
    expect(params).toEqual(['%bob%']);
  });

  it('respects the role filter (uppercased) and ignores "all"', () => {
    const applied = service.buildAffiliatesQueryBase({ role: 'affiliate' });
    expect(applied.whereClause).toContain('u.role = $1');
    expect(applied.params).toEqual(['AFFILIATE']);

    const skipped = service.buildAffiliatesQueryBase({ role: 'all' });
    expect(skipped.whereClause).not.toContain('u.role');
    expect(skipped.params).toEqual([]);
  });

  it('respects the status filter (uppercased) and ignores "all"', () => {
    const applied = service.buildAffiliatesQueryBase({ status: 'pending' });
    expect(applied.whereClause).toContain('u.status = $1');
    expect(applied.params).toEqual(['PENDING']);

    const skipped = service.buildAffiliatesQueryBase({ status: 'all' });
    expect(skipped.whereClause).not.toContain('u.status');
  });

  it('respects noLink="true" with a NOT EXISTS sub-query (no param)', () => {
    const applied = service.buildAffiliatesQueryBase({ noLink: 'true' });
    expect(applied.whereClause).toContain('NOT EXISTS');
    expect(applied.params).toEqual([]);

    const skipped = service.buildAffiliatesQueryBase({ noLink: 'false' });
    expect(skipped.whereClause).not.toContain('NOT EXISTS');
  });

  it('respects the bettingHouseId filter with an EXISTS sub-query', () => {
    const applied = service.buildAffiliatesQueryBase({
      bettingHouseId: 'betano',
    });
    expect(applied.whereClause).toContain('al3."bettingHouse" = $1');
    expect(applied.params).toEqual(['betano']);

    const skipped = service.buildAffiliatesQueryBase({ bettingHouseId: 'all' });
    expect(skipped.params).toEqual([]);
  });

  it.each([
    ['direct', 'u."referredById" IS NULL'],
    ['0', 'u."referredById" IS NULL'],
    ['1', 'rd.depth = 1'],
    ['2', 'rd.depth = 2'],
    ['3', 'rd.depth = 3'],
    ['4plus', 'rd.depth >= 4'],
  ])('respects referralDepth=%s', (depth, expected) => {
    const { whereClause } = service.buildAffiliatesQueryBase({
      referralDepth: depth,
    });
    expect(whereClause).toContain(expected);
  });

  it('combines multiple filters and increments param indices', () => {
    const { whereClause, params, nextParamIdx } =
      service.buildAffiliatesQueryBase({
        search: 'ana',
        status: 'APPROVED',
        bettingHouseId: 'superbet',
      });
    expect(params).toEqual(['%ana%', 'APPROVED', 'superbet']);
    // $1 search, $2 status, $3 house → next free index is 4
    expect(nextParamIdx).toBe(4);
    expect(whereClause).toContain('$1');
    expect(whereClause).toContain('$2');
    expect(whereClause).toContain('$3');
  });
});

// ─── UserService.referralOriginLabel ──────────────────────────────────────────

describe('UserService.referralOriginLabel', () => {
  const { service } = makeUserService();

  it('maps null → "Indefinido", 0 → "Direto ao painel", N → "Nível N"', () => {
    expect(service.referralOriginLabel(null)).toBe('Indefinido');
    expect(service.referralOriginLabel(0)).toBe('Direto ao painel');
    expect(service.referralOriginLabel(2)).toBe('Nível 2');
  });
});

// ─── UserService.findAffiliatesForExport ──────────────────────────────────────

describe('UserService.findAffiliatesForExport', () => {
  afterEach(() => vi.clearAllMocks());

  it('passes filter params plus the 10.000-row safety cap, never LIMIT/OFFSET pagination', async () => {
    const { service, queryRawUnsafe } = makeUserService([]);

    await service.findAffiliatesForExport({
      search: 'bob',
      status: 'APPROVED',
    });

    expect(queryRawUnsafe).toHaveBeenCalledTimes(1);
    const [sql, ...args] = queryRawUnsafe.mock.calls[0];

    // filter params first ($1 search, $2 role default, $3 status), then the cap
    expect(args).toEqual([
      '%bob%',
      'AFFILIATE',
      'APPROVED',
      AFFILIATE_EXPORT_MAX_ROWS,
    ]);
    expect(AFFILIATE_EXPORT_MAX_ROWS).toBe(10000);

    // export query must cap rows but never paginate
    expect(sql).toContain('LIMIT $4');
    expect(sql).not.toContain('OFFSET');
  });

  it('defaults the role filter to AFFILIATE so ADMINs never leak into the export', async () => {
    const { service, queryRawUnsafe } = makeUserService([]);

    await service.findAffiliatesForExport({});

    const [sql, ...args] = queryRawUnsafe.mock.calls[0];
    expect(sql).toContain('u.role = $1');
    expect(args).toEqual(['AFFILIATE', AFFILIATE_EXPORT_MAX_ROWS]);
  });

  it('honors an explicit role filter over the AFFILIATE default', async () => {
    const { service, queryRawUnsafe } = makeUserService([]);

    await service.findAffiliatesForExport({ role: 'admin' });

    const [, ...args] = queryRawUnsafe.mock.calls[0];
    expect(args).toEqual(['ADMIN', AFFILIATE_EXPORT_MAX_ROWS]);
  });

  it('returns one mapped row per affiliate', async () => {
    const raw = [
      {
        id: 'u1',
        name: 'Alice',
        email: 'alice@x.com',
        status: 'APPROVED',
        createdAt: new Date('2026-02-01T00:00:00Z'),
        referralDepth: 0,
        referredBy: null,
        links: [],
      },
      {
        id: 'u2',
        name: 'Bob',
        email: 'bob@x.com',
        status: 'PENDING',
        createdAt: new Date('2026-02-02T00:00:00Z'),
        referralDepth: 1,
        referredBy: { id: 'u1', name: 'Alice', email: 'alice@x.com' },
        links: [],
      },
    ];
    const { service } = makeUserService(raw);

    const rows = await service.findAffiliatesForExport({});

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      name: 'Alice',
      email: 'alice@x.com',
      status: 'APPROVED',
      referralOriginLabel: 'Direto ao painel',
      referredBy: null,
    });
    expect(rows[1]).toMatchObject({
      name: 'Bob',
      referralOriginLabel: 'Nível 1',
      referredBy: { name: 'Alice', email: 'alice@x.com' },
    });
  });

  it('maps memberships (houseName + commissions) from the links json aggregate', async () => {
    const raw = [
      {
        id: 'u1',
        name: 'Alice',
        email: 'alice@x.com',
        status: 'APPROVED',
        createdAt: new Date(),
        referralDepth: 0,
        referredBy: null,
        links: [
          {
            bettingHouse: 'betano',
            houseName: 'Betano',
            cpa: 100,
            revshare: 30,
          },
          {
            bettingHouse: 'superbet',
            houseName: 'Superbet',
            cpa: 80,
            revshare: 25,
          },
        ],
      },
    ];
    const { service } = makeUserService(raw);

    const [row] = await service.findAffiliatesForExport({});

    expect(row.memberships).toEqual([
      { houseName: 'Betano', commissionCpa: 100, commissionRevshare: 30 },
      { houseName: 'Superbet', commissionCpa: 80, commissionRevshare: 25 },
    ]);
  });

  it('coerces null commissions to 0 and tolerates an empty/missing links array', async () => {
    const raw = [
      {
        id: 'u1',
        name: 'Carol',
        email: 'carol@x.com',
        status: 'APPROVED',
        createdAt: new Date(),
        referralDepth: null,
        referredBy: null,
        links: [
          { bettingHouse: 'x', houseName: 'X', cpa: null, revshare: null },
        ],
      },
    ];
    const { service } = makeUserService(raw);

    const [row] = await service.findAffiliatesForExport({});

    expect(row.referralOriginLabel).toBe('Indefinido');
    expect(row.memberships).toEqual([
      { houseName: 'X', commissionCpa: 0, commissionRevshare: 0 },
    ]);
  });
});

// ─── AffiliateExportService — CSV ─────────────────────────────────────────────

describe('AffiliateExportService — CSV', () => {
  it('emits a header row and exactly one data row per affiliate', async () => {
    const rows = [
      makeRow({ name: 'Alice', email: 'alice@x.com' }),
      makeRow({ name: 'Bob', email: 'bob@x.com' }),
    ];
    const { service } = makeExportService(rows);

    const file = await service.export({}, 'csv');
    const text = (await drain(file)).toString('utf-8');
    const lines = text.replace(/^�/, '').trim().split('\r\n');

    // 1 header + 2 affiliates
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('"Nome"');
    expect(lines[0]).toContain('"Casas & comissões"');
    expect(lines[1]).toContain('"Alice"');
    expect(lines[2]).toContain('"Bob"');
  });

  it('starts with a UTF-8 BOM and uses ";" as the cell separator', async () => {
    const { service } = makeExportService([makeRow()]);

    const file = await service.export({}, 'csv');
    const buf = await drain(file);

    // BOM bytes EF BB BF
    expect(buf[0]).toBe(0xef);
    expect(buf[1]).toBe(0xbb);
    expect(buf[2]).toBe(0xbf);

    const header = buf.toString('utf-8').replace(/^�/, '').split('\r\n')[0];
    expect(header.split(';').length).toBe(8); // 8 columns
  });

  it('escapes embedded double-quotes by doubling them', async () => {
    const { service } = makeExportService([
      makeRow({ name: 'Ana "The Boss" Lima' }),
    ]);

    const file = await service.export({}, 'csv');
    const text = (await drain(file)).toString('utf-8');

    expect(text).toContain('"Ana ""The Boss"" Lima"');
  });

  it('keeps separators/newlines inside a cell safe by quoting the whole cell', async () => {
    const { service } = makeExportService([
      makeRow({ name: 'Semi; colon\nand newline' }),
    ]);

    const file = await service.export({}, 'csv');
    const text = (await drain(file)).toString('utf-8');

    // the raw value lives inside a single quoted cell — the inner ';' and '\n'
    // do not split the record
    expect(text).toContain('"Semi; colon\nand newline"');
  });

  it('concatenates memberships into the single "Casas & comissões" column', async () => {
    const { service } = makeExportService([
      makeRow({
        memberships: [
          { houseName: 'Betano', commissionCpa: 100, commissionRevshare: 30 },
          { houseName: 'Superbet', commissionCpa: 80, commissionRevshare: 25 },
        ],
      }),
    ]);

    const file = await service.export({}, 'csv');
    const text = (await drain(file)).toString('utf-8');

    expect(text).toContain(
      '"Betano (CPA 100 / RS 30%); Superbet (CPA 80 / RS 25%)"',
    );
  });

  it('renders "—" for missing referrer and empty memberships', async () => {
    const { service } = makeExportService([
      makeRow({ referredBy: null, memberships: [] }),
    ]);

    const file = await service.export({}, 'csv');
    const text = (await drain(file)).toString('utf-8');
    const dataLine = text.replace(/^�/, '').trim().split('\r\n')[1];

    // indicador, e-mail do indicador, casas → all "—"
    expect(dataLine.match(/"—"/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('neutralizes spreadsheet formula injection by prefixing a single quote', async () => {
    const { service } = makeExportService([
      makeRow({ name: '=HYPERLINK("http://evil","x")', email: '+1', status: 'APPROVED' }),
    ]);

    const file = await service.export({}, 'csv');
    const text = (await drain(file)).toString('utf-8');
    const dataLine = text.replace(/^�/, '').trim().split('\r\n')[1];

    // The dangerous leading char must be neutralized with a `'` prefix so the
    // spreadsheet treats the cell as text, not a formula (CWE-1236).
    expect(dataLine).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(dataLine).toContain(`"'+1"`);
  });

  it('defaults to CSV when format is undefined/unknown', async () => {
    const { service } = makeExportService([makeRow()]);

    const file = await service.export({}, undefined);
    const buf = await drain(file);
    expect(buf[0]).toBe(0xef); // BOM → CSV path
  });

  it('produces a header-only file when no affiliates match', async () => {
    const { service } = makeExportService([]);

    const file = await service.export({}, 'csv');
    const text = (await drain(file)).toString('utf-8');
    const lines = text.replace(/^�/, '').trim().split('\r\n');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"Nome"');
  });
});

// ─── AffiliateExportService — PDF ─────────────────────────────────────────────

describe('AffiliateExportService — PDF', () => {
  it('returns a non-empty PDF buffer with the %PDF magic header', async () => {
    const { service } = makeExportService([
      makeRow({
        memberships: [
          { houseName: 'Betano', commissionCpa: 100, commissionRevshare: 30 },
        ],
      }),
    ]);

    const file = await service.export({}, 'pdf');
    const buf = await drain(file);

    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('still produces a non-empty PDF for an empty result set', async () => {
    const { service } = makeExportService([]);

    const file = await service.export({}, 'pdf');
    const buf = await drain(file);

    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('renders a small result set on a single page (no spurious blank page)', async () => {
    const { service } = makeExportService([
      makeRow({ name: 'A' }),
      makeRow({ name: 'B' }),
      makeRow({ name: 'C' }),
    ]);

    const file = await service.export({}, 'pdf');
    const buf = await drain(file);

    // Count `/Type /Page` objects, excluding the `/Type /Pages` tree node.
    const pageObjects =
      buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? [];
    expect(pageObjects.length).toBe(1);
  });
});

// ─── AffiliateExportService.fileBaseName ──────────────────────────────────────

describe('AffiliateExportService.fileBaseName', () => {
  it('formats as afiliados-YYYY-MM-DD', () => {
    const name = AffiliateExportService.fileBaseName(
      new Date('2026-06-26T10:00:00'),
    );
    expect(name).toBe('afiliados-2026-06-26');
  });
});
