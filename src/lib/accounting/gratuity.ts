/**
 * UAE End-of-Service Gratuity Calculator.
 * Federal Decree-Law No. 33 of 2021, as amended.
 *
 * Settlement entitlement requires one year of continuous service. That is not
 * the same as the monthly accounting provision: IAS 19 requires an accrual
 * from the first month of service, so monthlyGratuityAccrual() never waits for
 * the one-year vesting threshold.
 */

export interface GratuityInput {
  basicSalary: number
  hireDate: string
  asOfDate?: string
  contractType?: 'limited' | 'unlimited'
}

export interface GratuityResult {
  yearsOfService: number
  dailyBasicRate: number
  first5YearsComponent: number
  beyond5YearsComponent: number
  grossGratuity: number
  cappedGratuity: number
  monthlyAccrual: number
  qualifies: boolean
}

function parseDateOnly(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function serviceYears(hireDate: string, asOfDate?: string) {
  const hire = parseDateOnly(hireDate)
  const asOf = asOfDate ? parseDateOnly(asOfDate) : new Date()
  const days = Math.max(0, (asOf.getTime() - hire.getTime()) / 86_400_000)
  return days / 365.25
}

export function calculateGratuity(input: GratuityInput): GratuityResult {
  const salary = Math.max(0, input.basicSalary || 0)
  const yearsOfService = serviceYears(input.hireDate, input.asOfDate)
  const dailyBasicRate = salary / 30
  const qualifies = yearsOfService >= 1

  const yearsFirst5 = Math.min(5, yearsOfService)
  const yearsBeyond5 = Math.max(0, yearsOfService - 5)
  const first5YearsComponent = yearsFirst5 * 21 * dailyBasicRate
  const beyond5YearsComponent = yearsBeyond5 * 30 * dailyBasicRate
  const grossGratuity = qualifies ? first5YearsComponent + beyond5YearsComponent : 0
  const cappedGratuity = Math.min(grossGratuity, salary * 24)

  // Current-period provision: 21 days/year for the first five years, then
  // 30 days/year. This accrues from month one and is not a lifetime average.
  const annualAccrual = yearsOfService <= 5 ? 21 * dailyBasicRate : 30 * dailyBasicRate
  const monthlyAccrual = annualAccrual / 12

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

export function monthlyGratuityAccrual(input: GratuityInput): number {
  return calculateGratuity(input).monthlyAccrual
}
