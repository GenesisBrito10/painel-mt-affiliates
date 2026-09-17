import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const dealCard = readFileSync(
  new URL('../app/components/DealCard.vue', import.meta.url),
  'utf8',
)
const dealsPage = readFileSync(
  new URL('../app/pages/deals.vue', import.meta.url),
  'utf8',
)

describe('Betano Diario eligibility copy', () => {
  it('shows a CPA-only Superbet requirement when no average-deposit gate exists', () => {
    expect(dealCard).toContain('deal.eligibility.minAvgDepositPerFtd > 0')
    expect(dealCard).toContain('CPA na Superbet')
    expect(dealsPage).toContain('eligibility.minAvgDepositPerFtd > 0')
    expect(dealsPage).toContain('CPAs qualificados na Superbet')
  })
})
