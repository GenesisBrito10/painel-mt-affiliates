import type { SheetRow } from './betano-diario.types.js';

const REQUIRED_HEADERS = ['LINK', 'STATUS', 'E-MAIL'] as const;

export class BetanoDiarioSheetSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BetanoDiarioSheetSchemaError';
  }
}

function normalizeHeader(value: string | undefined): string {
  return (value ?? '').trim().toUpperCase();
}

function columnLetter(index: number): string {
  let value = index + 1;
  let out = '';
  while (value > 0) {
    value--;
    out = String.fromCharCode(65 + (value % 26)) + out;
    value = Math.floor(value / 26);
  }
  return out;
}

export function parseBetanoDiarioPoolSheet(values: string[][]): {
  columns: { status: string; email: string };
  rows: SheetRow[];
} {
  const headers = values[0] ?? [];
  const positions = new Map<string, number[]>();
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    const current = positions.get(normalized) ?? [];
    current.push(index);
    positions.set(normalized, current);
  });

  for (const required of REQUIRED_HEADERS) {
    const matches = positions.get(required) ?? [];
    if (matches.length !== 1) {
      throw new BetanoDiarioSheetSchemaError(
        `Cabeçalho ${required} deve existir exatamente uma vez.`,
      );
    }
  }

  const linkIndex = positions.get('LINK')?.[0] ?? -1;
  const statusIndex = positions.get('STATUS')?.[0] ?? -1;
  const emailIndex = positions.get('E-MAIL')?.[0] ?? -1;

  return {
    columns: {
      status: columnLetter(statusIndex),
      email: columnLetter(emailIndex),
    },
    rows: values.slice(1).map((row, index) => ({
      rowIndex: index + 2,
      link: (row[linkIndex] ?? '').trim(),
      status: (row[statusIndex] ?? '').trim(),
      email: (row[emailIndex] ?? '').trim(),
    })),
  };
}
