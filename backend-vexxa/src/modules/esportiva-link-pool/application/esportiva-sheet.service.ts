import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, sheets_v4 } from 'googleapis';
import {
  SheetRow,
  ESPORTIVA_MARKED_STATUS,
} from '../domain/esportiva.types.js';

@Injectable()
export class EsportivaSheetService implements OnModuleInit {
  private readonly logger = new Logger(EsportivaSheetService.name);
  private sheets?: sheets_v4.Sheets;
  private sheetId = '';
  private sheetTab = '';

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    // Opcional: sem ESPORTIVA_SHEET_ID o pool fica inativo (pool_empty) sem
    // derrubar o boot — a solicitação ainda é criada e aguarda link.
    this.sheetId = this.config.get<string>('ESPORTIVA_SHEET_ID', '');
    this.sheetTab = this.config.get<string>('ESPORTIVA_SHEET_TAB', '');
    if (!this.sheetId) {
      this.logger.warn(
        'ESPORTIVA_SHEET_ID não configurado — pool Esportiva inativo (solicitações aguardam link).',
      );
      return;
    }

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
      `Initialized for sheet ${this.sheetId} (tab: ${this.sheetTab || '(primeira aba)'})`,
    );
  }

  /** Range A2:D, com nome da aba quando configurado (senão primeira aba). */
  private range(cols: string): string {
    return this.sheetTab ? `${this.sheetTab}!${cols}` : cols;
  }

  // Schema (header em row 1): A=ID, B=LINK, C=EMAIL, D=STATUS
  async readPool(): Promise<SheetRow[]> {
    if (!this.sheets) return [];
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.sheetId,
      range: this.range('A2:D'),
    });
    const values = (res.data.values ?? []) as string[][];
    return values.map((row, i) => ({
      rowIndex: i + 2,
      id: (row[0] ?? '').trim(),
      link: (row[1] ?? '').trim(),
      email: (row[2] ?? '').trim(),
      status: (row[3] ?? '').trim(),
    }));
  }

  async markRowUsed(rowIndex: number, userEmail: string): Promise<void> {
    if (!this.sheets) return;
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.sheetId,
      range: this.range(`C${rowIndex}:D${rowIndex}`),
      valueInputOption: 'RAW',
      requestBody: { values: [[userEmail, ESPORTIVA_MARKED_STATUS]] },
    });
  }

  /** Marca várias linhas numa única chamada (1 write request — respeita quota). */
  async markRowsUsed(
    entries: { rowIndex: number; email: string }[],
  ): Promise<void> {
    if (!this.sheets || entries.length === 0) return;
    await this.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: this.sheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: entries.map((e) => ({
          range: this.range(`C${e.rowIndex}:D${e.rowIndex}`),
          values: [[e.email, ESPORTIVA_MARKED_STATUS]],
        })),
      },
    });
  }

  async clearRowAssignment(rowIndex: number): Promise<void> {
    if (!this.sheets) return;
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.sheetId,
      range: this.range(`C${rowIndex}:D${rowIndex}`),
      valueInputOption: 'RAW',
      requestBody: { values: [['', '']] },
    });
  }
}
