export interface DepreciationInput {
  purchaseCost: number
  salvageValue: number
  usefulLifeYears: number
  purchaseDate: string
  method?: 'straight_line'
}

export interface DepreciationScheduleEntry {
  periodDate: string
  depreciationAmount: number
  accumulatedDepreciation: number
  netBookValue: number
}

function parseDateOnly(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function calculateMonthlyDepreciation(input: DepreciationInput): number {
  const depreciableAmount = Math.max(0, input.purchaseCost - (input.salvageValue || 0))
  return depreciableAmount / (input.usefulLifeYears * 12)
}

export function generateDepreciationSchedule(input: DepreciationInput): DepreciationScheduleEntry[] {
  const monthlyDepreciation = calculateMonthlyDepreciation(input)
  const totalMonths = input.usefulLifeYears * 12
  const schedule: DepreciationScheduleEntry[] = []
  const purchaseDate = parseDateOnly(input.purchaseDate)
  let accumulated = 0

  // Depreciation starts in the acquisition month. Use UTC date-only arithmetic
  // so UAE timezone conversion cannot shift a period to the previous day.
  for (let i = 0; i < totalMonths; i++) {
    const periodDate = new Date(Date.UTC(purchaseDate.getUTCFullYear(), purchaseDate.getUTCMonth() + i, 1))
    const remaining = Math.max(0, input.purchaseCost - (input.salvageValue || 0) - accumulated)
    const depreciationAmount = Math.min(monthlyDepreciation, remaining)
    accumulated += depreciationAmount

    schedule.push({
      periodDate: formatDateOnly(periodDate),
      depreciationAmount,
      accumulatedDepreciation: accumulated,
      netBookValue: input.purchaseCost - accumulated,
    })
  }

  return schedule
}

export function getNetBookValue(input: DepreciationInput, asOfDate?: string): number {
  const purchaseDate = parseDateOnly(input.purchaseDate)
  const asOf = asOfDate ? parseDateOnly(asOfDate) : new Date()
  let elapsedMonths = (asOf.getUTCFullYear() - purchaseDate.getUTCFullYear()) * 12 +
    (asOf.getUTCMonth() - purchaseDate.getUTCMonth())
  elapsedMonths = Math.max(0, Math.min(elapsedMonths + 1, input.usefulLifeYears * 12))

  const monthlyDepreciation = calculateMonthlyDepreciation(input)
  const accumulated = Math.min(
    input.purchaseCost - (input.salvageValue || 0),
    elapsedMonths * monthlyDepreciation,
  )
  return input.purchaseCost - accumulated
}
