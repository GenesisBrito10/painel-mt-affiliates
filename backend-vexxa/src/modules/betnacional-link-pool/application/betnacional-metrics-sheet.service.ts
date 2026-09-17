import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, sheets_v4 } from 'googleapis';

export interface MetricsRow {
  campaignId: string;
  date: Date; // UTC midnight of the day
  clicks: number;
  registrations: number;
  ftds: number;
  cpaValue: number;
  deposit: number;
}

const DEFAULT_SHEET_ID = '1rHbp2UItctUzD3o82UXo6Ou6dDHnrq6wiEjvO5BQV8E';
const DEFAULT_SHEET_TAB = 'Historico';

@Injectable()
export class BetnacionalMetricsSheetService implements OnModuleInit {
  private readonly logger = new Logger(BetnacionalMetricsSheetService.name);
  private sheets!: sheets_v4.Sheets;
  private sheetId!: string;
  private sheetTab!: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.sheetId = this.config.get<string>(
      'BETNACIONAL_METRICS_SHEET_ID',
      DEFAULT_SHEET_ID,
    );
    this.sheetTab = this.config.get<string>(
      'BETNACIONAL_METRICS_SHEET_TAB',
      DEFAULT_SHEET_TAB,
    );

    const auth = new google.auth.GoogleAuth({
      credentials: {
        type: this.config.getOrThrow<string>('GOOGLE_TYPE'),
        project_id: this.config.getOrThrow<string>('GOOGLE_PROJECT_ID'),
        private_key_id: this.config.getOrThrow<string>('GOOGLE_PRIVATE_KEY_ID'),
        private_key: this.config
          .getOrThrow<string>('GOOGLE_PRIVATE_KEY')
          .replace(/\\n/g, '\n'),
        client_email: this.config.getOrThrow<string>('GOOGLE_CLIENT_EMAIL'),
        client_id: this.config.getOrThrow<string>('GOOGLE_CLIENT_ID'),
        universe_domain: this.config.get<string>(
          'GOOGLE_UNIVERSE_DOMAIN',
          'googleapis.com',
        ),
      } as Record<string, string>,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    this.sheets = google.sheets({ version: 'v4', auth });
    this.logger.log(
      `Initialized for sheet ${this.sheetId} (tab: ${this.sheetTab})`,
    );
  }

  // Header in row 1. Columns: A=ID Campanha, B=Data Registro,
  // C=Click, D=Registro, E=FTD, F=CPA, G=Deposito
  async readHistorico(): Promise<MetricsRow[]> {
    const range = `${this.sheetTab}!A2:G`;
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.sheetId,
      range,
    });
    const values = (res.data.values ?? []) as string[][];

    const parsed: MetricsRow[] = [];
    let skipped = 0;
    for (const row of values) {
      const campaignId = (row[0] ?? '').trim();
      const dateRaw = (row[1] ?? '').trim();
      if (!campaignId || !dateRaw) {
        skipped++;
        continue;
      }
      const date = parseBrDateOnly(dateRaw);
      if (!date) {
        skipped++;
        continue;
      }
      parsed.push({
        campaignId,
        date,
        clicks: parseIntSafe(row[2]),
        registrations: parseIntSafe(row[3]),
        ftds: parseIntSafe(row[4]),
        cpaValue: parseDecimalBr(row[5]),
        deposit: parseDecimalBr(row[6]),
      });
    }
    if (skipped > 0) {
      this.logger.debug(`Skipped ${skipped} invalid row(s) from sheet`);
    }
    return parsed;
  }
}

// "10/05/2026 13:48:33" → Date(UTC 2026-05-10 00:00:00)
export function parseBrDateOnly(value: string): Date | null {
  const datePart = value.split(' ')[0]?.trim() ?? '';
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(datePart);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const iso = `${yyyy}-${mm!.padStart(2, '0')}-${dd!.padStart(2, '0')}`;
  const d = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseIntSafe(raw: string | undefined): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[^\d-]/g, '');
  const n = Number.parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : 0;
}

// "R$ 1.234,56" | "1234,56" | "1234.56" → 1234.56
export function parseDecimalBr(raw: string | undefined): number {
  if (!raw) return 0;
  const stripped = raw.replace(/[^\d,.-]/g, '');
  const normalized = stripped.includes(',')
    ? stripped.replace(/\./g, '').replace(',', '.')
    : stripped;
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : 0;
}
