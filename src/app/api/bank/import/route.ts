import { NextRequest, NextResponse } from 'next/server'
import { requireOrgAccess, WRITE_ROLES } from '@/lib/supabase/guard'

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

/** Handles quoted CSV fields containing commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ } else { inQuotes = !inQuotes }
    } else if (char === ',' && !inQuotes) {
      out.push(current); current = ''
    } else {
      current += char
    }
  }
  out.push(current)
  return out.map((c) => c.trim())
}

function normalizeDate(raw: string): string | null {
  if (!raw) return null
  const cleaned = raw.replace(/"/g, '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned
  // DD/MM/YYYY and DD-MM-YYYY are the common UAE bank statement formats
  const m = cleaned.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (m) {
    const [, d, mo, y] = m
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const parsed = new Date(cleaned)
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0]
  return null
}

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const orgId = formData.get('orgId') as string | null
  const bankAccountId = (formData.get('bankAccountId') as string | null) || null

  // SECURITY: membership check — this writes rows into another org's bank ledger.
  const guard = await requireOrgAccess(orgId, { roles: WRITE_ROLES })
  if (!guard.ok) return guard.response
  const { supabase } = guard

  if (!file) {
    return NextResponse.json({ error: 'Missing required field (file)' }, { status: 400 })
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'File too large (max 5 MB)' }, { status: 413 })
  }

  // bank_transactions.bank_account_id is NOT NULL. When the caller does not
  // specify one, fall back to the org's only/first active bank account.
  let resolvedBankAccountId = bankAccountId

  if (resolvedBankAccountId) {
    // Confirm the account belongs to THIS org, not just to any org.
    const { data: bankAccount } = await supabase
      .from('bank_accounts')
      .select('id')
      .eq('id', resolvedBankAccountId)
      .eq('org_id', orgId)
      .maybeSingle()

    if (!bankAccount) {
      return NextResponse.json({ error: 'Bank account not found in this organization' }, { status: 404 })
    }
  } else {
    const { data: defaultAccount } = await supabase
      .from('bank_accounts')
      .select('id')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (!defaultAccount) {
      return NextResponse.json(
        { error: 'No bank account found. Create a bank account before importing a statement.' },
        { status: 400 }
      )
    }
    resolvedBankAccountId = defaultAccount.id
  }

  const text = await file.text()
  const lines = text.split(/\r?\n/).filter((l) => l.trim())

  if (lines.length < 2) {
    return NextResponse.json({ error: 'CSV has no data rows' }, { status: 400 })
  }

  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase())
  const dateIdx = headers.findIndex((h) => h.includes('date'))
  const descIdx = headers.findIndex((h) => h.includes('desc') || h.includes('narrative') || h.includes('detail'))
  const amountIdx = headers.findIndex((h) => h.includes('amount') || h.includes('value'))
  const refIdx = headers.findIndex((h) => h.includes('ref'))
  const debitIdx = headers.findIndex((h) => h.includes('debit') || h.includes('withdrawal'))
  const creditIdx = headers.findIndex((h) => h.includes('credit') || h.includes('deposit'))

  const transactions = []
  const rejected: Array<{ row: number; reason: string }> = []

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i])
    const transactionDate = normalizeDate(cols[dateIdx >= 0 ? dateIdx : 0] || '')
    const description = (cols[descIdx >= 0 ? descIdx : 1] || '').replace(/"/g, '')

    let amount = NaN
    if (amountIdx >= 0) {
      amount = parseFloat((cols[amountIdx] || '').replace(/[,"]/g, ''))
    } else if (debitIdx >= 0 || creditIdx >= 0) {
      const debit = parseFloat((cols[debitIdx] || '0').replace(/[,"]/g, '')) || 0
      const credit = parseFloat((cols[creditIdx] || '0').replace(/[,"]/g, '')) || 0
      amount = credit - debit
    } else {
      amount = parseFloat((cols[2] || '').replace(/[,"]/g, ''))
    }

    if (!transactionDate) { rejected.push({ row: i + 1, reason: 'Unrecognised date' }); continue }
    if (!description) { rejected.push({ row: i + 1, reason: 'Missing description' }); continue }
    if (!Number.isFinite(amount)) { rejected.push({ row: i + 1, reason: 'Invalid amount' }); continue }

    transactions.push({
      org_id: orgId,
      bank_account_id: resolvedBankAccountId,
      transaction_date: transactionDate,
      description,
      amount,
      reference_number: refIdx >= 0 ? (cols[refIdx] || null) : null,
      reconciliation_status: 'unmatched' as const,
    })
  }

  if (transactions.length === 0) {
    return NextResponse.json({ error: 'No valid transactions found in CSV', rejected }, { status: 400 })
  }

  const { data, error } = await supabase.from('bank_transactions').insert(transactions).select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, imported: data?.length || 0, rejected })
}
