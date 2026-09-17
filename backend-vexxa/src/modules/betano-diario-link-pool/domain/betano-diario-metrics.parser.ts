import { extractBetanoCampaignId } from '../../betano-link-pool/domain/betano.types.js';

const METRIC_HEADERS = [
  'LINKS',
  'CLICKS',
  'REGISTROS',
  'FTDS',
  'FTD AMOUNT',
  'CPA',
] as const;

export interface BetanoDiarioMetricRow {
  tab: string;
  rowIndex: number;
  date: Date;
  link: string;
  campaignId: string;
  affiliateId: string;
  clicks: number;
  registrations: number;
  ftds: number;
  deposit: number;
  cpaQualified: number;
}

export interface BetanoDiarioMetricIssue {
  tab: string;
  rowIndex: number;
  message: string;
}

export class BetanoDiarioMetricsSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BetanoDiarioMetricsSchemaError';
  }
}

function normalizedHeader(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/gu, ' ').toUpperCase();
}

export function parseBetanoDiarioMetricTabDate(title: string): Date | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(title.trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function parseCount(value: string | undefined, label: string): number {
  const raw = (value ?? '').trim();
  if (!/^\d+$/u.test(raw)) {
    throw new Error(`${label} deve ser um inteiro não negativo.`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} está fora do intervalo aceito.`);
  }
  return parsed;
}

function parseAmount(value: string | undefined): number {
  const raw = (value ?? '').trim();
  const stripped = raw.replace(/[^\d,.-]/gu, '');
  const normalized = stripped.includes(',')
    ? stripped.replace(/\./gu, '').replace(',', '.')
    : stripped;
  if (!normalized || !/^(?:\d+)(?:\.\d+)?$/u.test(normalized)) {
    throw new Error('FTD AMOUNT deve ser um valor não negativo.');
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('FTD AMOUNT deve ser um valor não negativo.');
  }
  return parsed;
}

export function parseBetanoDiarioMetricsTab(
  tab: string,
  values: string[][],
): { rows: BetanoDiarioMetricRow[]; issues: BetanoDiarioMetricIssue[] } {
  const date = parseBetanoDiarioMetricTabDate(tab);
  if (!date) {
    throw new BetanoDiarioMetricsSchemaError(`Aba de data inválida: ${tab}.`);
  }

  const headers = values[1] ?? [];
  const positions = new Map<string, number[]>();
  headers.forEach((header, index) => {
    const normalized = normalizedHeader(header);
    const current = positions.get(normalized) ?? [];
    current.push(index);
    positions.set(normalized, current);
  });
  for (const required of METRIC_HEADERS) {
    const matches = positions.get(required) ?? [];
    if (matches.length !== 1) {
      throw new BetanoDiarioMetricsSchemaError(
        `Aba ${tab}: cabeçalho ${required} deve existir exatamente uma vez na linha 2.`,
      );
    }
  }

  const indexOf = (header: (typeof METRIC_HEADERS)[number]): number =>
    positions.get(header)?.[0] ?? -1;
  const linkIndex = indexOf('LINKS');
  const metricIndexes = {
    clicks: indexOf('CLICKS'),
    registrations: indexOf('REGISTROS'),
    ftds: indexOf('FTDS'),
    deposit: indexOf('FTD AMOUNT'),
    cpa: indexOf('CPA'),
  };

  const rows: BetanoDiarioMetricRow[] = [];
  const issues: BetanoDiarioMetricIssue[] = [];
  values.slice(2).forEach((row, offset) => {
    const rowIndex = offset + 3;
    const link = (row[linkIndex] ?? '').trim();
    if (!link) return;
    const metricValues = Object.values(metricIndexes).map(
      (index) => row[index],
    );
    if (metricValues.every((value) => (value ?? '').trim() === '')) return;

    const parsedLink = extractBetanoCampaignId(link);
    if (!parsedLink) {
      issues.push({ tab, rowIndex, message: 'LINKS não contém siteid e c.' });
      return;
    }

    try {
      rows.push({
        tab,
        rowIndex,
        date: new Date(date),
        link,
        campaignId: `${parsedLink.siteid}-${parsedLink.c}`,
        affiliateId: parsedLink.siteid,
        clicks: parseCount(row[metricIndexes.clicks], 'CLICKS'),
        registrations: parseCount(
          row[metricIndexes.registrations],
          'REGISTROS',
        ),
        ftds: parseCount(row[metricIndexes.ftds], 'FTDs'),
        deposit: parseAmount(row[metricIndexes.deposit]),
        cpaQualified: parseCount(row[metricIndexes.cpa], 'CPA'),
      });
    } catch (error) {
      issues.push({
        tab,
        rowIndex,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return { rows, issues };
}
