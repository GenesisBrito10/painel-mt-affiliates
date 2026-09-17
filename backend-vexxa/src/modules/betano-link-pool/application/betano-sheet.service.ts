import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, sheets_v4 } from 'googleapis';
import { SheetRow, BETANO_MARKED_STATUS } from '../domain/betano.types.js';

@Injectable()
export class BetanoSheetService implements OnModuleInit {
  private readonly logger = new Logger(BetanoSheetService.name);
  private sheets!: sheets_v4.Sheets;
  private sheetId!: string;
  private sheetTab!: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.sheetId = this.config.getOrThrow<string>('BETANO_SHEET_ID');
    this.sheetTab = this.config.getOrThrow<string>('BETANO_SHEET_TAB');

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

  // Sheet schema (header on row 1):
  //   A = IDENTIFICAÇÃO, B = LINK, C = STATUS, D = E-MAIL
  async readPool(): Promise<SheetRow[]> {
    const range = `${this.sheetTab}!A2:D`;
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.sheetId,
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

  async markRowUsed(rowIndex: number, userEmail: string): Promise<void> {
    const range = `${this.sheetTab}!C${rowIndex}:D${rowIndex}`;
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.sheetId,
      range,
      valueInputOption: 'RAW',
      requestBody: { values: [[BETANO_MARKED_STATUS, userEmail]] },
    });
  }

  /** Marca várias linhas numa única chamada (1 write request — respeita quota). */
  async markRowsUsed(
    entries: { rowIndex: number; email: string }[],
  ): Promise<void> {
    if (entries.length === 0) return;
    await this.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: this.sheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: entries.map((e) => ({
          range: `${this.sheetTab}!C${e.rowIndex}:D${e.rowIndex}`,
          values: [[BETANO_MARKED_STATUS, e.email]],
        })),
      },
    });
  }
}
