import { escapeHtml, formatMoney, formatNumber, truncate } from '../format.js';
import {
  computeTotals,
  type InvestigationResult,
} from '../services/affiliate-investigation.service.js';
import { LINK_HELP } from './link-report.js';

function num(value: string | number | null | undefined): number {
  if (value == null) return 0;
  return typeof value === 'number' ? value : parseFloat(value);
}

export function formatInvestigationReport(
  result: InvestigationResult,
  houseFilter?: string,
): string {
  const totals = computeTotals(result);
  const lines: string[] = [];

  lines.push('<b>🔍 Investigação de Afiliado</b>');
  lines.push('');
  lines.push(`👤 <b>${escapeHtml(result.user.name)}</b>`);
  lines.push(`📧 ${escapeHtml(result.user.email)}`);
  lines.push(`📋 Status: ${escapeHtml(result.user.status)}`);
  if (houseFilter) lines.push(`🏠 Filtro: ${escapeHtml(houseFilter)}`);
  lines.push('');

  lines.push('<b>💰 Resumo financeiro (cálculo esperado)</b>');
  lines.push(`• CPA direto: ${formatMoney(totals.ownCpaEarnings)} (${totals.ownCpaCount} CPAs × taxa)`);
  lines.push(`• Rede: ${formatMoney(totals.networkEarnings)} (${totals.networkCpaCount} CPAs de indicados)`);
  lines.push(`• Bruto estimado: ${formatMoney(totals.grossTotal)}`);
  if (result.withdrawalsTotal > 0) {
    lines.push(`• Saques já feitos: ${formatMoney(result.withdrawalsTotal)}`);
  }
  lines.push('');

  lines.push('<b>📊 Métricas (como o dashboard)</b>');
  lines.push(`• QFTD total (escopo all): ${formatNumber(totals.dashboardQftd)}`);
  lines.push(`  ↳ Próprios: ${formatNumber(totals.ownCpaCount)}`);
  lines.push(`  ↳ Rede: ${formatNumber(totals.networkCpaCount)}`);
  lines.push(`• Indicados: ${formatNumber(result.referralsCount)}`);
  lines.push('');

  if (result.links.length > 0) {
    lines.push('<b>🔗 Links ativos</b>');
    for (const link of result.links) {
      lines.push(
        `• ${escapeHtml(link.bettingHouse)} — CPA ${formatMoney(num(link.cpa))} — <code>${escapeHtml(link.campaignId)}</code>`,
      );
    }
    lines.push('');
  }

  const ownWithCpa = result.ownCpas.filter((r) => num(r.cpaQualified) > 0);
  if (ownWithCpa.length > 0) {
    lines.push('<b>✅ CPAs próprios por casa</b>');
    for (const row of ownWithCpa) {
      const earned = num(row.cpa) * num(row.cpaQualified);
      lines.push(
        `• ${escapeHtml(row.bettingHouse)}: ${formatNumber(num(row.cpaQualified))} CPAs → ${formatMoney(earned)}`,
      );
    }
    lines.push('');
  }

  if (result.networkCpas.length > 0) {
    lines.push('<b>🌐 CPAs da rede (indicados)</b>');
    for (const row of result.networkCpas) {
      const headLink = result.links.find((l) => l.bettingHouse === row.bettingHouse);
      const margin = Math.max(0, num(headLink?.cpa) - num(row.cpa));
      const earned = margin * num(row.cpaQualified);
      lines.push(
        `• ${escapeHtml(row.name)} (${escapeHtml(row.email)})`,
      );
      lines.push(
        `  ${escapeHtml(row.bettingHouse)}: ${formatNumber(num(row.cpaQualified))} CPA — spread ${formatMoney(margin)} → ${formatMoney(earned)}`,
      );
    }
    lines.push('');
  }

  if (result.dailyBreakdown.length > 0) {
    lines.push('<b>📅 CPAs por dia (próprios)</b>');
    for (const row of result.dailyBreakdown) {
      lines.push(
        `• ${row.date} — ${escapeHtml(row.bettingHouse)}: ${row.cpaQualified} CPA(s) — dep. ${formatMoney(num(row.deposit))}`,
      );
    }
    lines.push('');
  }

  if (result.fraud.length > 0) {
    lines.push('<b>🚨 Fraude registrada</b>');
    for (const f of result.fraud) {
      lines.push(`• ${escapeHtml(f.bettingHouse)}: ${f.count}`);
    }
    lines.push('');
  }

  if (result.ledgerCutover) {
    lines.push(`ℹ️ Ledger cutover: ${escapeHtml(result.ledgerCutover)}`);
    lines.push('(Saldo usa só dados após essa data; métricas QFTD mostram all-time)');
    lines.push('');
  }

  lines.push('<b>🧠 Diagnóstico</b>');
  for (const note of result.diagnosis) {
    lines.push(`• ${escapeHtml(note)}`);
  }

  return truncate(lines.join('\n'));
}

export const HELP_TEXT = `<b>Vallex Bot — Investigação de Afiliados</b>

<b>Como usar:</b>
• Envie um <b>email</b> → investigação automática
• Envie um <b>link/código</b> → consulta por campaignId
• <code>/investigar email@exemplo.com</code>
• <code>/investigar email@exemplo.com superbet</code> — filtra por casa
• <code>/link VALLEXBR55</code> ou URL do Superbet

<b>Exemplos naturais:</b>
• <code>viniciussouzasilvas1@gmail.com cpa errado</code>
• <code>https://wlsuperbet...?siteid=32666&c=VALLEXBR55</code>
• <code>VALLEXBR55</code>

O bot explica diferenças entre QFTD, CPA direto e ganho de rede.

${LINK_HELP}`;
