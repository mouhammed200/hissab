/**
 * UAE End-of-Service Gratuity Calculator
 * Per Federal Decree-Law No. 33 of 2021 (effective 2 Feb 2022)
 *
 * Key change from old law:
 * - Pre-2022: resignation reductions (1/3, 2/3) applied based on years served
 * - Post-2022 (current): ALL employees with ≥ 1 year get FULL gratuity,
 *   regardless of whether they resign or are terminated.
 *   The adjustmentFactor is ALWAYS 1.0 under the new law.
 */

export interface GratuityInput {
  basicSalary: number       // Monthly basic salary in AED (excludes allowances)
  hireDate: string          // ISO date string
  asOfDate?: string         // Termination/calculation date. Default: today
  contractType?: 'limited' | 'unlimited'  // No longer affects gratuity amount
}

export interface GratuityResult {
  yearsOfService: number
  dailyBasicRate: number
  first5YearsComponent: number   // 21 working days × year (up to 5 years)
  beyond5YearsComponent: number  // 30 working days × year (beyond 5 years)
  grossGratuity: number
  cappedGratuity: number         // Capped at 24 months basic salary
  monthlyAccrual: number         // For monthly journal entry
  qualifies: boolean             // Must have ≥ 1 full year of service
}

export function calculateGratuity(input: GratuityInput): GratuityResult {
  const hire  = new Date(input.hireDate)
  const asOf  = input.asOfDate ? new Date(input.asOfDate) : new Date()

  const daysOfService   = Math.max(0, (asOf.getTime() - hire.getTime()) / (1000 * 60 * 60 * 24))
  const yearsOfService  = daysOfService / 365.25
  const dailyBasicRate  = input.basicSalary / 30

  // Must have completed at least 1 full year to receive any gratuity
  const qualifies = yearsOfService >= 1

  let first5YearsComponent  = 0
  let beyond5YearsComponent = 0
  let grossGratuity         = 0

  if (qualifies) {
    const yearsFirst5  = Math.min(5, yearsOfService)
    const yearsBeyond5 = Math.max(0, yearsOfService - 5)

    first5YearsComponent  = yearsFirst5  * 21 * dailyBasicRate
    beyond5YearsComponent = yearsBeyond5 * 30 * dailyBasicRate
    grossGratuity         = first5YearsComponent + beyond5YearsComponent
  }

  // Under Federal Decree-Law No. 33 of 2021, no reduction for resignation.
  // Capped at 2 years (24 months) of basic salary.
  const cappedGratuity = Math.min(grossGratuity, input.basicSalary * 24)
  const monthlyAccrual = cappedGratuity / Math.max(yearsOfService * 12, 1)

  return {
    yearsOfService,
    dailyBasicRate,
    first5YearsComponent,
    beyond5YearsComponent,
    grossGratuity,
    cappedGratuity,
    monthlyAccrual,
    qualifies,
  }
}

/**
 * Monthly gratuity accrual for journal entries.
 * Records the monthly provision (Debit: Gratuity Expense, Credit: Gratuity Payable).
 */
export function monthlyGratuityAccrual(input: GratuityInput): number {
  const result = calculateGratuity(input)
  return result.monthlyAccrual
}
