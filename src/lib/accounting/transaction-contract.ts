import type { JournalLineInput } from '@/lib/accounting/journal'
import { buildSaleJournalLines, buildPurchaseJournalLines, buildSalaryLines, buildAssetPurchaseLines } from '@/lib/accounting/journal'
import { computeTotals, type NormalizedRecord, type RecordTotals } from '@/lib/records/normalize'
import { assertBalanced, buildMonetaryFacts, deriveVatCategory, type MonetaryFacts } from '@/lib/accounting/policy'

export interface TransactionContract {
  version: 1
  type: NormalizedRecord['type']
  source: NormalizedRecord
  facts: {
    source: RecordTotals
    monetary: MonetaryFacts
    vatCategory: string
  }
  journalLines: JournalLineInput[]
}

export function buildTransactionContract(record: NormalizedRecord, options?: { rateSource?: string; rateDate?: string }): TransactionContract {
  const sourceTotals = computeTotals(record)
  const monetary = buildMonetaryFacts(record, sourceTotals, {
    rate: record.currency === 'AED' ? 1 : record.exchangeRate,
    rateDate: options?.rateDate ?? record.date,
    rateSource: options?.rateSource ?? (record.currency === 'AED' ? 'BASE_CURRENCY' : 'OFFICIAL_RATE_REQUIRED'),
  })
  const category = deriveVatCategory(record.items)
  const description = record.party ? `${record.type}: ${record.party}` : record.type
  let journalLines: JournalLineInput[] = []
  if (record.type === 'sale') journalLines = buildSaleJournalLines(monetary.aed.subtotal, monetary.aed.vat, category, description)
  else if (record.type === 'purchase') journalLines = buildPurchaseJournalLines(monetary.aed.subtotal, monetary.aed.vat, Boolean(record.reverseCharge), description)
  else if (record.type === 'employee') journalLines = buildSalaryLines((record.basicSalary ?? 0) + (record.allowances ?? 0), `Salary: ${record.name ?? 'Employee'}`)
  else if (record.type === 'asset') journalLines = buildAssetPurchaseLines(record.purchaseCost ?? 0, true, `Asset: ${record.assetName ?? 'Asset'}`)
  assertBalanced(journalLines)
  return { version: 1, type: record.type, source: record, facts: { source: sourceTotals, monetary, vatCategory: category }, journalLines }
}
