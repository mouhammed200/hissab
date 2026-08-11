/**
 * UAE Corporate Tax calculator.
 * Sources checked 10 Aug 2026: Federal Decree-Law No. 47 of 2022 as amended,
 * Ministerial Decision No. 134 of 2023, Cabinet Decision No. 100 of 2023,
 * and FTA CT guidance on taxable income and losses.
 */

const CT_THRESHOLD = 375_000
const CT_RATE = 0.09
const SBR_REVENUE_CAP = 3_000_000
const LOSS_OFFSET_CAP = 0.75
const QFZP_DE_MINIMIS_RATE = 0.05
const QFZP_DE_MINIMIS_CAP = 5_000_000

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
  lossUsed: number
  lossDisallowedByCap: number
  qualifyingIncomeTaxedAtZero: number
  nonQualifyingIncomeTaxedAtNinePercent: number
  notes: string[]
}

export function calculateCorporateTax(input: CorporateTaxInput): CorporateTaxResult {
  const notes: string[] = []
  const revenue = Math.max(0, input.revenue || 0)
  const expenses = Math.max(0, input.expenses || 0)
  const grossIncome = revenue - expenses
  const nonDeductible = Math.max(0, input.nonDeductibleExpenses || 0)
  const exemptIncome = Math.max(0, input.exemptIncome || 0)
  const losses = Math.max(0, input.carriedForwardLosses || 0)
  const accountingTaxableIncome = Math.max(0, grossIncome + nonDeductible - exemptIncome)

  if (input.isSmallBusinessReliefElected && revenue <= SBR_REVENUE_CAP) {
    notes.push('Small Business Relief applied: election treats taxable income as nil for eligible tax periods ending on or before 31 December 2026.')
    return {
      grossIncome,
      adjustedTaxableIncome: 0,
      tax: 0,
      effectiveRate: 0,
      smallBusinessReliefApplied: true,
      qfzpDeMinimisViolated: false,
      lossUsed: 0,
      lossDisallowedByCap: 0,
      qualifyingIncomeTaxedAtZero: 0,
      nonQualifyingIncomeTaxedAtNinePercent: 0,
      notes,
    }
  }

  let qfzpDeMinimisViolated = false
  let qualifyingIncomeTaxedAtZero = 0
  let nonQualifyingIncomeTaxedAtNinePercent = 0
  let taxableIncome = accountingTaxableIncome

  if (input.isQualifyingFreeZone) {
    const nonQualifyingRevenue = Math.max(0, input.nonQualifyingRevenue || 0)
    const deMinimisLimit = Math.min(revenue * QFZP_DE_MINIMIS_RATE, QFZP_DE_MINIMIS_CAP)
    qfzpDeMinimisViolated = nonQualifyingRevenue > deMinimisLimit

    if (qfzpDeMinimisViolated) {
      notes.push(`QFZP de minimis threshold exceeded: non-qualifying revenue AED ${nonQualifyingRevenue.toLocaleString()} is above AED ${deMinimisLimit.toLocaleString()}. The 0% QFZP treatment is unavailable for the period.`)
    } else {
      // QFZP does not receive the ordinary AED 375,000 0% band on non-qualifying income.
      qualifyingIncomeTaxedAtZero = Math.min(accountingTaxableIncome, Math.max(0, input.qualifyingIncome || 0))
      nonQualifyingIncomeTaxedAtNinePercent = Math.max(0, accountingTaxableIncome - qualifyingIncomeTaxedAtZero)
      taxableIncome = nonQualifyingIncomeTaxedAtNinePercent
      notes.push('QFZP treatment applied: qualifying income at 0%; non-qualifying income at 9% without the ordinary AED 375,000 band.')
    }
  }

  // Article 37 caps carried-forward loss relief at 75% of taxable income for the period.
  const lossBase = taxableIncome
  const maximumLossUsable = lossBase * LOSS_OFFSET_CAP
  const lossUsed = Math.min(losses, maximumLossUsable)
  const lossDisallowedByCap = Math.max(0, Math.min(losses, lossBase) - lossUsed)
  taxableIncome = Math.max(0, lossBase - lossUsed)

  if (losses > 0 && lossUsed < losses) {
    notes.push(`Carried-forward loss relief capped at 75% of taxable income: AED ${lossUsed.toLocaleString()} used, AED ${Math.max(0, losses - lossUsed).toLocaleString()} remains available subject to the law.`)
  }

  let tax: number
  if (input.isQualifyingFreeZone && !qfzpDeMinimisViolated) {
    tax = taxableIncome * CT_RATE
  } else {
    tax = Math.max(0, taxableIncome - CT_THRESHOLD) * CT_RATE
  }

  const effectiveRate = grossIncome > 0 ? tax / grossIncome : 0
  if (taxableIncome <= CT_THRESHOLD && !(input.isQualifyingFreeZone && !qfzpDeMinimisViolated)) {
    notes.push('Taxable income is within the ordinary AED 375,000 0% band.')
  }

  return {
    grossIncome,
    adjustedTaxableIncome: taxableIncome,
    tax,
    effectiveRate,
    smallBusinessReliefApplied: false,
    qfzpDeMinimisViolated,
    lossUsed,
    lossDisallowedByCap,
    qualifyingIncomeTaxedAtZero,
    nonQualifyingIncomeTaxedAtNinePercent,
    notes,
  }
}
