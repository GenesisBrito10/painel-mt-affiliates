import { Injectable, StreamableFile } from '@nestjs/common';
import { Readable } from 'stream';
import PDFDocument from 'pdfkit';
import { UserService } from './user.service.js';
import type { AffiliateExportRow, AffiliatesFilter } from './user.service.js';

/** UTF-8 BOM so Excel renders accented characters correctly. */
const UTF8_BOM = '﻿';

/** CSV cell separator (Excel pt-BR friendly). */
const CSV_SEP = ';';

const CSV_COLUMNS = [
  'Nome',
  'E-mail',
  'Status',
  'Origem',
  'Indicador',
  'E-mail do indicador',
  'Casas & comissões',
  'Cadastro',
];

const PDF_COLUMNS: Array<{ label: string; width: number }> = [
  { label: 'Nome', width: 110 },
  { label: 'E-mail', width: 140 },
  { label: 'Status', width: 60 },
  { label: 'Origem', width: 75 },
  { label: 'Indicador', width: 95 },
  { label: 'Casas & comissões', width: 192 },
  { label: 'Cadastro', width: 60 },
];

@Injectable()
export class AffiliateExportService {
  constructor(private readonly userService: UserService) {}

  /**
   * Builds a CSV or PDF export of the affiliates matching `filters`.
   * Defaults to CSV when the format is missing or unknown.
   */
  async export(
    filters: AffiliatesFilter,
    format: 'csv' | 'pdf' | undefined,
  ): Promise<StreamableFile> {
    const rows = await this.userService.findAffiliatesForExport(filters);
    return format === 'pdf'
      ? this.buildPdf(rows, filters)
      : this.buildCsv(rows);
  }

  /** Filename suffix `afiliados-YYYY-MM-DD`. */
  static fileBaseName(now = new Date()): string {
    return `afiliados-${AffiliateExportService.isoDate(now)}`;
  }

  // ─── CSV ───────────────────────────────────────────────────────────────────

  private buildCsv(rows: AffiliateExportRow[]): StreamableFile {
    const lines: string[] = [
      CSV_COLUMNS.map((c) => this.csvCell(c)).join(CSV_SEP),
    ];

    for (const r of rows) {
      lines.push(
        [
          r.name,
          r.email,
          r.status,
          r.referralOriginLabel,
          r.referredBy?.name ?? '—',
          r.referredBy?.email ?? '—',
          this.membershipsLabel(r),
          this.formatDate(r.createdAt),
        ]
          .map((v) => this.csvCell(v))
          .join(CSV_SEP),
      );
    }

    const content = UTF8_BOM + lines.join('\r\n') + '\r\n';
    const stream = Readable.from([Buffer.from(content, 'utf-8')]);
    return new StreamableFile(stream, {
      type: 'text/csv',
      disposition: `attachment; filename="${AffiliateExportService.fileBaseName()}.csv"`,
    });
  }

  /**
   * Escapes a value for a CSV cell: always quoted, inner quotes doubled.
   * Quoting unconditionally keeps `;`, line breaks and commas safe.
   *
   * Also neutralizes spreadsheet formula injection (CWE-1236): a cell whose
   * value starts with `=`, `+`, `-`, `@`, TAB or CR is evaluated as a formula
   * by Excel/LibreOffice/Sheets. CSV quoting does NOT prevent this (the parser
   * strips the quotes), so we prefix a single quote `'` to force a text cell.
   */
  private csvCell(value: string): string {
    let v = value ?? '';
    if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
    const safe = v.replace(/"/g, '""');
    return `"${safe}"`;
  }

  // ─── PDF ───────────────────────────────────────────────────────────────────

  private buildPdf(
    rows: AffiliateExportRow[],
    filters: AffiliatesFilter,
  ): Promise<StreamableFile> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margin: 36,
        bufferPages: true,
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('error', reject);
      doc.on('end', () => {
        const stream = Readable.from([Buffer.concat(chunks)]);
        resolve(
          new StreamableFile(stream, {
            type: 'application/pdf',
            disposition: `attachment; filename="${AffiliateExportService.fileBaseName()}.pdf"`,
          }),
        );
      });

      try {
        this.renderPdf(doc, rows, filters);
        doc.end();
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private renderPdf(
    doc: PDFKit.PDFDocument,
    rows: AffiliateExportRow[],
    filters: AffiliatesFilter,
  ): void {
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const tableWidth = right - left;

    // ── Header ──────────────────────────────────────────────────────────────
    doc
      .fontSize(16)
      .font('Helvetica-Bold')
      .text('MT Affiliates - Afiliados', left, doc.page.margins.top);

    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#555555')
      .text(this.pdfSubtitle(filters, rows.length), { width: tableWidth });
    doc.fillColor('#000000');
    doc.moveDown(0.5);

    const headerBottom = doc.y;
    let y = headerBottom;

    const drawRowSeparator = (yPos: number) => {
      doc
        .moveTo(left, yPos)
        .lineTo(right, yPos)
        .lineWidth(0.5)
        .strokeColor('#cccccc')
        .stroke()
        .strokeColor('#000000');
    };

    const drawTableHeader = (yPos: number): number => {
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#000000');
      let x = left;
      for (const col of PDF_COLUMNS) {
        doc.text(col.label, x + 2, yPos + 2, {
          width: col.width - 4,
          ellipsis: true,
        });
        x += col.width;
      }
      const bottom = yPos + 16;
      drawRowSeparator(bottom);
      return bottom;
    };

    y = drawTableHeader(y);

    const bottomLimit = doc.page.height - doc.page.margins.bottom - 24;

    doc.font('Helvetica').fontSize(7.5);
    for (const r of rows) {
      const cells = [
        r.name,
        r.email,
        r.status,
        r.referralOriginLabel,
        r.referredBy?.name ?? '—',
        this.membershipsLabel(r),
        this.formatDate(r.createdAt),
      ];

      // Measure tallest cell to allow multi-line wrapping.
      let rowHeight = 0;
      for (let i = 0; i < PDF_COLUMNS.length; i++) {
        const h = doc.heightOfString(cells[i] ?? '', {
          width: PDF_COLUMNS[i].width - 4,
        });
        if (h > rowHeight) rowHeight = h;
      }
      rowHeight = Math.max(rowHeight, 10) + 4;

      if (y + rowHeight > bottomLimit) {
        doc.addPage();
        y = doc.page.margins.top;
        y = drawTableHeader(y);
        doc.font('Helvetica').fontSize(7.5);
      }

      let x = left;
      for (let i = 0; i < PDF_COLUMNS.length; i++) {
        doc.fillColor('#000000').text(cells[i] ?? '', x + 2, y + 2, {
          width: PDF_COLUMNS[i].width - 4,
        });
        x += PDF_COLUMNS[i].width;
      }
      y += rowHeight;
      drawRowSeparator(y);
    }

    if (rows.length === 0) {
      doc
        .font('Helvetica-Oblique')
        .fontSize(9)
        .fillColor('#777777')
        .text(
          'Nenhum afiliado encontrado para os filtros aplicados.',
          left,
          y + 6,
        );
      doc.fillColor('#000000');
    }

    // ── Footer pagination ───────────────────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const footerY = doc.page.height - doc.page.margins.bottom + 4;
      // Writing into the bottom margin would trigger pdfkit's auto page-break
      // (spurious blank page). Temporarily drop the bottom margin so the footer
      // stays on the current page.
      const prevBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#777777')
        .text(`Página ${i + 1} de ${range.count}`, left, footerY, {
          width: tableWidth,
          align: 'right',
          lineBreak: false,
        });
      doc.fillColor('#000000');
      doc.page.margins.bottom = prevBottom;
    }
  }

  private pdfSubtitle(filters: AffiliatesFilter, count: number): string {
    const parts: string[] = [];
    if (filters.search) parts.push(`Busca: "${filters.search}"`);
    if (filters.status && filters.status !== 'all')
      parts.push(`Status: ${filters.status}`);
    if (filters.role && filters.role !== 'all')
      parts.push(`Papel: ${filters.role}`);
    if (filters.referralDepth && filters.referralDepth !== 'all')
      parts.push(`Origem: ${filters.referralDepth}`);
    if (filters.bettingHouseId && filters.bettingHouseId !== 'all')
      parts.push(`Casa: ${filters.bettingHouseId}`);
    if (filters.noLink === 'true') parts.push('Sem vínculo');

    const filterLabel = parts.length ? parts.join(' · ') : 'Sem filtros';
    const generatedAt = this.formatDate(new Date());
    return `${filterLabel} — ${count} afiliado(s) — Gerado em ${generatedAt}`;
  }

  // ─── Shared formatting ──────────────────────────────────────────────────────

  /** `"Betano (CPA 100 / RS 30%); Superbet (CPA 80 / RS 25%)"`. */
  private membershipsLabel(row: AffiliateExportRow): string {
    if (!row.memberships.length) return '—';
    return row.memberships
      .map(
        (m) =>
          `${m.houseName} (CPA ${this.formatNumber(m.commissionCpa)} / RS ${this.formatNumber(m.commissionRevshare)}%)`,
      )
      .join('; ');
  }

  private formatNumber(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }

  /** `dd/MM/yyyy`. */
  private formatDate(date: Date): string {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }

  /** `YYYY-MM-DD` for filenames. */
  private static isoDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
