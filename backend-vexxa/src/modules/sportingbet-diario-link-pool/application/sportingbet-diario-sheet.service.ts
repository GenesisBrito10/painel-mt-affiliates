import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, sheets_v4 } from 'googleapis';
import { SportingbetSheetSchemaError } from '../../sportingbet-link-pool/domain/sportingbet-sheet.parser.js';
import { parseSportingbetSheet } from '../../sportingbet-link-pool/domain/sportingbet-sheet.parser.js';
import {
  SheetRow,
  SPORTINGBET_MARKED_STATUS,
} from '../../sportingbet-link-pool/domain/sportingbet.types.js';

@Injectable()
export class SportingbetDiarioSheetService implements OnModuleInit {
  private readonly logger = new Logger(SportingbetDiarioSheetService.name);
  private sheets?: sheets_v4.Sheets;
  private sheetId = '';
  private sheetTab = 'Diário';
  private controlColumns?: { status: string; email: string };

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.sheetId = this.config.get<string>('SPORTINGBET_SHEET_ID', '');
    this.sheetTab = this.config.get<string>(
      'SPORTINGBET_DIARIO_SHEET_TAB',
      'Diário',
    );
    if (!this.sheetId) {
      this.logger.warn(
        'SPORTINGBET_SHEET_ID não configurado — pool SportingBet Diário inativo.',
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
      `Initialized for sheet ${this.sheetId} (tab: ${this.sheetTab})`,
    );
  }

  private range(columns: string): string {
    const escapedTab = this.sheetTab.replace(/'/gu, "''");
    return `'${escapedTab}'!${columns}`;
  }

  async readPool(): Promise<SheetRow[]> {
    if (!this.sheets) return [];
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.sheetId,
      range: this.range('A1:ZZ'),
    });
    const values = (response.data.values ?? []) as string[][];
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
}
