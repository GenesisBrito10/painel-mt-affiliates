import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const agreementCard = readFileSync(
  new URL('../app/components/affiliates/AgreementCard.vue', import.meta.url),
  'utf8',
)

describe('AgreementCard visibility', () => {
  it('shows houses and CPA without Link ID or RevShare', () => {
    expect(agreementCard).toContain('Meus Acordos')
    expect(agreementCard).toContain('CPA Total')
    expect(agreementCard).toContain('CPA {{ link.cpa')
    expect(agreementCard).not.toContain('LINK ID')
    expect(agreementCard).not.toContain('link.affiliateName')
    expect(agreementCard).not.toContain('RevShare Médio')
    expect(agreementCard).not.toContain('link.revshare')
  })
})
