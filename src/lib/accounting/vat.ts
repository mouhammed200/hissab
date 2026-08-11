import type { Emirate, VatCategory } from '@/types/database'

const VAT_RATE = 0.05

export interface VatLineItem {
  subtotal: number
  vatCategory: VatCategory
  emirate: Emirate
  isReverseCharge?: boolean
  isImport?: boolean
}

/**
 * Real FTA VAT 201 form box structure:
 * Box 1  — Standard-rated domestic supplies (amount)
 * Box 1a — Standard-rated domestic VAT
 * Box 2  — Supplies subject to domestic reverse charge (amount)
 * Box 2a — Domestic reverse charge VAT
 * Box 3  — Zero-rated domestic supplies
 * Box 4  — Exempt supplies
 * Box 5  — Goods imported into UAE (Customs declaration)
 * Box 5a — VAT on imports (if paid at customs)
 * Box 6  — Adjustments to goods imports
 * Box 7  — Output VAT on supplies in boxes 1, 2, 6
 * Box 8  — Input VAT recoverable on expenses/purchases
 * Box 9  — Input VAT recoverable — imports (box 5a)
 * Box 10 — Input VAT recoverable — imports (reverse charge, box 2a)
 * Box 11 — Blocked input VAT
 * Box 12 — Net VAT due (Box 7 − (8+9+10−11))
 */
export interface VatReturn201 {
  box1Amount: number    // Standard-rated domestic supplies
  box1aVat: number      // VAT on box 1
  box2Amount: number    // Domestic reverse charge supplies
  box2aVat: number      // VAT on box 2
  box3Amount: number    // Zero-rated domestic supplies
  box4Amount: number    // Exempt supplies
  box5Amount: number    // Goods imported (customs)
  box5aVat: number      // VAT paid at customs on imports
  box6Adjustment: number // Adjustments on goods imports
  box7TotalOutputVat: number  // Sum of all output VAT
  box8InputVatExpenses: number // Input VAT on purchases/expenses
  box9InputVatImports: number  // Input VAT on imports (customs)
  box10InputVatReverseCharge: number // Input VAT via reverse charge
  box11BlockedInputVat: number       // Non-deductible input VAT
  box12NetVatDue: number  // Positive = payable; negative = refund
  isRefund: boolean
}

/** Legacy boxes object — kept for backward compat with existing UI */
export interface VatBoxes {
  [key: string]: { amount: number; vat: number }
}

export function calculateVAT(amount: number, category: VatCategory): { net: number, vat: number, total: number } {
  const vat = category === 'standard' ? amount * VAT_RATE : 0
  return { net: amount, vat, total: amount + vat }
}

/**
 * Maps line items to the correct FTA VAT 201 boxes.
 * Previously this mapped emirates to boxes 1-7 (WRONG).
 * The real FTA 201 form uses supply TYPE, not emirate, for box allocation.
 */
export function buildVatReturn201(
  salesItems: VatLineItem[],
  purchaseItems: VatLineItem[],
  blockedInputVat = 0,
  importVatPaidAtCustoms = 0,
): VatReturn201 {
  let box1Amount = 0, box1aVat = 0
  let box2Amount = 0, box2aVat = 0
  let box3Amount = 0
  let box4Amount = 0

  // Process output (sales)
  for (const item of salesItems) {
    if (item.isReverseCharge) {
      // Domestic reverse charge
      box2Amount += item.subtotal
      box2aVat  += item.subtotal * VAT_RATE
    } else if (item.vatCategory === 'standard') {
      box1Amount += item.subtotal
      box1aVat   += item.subtotal * VAT_RATE
    } else if (item.vatCategory === 'zero') {
      box3Amount += item.subtotal
    } else if (item.vatCategory === 'exempt') {
      box4Amount += item.subtotal
    }
  }

  const box7TotalOutputVat = box1aVat + box2aVat

  // Process input (purchases). Imports must not be reported as ordinary
  // domestic expenses: their taxable value belongs in Box 5 and recoverable
  // import VAT belongs in Box 9 (or Box 10 for reverse-charge imports).
  let box5Amount = 0
  let box8InputVatExpenses = 0
  let box10InputVatReverseCharge = 0

  for (const item of purchaseItems) {
    if (item.isImport) {
      box5Amount += item.subtotal
      if (item.isReverseCharge) {
        box10InputVatReverseCharge += item.subtotal * VAT_RATE
      }
      continue
    }
    if (item.isReverseCharge) {
      box10InputVatReverseCharge += item.subtotal * VAT_RATE
    } else if (item.vatCategory === 'standard') {
      box8InputVatExpenses += item.subtotal * VAT_RATE
    }
    // zero/exempt purchases have no recoverable input VAT
  }

  const box9InputVatImports = importVatPaidAtCustoms
  const totalInputVat = box8InputVatExpenses + box9InputVatImports + box10InputVatReverseCharge - blockedInputVat
  const box12NetVatDue = box7TotalOutputVat - totalInputVat

  return {
    box1Amount, box1aVat,
    box2Amount, box2aVat,
    box3Amount, box4Amount,
    box5Amount, box5aVat: box9InputVatImports,
    box6Adjustment: 0,
    box7TotalOutputVat,
    box8InputVatExpenses,
    box9InputVatImports,
    box10InputVatReverseCharge,
    box11BlockedInputVat: blockedInputVat,
    box12NetVatDue,
    isRefund: box12NetVatDue < 0,
  }
}

/** @deprecated Use buildVatReturn201() instead. Kept for legacy UI compatibility. */
export function mapToVatBoxes(items: VatLineItem[]): VatBoxes {
  const boxes: VatBoxes = {}
  for (let i = 1; i <= 12; i++) {
    boxes[i.toString()] = { amount: 0, vat: 0 }
  }
  for (const item of items) {
    if (item.isReverseCharge) {
      boxes['2'].amount += item.subtotal
      boxes['2'].vat    += item.subtotal * VAT_RATE
    } else if (item.vatCategory === 'standard') {
      boxes['1'].amount += item.subtotal
      boxes['1'].vat    += item.subtotal * VAT_RATE
    } else if (item.vatCategory === 'zero') {
      boxes['3'].amount += item.subtotal
    } else if (item.vatCategory === 'exempt') {
      boxes['4'].amount += item.subtotal
    }
  }
  // Box 7 = total output VAT
  boxes['7'].vat = boxes['1'].vat + boxes['2'].vat
  return boxes
}

export function calculateNetVAT(outputVAT: number, inputVAT: number): { netPayable: number, isRefund: boolean } {
  const diff = outputVAT - inputVAT
  return { netPayable: Math.abs(diff), isRefund: diff < 0 }
}

export function getVATThresholdStatus(revenue12Months: number): {
  status: 'below' | 'voluntary' | 'mandatory'
  threshold: number
} {
  const MANDATORY_THRESHOLD = 375_000
  const VOLUNTARY_THRESHOLD = 187_500
  if (revenue12Months >= MANDATORY_THRESHOLD) return { status: 'mandatory', threshold: MANDATORY_THRESHOLD }
  if (revenue12Months >= VOLUNTARY_THRESHOLD) return { status: 'voluntary', threshold: VOLUNTARY_THRESHOLD }
  return { status: 'below', threshold: VOLUNTARY_THRESHOLD }
}

/** Compute next VAT filing deadline (28 days after period end) */
export function getNextVatDeadline(periodEndDate: Date): Date {
  const deadline = new Date(periodEndDate)
  deadline.setDate(deadline.getDate() + 28)
  // UAE weekend is Saturday/Sunday. Move a deadline landing on either
  // non-working day to Monday, not Sunday.
  const day = deadline.getDay()
  if (day === 6) deadline.setDate(deadline.getDate() + 2) // Saturday → Monday
  if (day === 0) deadline.setDate(deadline.getDate() + 1) // Sunday → Monday
  return deadline
}
