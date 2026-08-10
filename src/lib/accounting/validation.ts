export function validateTRN(trn: string): { valid: boolean; error?: string } {
  // TRN must be exactly 15 digits, starting with 1
  if (!trn) return { valid: false, error: 'TRN is required' }
  const cleaned = trn.replace(/\s/g, '')
  if (!/^\d{15}$/.test(cleaned)) return { valid: false, error: 'TRN must be exactly 15 digits' }
  if (!cleaned.startsWith('1')) return { valid: false, error: 'TRN must start with 1' }
  return { valid: true }
}

export function validateIBAN(iban: string): { valid: boolean; error?: string } {
  // UAE IBAN: AE + 2 check digits + 3 bank code + 16 account = 23 chars
  if (!iban) return { valid: false, error: 'IBAN is required' }
  const cleaned = iban.replace(/\s/g, '').toUpperCase()
  if (!/^AE\d{21}$/.test(cleaned)) return { valid: false, error: 'UAE IBAN must be AE followed by 21 digits (23 chars total)' }
  return { valid: true }
}

export function verifyArithmetic(items: Array<{ qty: number; price: number; discount: number }>): {
  valid: boolean
  corrections: Array<{ index: number; expected: number; got: number }>
} {
  // Post-AI safety net: verify qty * price - discount = lineTotal
  const corrections: Array<{ index: number; expected: number; got: number }> = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const expected = item.qty * item.price - item.discount
    // Check if the item has a lineTotal property and it doesn't match
    const got = (item as any).lineTotal ?? expected
    if (Math.abs(expected - got) > 0.01) {
      corrections.push({ index: i, expected, got })
    }
  }
  return { valid: corrections.length === 0, corrections }
}

export function detectDuplicate(existing: Array<{ party: string; amount: number; date: string }>, newRecord: { party: string; amount: number; date: string }): boolean {
  // Same party + same amount + date within 1 day
  const newDate = new Date(newRecord.date).getTime()
  return existing.some(e => {
    const existingDate = new Date(e.date).getTime()
    const dayDiff = Math.abs(newDate - existingDate) / (1000 * 60 * 60 * 24)
    return e.party.toLowerCase() === newRecord.party.toLowerCase() && Math.abs(e.amount - newRecord.amount) < 0.01 && dayDiff <= 1
  })
}
