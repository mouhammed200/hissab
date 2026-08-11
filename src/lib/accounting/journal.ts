import type { Account, VatCategory, Emirate } from '@/types/database'

export interface JournalLineInput {
  account_code: string
  debit: number
  credit: number
  description?: string
  vat_category?: VatCategory
  vat_rate?: number
  vat_amount?: number
  contact_id?: string
}

export interface CreateJournalInput {
  org_id: string
  date: string
  description: string
  source_type: string
  source_id: string
  lines: JournalLineInput[]
  created_by: string
}

export function buildSaleJournalLines(
  subtotal: number,
  vatAmount: number,
  vatCategory: VatCategory,
  description?: string,
  contactId?: string
): JournalLineInput[] {
  const lines: JournalLineInput[] = []
  const total = subtotal + vatAmount

  // DR 1100 A/R = total
  lines.push({
    account_code: '1100',
    debit: total,
    credit: 0,
    description,
    contact_id: contactId
  })

  if (vatCategory === 'standard') {
    // CR 4000 Revenue = subtotal
    lines.push({
      account_code: '4000',
      debit: 0,
      credit: subtotal,
      description,
      vat_category: vatCategory,
      vat_amount: vatAmount
    })
    // CR 2100 Output VAT = VAT amount
    lines.push({
      account_code: '2100',
      debit: 0,
      credit: vatAmount,
      description: 'Output VAT'
    })
  } else if (vatCategory === 'zero') {
    // CR 4100 Revenue (Zero) = subtotal
    lines.push({
      account_code: '4100',
      debit: 0,
      credit: subtotal,
      description,
      vat_category: vatCategory
    })
  } else if (vatCategory === 'exempt') {
    // CR 4200 Revenue (Exempt) = subtotal
    lines.push({
      account_code: '4200',
      debit: 0,
      credit: subtotal,
      description,
      vat_category: vatCategory
    })
  } else {
    // Out-of-scope/unknown categories cannot silently drop VAT. Preserve the
    // double entry and make the VAT treatment explicit as standard when a VAT
    // amount was actually supplied.
    lines.push({
      account_code: '4000',
      debit: 0,
      credit: subtotal,
      description,
      vat_category: vatCategory,
      vat_amount: 0,
    })
    if (vatAmount > 0) {
      lines.push({
        account_code: '2100',
        debit: 0,
        credit: vatAmount,
        description: 'Output VAT (uncategorized input normalized)',
        vat_category: 'standard',
        vat_rate: 0.05,
        vat_amount: vatAmount,
      })
    }
  }

  return lines
}

export function buildPurchaseJournalLines(
  subtotal: number,
  vatAmount: number,
  isReverseCharge: boolean,
  description?: string,
  contactId?: string
): JournalLineInput[] {
  const lines: JournalLineInput[] = []

  if (isReverseCharge) {
    // DR 5000 COGS = subtotal
    lines.push({
      account_code: '5000',
      debit: subtotal,
      credit: 0,
      description
    })
    // DR 1400 Input VAT = VAT amount
    lines.push({
      account_code: '1400',
      debit: vatAmount,
      credit: 0,
      description: 'Input VAT (Reverse Charge)',
      vat_category: 'standard',
      vat_rate: 0.05,
      vat_amount: vatAmount
    })
    // CR 2010 A/P = subtotal
    lines.push({
      account_code: '2010',
      debit: 0,
      credit: subtotal,
      description,
      contact_id: contactId
    })
    // CR 2100 Output VAT = VAT amount
    lines.push({
      account_code: '2100',
      debit: 0,
      credit: vatAmount,
      description: 'Output VAT (Reverse Charge)',
      vat_category: 'standard',
      vat_rate: 0.05,
      vat_amount: vatAmount
    })
  } else {
    // DR 5000 COGS = subtotal
    lines.push({
      account_code: '5000',
      debit: subtotal,
      credit: 0,
      description
    })
    // DR 1400 Input VAT = VAT amount
    if (vatAmount > 0) {
      lines.push({
        account_code: '1400',
        debit: vatAmount,
        credit: 0,
        description: 'Input VAT',
        vat_category: 'standard',
        vat_rate: 0.05,
        vat_amount: vatAmount
      })
    }
    // CR 2010 A/P = total
    lines.push({
      account_code: '2010',
      debit: 0,
      credit: subtotal + vatAmount,
      description,
      contact_id: contactId
    })
  }

  return lines
}

export function buildPaymentReceivedLines(
  amount: number,
  description?: string,
  contactId?: string
): JournalLineInput[] {
  return [
    {
      account_code: '1020',
      debit: amount,
      credit: 0,
      description
    },
    {
      account_code: '1100',
      debit: 0,
      credit: amount,
      description,
      contact_id: contactId
    }
  ]
}

export function buildPaymentMadeLines(
  amount: number,
  description?: string,
  contactId?: string
): JournalLineInput[] {
  return [
    {
      account_code: '2010',
      debit: amount,
      credit: 0,
      description,
      contact_id: contactId
    },
    {
      account_code: '1020',
      debit: 0,
      credit: amount,
      description
    }
  ]
}

export function buildSalaryLines(
  totalSalary: number,
  description?: string
): JournalLineInput[] {
  return [
    {
      account_code: '6000',
      debit: totalSalary,
      credit: 0,
      description: description || 'Salaries Expense'
    },
    {
      account_code: '1020',
      debit: 0,
      credit: totalSalary,
      description: description || 'Salaries Payment'
    }
  ]
}

export function buildGratuityAccrualLines(
  monthlyAccrual: number,
  description?: string
): JournalLineInput[] {
  return [
    {
      account_code: '6100',
      debit: monthlyAccrual,
      credit: 0,
      description: description || 'Gratuity Expense Accrual'
    },
    {
      account_code: '2300',
      debit: 0,
      credit: monthlyAccrual,
      description: description || 'EOSB Provision'
    }
  ]
}

export function buildDepreciationLines(
  monthlyAmount: number,
  description?: string
): JournalLineInput[] {
  return [
    {
      account_code: '6400',
      debit: monthlyAmount,
      credit: 0,
      description: description || 'Depreciation Expense'
    },
    {
      account_code: '1510',
      debit: 0,
      credit: monthlyAmount,
      description: description || 'Accumulated Depreciation'
    }
  ]
}

export function buildAssetPurchaseLines(
  cost: number,
  paidFromBank: boolean,
  description?: string,
  contactId?: string
): JournalLineInput[] {
  return [
    {
      account_code: '1500',
      debit: cost,
      credit: 0,
      description: description || 'Asset Purchase'
    },
    {
      account_code: paidFromBank ? '1020' : '2010',
      debit: 0,
      credit: cost,
      description: description || 'Asset Purchase Payment',
      contact_id: !paidFromBank ? contactId : undefined
    }
  ]
}
