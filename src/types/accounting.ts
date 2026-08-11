// AI-parsed record types are defined once in src/lib/records/normalize.ts and
// re-exported here. Keeping a second, drifting copy of ParsedRecord in this
// file is what allowed the UI, the API and the ledger to disagree about which
// fields a record actually has.
export type {
  NormalizedItem as ParsedItem,
  NormalizedRecord as ParsedRecord,
  RecordTotals,
  RecordType,
  ValidationResult,
} from '@/lib/records/normalize'

// Gratuity calculation result
export interface GratuityResult {
  years: number
  dailyRate: number
  first5Years: number
  beyond5Years: number
  grossGratuity: number
  adjustedGratuity: number
  cappedGratuity: number
}

// Corporate tax result
export interface CorporateTaxResult {
  taxableIncome: number
  tax: number
  effectiveRate: number
}

// Report types
export interface TrialBalanceRow {
  account_id: string
  account_code: string
  account_name: string
  account_name_ar: string | null
  account_type: string
  total_debit: number
  total_credit: number
  net_balance: number
}

export interface PLRow {
  category: string
  account_code: string
  account_name: string
  amount: number
}

export interface BalanceSheetRow {
  bs_type: string
  category: string
  account_code: string
  account_name: string
  balance: number
}

export interface AgedReportRow {
  contact_id: string
  contact_name: string
  current_0_30: number
  days_31_60: number
  days_61_90: number
  days_90_plus: number
  total_due: number
}
