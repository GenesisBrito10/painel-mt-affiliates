import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, sheets_v4 } from 'googleapis';
import {
  SheetRow,
  SPORTINGBET_MARKED_STATUS,
} from '../domain/sportingbet.types.js';
import {
  parseSportingbetSheet,
  SportingbetSheetSchemaError,
} from '../domain/sportingbet-sheet.parser.js';

@Injectable()
export class SportingbetSheetService implements OnModuleInit {
  private readonly logger = new Logger(SportingbetSheetService.name);
  private sheets?: sheets_v4.Sheets;
  private sheetId = '';
  private sheetTab = '';
  private controlColumns?: { status: string; email: string };

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    // Opcional: sem SPORTINGBET_SHEET_ID o pool fica inativo (pool_empty) sem
    // derrubar o boot — a solicitação ainda é criada e aguarda link.
    this.sheetId = this.config.get<string>('SPORTINGBET_SHEET_ID', '');
    this.sheetTab = this.config.get<string>('SPORTINGBET_SHEET_TAB', '');
    if (!this.sheetId) {
      this.logger.warn(
        'SPORTINGBET_SHEET_ID não configurado — pool SportingBet inativo (solicitações aguardam link).',
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

  private range(cols: string): string {
    return this.sheetTab ? `${this.sheetTab}!${cols}` : cols;
  }

  async readPool(): Promise<SheetRow[]> {
    if (!this.sheets) return [];
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.sheetId,
      range: this.range('A1:ZZ'),
    });
    const values = (res.data.values ?? []) as string[][];
    const parsed = parseSportingbetSheet(values);
    this.controlColumns = parsed.columns;
    return parsed.rows;
  }

  private getControlColumns(): { status: string; email: string } {
    if (!this.controlColumns) {
      throw new SportingbetSheetSchemaError(
        'Cabeçalhos STATUS e EMAIL ainda não foram carregados.',
      );
    }
    return this.controlColumns;
  }

  async markRowUsed(rowIndex: number, userEmail: string): Promise<void> {
    if (!this.sheets) return;
    const columns = this.getControlColumns();
    await this.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: this.sheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          {
            range: this.range(`${columns.status}${rowIndex}`),
            values: [[SPORTINGBET_MARKED_STATUS]],
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
    if (!this.sheets || entries.length === 0) return;
    const columns = this.getControlColumns();
    await this.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: this.sheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: entries.flatMap((entry) => [
          {
            range: this.range(`${columns.status}${entry.rowIndex}`),
            values: [[SPORTINGBET_MARKED_STATUS]],
          },
          {
            range: this.range(`${columns.email}${entry.rowIndex}`),
            values: [[entry.email]],
          },
        ]),
      },
    });
  }

  async clearRowAssignment(rowIndex: number): Promise<void> {
    if (!this.sheets) return;
    const columns = this.getControlColumns();
    await this.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: this.sheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          {
            range: this.range(`${columns.status}${rowIndex}`),
            values: [['']],
          },
          {
            range: this.range(`${columns.email}${rowIndex}`),
            values: [['']],
          },
        ],
      },
    });
  }
}
