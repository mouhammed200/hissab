/**
 * UAE Corporate Tax Calculator
 * Per Federal Decree-Law No. 47 of 2022
 *
 * Tax Rates:
 * - 0% on Taxable Income up to AED 375,000
 * - 9% on Taxable Income above AED 375,000
 *
 * Small Business Relief (SBR):
 * - Available for tax periods ending on or before 31 December 2026
 * - Eligible if Revenue <= AED 3,000,000
 * - Taxable person can elect to be treated as having no taxable income (0% tax)
 *
 * Qualifying Free Zone Person (QFZP):
 * - 0% on Qualifying Income
 * - 9% on Non-Qualifying Income
 * - De Minimis rule: Non-qualifying revenue must NOT exceed the LOWER of:
 *   a) 5% of total revenue, OR
 *   b) AED 5,000,000
 *   If non-qualifying revenue exceeds de minimis threshold, QFZP status is lost for that period.
 */

const CT_THRESHOLD = 375_000
const CT_RATE = 0.09
const SBR_REVENUE_CAP = 3_000_000

export interface CorporateTaxInput {
  revenue: number
  expenses: number
  nonDeductibleExpenses?: number
  exemptIncome?: number
  carriedForwardLosses?: number
  isSmallBusinessReliefElected?: boolean
  isQualifyingFreeZone?: boolean
  qualifyingIncome?: number
  nonQualifyingRevenue?: number
}

export interface CorporateTaxResult {
  grossIncome: number
  adjustedTaxableIncome: number
  tax: number
  effectiveRate: number
  smallBusinessReliefApplied: boolean
  qfzpDeMinimisViolated: boolean
  notes: string[]
}

export function calculateCorporateTax(input: CorporateTaxInput): CorporateTaxResult {
  const notes: string[] = []
  const grossIncome = input.revenue - input.expenses
  let taxableIncome = grossIncome + (input.nonDeductibleExpenses || 0) - (input.exemptIncome || 0) - (input.carriedForwardLosses || 0)
  taxableIncome = Math.max(0, taxableIncome)

  let smallBusinessReliefApplied = false
  let qfzpDeMinimisViolated = false

  // 1. Check Small Business Relief election (revenue <= 3M AED)
  if (input.isSmallBusinessReliefElected && input.revenue <= SBR_REVENUE_CAP) {
    smallBusinessReliefApplied = true
    notes.push('Small Business Relief (SBR) applied: Taxable income treated as AED 0 (0% tax rate).')
    return {
      grossIncome,
      adjustedTaxableIncome: 0,
      tax: 0,
      effectiveRate: 0,
      smallBusinessReliefApplied: true,
      qfzpDeMinimisViolated: false,
      notes,
    }
  }

  // 2. Free Zone QFZP check with De Minimis rule
  if (input.isQualifyingFreeZone) {
    const totalRevenue = input.revenue
    const nonQualifying = input.nonQualifyingRevenue || 0
    const deMinimisLimit = Math.min(totalRevenue * 0.05, 5_000_000)

    if (nonQualifying > deMinimisLimit) {
      qfzpDeMinimisViolated = true
      notes.push(`De Minimis threshold exceeded (Non-qualifying revenue AED ${nonQualifying.toLocaleString()} > limit AED ${deMinimisLimit.toLocaleString()}). QFZP 0% status lost. Standard 9% rate applies to all income.`)
    } else {
      notes.push('QFZP De Minimis test passed: 0% tax applies to Qualifying Income.')
      if (input.qualifyingIncome) {
        taxableIncome = Math.max(0, taxableIncome - input.qualifyingIncome)
      }
    }
  }

  // 3. Compute tax: 0% up to 375k, 9% above 375k
  const tax = taxableIncome <= CT_THRESHOLD ? 0 : (taxableIncome - CT_THRESHOLD) * CT_RATE
  const effectiveRate = grossIncome > 0 ? tax / grossIncome : 0

  if (taxableIncome <= CT_THRESHOLD) {
    notes.push('Taxable income is within the 0% threshold (AED 375,000).')
  }

  return {
    grossIncome,
    adjustedTaxableIncome: taxableIncome,
    tax,
    effectiveRate,
    smallBusinessReliefApplied,
    qfzpDeMinimisViolated,
    notes,
  }
}
