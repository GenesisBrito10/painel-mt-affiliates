import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { FileUploadService } from '../../file-upload/file-upload.service.js';

/** Dados necessários para renderizar o comprovante PIX. */
export interface ReceiptData {
  amountReais: number;
  statusLabel: string; // ex: "Concluída"
  dateLabel: string; // ex: "09/06/2026, 21:02:18"
  clienteNome: string;
  clienteDoc: string;
  pixKey: string;
  endToEndId?: string | null;
  paymentId?: string | null;
  transactionId?: string | null;
  userId?: string | null;
}

// Tipo mínimo que o satori aceita (evita exigir JSX/tsx no projeto).
type Node = { type: string; props: Record<string, unknown> };

const WIDTH = 1000;
const FONT_FILES: Array<{ file: string; weight: 400 | 600 | 700 | 900 }> = [
  { file: 'Inter-400.woff', weight: 400 },
  { file: 'Inter-600.woff', weight: 600 },
  { file: 'Inter-700.woff', weight: 700 },
  { file: 'Inter-900.woff', weight: 900 },
];

const COLORS = {
  bg: '#07070b',
  card: '#0d0d16',
  cardBorder: '#7c3aed',
  neon1: '#a855f7',
  neon2: '#7c3aed',
  green: '#22c55e',
  white: '#ffffff',
  value: '#e9d5ff',
  label: '#8b8b9e',
  text: '#e5e5ef',
};

/**
 * Gera o comprovante PIX (PNG) localmente — a Vorexy NÃO fornece comprovante.
 * Renderiza um cartão "dark neon" com os dados do saque via satori (→SVG) +
 * resvg (→PNG) e sobe para o R2, retornando a URL pública.
 *
 * Tolerante a falhas: qualquer erro retorna null (o envio do comprovante é
 * fire-and-forget e NUNCA pode afetar o fluxo de saque).
 */
@Injectable()
export class ReceiptGeneratorService {
  private readonly logger = new Logger(ReceiptGeneratorService.name);
  private fonts: Array<{
    name: string;
    data: Buffer;
    weight: 400 | 600 | 700 | 900;
    style: 'normal';
  }> | null = null;

  constructor(
    private readonly fileUpload: FileUploadService,
    private readonly config: ConfigService,
  ) {}

  private brandName(): string {
    return (
      this.config.get<string>('RECEIPT_BRAND_NAME', 'MT Affiliates') ||
      'MT Affiliates'
    );
  }

  private loadFonts(): NonNullable<typeof this.fonts> {
    if (this.fonts) return this.fonts;
    // Resolve a pasta de fontes de forma robusta: primeiro relativo ao cwd
    // (backend-vexxa em produção via PM2), depois relativo a este arquivo.
    const candidates = [
      resolve(process.cwd(), 'assets/fonts'),
      resolve(__dirname, '../../../../assets/fonts'),
      resolve(__dirname, '../../../../../assets/fonts'),
    ];
    for (const dir of candidates) {
      try {
        const loaded = FONT_FILES.map((f) => ({
          name: 'Inter',
          data: readFileSync(resolve(dir, f.file)),
          weight: f.weight,
          style: 'normal' as const,
        }));
        this.fonts = loaded;
        return loaded;
      } catch {
        // tenta próximo candidato
      }
    }
    throw new Error('Fontes do comprovante não encontradas (assets/fonts).');
  }

  /** Gera o PNG do comprovante e sobe para o R2. Retorna a URL ou null. */
  async generateAndUpload(
    data: ReceiptData,
    withdrawalId: string,
  ): Promise<string | null> {
    try {
      const png = await this.renderPng(data);
      const result = await this.fileUpload.uploadObject({
        buffer: png,
        mimeType: 'image/png',
        scopePrefix: 'receipts',
        filename: `comprovante-${withdrawalId}.png`,
      });
      return result.url;
    } catch (err) {
      this.logger.warn(
        `Falha ao gerar/subir comprovante do saque ${withdrawalId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /** Renderiza o comprovante como PNG (Buffer). */
  async renderPng(data: ReceiptData): Promise<Buffer> {
    const fonts = this.loadFonts();
    const svg = await satori(this.buildTree(data) as unknown as never, {
      width: WIDTH,
      fonts,
    });
    const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } });
    return Buffer.from(resvg.render().asPng());
  }

  // ── Builders de layout (satori usa flexbox) ──────────────────────────────

  private h(
    type: string,
    style: Record<string, unknown>,
    children?: unknown,
  ): Node {
    return {
      type,
      props: { style, ...(children !== undefined ? { children } : {}) },
    };
  }

  private text(value: string, style: Record<string, unknown>): Node {
    return this.h('div', { display: 'flex', ...style }, value);
  }

  private field(label: string, value: string): Node {
    return this.h(
      'div',
      { display: 'flex', flexDirection: 'column', marginTop: 14 },
      [
        this.text(label, {
          color: COLORS.label,
          fontSize: 18,
          fontWeight: 400,
        }),
        this.text(value || '—', {
          color: COLORS.text,
          fontSize: 22,
          fontWeight: 600,
          marginTop: 2,
          maxWidth: 344,
          wordBreak: 'break-all',
          lineHeight: 1.25,
        }),
      ],
    );
  }

  private card(title: string, fields: Node[]): Node {
    return this.h(
      'div',
      {
        display: 'flex',
        flexDirection: 'column',
        width: 400,
        backgroundColor: COLORS.card,
        border: `2px solid ${COLORS.cardBorder}`,
        borderRadius: 22,
        padding: 28,
      },
      [
        this.text(title, {
          color: COLORS.white,
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: 1,
        }),
        this.h('div', {
          display: 'flex',
          width: 60,
          height: 3,
          marginTop: 10,
          backgroundImage: `linear-gradient(90deg, ${COLORS.neon1}, ${COLORS.neon2})`,
        }),
        ...fields,
      ],
    );
  }

  private buildTree(d: ReceiptData): Node {
    const brand = this.brandName();
    const amount = new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(d.amountReais);

    const idFields: Node[] = [];
    if (d.endToEndId) idFields.push(this.field('End-to-End ID', d.endToEndId));
    if (d.paymentId) idFields.push(this.field('Payment ID', d.paymentId));
    if (d.transactionId)
      idFields.push(this.field('Transaction ID', d.transactionId));
    if (d.userId) idFields.push(this.field('User ID', d.userId));
    if (idFields.length === 0) idFields.push(this.field('Identificação', '—'));

    return this.h(
      'div',
      {
        display: 'flex',
        flexDirection: 'column',
        width: WIDTH,
        backgroundColor: COLORS.bg,
        padding: 36,
        fontFamily: 'Inter',
      },
      [
        this.h(
          'div',
          {
            display: 'flex',
            flexDirection: 'column',
            border: `3px solid ${COLORS.cardBorder}`,
            borderRadius: 34,
            padding: 40,
          },
          [
            this.text(brand.toUpperCase(), {
              color: COLORS.white,
              fontSize: 70,
              fontWeight: 900,
              justifyContent: 'center',
              letterSpacing: 2,
            }),

            this.h(
              'div',
              {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginTop: 28,
              },
              [
                this.h(
                  'div',
                  {
                    display: 'flex',
                    width: 84,
                    height: 84,
                    borderRadius: 42,
                    border: `5px solid ${COLORS.green}`,
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: 22,
                    color: COLORS.green,
                    fontSize: 46,
                    fontWeight: 900,
                  },
                  '✓',
                ),
                this.h('div', { display: 'flex', flexDirection: 'column' }, [
                  this.text('PAGAMENTO', {
                    color: COLORS.white,
                    fontSize: 56,
                    fontWeight: 900,
                    lineHeight: 1,
                  }),
                  this.text('CONCLUÍDO', {
                    color: COLORS.white,
                    fontSize: 44,
                    fontWeight: 600,
                    lineHeight: 1,
                  }),
                ]),
              ],
            ),
            this.text('TRANSFERÊNCIA REALIZADA COM SUCESSO', {
              color: COLORS.label,
              fontSize: 20,
              fontWeight: 400,
              justifyContent: 'center',
              marginTop: 16,
              letterSpacing: 1,
            }),

            this.h(
              'div',
              {
                display: 'flex',
                flexDirection: 'column',
                marginTop: 30,
                backgroundColor: COLORS.card,
                border: `2px solid ${COLORS.cardBorder}`,
                borderRadius: 26,
                padding: 34,
              },
              [
                this.text('VALOR RECEBIDO', {
                  color: COLORS.green,
                  fontSize: 24,
                  fontWeight: 700,
                  letterSpacing: 1,
                }),
                this.h(
                  'div',
                  { display: 'flex', alignItems: 'flex-end', marginTop: 10 },
                  [
                    this.text('R$', {
                      color: COLORS.value,
                      fontSize: 46,
                      fontWeight: 600,
                      marginRight: 12,
                      marginBottom: 16,
                    }),
                    this.text(amount, {
                      color: COLORS.value,
                      fontSize: 96,
                      fontWeight: 900,
                      lineHeight: 1,
                    }),
                  ],
                ),
                this.text(`Operação segura e processada pela ${brand}`, {
                  color: COLORS.label,
                  fontSize: 18,
                  fontWeight: 400,
                  marginTop: 14,
                }),
              ],
            ),

            this.h(
              'div',
              {
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                rowGap: 26,
                marginTop: 26,
              },
              [
                this.card('DETALHES DA TRANSFERÊNCIA', [
                  this.field('Status', d.statusLabel),
                  this.field('Data e hora', d.dateLabel),
                ]),
                this.card('PAGADOR', [
                  this.field('Nome', brand),
                  this.field('Tipo', 'Conta de pagamento'),
                ]),
                this.card('CLIENTE', [
                  this.field('Nome', d.clienteNome),
                  this.field('CPF/CNPJ', d.clienteDoc),
                  this.field('Chave PIX', d.pixKey),
                ]),
                this.card('IDENTIFICAÇÃO', idFields),
              ],
            ),

            this.h(
              'div',
              {
                display: 'flex',
                alignItems: 'center',
                marginTop: 30,
                border: `2px solid ${COLORS.cardBorder}`,
                borderRadius: 22,
                padding: 28,
              },
              [
                this.text('✓', {
                  color: COLORS.neon1,
                  fontSize: 40,
                  fontWeight: 900,
                  marginRight: 22,
                }),
                this.h(
                  'div',
                  {
                    display: 'flex',
                    flexDirection: 'column',
                    flexGrow: 1,
                    flexShrink: 1,
                    minWidth: 0,
                  },
                  [
                    this.text('SUA CONFIANÇA NOS MOVE.', {
                      color: COLORS.white,
                      fontSize: 24,
                      fontWeight: 700,
                    }),
                    this.text(
                      `A ${brand} agradece por fazer parte dessa história de sucesso.`,
                      {
                        color: COLORS.label,
                        fontSize: 16,
                        fontWeight: 400,
                        marginTop: 4,
                        maxWidth: 460,
                      },
                    ),
                  ],
                ),
                this.text(brand.toUpperCase(), {
                  color: COLORS.white,
                  fontSize: 26,
                  fontWeight: 900,
                  marginLeft: 18,
                  flexShrink: 0,
                  maxWidth: 220,
                  lineHeight: 1.05,
                }),
              ],
            ),
          ],
        ),
      ],
    );
  }
}
