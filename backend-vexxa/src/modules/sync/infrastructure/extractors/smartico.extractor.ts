import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  IProviderExtractor,
  ExtractedReport,
  ProviderCredentials,
} from '../../domain/ports/provider-extractor.port.js';
import { ProviderFetchFailedException } from '../../domain/exceptions/sync.exceptions.js';
import Decimal from 'decimal.js';

// Smartico API shape — GET af2_media_report_af (group_by=afp1|afp2, DAY).
// A dimensão de agrupamento vira o campaignId no sistema:
//  - Pinbet Diário  → group_by=afp1 (campo `afp1` de cada row)
//  - Pinbet Mensal  → group_by=afp2 (campo `afp2` de cada row)
// Como diário e mensal usam dimensões diferentes, os conjuntos NÃO se cruzam —
// cada casa puxa só os seus dados (sem alias/casa-fonte).
interface SmarticoRow {
  dt: string; // "2026-07-21T00:00:00.000Z"
  afp1?: string; // código da campanha diário (ex.: VALLEX0001). "" = agregado.
  afp2?: string; // código da campanha mensal. "" = agregado.
  visit_count: number; // cliques
  registration_count: number; // cadastros
  qftd_count: number; // CPA qualificado
  ftd_count: number; // FTDs
  deposit_total: number; // depósitos
  withdrawal_total: number; // saques
  net_pl: number; // resultado líquido
  volume: number; // volume apostado
  commissions_rev_share: number; // revshare bruto do provedor
}

interface SmarticoResponse {
  meta?: { affiliate_id?: number };
  data?: SmarticoRow[];
}

const DEFAULT_HEADERS = {
  Accept: 'application/json, text/plain, */*',
};

type GroupByField = 'afp1' | 'afp2';

const roundMoney = (value: number | null | undefined): number =>
  new Decimal(value ?? 0).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

@Injectable()
export class SmarticoExtractor implements IProviderExtractor {
  readonly providerSlug = 'smartico';
  readonly dateScope = 'current-day-only' as const;
  readonly supportsExplicitDates = true;
  private readonly logger = new Logger(SmarticoExtractor.name);

  // Base fixa da Smartico (mesmo padrão do Betboard: URL hardcoded no extractor).
  private static readonly API_BASE = 'https://boapi7.smartico.ai/api';

  constructor(private readonly config: ConfigService) {}

  /**
   * A Smartico autentica por token estático no header `authorization` (sem
   * login/senha). Fonte de verdade do token: env `PINBET_SMARTICO_TOKEN` (.env,
   * não hardcoded). Se o env não estiver setado, cai para o token guardado na
   * ProviderAccount (`encryptedPassword`, entregue já decriptado em
   * `credentials.password`).
   */
  login(credentials: ProviderCredentials): Promise<string> {
    const envToken = this.config.get<string>('PINBET_SMARTICO_TOKEN', '');
    return Promise.resolve(envToken || credentials.password);
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
    const requested = bookmarkerId
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter((value): value is GroupByField =>
        ['afp1', 'afp2'].includes(value),
      );
    const dimensions = [
      ...new Set<GroupByField>(requested.length > 0 ? requested : ['afp1']),
    ];
    const reports: ExtractedReport[] = [];
    for (const groupBy of dimensions) {
      reports.push(
        ...(await this.fetchReportsForGroup(
          accessToken,
          dateFrom,
          dateToExclusive,
          groupBy,
        )),
      );
    }
    return reports;
  }

  private async fetchReportsForGroup(
    accessToken: string,
    dateFrom: string,
    dateToExclusive: string,
    groupBy: GroupByField,
  ): Promise<ExtractedReport[]> {
    const url =
      `${SmarticoExtractor.API_BASE}/af2_media_report_af` +
      `?aggregation_period=DAY&group_by=${groupBy}&date_from=${dateFrom}&date_to=${dateToExclusive}`;

    const res = await fetch(url, {
      headers: { ...DEFAULT_HEADERS, Authorization: accessToken },
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
      // campaignId = valor da dimensão agrupada (afp1 OU afp2).
      const campaignId = (r[groupBy] ?? '').trim();
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
