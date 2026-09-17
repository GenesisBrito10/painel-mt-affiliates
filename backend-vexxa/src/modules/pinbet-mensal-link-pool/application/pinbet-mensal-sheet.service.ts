import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, sheets_v4 } from 'googleapis';
import {
  SheetRow,
  PINBET_MARKED_STATUS,
} from '../domain/pinbet-mensal.types.js';

@Injectable()
export class PinbetMensalSheetService implements OnModuleInit {
  private readonly logger = new Logger(PinbetMensalSheetService.name);
  private sheets?: sheets_v4.Sheets;
  private sheetId = '';
  private sheetTab = '';

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    // Mesma planilha do Diário, aba "Mensal": se PINBET_MENSAL_SHEET_ID não for
    // configurado, usa PINBET_SHEET_ID (mesmo arquivo, outra aba).
    this.sheetId =
      this.config.get<string>('PINBET_MENSAL_SHEET_ID', '') ||
      this.config.get<string>('PINBET_SHEET_ID', '');
    this.sheetTab = this.config.get<string>(
      'PINBET_MENSAL_SHEET_TAB',
      'Mensal',
    );
    if (!this.sheetId) {
      this.logger.warn(
        'Nenhum sheet configurado (PINBET_MENSAL_SHEET_ID/PINBET_SHEET_ID) — pool Pinbet Mensal INATIVO.',
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

  // Mesmo schema do Diário: A=IDENTIFICAÇÃO, B=CÓDIGO, C=LINKS, D=STATUS, E=E-MAIL
  async readPool(): Promise<SheetRow[]> {
    if (!this.sheets) return [];
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.sheetId,
      range: this.range('A2:E'),
    });
    const values = (res.data.values ?? []) as string[][];
    return values.map((row, i) => ({
      rowIndex: i + 2,
      identificacao: (row[0] ?? '').trim(),
      code: (row[1] ?? '').trim(),
      link: (row[2] ?? '').trim(),
      status: (row[3] ?? '').trim(),
      email: (row[4] ?? '').trim(),
    }));
  }

  async markRowUsed(rowIndex: number, userEmail: string): Promise<void> {
    if (!this.sheets) return;
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.sheetId,
      range: this.range(`D${rowIndex}:E${rowIndex}`),
      valueInputOption: 'RAW',
      requestBody: { values: [[PINBET_MARKED_STATUS, userEmail]] },
    });
  }

  async markRowsUsed(
    entries: { rowIndex: number; email: string }[],
  ): Promise<void> {
    if (!this.sheets || entries.length === 0) return;
    await this.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: this.sheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: entries.map((e) => ({
          range: this.range(`D${e.rowIndex}:E${e.rowIndex}`),
          values: [[PINBET_MARKED_STATUS, e.email]],
        })),
      },
    });
  }
}
