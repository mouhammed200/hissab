/**
 * Shared record normalizer + validator.
 *
 * Single source of truth for turning a raw Gemini payload into a record that
 * the UI and the posting route can both trust. Previously ChatPane, RecordCard
 * and confirm/route.ts each re-derived shape and totals with slightly
 * different rules, which is how a 15,000 AED sale could render as an empty
 * "General" card and then post a 0.00 journal entry.
 *
 * Rules enforced here:
 *  - Nested detail objects (employeeDetails / assetDetails / relatedPartyDetails)
 *    are flattened onto the root so nothing is lost between parse and confirm.
 *  - sale/purchase always end up with at least one line item. A lump-sum record
 *    is materialised as a single synthetic line so it can never render blank.
 *  - Totals are computed once, in one place, in the record currency.
 *  - Anything that cannot be repaired deterministically becomes a hard error
 *    instead of a silent zero.
 *
 * Dependency-free on purpose so it can be unit tested without a bundler.
 */

export type RecordType =
  | 'sale'
  | 'purchase'
  | 'employee'
  | 'asset'
  | 'relatedParty'
  | 'payment'
  | 'query'
  | 'action'

export type PaymentType = 'received' | 'sent'

export interface NormalizedAllocation {
  invoiceNumber: string
  amount: number
}

export type VatItemCategory = 'standard' | 'zero' | 'exempt'

export interface NormalizedItem {
  description: string
  qty: number
  price: number
  discount: number
  category: VatItemCategory
  exciseCategory?: string
  lineTotal: number
}

export interface NormalizedRecord {
  type: RecordType
  subtype?: 'itemized' | 'lumpSum'
  party?: string
  date?: string
  currency: string
  exchangeRate?: number
  amountInAED?: number
  vatInAED?: number
  emirate?: string
  reverseCharge?: boolean
  sellerTRN?: string
  buyerTRN?: string
  invoiceNumber?: string
  dateOfSupply?: string
  exchangeRateDate?: string
  exchangeRateSource?: string
  sourceChannel?: string
  items: NormalizedItem[]
  name?: string
  position?: string
  basicSalary?: number
  allowances?: number
  hireDate?: string
  contractType?: string
  terminationReason?: string
  assetName?: string
  purchaseCost?: number
  salvageValue?: number
  usefulLifeYears?: number
  supplier?: string
  purchaseDate?: string
  relationship?: string
  transactionType?: string
  amount?: number
  isArmsLength?: boolean
  // Payment fields. Reuses party/amount/currency/exchangeRate/date above.
  paymentType?: PaymentType
  paymentMethod?: string
  bankAccountName?: string
  allocations?: NormalizedAllocation[]
  queryResponse?: string
  actionType?: string
  actionPayload?: Record<string, unknown>
  notes?: string
  confidence?: number
  _normalizerWarnings?: string[]
}

export interface RecordTotals {
  subtotal: number
  vat: number
  discount: number
  total: number
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

const VAT_RATE = 0.05
const ITEM_CATEGORIES: VatItemCategory[] = ['standard', 'zero', 'exempt']

export const TRANSACTION_TYPES: RecordType[] = [
  'sale',
  'purchase',
  'employee',
  'asset',
  'relatedParty',
  'payment',
]

function normalizeAllocation(raw: unknown, index: number, warnings: string[]): NormalizedAllocation | null {
  const item = (raw ?? {}) as Record<string, unknown>
  const invoiceNumber = toText(item.invoiceNumber) ?? toText(item.invoice_number)
  const amount = toPositiveNumber(item.amount, undefined)
  if (!invoiceNumber || amount === undefined || amount <= 0) {
    warnings.push(`Allocation ${index + 1} was missing an invoice number or amount and was dropped.`)
    return null
  }
  return { invoiceNumber, amount: round2(amount) }
}

function toNumber(value: unknown, fallback: number | undefined = undefined): number | undefined {
  if (value === null || value === undefined || value === '') return fallback
  // Tolerate "15,000" / "15 000 AED" style values without inventing digits.
  const cleaned =
    typeof value === 'string' ? value.replace(/[,\s]/g, '').replace(/[A-Za-z]+$/, '') : value
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : fallback
}

function toPositiveNumber(value: unknown, fallback: number | undefined = undefined): number | undefined {
  const n = toNumber(value, fallback)
  if (n === undefined) return undefined
  return n < 0 ? Math.abs(n) : n
}

function toText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length ? trimmed : undefined
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function normalizeCategory(value: unknown): VatItemCategory {
  const text = toText(value)?.toLowerCase()
  if (text && (ITEM_CATEGORIES as string[]).includes(text)) return text as VatItemCategory
  // 'outOfScope' and anything unrecognised are treated as standard-rated so VAT
  // is never silently dropped from a UAE invoice.
  return 'standard'
}

function normalizeItem(raw: unknown, index: number, warnings: string[]): NormalizedItem {
  const item = (raw ?? {}) as Record<string, unknown>
  const description = toText(item.description) ?? toText(item.desc) ?? `Item ${index + 1}`

  // A qty of 0 is legitimate; `||` would silently promote it to 1.
  let qty = toNumber(item.qty ?? item.quantity, undefined)
  if (qty === undefined) {
    qty = 1
    warnings.push(`Item ${index + 1} ("${description}") had no quantity, defaulted to 1.`)
  }

  const price = toPositiveNumber(item.price ?? item.unitPrice, 0) as number
  const discount = toPositiveNumber(item.discount, 0) as number
  const category = normalizeCategory(item.category)

  const expected = round2(qty * price - discount)
  const supplied = toNumber(item.lineTotal, undefined)
  if (supplied !== undefined && Math.abs(supplied - expected) > 0.01) {
    warnings.push(
      `Item ${index + 1} ("${description}") line total ${supplied} did not match ${qty} x ${price} - ${discount}; recalculated to ${expected}.`,
    )
  }

  return {
    description,
    qty,
    price,
    discount,
    category,
    exciseCategory: toText(item.exciseCategory) ?? 'none',
    lineTotal: Math.max(0, expected),
  }
}

/**
 * Best-effort recovery of a total when the model returned a sale/purchase with
 * no line items. Only reads fields the model was actually asked to produce, and
 * reports what it used so the UI can flag it. Never guesses from free text, and
 * never language-specific: this works identically for English and Arabic input.
 */
function recoverLumpSumAmount(raw: Record<string, unknown>): { amount: number; source: string } | null {
  const candidates: Array<[string, unknown]> = [
    ['amount', raw.amount],
    ['total', raw.total],
    ['totalAmount', raw.totalAmount],
    ['purchaseCost', raw.purchaseCost],
    ['amountInAED', raw.amountInAED],
  ]
  for (const [source, value] of candidates) {
    const n = toPositiveNumber(value, undefined)
    if (n !== undefined && n > 0) return { amount: round2(n), source }
  }
  return null
}

function flatten(
  raw: Record<string, unknown>,
  nestedKey: string,
  map: Record<string, string>,
): Record<string, unknown> {
  const nested = raw[nestedKey]
  if (!nested || typeof nested !== 'object') return raw
  const source = nested as Record<string, unknown>
  const merged: Record<string, unknown> = { ...raw }
  for (const [from, to] of Object.entries(map)) {
    if (merged[to] === undefined || merged[to] === null || merged[to] === '') {
      if (source[from] !== undefined) merged[to] = source[from]
    }
  }
  return merged
}

export function normalizeRecord(input: unknown, locale: 'en' | 'ar' = 'en'): NormalizedRecord {
  const ar = locale === 'ar'
  const warnings: string[] = []
  let raw = (input ?? {}) as Record<string, unknown>

  // Flatten nested detail objects before anything else reads the root.
  raw = flatten(raw, 'employeeDetails', {
    name: 'name',
    position: 'position',
    basicSalary: 'basicSalary',
    allowances: 'allowances',
    hireDate: 'hireDate',
    contractType: 'contractType',
  })
  raw = flatten(raw, 'assetDetails', {
    name: 'assetName',
    cost: 'purchaseCost',
    salvageValue: 'salvageValue',
    usefulLife: 'usefulLifeYears',
    supplier: 'supplier',
  })
  raw = flatten(raw, 'relatedPartyDetails', {
    party: 'party',
    relationship: 'relationship',
    amount: 'amount',
    isArmsLength: 'isArmsLength',
  })

  const type = (toText(raw.type) ?? 'query') as RecordType
  const currency = (toText(raw.currency) ?? 'AED').toUpperCase()

  const rawItems = Array.isArray(raw.items) ? raw.items : []
  let items = rawItems.map((item, index) => normalizeItem(item, index, warnings))

  const record: NormalizedRecord = {
    type,
    subtype: (toText(raw.subtype) as NormalizedRecord['subtype']) ?? undefined,
    party: toText(raw.party) ?? toText(raw.partyName),
    date: toText(raw.date),
    currency,
    exchangeRate: toPositiveNumber(raw.exchangeRate, undefined),
    amountInAED: toPositiveNumber(raw.amountInAED, undefined),
    vatInAED: toPositiveNumber(raw.vatInAED, undefined),
    emirate: toText(raw.emirate),
    reverseCharge: raw.reverseCharge === true,
    sellerTRN: toText(raw.sellerTRN),
    buyerTRN: toText(raw.buyerTRN),
    invoiceNumber: toText(raw.invoiceNumber),
    items,
    name: toText(raw.name),
    position: toText(raw.position),
    basicSalary: toPositiveNumber(raw.basicSalary, undefined),
    allowances: toPositiveNumber(raw.allowances, undefined),
    hireDate: toText(raw.hireDate) ?? toText(raw.joinDate),
    contractType: toText(raw.contractType),
    terminationReason: toText(raw.terminationReason),
    assetName: toText(raw.assetName),
    purchaseCost: toPositiveNumber(raw.purchaseCost ?? raw.purchasePrice, undefined),
    salvageValue: toPositiveNumber(raw.salvageValue, undefined),
    usefulLifeYears: toPositiveNumber(raw.usefulLifeYears, undefined),
    supplier: toText(raw.supplier),
    purchaseDate: toText(raw.purchaseDate),
    relationship: toText(raw.relationship),
    transactionType: toText(raw.transactionType),
    amount: toPositiveNumber(raw.amount, undefined),
    isArmsLength: typeof raw.isArmsLength === 'boolean' ? raw.isArmsLength : undefined,
    paymentType: (toText(raw.paymentType) as PaymentType) ?? undefined,
    paymentMethod: toText(raw.paymentMethod),
    bankAccountName: toText(raw.bankAccountName),
    allocations: Array.isArray(raw.allocations)
      ? (raw.allocations
          .map((a, i) => normalizeAllocation(a, i, warnings))
          .filter((a): a is NormalizedAllocation => a !== null))
      : undefined,
    queryResponse: toText(raw.queryResponse),
    actionType: toText(raw.actionType),
    actionPayload: (raw.actionPayload as Record<string, unknown>) ?? undefined,
    notes: toText(raw.notes),
    confidence: toNumber(raw.confidence, undefined),
  }

  // buildMonetaryFacts requires a rate date for every record type, not just
  // sale/purchase. The UI previously only defaulted this for display
  // (RecordCard falling back to today's date on screen) without writing it
  // back onto the record, so a record with no extracted date would pass
  // review looking fine and then be rejected by the server as
  // "Date of supply is required for exchange-rate facts."
  if (!record.date) {
    record.date = new Date().toISOString().split('T')[0]
    warnings.push(
      ar
        ? `لم يتم تحديد تاريخ للمعاملة؛ تم استخدام ${record.date} كتاريخ افتراضي. يرجى المراجعة قبل التأكيد.`
        : `No date was detected; defaulted to ${record.date}. Review before confirming.`
    )
  }

  if (type === 'sale' || type === 'purchase') {
    if (items.length === 0) {
      const recovered = recoverLumpSumAmount(raw)
      if (recovered) {
        items = [
          normalizeItem(
            {
              description: record.party
                ? `${type === 'sale' ? 'Sale to' : 'Purchase from'} ${record.party}`
                : type === 'sale'
                  ? 'Sale'
                  : 'Purchase',
              qty: 1,
              price: recovered.amount,
              discount: 0,
              category: 'standard',
            },
            0,
            [],
          ),
        ]
        record.subtype = 'lumpSum'
        warnings.push(
          `No line items were returned; rebuilt a single lump-sum line of ${recovered.amount} ${currency} from "${recovered.source}". Review the description and VAT category before confirming.`,
        )
      }
    }
    if (!record.subtype) record.subtype = items.length > 1 ? 'itemized' : 'lumpSum'
    if (!record.emirate) record.emirate = 'Dubai'
  }

  if (type === 'asset') {
    if (record.purchaseCost === undefined) {
      const recovered = recoverLumpSumAmount(raw)
      if (recovered) {
        record.purchaseCost = recovered.amount
        warnings.push(`Asset cost was missing; used "${recovered.source}" (${recovered.amount} ${currency}).`)
      }
    }
    if (record.usefulLifeYears === undefined) {
      record.usefulLifeYears = 5
      warnings.push('Useful life was missing; defaulted to 5 years (straight line).')
    }
    if (record.salvageValue === undefined) record.salvageValue = 0
  }

  if (type === 'employee') {
    if (record.allowances === undefined) record.allowances = 0
    if (!record.contractType) record.contractType = 'unlimited'
  }

  if (type === 'payment') {
    if (record.paymentType !== 'received' && record.paymentType !== 'sent') {
      record.paymentType = 'received'
      warnings.push('Payment direction was not clear; defaulted to "received". Review before confirming.')
    }
    if (!record.paymentMethod) record.paymentMethod = 'bank_transfer'
    if (record.allocations && record.allocations.length && record.amount !== undefined) {
      const allocatedTotal = round2(record.allocations.reduce((sum, a) => sum + a.amount, 0))
      if (allocatedTotal > record.amount + 0.01) {
        warnings.push(
          `Allocations total ${allocatedTotal} ${currency}, which exceeds the payment amount of ${record.amount} ${currency}. Adjust before confirming.`,
        )
      }
    }
  }

  record.items = items
  if (warnings.length) record._normalizerWarnings = warnings
  return record
}

/** Totals in the record currency. One implementation, used everywhere. */
export function computeTotals(record: Pick<NormalizedRecord, 'items'>): RecordTotals {
  let subtotal = 0
  let vat = 0
  let discount = 0
  for (const item of record.items ?? []) {
    const net = Math.max(0, item.qty * item.price - item.discount)
    subtotal += net
    discount += item.discount
    vat += item.category === 'standard' ? net * VAT_RATE : 0
  }
  return {
    subtotal: round2(subtotal),
    vat: round2(vat),
    discount: round2(discount),
    total: round2(subtotal + vat),
  }
}

/**
 * Totals expressed in AED. Foreign-currency records must carry amountInAED or
 * an exchange rate, otherwise the ledger would silently record the foreign
 * face value as if it were dirhams.
 */
export function computeTotalsInAed(record: NormalizedRecord): RecordTotals | null {
  const totals = computeTotals(record)
  if (record.currency === 'AED') return totals

  if (record.amountInAED !== undefined && record.amountInAED > 0) {
    const impliedVatRatio = totals.subtotal > 0 ? totals.vat / totals.subtotal : 0
    const vat = record.vatInAED ?? round2(record.amountInAED * impliedVatRatio)
    return {
      subtotal: round2(record.amountInAED),
      vat: round2(vat),
      discount: record.exchangeRate ? round2(totals.discount * record.exchangeRate) : 0,
      total: round2(record.amountInAED + vat),
    }
  }

  if (record.exchangeRate && record.exchangeRate > 0) {
    return {
      subtotal: round2(totals.subtotal * record.exchangeRate),
      vat: round2(totals.vat * record.exchangeRate),
      discount: round2(totals.discount * record.exchangeRate),
      total: round2(totals.total * record.exchangeRate),
    }
  }

  return null
}

/** Per-type validation. Errors block posting; warnings are surfaced in the UI. */
export function validateRecord(record: NormalizedRecord, locale: 'en' | 'ar' = 'en'): ValidationResult {
  const ar = locale === 'ar'
  const errors: string[] = []
  const warnings: string[] = [...(record._normalizerWarnings ?? [])]

  if (!record.type) {
    return { valid: false, errors: [ar ? 'نوع السجل مفقود.' : 'Record type is missing.'], warnings }
  }

  switch (record.type) {
    case 'sale':
    case 'purchase': {
      const typeLabel = ar
        ? (record.type === 'sale' ? 'المبيعات' : 'المشتريات')
        : record.type
      if (!record.items.length) {
        errors.push(
          ar
            ? `يجب أن يحتوي سجل ${typeLabel} على بند واحد على الأقل. أعاد المساعد سجلاً بدون مبلغ، لذا لا يمكن ترحيل شيء.`
            : `A ${record.type} must have at least one line item. The assistant returned a record with no amount, so nothing can be posted.`,
        )
        break
      }
      const totals = computeTotals(record)
      if (totals.total <= 0) {
        errors.push(
          ar
            ? `إجمالي ${typeLabel} هذا هو 0.00 ${record.currency}. أضف الكمية والسعر قبل التأكيد.`
            : `This ${record.type} totals 0.00 ${record.currency}. Add a quantity and price before confirming.`,
        )
      }
      if (!record.party) {
        warnings.push(
          ar
            ? `لم يتم التعرف على اسم ${record.type === 'sale' ? 'العميل' : 'المورد'}.`
            : `No ${record.type === 'sale' ? 'customer' : 'supplier'} name was detected.`,
        )
      }
      if (record.currency !== 'AED' && computeTotalsInAed(record) === null) {
        errors.push(
          ar
            ? `${typeLabel} بعملة ${record.currency} هذا بدون تحويل إلى الدرهم. سعر الصرف مطلوب قبل الترحيل إلى دفتر الأستاذ.`
            : `This ${record.currency} ${record.type} has no AED conversion. An exchange rate is required before posting to the ledger.`,
        )
      }
      if (record.type === 'sale') {
        const aedTotal = (computeTotalsInAed(record) ?? totals).total
        if (aedTotal > 10000 && !record.buyerTRN) {
          warnings.push(
            ar
              ? 'تتطلب الهيئة الاتحادية للضرائب رقم التسجيل الضريبي للمشتري على الفواتير الضريبية التي تتجاوز 10,000 درهم.'
              : 'FTA requires the buyer TRN on tax invoices above AED 10,000.',
          )
        }
      }
      break
    }
    case 'employee': {
      if (!record.name) errors.push(ar ? 'يحتاج سجل الموظف إلى اسم.' : 'An employee record needs a name.')
      const salary = (record.basicSalary ?? 0) + (record.allowances ?? 0)
      if (salary <= 0) errors.push(ar ? 'يحتاج سجل الموظف إلى راتب أساسي أكبر من 0.' : 'An employee record needs a basic salary greater than 0.')
      if (!record.hireDate) warnings.push(ar ? 'لم يتم تحديد تاريخ التعيين؛ سيبدأ استحقاق مكافأة نهاية الخدمة من اليوم.' : 'No hire date was detected; gratuity accrual will start from today.')
      break
    }
    case 'asset': {
      if (!record.assetName) errors.push(ar ? 'يحتاج سجل الأصل إلى اسم.' : 'An asset record needs a name.')
      if (!record.purchaseCost || record.purchaseCost <= 0) {
        errors.push(ar ? 'يحتاج سجل الأصل إلى تكلفة شراء أكبر من 0.' : 'An asset record needs a purchase cost greater than 0.')
      }
      if (!record.usefulLifeYears || record.usefulLifeYears <= 0) {
        errors.push(ar ? 'يحتاج سجل الأصل إلى عمر إنتاجي بالسنوات.' : 'An asset record needs a useful life in years.')
      }
      if ((record.salvageValue ?? 0) > (record.purchaseCost ?? 0)) {
        errors.push(ar ? 'لا يمكن أن تتجاوز القيمة التخريدية تكلفة الشراء.' : 'Salvage value cannot exceed the purchase cost.')
      }
      break
    }
    case 'relatedParty': {
      if (!record.party) errors.push(ar ? 'يحتاج سجل الطرف ذي الصلة إلى اسم الطرف المقابل.' : 'A related-party record needs the counterparty name.')
      if (!record.amount || record.amount <= 0) {
        errors.push(ar ? 'يحتاج سجل 
