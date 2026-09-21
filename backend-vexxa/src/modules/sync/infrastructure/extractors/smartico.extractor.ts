import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  IProviderExtractor,
  ExtractedReport,
  ProviderCredentials,
} from '../../domain/ports/provider-extractor.port.js';
import { ProviderFetchFailedException } from '../../domain/exceptions/sync.exceptions.js';
import Decimal from 'decimal.js';

// Smartico API shape — GET af2_media_report_af (group_by=afp|afp1..afp5, DAY).
// A dimensão de agrupamento vira o campaignId no sistema:
//  - Pinbet Diário  → group_by=afp1 (campo `afp1` de cada row)
//  - Pinbet Mensal  → group_by=afp2 (campo `afp2` de cada row)
//  - Bateu Bet      → group_by=afp  (link go.aff.bateu.bet.br/xxxx?afp=CODIGO)
// Como cada casa usa uma dimensão diferente, os conjuntos NÃO se cruzam —
// cada casa puxa só os seus dados (sem alias/casa-fonte).
interface SmarticoRow {
  dt: string; // "2026-07-21T00:00:00.000Z"
  visit_count: number; // cliques
  registration_count: number; // cadastros
  qftd_count: number; // CPA qualificado
  ftd_count: number; // FTDs
  deposit_total: number; // depósitos
  withdrawal_total: number; // saques
  net_pl: number; // resultado líquido
  volume: number; // volume apostado
  commissions_rev_share: number; // revshare bruto do provedor
  // A coluna da dimensão agrupada (`afp`, `afp1`, …) vem junto no row e é lida
  // dinamicamente — "" nessa coluna = linha agregada da conta.
}

interface SmarticoResponse {
  meta?: { affiliate_id?: number };
  data?: SmarticoRow[];
}

const DEFAULT_HEADERS = {
  Accept: 'application/json, text/plain, */*',
};

// Host por conta: Pinbet fica em boapi7, Bateu Bet em boapi3. O valor vem do
// ProviderAccount.apiBaseUrl; boapi7 permanece como fallback histórico.
const DEFAULT_API_BASE = 'https://boapi7.smartico.ai/api';

// Dimensões aceitas pelo relatório: `afp` (link com ?afp=CODIGO) e `afp1`..`afp5`.
const GROUP_BY_PATTERN = /^afp[1-5]?$/u;

// Só aceita host da Smartico: contas antigas (Pinbet) foram cadastradas com o
// apiBaseUrl default do Betboard porque este extractor ignorava o campo, e
// apontar o relatório para lá quebraria o sync.
const normalizeApiBase = (value: string | undefined): string => {
  const normalized = (value ?? '').trim().replace(/\/+$/u, '');
  if (!normalized) return DEFAULT_API_BASE;
  try {
    const { hostname } = new URL(normalized);
    if (hostname === 'smartico.ai' || hostname.endsWith('.smartico.ai')) {
      return normalized;
    }
  } catch {
    // URL inválida — cai no host padrão.
  }
  return DEFAULT_API_BASE;
};

const roundMoney = (value: number | null | undefined): number =>
  new Decimal(value ?? 0).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

/**
 * A Smartico não tem login: o que o orchestrator guarda no cache de token é
 * esta sessão, que carrega token E host da conta. Guardar o host num campo da
 * instância (padrão Betboard/OTG) não serve aqui — o extractor é singleton e o
 * orchestrator só chama login() quando o cache expira, então uma conta acabaria
 * lendo o host da outra.
 */
interface SmarticoSession {
  token: string;
  apiBase: string;
}

const encodeSession = (session: SmarticoSession): string =>
  JSON.stringify(session);

const decodeSession = (raw: string): SmarticoSession => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as SmarticoSession).token === 'string'
    ) {
      const session = parsed as Partial<SmarticoSession>;
      return {
        token: session.token ?? '',
        apiBase: normalizeApiBase(session.apiBase),
      };
    }
  } catch {
    // Token cru (chamada direta ao extractor) — mantém o host padrão.
  }
  return { token: raw, apiBase: DEFAULT_API_BASE };
};

@Injectable()
export class SmarticoExtractor implements IProviderExtractor {
  readonly providerSlug = 'smartico';
  readonly dateScope = 'current-day-only' as const;
  readonly supportsExplicitDates = true;
  private readonly logger = new Logger(SmarticoExtractor.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * A Smartico autentica por token estático no header `authorization` (sem
   * login/senha). Fonte de verdade: o token da própria ProviderAccount
   * (`encryptedPassword`, entregue decriptado em `credentials.password`).
   * `PINBET_SMARTICO_TOKEN` vale apenas para a conta legada do host padrão.
   */
  login(credentials: ProviderCredentials): Promise<string> {
    const apiBase = normalizeApiBase(credentials.apiBaseUrl);
    // Host legado (Pinbet): o env continua ganhando, como sempre foi. Qualquer
    // outra conta usa SÓ o token dela — mandar o token do Pinbet para outro
    // host (Bateu Bet em boapi3) autenticaria na conta errada.
    const token =
      apiBase === DEFAULT_API_BASE
        ? this.config.get<string>('PINBET_SMARTICO_TOKEN', '') ||
          credentials.password
        : credentials.password;
    return Promise.resolve(encodeSession({ token, apiBase }));
  }

  /**
   * A dimensão de agrupamento vem do `bookmarkerId` da ProviderAccountHouse:
   * Aceita uma ou mais dimensões separadas por vírgula. A casa mensal
   * consolidada usa `afp1,afp2`; as chamadas são sequenciais para não ampliar o
   * risco de throttle da Smartico.
   */
  async fetchReports(
    accessToken: string,
    date: string,
    bookmarkerId: string,
  ): Promise<ExtractedReport[]> {
    // Janela de 1 dia: date_from = date, date_to = date + 1 dia (exclusivo),
    // exatamente como o curl de referência (dia 21 → from=21, to=22).
    const to = new Date(`${date}T00:00:00.000Z`);
    to.setUTCDate(to.getUTCDate() + 1);
    const dateTo = to.toISOString().slice(0, 10);
    return this.fetchReportsRange(accessToken, date, dateTo, bookmarkerId);
  }

  async fetchReportsRange(
    accessToken: string,
    dateFrom: string,
    dateToExclusive: string,
    bookmarkerId: string,
  ): Promise<ExtractedReport[]> {
    const session = decodeSession(accessToken);
    const requested = bookmarkerId
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter((value) => GROUP_BY_PATTERN.test(value));
    const dimensions = [
      ...new Set<string>(requested.length > 0 ? requested : ['afp1']),
    ];
    const reports: ExtractedReport[] = [];
    for (const groupBy of dimensions) {
      reports.push(
        ...(await this.fetchReportsForGroup(
          session,
          dateFrom,
          dateToExclusive,
          groupBy,
        )),
      );
    }
    return reports;
  }

  private async fetchReportsForGroup(
    session: SmarticoSession,
    dateFrom: string,
    dateToExclusive: string,
    groupBy: string,
  ): Promise<ExtractedReport[]> {
    const url =
      `${session.apiBase}/af2_media_report_af` +
      `?aggregation_period=DAY&group_by=${groupBy}&date_from=${dateFrom}&date_to=${dateToExclusive}`;

    const res = await fetch(url, {
      headers: { ...DEFAULT_HEADERS, Authorization: session.token },
    });

    // Smartico uses non-standard 2xx codes (observed: 291) for throttling.
    // fetch().ok still returns true for them, so only HTTP 200 is a report.
    if (res.status !== 200) {
      const body = await res.text().catch(() => '');
      throw new ProviderFetchFailedException(
        'smartico',
        dateFrom,
        `HTTP ${res.status}: ${body.slice(0, 200)}`,
      );
    }

    const payload = (await res.json()) as SmarticoResponse;
    const data = Array.isArray(payload?.data) ? payload.data : [];

    const reports: ExtractedReport[] = [];
    for (const r of data) {
      // campaignId = valor da dimensão agrupada (afp, afp1, afp2, …).
      const rawCampaignId = (r as unknown as Record<string, unknown>)[groupBy];
      const campaignId =
        typeof rawCampaignId === 'string' ? rawCampaignId.trim() : '';
      // Valor vazio = linha agregada da conta (sem campanha) — ignorar.
      if (!campaignId) continue;
      const reportDate = typeof r.dt === 'string' ? r.dt.slice(0, 10) : '';
      // date_to é exclusivo. Ignora qualquer linha fora da janela solicitada.
      if (reportDate < dateFrom || reportDate >= dateToExclusive) continue;

      const revShare = r.commissions_rev_share ?? 0;
      reports.push({
        campaignId,
        affiliateId: campaignId,
        date: new Date(`${reportDate}T00:00:00.000Z`),
        clicks: r.visit_count ?? 0,
        registrations: r.registration_count ?? 0,
        ftds: r.ftd_count ?? 0,
        qftd: r.qftd_count ?? 0,
        deposit: roundMoney(r.deposit_total),
        netPl: roundMoney(r.net_pl),
        withdrawalTotal: roundMoney(r.withdrawal_total),
        volume: roundMoney(r.volume),
        revShare,
        cpaQualified: r.qftd_count ?? 0,
        // CPA é INTERNO (qFTD × cpa contratado do link, resolvido no dashboard/
        // orchestrator). O CPA do provedor é irrelevante — deixamos 0 como
        // fallback (só usado se a campanha não tiver link/rate contratado).
        cpaValue: 0,
        totalCommission: 0,
      });
    }

    this.logger.debug(
      `[smartico] ${dateFrom}..${dateToExclusive} exclusivo (${groupBy}) → ${reports.length} reports`,
    );
    return reports;
  }
}
