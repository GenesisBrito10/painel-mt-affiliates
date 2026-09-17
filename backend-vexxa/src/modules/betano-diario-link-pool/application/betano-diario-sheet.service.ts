import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, sheets_v4 } from 'googleapis';
import {
  SheetRow,
  BETANO_MARKED_STATUS,
} from '../domain/betano-diario.types.js';
import {
  BetanoDiarioSheetSchemaError,
  parseBetanoDiarioPoolSheet,
} from '../domain/betano-diario-sheet.parser.js';

@Injectable()
export class BetanoDiarioSheetService implements OnModuleInit {
  private readonly logger = new Logger(BetanoDiarioSheetService.name);
  private sheets!: sheets_v4.Sheets;
  private sheetId!: string;
  private sheetTab!: string;
  private controlColumns?: { status: string; email: string };

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    // Pool próprio do Betano Diário; não compartilha mais a aba do Betano.
    this.sheetId = this.config.getOrThrow<string>('BETANO_DIARIO_SHEET_ID');
    this.sheetTab = this.config.getOrThrow<string>('BETANO_DIARIO_SHEET_TAB');

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
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.sheets = google.sheets({ version: 'v4', auth });
    this.logger.log(
      `Initialized for sheet ${this.sheetId} (tab: ${this.sheetTab})`,
    );
  }

  private range(columns: string): string {
    const escapedTab = this.sheetTab.replace(/'/gu, "''");
    return `'${escapedTab}'!${columns}`;
  }

  async readPool(): Promise<SheetRow[]> {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.sheetId,
      range: this.range('A1:ZZ'),
    });
    const values = (res.data.values ?? []) as string[][];
    const parsed = parseBetanoDiarioPoolSheet(values);
    this.controlColumns = parsed.columns;
    return parsed.rows;
  }

  private getControlColumns(): { status: string; email: string } {
    if (!this.controlColumns) {
      throw new BetanoDiarioSheetSchemaError(
        'Cabeçalhos STATUS e E-MAIL ainda não foram carregados.',
      );
    }
    return this.controlColumns;
  }

  async markRowUsed(rowIndex: number, userEmail: string): Promise<void> {
    const columns = this.getControlColumns();
    await this.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: this.sheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          {
            range: this.range(`${columns.status}${rowIndex}`),
            values: [[BETANO_MARKED_STATUS]],
          },
          {
            range: this.range(`${columns.email}${rowIndex}`),
            values: [[userEmail]],
          },
        ],
      },
    });
  }

  /** Marca várias linhas numa única chamada (1 write request — respeita quota). */
  async markRowsUsed(
    entries: { rowIndex: number; email: string }[],
  ): Promise<void> {
    if (entries.length === 0) return;
    const columns = this.getControlColumns();
    await this.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: this.sheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: entries.flatMap((entry) => [
          {
            range: this.range(`${columns.status}${entry.rowIndex}`),
            values: [[BETANO_MARKED_STATUS]],
          },
          {
            range: this.range(`${columns.email}${entry.rowIndex}`),
            values: [[entry.email]],
          },
        ]),
      },
    });
  }
}
