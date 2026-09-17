import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readPage = (page: string) =>
  readFileSync(new URL(`../app/pages/${page}`, import.meta.url), 'utf8')

describe('Pinbet user-facing labels', () => {
  it('names the operational metric Net P&L on the dashboard card', () => {
    const dashboard = readPage('index.vue')

    expect(dashboard).toContain("label: 'Net P&L'")
    expect(dashboard).toContain("label: 'Saques'")
    expect(dashboard).toContain("label: 'Volume'")
    expect(dashboard).not.toContain('Saúde da operação Pinbet')
    expect(dashboard).not.toContain('pinbetMetricCards')
  })

  it('keeps the dashboard financial balance separate from Payments', () => {
    const dashboard = readPage('index.vue')

    expect(dashboard).toContain('activeHouse.value.total')
    expect(dashboard).toContain('balance.value?.balance')
    expect(dashboard).not.toContain('balance.value?.withdrawableNet')
  })

  it('always shows Net P&L as a metric row in the balance distribution card', () => {
    const payments = readPage('payments.vue')

    expect(payments).toContain('>Net P&amp;L</span>')
    expect(payments).toContain("h.netPl === null ? 'Sincronizando' : formatCurrency(h.netPl)")
    expect(payments).toContain('80% do Net P&amp;L positivo')
    expect(payments).not.toContain('Resultado: <strong :style="{ color: h.netPl')
  })

  it('explains the Pinbet withdrawal limit with explicit amounts', () => {
    const payments = readPage('payments.vue')

    expect(payments).toContain('Limite de saque (80% do Net P&amp;L)')
    expect(payments).toContain('Total já sacado nesta casa')
    expect(payments).toContain('Saldo disponível para saque')
    expect(payments).toContain('Seus saques anteriores já consumiram o limite atual')
    expect(payments).not.toContain('já utilizado:')
  })
})
