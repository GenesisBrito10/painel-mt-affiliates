import { describe, expect, it } from 'vitest'
import { aggregatePinbetKpis } from '../app/utils/pinbet-kpis'

const houses = [
  {
    house: 'pinbet-diario' as const,
    name: 'Pinbet Diário',
    netPl: -68.26,
    depositTotal: 1000,
    withdrawalTotal: 250,
    volume: 3000,
    metricsComplete: true,
    health: 'ATTENTION' as const,
  },
  {
    house: 'pinbet-mensal' as const,
    name: 'Pinbet Mensal',
    netPl: 100,
    depositTotal: 500,
    withdrawalTotal: 100,
    volume: 2000,
    metricsComplete: true,
    health: 'HEALTHY' as const,
  },
]

describe('dashboard Pinbet KPI aggregation', () => {
  it('sums Pinbet operational metrics when all houses are selected', () => {
    expect(aggregatePinbetKpis(houses)).toEqual({
      netPl: 31.74,
      depositTotal: 1500,
      withdrawalTotal: 350,
      volume: 5000,
    })
  })

  it('keeps only the selected Pinbet house', () => {
    expect(aggregatePinbetKpis(houses, 'pinbet-diario')).toEqual({
      netPl: -68.26,
      depositTotal: 1000,
      withdrawalTotal: 250,
      volume: 3000,
    })
  })

  it('returns zero for operational metrics in filters from other houses', () => {
    expect(aggregatePinbetKpis(houses, 'superbet')).toEqual({
      netPl: 0,
      depositTotal: 0,
      withdrawalTotal: 0,
      volume: 0,
    })
  })

  it('keeps Net P&L pending when a selected Pinbet history is incomplete', () => {
    expect(aggregatePinbetKpis([
      { ...houses[0]!, netPl: null, metricsComplete: false, health: 'SYNCING' },
    ], 'pinbet-diario')).toEqual({
      netPl: null,
      depositTotal: 1000,
      withdrawalTotal: 250,
      volume: 3000,
    })
  })
})
