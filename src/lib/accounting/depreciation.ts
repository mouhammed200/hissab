export interface DepreciationInput {
  purchaseCost: number
  salvageValue: number
  usefulLifeYears: number
  purchaseDate: string
  method?: 'straight_line'  // Only straight-line for now
}

export interface DepreciationScheduleEntry {
  periodDate: string  // YYYY-MM-DD (1st of month)
  depreciationAmount: number
  accumulatedDepreciation: number
  netBookValue: number
}

export function calculateMonthlyDepreciation(input: DepreciationInput): number {
  const depreciableAmount = input.purchaseCost - (input.salvageValue || 0)
  return depreciableAmount / (input.usefulLifeYears * 12)
}

export function generateDepreciationSchedule(input: DepreciationInput): DepreciationScheduleEntry[] {
  const monthlyDepreciation = calculateMonthlyDepreciation(input)
  const totalMonths = input.usefulLifeYears * 12
  const schedule: DepreciationScheduleEntry[] = []
  
  let accumulated = 0
  const purchaseDate = new Date(input.purchaseDate)
  
  for (let i = 1; i <= totalMonths; i++) {
    const currentMonthDate = new Date(purchaseDate.getFullYear(), purchaseDate.getMonth() + i, 1)
    
    accumulated += monthlyDepreciation
    const netBookValue = input.purchaseCost - accumulated
    
    schedule.push({
      periodDate: currentMonthDate.toISOString().split('T')[0],
      depreciationAmount: monthlyDepreciation,
      accumulatedDepreciation: accumulated,
      netBookValue: netBookValue
    })
  }
  
  return schedule
}

export function getNetBookValue(input: DepreciationInput, asOfDate?: string): number {
  const purchaseDate = new Date(input.purchaseDate)
  const asOf = asOfDate ? new Date(asOfDate) : new Date()
  
  let elapsedMonths = (asOf.getFullYear() - purchaseDate.getFullYear()) * 12 + (asOf.getMonth() - purchaseDate.getMonth())
  
  if (asOf.getDate() < purchaseDate.getDate()) {
    elapsedMonths -= 1
  }
  
  elapsedMonths = Math.max(0, elapsedMonths)
  const totalMonths = input.usefulLifeYears * 12
  elapsedMonths = Math.min(elapsedMonths, totalMonths)
  
  const monthlyDepreciation = calculateMonthlyDepreciation(input)
  const accumulated = elapsedMonths * monthlyDepreciation
  
  return input.purchaseCost - accumulated
}
