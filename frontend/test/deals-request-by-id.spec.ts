import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const dealsPage = readFileSync(
  new URL('../app/pages/deals.vue', import.meta.url),
  'utf8',
)

describe('Deals marketplace request identity', () => {
  it('requests the selected deal by id instead of resolving only by house', () => {
    expect(dealsPage).toContain('body: { dealId: deal.id }')
    expect(dealsPage).not.toContain('body: { bettingHouseSlug: deal.bettingHouseSlug }')
  })
})
