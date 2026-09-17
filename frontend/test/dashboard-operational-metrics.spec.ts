import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readFrontend = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const readAdmin = (path: string) =>
  readFileSync(new URL(`../../admin/${path}`, import.meta.url), 'utf8')

describe('general dashboard operational metrics', () => {
  it('uses general summary deposits and betting volume on affiliate cards', () => {
    const dashboard = readFrontend('app/pages/index.vue')

    expect(dashboard).toContain('value: formatCurrency(s.deposit)')
    expect(dashboard).toContain('value: formatCurrency(s.volume)')
    expect(dashboard).not.toContain(
      'value: formatCurrency(operationalKpis.value.depositTotal)',
    )
    expect(dashboard).toContain(
      'value: formatCurrency(operationalKpis.value.withdrawalTotal)',
    )
  })

  it('types and renders betting volume in the affiliate daily table', () => {
    const types = readFrontend('app/types/dashboard.ts')
    const dashboard = readFrontend('app/pages/index.vue')

    expect(types.match(/volume: number/g)?.length).toBeGreaterThanOrEqual(3)
    expect(dashboard).toContain(
      "{ accessorKey: 'volume', header: 'Volume apostado' }",
    )
    expect(dashboard).toContain('#volume-cell')
    expect(dashboard).toContain('formatCurrency(row.original.volume)')
  })

  it('renders betting volume throughout the admin affiliate detail', () => {
    const page = readAdmin('app/pages/affiliates/[id].vue')

    expect(page).toContain('{{ money(summary?.volume || 0) }}')
    expect(page).toContain('{{ money(row.volume) }}')
    expect(page).toContain('{{ money(c.volume) }}')
    expect(page.match(/volume: number/g)?.length).toBeGreaterThanOrEqual(4)
  })
})
