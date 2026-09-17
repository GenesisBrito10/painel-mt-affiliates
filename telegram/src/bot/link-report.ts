import { escapeHtml, formatMoney, formatNumber, truncate } from '../format.js';
import {
  computeExpectedCpa,
  type LinkLookupResult,
} from '../services/link-lookup.service.js';

function num(v: string | null | undefined): number {
  if (v == null) return 0;
  return parseFloat(v);
}

export function formatLinkLookupReport(result: LinkLookupResult): string {
  const {
    parsed,
    matches,
    metrics,
    dailyMetrics,
    providerAccountsForHouse,
    linkRequests,
    betboardHits,
  } = result;
  const lines: string[] = [];
  const active = matches.find((m) => !m.deletedAt) ?? matches[0];

  lines.push('<b>🔗 Consulta por link / código</b>');
  lines.push('');
  lines.push(`📌 Código: <code>${escapeHtml(parsed.code)}</code>`);
  lines.push(`🆔 Campaign ID: <code>${escapeHtml(result.resolvedCampaignId ?? parsed.campaignId)}</code>`);
  lines.push(`🏠 Casa: ${escapeHtml(active?.bettingHouse ?? parsed.bettingHouse)}`);
  lines.push(`📍 Site ID: ${escapeHtml(parsed.siteid)}`);
  lines.push(`📆 Período: <b>${escapeHtml(result.period.start)} → ${escapeHtml(result.period.end)}</b> (mês atual)`);
  lines.push('');

  if (!active && matches.length === 0 && !metrics && betboardHits.length === 0) {
    lines.push('❌ Nenhum link ou dado encontrado (banco + Betboard).');
    if (providerAccountsForHouse.length > 0) {
      lines.push('');
      lines.push('<b>Contas de provedor na casa</b>');
      for (const pa of providerAccountsForHouse) {
        lines.push(`• ${escapeHtml(pa.name)} (${escapeHtml(pa.provider)}) — ${pa.active ? '✅' : '⛔'}`);
      }
    }
    return truncate(lines.join('\n'));
  }

  // ── Dono do link ──
  if (active) {
    lines.push('<b>👤 Afiliado vinculado</b>');
    lines.push(`• ${escapeHtml(active.userName)}`);
    lines.push(`• ${escapeHtml(active.userEmail)}`);
    lines.push(`• Status: ${escapeHtml(active.userStatus)}`);
    lines.push(`• CPA: ${formatMoney(num(active.cpa))} | Rev: ${num(active.revshare)}%`);
    lines.push(`• Origem: ${escapeHtml(active.source)}`);
    if (active.deletedAt) lines.push('⚠️ Link soft-deleted');
    lines.push('');
  } else if (matches.length === 0) {
    lines.push('⚠️ Sem affiliate_link — só dados de sync existem.');
    lines.push('');
  }

  // ── Conta de provedor (painel) ──
  lines.push('<b>🖥️ Conta de provedor (painel sync)</b>');
  if (active?.providerId) {
    lines.push(`• Nome: <b>${escapeHtml(active.providerName ?? '—')}</b>`);
    lines.push(`• Provider: ${escapeHtml(active.providerType ?? '—')}`);
    lines.push(`• Email: ${escapeHtml(active.providerEmail ?? '—')}`);
    lines.push(`• Bookmarker ID: <code>${escapeHtml(active.bookmarkerId ?? '—')}</code>`);
    lines.push(`• Ativa: ${active.providerActive ? '✅ sim' : '⛔ não'}`);
    if (active.providerLastUsed) {
      lines.push(`• Último uso: ${escapeHtml(active.providerLastUsed.slice(0, 19))}`);
    }
    if (active.providerLastError) {
      lines.push(`• Último erro: ${escapeHtml(active.providerLastError)}`);
    }
  } else {
    lines.push('⚠️ Nenhuma conta de provedor vinculada a este link ainda.');
    lines.push('(O sync enriquece providerAccountId quando encontra a campanha)');
    if (providerAccountsForHouse.length > 0) {
      lines.push('');
      lines.push('<b>Painéis disponíveis na casa:</b>');
      for (const pa of providerAccountsForHouse) {
        const status = pa.active ? '✅' : '⛔';
        lines.push(
          `• ${status} ${escapeHtml(pa.name)} — ${escapeHtml(pa.email)} (bookmarker: ${escapeHtml(pa.bookmarkerId)})`,
        );
      }
    }
  }
  lines.push('');

  // ── Métricas sync ──
  if (metrics) {
    const cpaQ = parseInt(metrics.cpaQualified, 10) || 0;
    const expected =
      active != null ? computeExpectedCpa(active.cpa, metrics.cpaQualified) : 0;

    lines.push('<b>📊 Dados do sync (affiliate_data — mês atual)</b>');
    lines.push(`• CPA qualificados: ${formatNumber(cpaQ)}`);
    lines.push(`• FTDs: ${formatNumber(parseInt(metrics.ftds, 10) || 0)}`);
    lines.push(`• Cliques: ${formatNumber(parseInt(metrics.clicks, 10) || 0)}`);
    lines.push(`• Cadastros: ${formatNumber(parseInt(metrics.registrations, 10) || 0)}`);
    lines.push(`• Depósitos: ${formatMoney(num(metrics.deposit))}`);
    lines.push(`• CPA value (casa): ${formatMoney(num(metrics.cpaValue))}`);
    lines.push(`• RevShare: ${formatMoney(num(metrics.revShare))}`);
    if (metrics.utmCampaign) {
      lines.push(`• Painel sync (utm): ${escapeHtml(metrics.utmCampaign)}`);
    }
    if (metrics.lastSyncAt) {
      lines.push(`• Último sync: ${escapeHtml(metrics.lastSyncAt.slice(0, 19))}`);
    }
    if (active && cpaQ > 0) {
      lines.push(`• CPA esperado afiliado: ${formatMoney(expected)} (${formatMoney(num(active.cpa))} × ${cpaQ})`);
    }
    lines.push('');
  }

  if (dailyMetrics.length > 0) {
    lines.push('<b>📅 CPAs por dia</b>');
    for (const row of dailyMetrics) {
      lines.push(
        `• ${row.date}: ${row.cpaQualified} CPA(s) — dep. ${formatMoney(num(row.deposit))}`,
      );
    }
    lines.push('');
  }

  if (linkRequests.length > 0) {
    lines.push('<b>📋 Solicitações de link</b>');
    for (const lr of linkRequests) {
      lines.push(
        `• ${escapeHtml(lr.userEmail)} — ${escapeHtml(lr.status)} (${lr.createdAt.slice(0, 10)})`,
      );
    }
    lines.push('');
  }

  if (betboardHits.length > 0) {
    lines.push('<b>🌐 Betboard (API ao vivo — mês atual)</b>');
    for (const hit of betboardHits) {
      lines.push(`• Painel: <b>${escapeHtml(hit.accountName)}</b> (${escapeHtml(hit.accountEmail)})`);
      lines.push(`  Casa: ${escapeHtml(hit.house)} | Campanha: <code>${escapeHtml(hit.metrics.campaignId)}</code>`);
      lines.push(
        `  QFTD: ${formatNumber(hit.metrics.qftd)} | FTD: ${formatNumber(hit.metrics.ftds)} | CPA R$: ${formatMoney(hit.metrics.cpaValue)}`,
      );
      lines.push(
        `  Cliques: ${formatNumber(hit.metrics.clicks)} | Dep.: ${formatMoney(hit.metrics.deposit)}`,
      );
      lines.push(`  Período: ${hit.periodStart} → ${hit.periodEnd}`);
    }
    lines.push('');
  } else if (process.env.BETBOARD_ACCOUNTS) {
    lines.push('ℹ️ Betboard: campanha não encontrada nos painéis configurados.');
    lines.push('');
  }

  if (matches.length > 1) {
    lines.push(`ℹ️ ${matches.length} registros encontrados (inclui histórico/deletados).`);
  }

  return truncate(lines.join('\n'));
}

export const LINK_HELP = `<b>Consulta por link / código</b>

<b>Comandos:</b>
• <code>/link VALLEXBR55</code>
• <code>/link 32666-VALLEXBR55</code>
• <code>/link https://wlsuperbet...?siteid=32666&c=VALLEXBR55</code>

Também funciona colando a URL ou só o código na conversa.

Consulta <b>banco local</b> + <b>API Betboard</b> (painéis configurados no .env).

Mostra: afiliado, conta de provedor, métricas sync, CPAs e dados ao vivo Betboard.`;
