import type { SheetRow } from './sportingbet.types.js';

const REQUIRED_HEADERS = {
  affiliate: ['afiliado'],
  linkType: ['tipo de link'],
  link: ['url'],
  status: ['status'],
  email: ['email', 'e-mail'],
} as const;

type RequiredHeader = keyof typeof REQUIRED_HEADERS;

export interface SportingbetSheetParseResult {
  rows: SheetRow[];
  columns: { status: string; email: string };
}

export class SportingbetSheetSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = SportingbetSheetSchemaError.name;
  }
}

const normalizeHeader = (value: string): string =>
  value.trim().toLocaleLowerCase('pt-BR');

const columnToA1 = (columnIndex: number): string => {
  let value = columnIndex + 1;
  let result = '';

  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }

  return result;
};

export function parseSportingbetSheet(
  values: string[][],
): SportingbetSheetParseResult {
  const headers = (values[0] ?? []).map((value) =>
    normalizeHeader(String(value ?? '')),
  );
  const indexes = {} as Record<RequiredHeader, number>;

  for (const [field, acceptedHeaders] of Object.entries(REQUIRED_HEADERS) as [
    RequiredHeader,
    readonly string[],
  ][]) {
    const matches = headers
      .map((header, index) => (acceptedHeaders.includes(header) ? index : -1))
      .filter((index) => index >= 0);

    if (matches.length !== 1) {
      throw new SportingbetSheetSchemaError(
        `Cabeçalho obrigatório "${acceptedHeaders.join(' ou ')}" deve existir exatamente uma vez (encontrado: ${matches.length}).`,
      );
    }
    indexes[field] = matches[0]!;
  }

  const cell = (row: string[], field: RequiredHeader): string =>
    String(row[indexes[field]] ?? '').trim();

  return {
    rows: values.slice(1).map((row, index) => ({
      rowIndex: index + 2,
      affiliate: cell(row, 'affiliate'),
      linkType: cell(row, 'linkType'),
      link: cell(row, 'link'),
      status: cell(row, 'status'),
      email: cell(row, 'email'),
    })),
    columns: {
      status: columnToA1(indexes.status),
      email: columnToA1(indexes.email),
    },
  };
}
