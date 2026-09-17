import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const cents = (value) => Math.round(Number(value ?? 0) * 100);

const pickHouse = (balance, house) => {
  const row = balance.perHouse.find((item) => item.house === house);
  return {
    total: cents(row?.total),
    withdrawable: cents(row?.withdrawable ?? Math.max(0, row?.total ?? 0)),
  };
};

const runPool = async (items, concurrency, worker) => {
  const result = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        result[index] = await worker(items[index], index);
      }
    }),
  );
  return result;
};

export async function createPinbetBalanceSnapshot(outputPath) {
  const dist = resolve(process.cwd(), 'dist/src/modules');
  const modules = await Promise.all([
    import('@nestjs/config'),
    import('@prisma/client'),
    import('@prisma/adapter-pg'),
    import(
      pathToFileURL(
        `${dist}/settings/infrastructure/persistence/settings.prisma-repository.js`,
      ).href
    ),
    import(
      pathToFileURL(`${dist}/settings/application/settings.service.js`).href
    ),
    import(
      pathToFileURL(
        `${dist}/dashboard/application/dashboard-access.service.js`,
      ).href
    ),
    import(
      pathToFileURL(
        `${dist}/dashboard/infrastructure/persistence/dashboard.prisma-repository.js`,
      ).href
    ),
    import(
      pathToFileURL(
        `${dist}/dashboard/application/dashboard-balance.service.js`,
      ).href
    ),
  ]);
  const exported = (module, name) => module[name] ?? module.default?.[name];
  const ConfigService = exported(modules[0], 'ConfigService');
  const PrismaClient = exported(modules[1], 'PrismaClient');
  const PrismaPg = exported(modules[2], 'PrismaPg');
  const SettingsPrismaRepository = exported(
    modules[3],
    'SettingsPrismaRepository',
  );
  const SettingsService = exported(modules[4], 'SettingsService');
  const DashboardAccessService = exported(
    modules[5],
    'DashboardAccessService',
  );
  const DashboardPrismaRepository = exported(
    modules[6],
    'DashboardPrismaRepository',
  );
  const DashboardBalanceService = exported(
    modules[7],
    'DashboardBalanceService',
  );

  const config = new ConfigService(process.env);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: config.getOrThrow('DATABASE_URL'),
      max: 5,
      connectionTimeoutMillis: 30_000,
    }),
  });
  await prisma.$connect();
  try {
    const settings = new SettingsService(
      new SettingsPrismaRepository(prisma),
    );
    const service = new DashboardBalanceService(
      new DashboardPrismaRepository(prisma),
      new DashboardAccessService(prisma),
      settings,
      prisma,
    );
    const users = await prisma.user.findMany({
      where: {
        affiliateLinks: {
          some: {
            deletedAt: null,
            bettingHouse: { in: ['pinbet-diario', 'pinbet-mensal'] },
          },
        },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const rows = await runPool(users, 5, async ({ id }, index) => {
      const jwt = { sub: id, email: '', role: 'AFFILIATE' };
      const diarioBalance = await service.getBalance(jwt, {
        bettingHouse: 'pinbet-diario',
      });
      const mensalBalance = await service.getBalance(jwt, {
        bettingHouse: 'pinbet-mensal',
      });
      const diario = pickHouse(diarioBalance, 'pinbet-diario');
      const mensal = pickHouse(mensalBalance, 'pinbet-mensal');
      const snapshotRow = {
        userId: id,
        diario,
        mensal,
        expectedMensal: {
          total: diario.total + mensal.total,
          withdrawable: diario.withdrawable + mensal.withdrawable,
        },
      };
      if ((index + 1) % 100 === 0 || index + 1 === users.length) {
        console.log(`Snapshot: ${index + 1}/${users.length}`);
      }
      return snapshotRow;
    });
    const snapshot = {
      createdAt: new Date().toISOString(),
      unit: 'cents',
      users: rows,
    };
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
      mode: 0o600,
    });
    return snapshot;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outputIndex = process.argv.indexOf('--output');
  if (outputIndex < 0 || !process.argv[outputIndex + 1]) {
    throw new Error('Use --output <arquivo.json>');
  }
  const snapshot = await createPinbetBalanceSnapshot(
    resolve(process.argv[outputIndex + 1]),
  );
  console.log(`Snapshot salvo: ${snapshot.users.length} usuários`);
}
