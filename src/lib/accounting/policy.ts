import type { VatCategory } from '@/types/database'
import type { NormalizedItem, NormalizedRecord, RecordTotals } from '@/lib/records/normalize'

export const UAE_VAT_RATE = 0.05

export interface AccountingPolicy {
  baseCurrency: 'AED'
  accountingBasis: 'accrual' | 'cash'
  reportingStandard: 'IFRS' | 'IFRS for SMEs' | 'other'
  vatRate: number
}

export interface MonetaryFacts {
  sourceCurrency: string
  source: RecordTotals
  aed: RecordTotals
  exchangeRate: number
  exchangeRateDate: string
  exchangeRateSource: string
}

export const DEFAULT_ACCOUNTING_POLICY: AccountingPolicy = {
  baseCurrency: 'AED',
  accountingBasis: 'accrual',
  reportingStandard: 'IFRS for SMEs',
  vatRate: UAE_VAT_RATE,
}

export function categoryToRevenueAccount(category: NormalizedItem['category']): string {
  if (category === 'zero') return '4100'
  if (category === 'exempt') return '4200'
  return '4000'
}

export function deriveVatCategory(items: NormalizedItem[]): VatCategory {
  if (items.some((i) => i.category === 'standard')) return 'standard'
  if (items.some((i) => i.category === 'exempt')) return 'exempt'
  return 'zero'
}

export function deriveTotals(items: NormalizedItem[], vatRate = UAE_VAT_RATE): RecordTotals {
  return items.reduce<RecordTotals>((totals, item) => {
    const net = Math.max(0, item.qty * item.price - item.discount)
    const vat = item.category === 'standard' ? net * vatRate : 0
    totals.subtotal += net
    totals.discount += item.discount
    totals.vat += vat
    totals.total += net + vat
    return totals
  }, { subtotal: 0, vat: 0, discount: 0, total: 0 })
}

function round2(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100 }

export function buildMonetaryFacts(
  record: NormalizedRecord,
  source: RecordTotals,
  options?: { rate?: number; rateDate?: string; rateSource?: string },
): MonetaryFacts {
  const rate = record.currency === 'AED' ? 1 : options?.rate ?? record.exchangeRate
  if (!rate || rate <= 0) throw new Error('A positive exchange rate is required before posting.')
  const rateDate = options?.rateDate ?? record.date
  if (!rateDate) throw new Error('Date of supply is required for exchange-rate facts.')
  const rateSource = record.currency === 'AED' ? 'BASE_CURRENCY' : options?.rateSource ?? 'UNSPECIFIED'
  if (record.currency !== 'AED' && rateSource === 'FALLBACK') {
    throw new Error('Indicative FX rates cannot be used for posting. Record the official rate and source date.')
  }
  return {
    sourceCurrency: record.currency,
    source,
    aed: {
      subtotal: round2(source.subtotal * rate),
      vat: round2(source.vat * rate),
      discount: round2(source.discount * rate),
      total: round2(source.total * rate),
    },
    exchangeRate: rate,
    exchangeRateDate: rateDate,
    exchangeRateSource: rateSource,
  }
}

export function assertBalanced(lines: Array<{ debit: number; credit: number }>) {
  const debit = round2(lines.reduce((s, l) => s + l.debit, 0))
  const credit = round2(lines.reduce((s, l) => s + l.credit, 0))
  if (debit <= 0 || Math.abs(debit - credit) > 0.005) {
    throw new Error(`Unbalanced journal: debit ${debit.toFixed(2)} vs credit ${credit.toFixed(2)}`)
  }
  return { debit, credit }
}

/** The only supported account mapping entry point for invoice revenue. */
export function accountMappingForItem(item: NormalizedItem) {
  return {
    revenueAccountCode: categoryToRevenueAccount(item.category),
    vatAccountCode: item.category === 'standard' ? '2100' : null,
    expenseAccountCode: null as string | null,
  }
}
