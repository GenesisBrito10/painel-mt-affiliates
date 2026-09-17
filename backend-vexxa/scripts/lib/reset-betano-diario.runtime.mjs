import { createHash } from 'node:crypto';

export function argumentValue(argv, name) {
  const spacedIndex = argv.indexOf(name);
  if (spacedIndex >= 0) return argv[spacedIndex + 1] ?? null;
  const prefix = `${name}=`;
  const matched = argv.find((value) => value.startsWith(prefix));
  return matched?.slice(prefix.length) || null;
}

export const BETANO_DIARIO_RESET_TABLES = [
  'link_webhook_deliveries',
  'affiliate_api_link_request_logs',
  'link_assignment_logs',
  'backfill_runs',
  'gateway_webhook_events',
  'whatsapp_send_logs',
  'notifications',
  'prize_winners',
  'rank_prizes',
  'ranking_prizes',
  'cpa_prize_logs',
  'cpa_prize_awards',
  'cpa_prize_progress',
  'cpa_prize_rule_versions',
  'withdrawal_day_releases',
  'withdrawal_requests',
  'affiliate_data_change_logs',
  'affiliate_data',
  'financial_ledger',
  'commission_logs',
  'fraud_logs',
  'fraud_counts',
  'balance_adjustments',
  'notification_snapshots',
  'provider_account_houses',
  'house_link_rule_change_logs',
  'link_requests',
  'deals',
  'house_link_rules',
  'sync_logs',
  'affiliate_links',
];

function stable(value) {
  if (value instanceof Date) return value.toJSON();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !['generatedAt', 'snapshotToken', 'snapshotPath'].includes(key),
        )
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

export function resetSnapshotToken(snapshot) {
  return createHash('sha256')
    .update(JSON.stringify(stable(snapshot)))
    .digest('hex');
}

export function compareResetManifest(expected, current) {
  const tables = [
    ...new Set([...Object.keys(expected), ...Object.keys(current)]),
  ].sort();
  return tables.flatMap((table) => {
    const before = expected[table] ?? { count: 0, fingerprint: '' };
    const after = current[table] ?? { count: 0, fingerprint: '' };
    if (
      before.count === after.count &&
      before.fingerprint === after.fingerprint
    )
      return [];
    return [
      `${table}: count ${before.count} -> ${after.count}, fingerprint ${before.fingerprint} -> ${after.fingerprint}`,
    ];
  });
}

export function partitionInventoryTables(tableNames) {
  const knownSet = new Set(BETANO_DIARIO_RESET_TABLES);
  return {
    known: tableNames.filter((table) => knownSet.has(table)).sort(),
    unknown: tableNames.filter((table) => !knownSet.has(table)).sort(),
  };
}

export function resetQueryParams(predicate, slug, campaignIds) {
  const parameterNumbers = [...predicate.matchAll(/\$(\d+)/g)].map((match) =>
    Number(match[1]),
  );
  const parameterCount = Math.max(0, ...parameterNumbers);
  if (parameterCount === 1) return [slug];
  if (parameterCount === 2) return [slug, campaignIds];
  throw new Error(
    `Unsupported reset predicate parameter count: ${parameterCount}`,
  );
}

function decimalToCents(value) {
  const match = value.trim().match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error(`Invalid monetary value: ${value}`);
  const fraction = (match[3] ?? '').padEnd(2, '0');
  const cents = BigInt(match[2]) * 100n + BigInt(fraction || '0');
  return match[1] === '-' ? -cents : cents;
}

export function summarizeMoney(values) {
  const cents = values.reduce(
    (total, value) => total + (value == null ? 0n : decimalToCents(value)),
    0n,
  );
  const sign = cents < 0 ? '-' : '';
  const absolute = cents < 0 ? -cents : cents;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

function columnLetter(index) {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

export function buildSheetControlRanges(sheetTitle, headers, lastRow) {
  if (lastRow < 2) return [];
  const normalized = headers.map((header) => header.trim().toUpperCase());
  return ['STATUS', 'E-MAIL'].map((required) => {
    const indexes = normalized.flatMap((header, index) =>
      header === required ? [index] : [],
    );
    if (indexes.length !== 1) {
      throw new Error(
        `Expected exactly one ${required} column; found ${indexes.length}`,
      );
    }
    const column = columnLetter(indexes[0]);
    return `'${sheetTitle.replaceAll("'", "''")}'!${column}2:${column}${lastRow}`;
  });
}
