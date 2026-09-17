import type { PinbetMetricHouse } from '~/types/dashboard'

export interface PinbetKpiTotals {
  netPl: number | null
  depositTotal: number
  withdrawalTotal: number
  volume: number
}

const PINBET_HOUSES = new Set(['pinbet-diario', 'pinbet-mensal'])
const roundCurrency = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

export function aggregatePinbetKpis(
  houses: PinbetMetricHouse[],
  selectedHouse?: string,
): PinbetKpiTotals {
  if (selectedHouse && !PINBET_HOUSES.has(selectedHouse)) {
    return { netPl: 0, depositTotal: 0, withdrawalTotal: 0, volume: 0 }
  }

  const selected = selectedHouse
    ? houses.filter(house => house.house === selectedHouse)
    : houses

  if (selected.length === 0) {
    return { netPl: 0, depositTotal: 0, withdrawalTotal: 0, volume: 0 }
  }

  const netPlComplete = selected.every(
    house => house.metricsComplete && house.netPl !== null,
  )

  return {
    netPl: netPlComplete
      ? roundCurrency(selected.reduce((sum, house) => sum + (house.netPl ?? 0), 0))
      : null,
    depositTotal: roundCurrency(
      selected.reduce((sum, house) => sum + house.depositTotal, 0),
    ),
    withdrawalTotal: roundCurrency(
      selected.reduce((sum, house) => sum + house.withdrawalTotal, 0),
    ),
    volume: roundCurrency(
      selected.reduce((sum, house) => sum + house.volume, 0),
    ),
  }
}
