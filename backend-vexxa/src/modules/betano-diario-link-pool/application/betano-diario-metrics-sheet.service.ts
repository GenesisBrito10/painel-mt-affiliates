import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, sheets_v4 } from 'googleapis';
import {
  BetanoDiarioMetricsSchemaError,
  parseBetanoDiarioMetricTabDate,
  parseBetanoDiarioMetricsTab,
  type BetanoDiarioMetricIssue,
  type BetanoDiarioMetricRow,
} from '../domain/betano-diario-metrics.parser.js';

function saoPauloDate(now: Date): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return new Date(Date.UTC(value('year'), value('month') - 1, value('day')));
}

@Injectable()
export class BetanoDiarioMetricsSheetService implements OnModuleInit {
  private readonly logger = new Logger(BetanoDiarioMetricsSheetService.name);
  private sheets!: sheets_v4.Sheets;
  private sheetId!: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.sheetId = this.config.getOrThrow<string>('BETANO_DIARIO_SHEET_ID');
    const auth = new google.auth.GoogleAuth({
      credentials: {
        type: this.config.getOrThrow<string>('GOOGLE_TYPE'),
        project_id: this.config.getOrThrow<string>('GOOGLE_PROJECT_ID'),
        private_key_id: this.config.getOrThrow<string>('GOOGLE_PRIVATE_KEY_ID'),
        private_key: this.config
          .getOrThrow<string>('GOOGLE_PRIVATE_KEY')
          .replace(/\\n/gu, '\n'),
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
  }

  async readMetrics(now = new Date()): Promise<{
    tabs: string[];
    rows: BetanoDiarioMetricRow[];
    issues: BetanoDiarioMetricIssue[];
  }> {
    const metadata = await this.sheets.spreadsheets.get({
      spreadsheetId: this.sheetId,
      fields: 'sheets.properties.title',
    });
    const today = saoPauloDate(now);
    const tabs = (metadata.data.sheets ?? [])
      .map((sheet) => sheet.properties?.title?.trim() ?? '')
      .map((title) => ({
        title,
        date: parseBetanoDiarioMetricTabDate(title),
      }))
      .filter(
        (item): item is { title: string; date: Date } =>
          item.date !== null && item.date <= today,
      )
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map((item) => item.title);

    if (tabs.length === 0) return { tabs: [], rows: [], issues: [] };

    const ranges = tabs.map((tab) => `'${tab.replace(/'/gu, "''")}'!A1:F`);
    const response = await this.sheets.spreadsheets.values.batchGet({
      spreadsheetId: this.sheetId,
      ranges,
    });

    const rows: BetanoDiarioMetricRow[] = [];
    const issues: BetanoDiarioMetricIssue[] = [];
    tabs.forEach((tab, index) => {
      const values = (response.data.valueRanges?.[index]?.values ?? []) as
        | string[][]
        | undefined;
      try {
        const parsed = parseBetanoDiarioMetricsTab(tab, values ?? []);
        rows.push(...parsed.rows);
        issues.push(...parsed.issues);
      } catch (error) {
        const message =
          error instanceof BetanoDiarioMetricsSchemaError
            ? error.message
            : `Aba ${tab}: ${error instanceof Error ? error.message : String(error)}`;
        this.logger.warn(message);
        issues.push({ tab, rowIndex: 2, message });
      }
    });
    return { tabs, rows, issues };
  }
}
