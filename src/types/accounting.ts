import type { VatCategory, Emirate, InvoiceType } from './database'

// AI-parsed record from Gemini
export interface ParsedItem {
  description: string
  qty: number
  price: number
  discount: number
  category: 'standard' | 'zero' | 'exempt'
  exciseCategory?: string
}

export interface ParsedRecord {
  type: 'sale' | 'purchase' | 'employee' | 'asset' | 'relatedParty' | 'query' | 'action'
  subtype?: 'itemized' | 'lumpSum'
  party?: string
  items?: ParsedItem[]
  reverseCharge?: boolean
  currency?: string
  sellerTRN?: string
  invoiceNumber?: string
  emirate?: Emirate
  // Employee fields
  name?: string
  position?: string
  basicSalary?: number
  allowances?: number
  hireDate?: string
  contractType?: 'limited' | 'unlimited'
  terminationReason?: 'employer' | 'resignation' | 'expiry'
  // Asset fields
  assetName?: string
  purchaseCost?: number
  salvageValue?: number
  usefulLifeYears?: number
  supplier?: string
  purchaseDate?: string
  // Related party fields
  relationship?: string
  transactionType?: string
  amount?: number
  isArmsLength?: boolean
  // Query response
  queryResponse?: string
  // Action
  actionType?: string
  actionPayload?: Record<string, unknown>
  // Meta
  notes?: string
  date?: string
  confidence?: number
}

// Calculated totals
export interface RecordTotals {
  subtotal: number
  vat: number
  discount: number
  total: number
  selfAccountedVAT?: number
}

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
