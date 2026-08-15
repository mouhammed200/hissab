import { NextResponse } from 'next/server'
import { requireOrgAccess, WRITE_ROLES } from '@/lib/supabase/guard'
import { normalizeRecord, validateRecord, type NormalizedRecord } from '@/lib/records/normalize'

// payments.payment_type has a DB CHECK of ('received','made'). The app/chat
// layer speaks 'received'|'sent' (matches how a person actually says it —
// "sent" a payment, not "made" one) so it has to be translated at this
// boundary; post_payment_transaction() writes whatever it's given straight
// into that column with no translation of its own.
function toDbPaymentType(paymentType: NormalizedRecord['paymentType']): 'received' | 'made' {
  return paymentType === 'sent' ? 'made' : 'received'
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { orgId } = body
    const locale: 'en' | 'ar' = body.locale === 'ar' ? 'ar' : 'en'

    const guard = await requireOrgAccess(orgId, { roles: WRITE_ROLES })
    if (!guard.ok) return guard.response

    const key = req.headers.get('idempotency-key') || body.requestKey
    if (!key) return NextResponse.json({ error: 'Missing Idempotency-Key' }, { status: 400 })

    if (!body.record?.type) {
      return NextResponse.json({ error: 'Missing record' }, { status: 400 })
    }

    // Re-normalize server-side, same as /api/records/confirm. The client
    // payload is never trusted — this is what actually catches a payment
    // with no bank account or an allocation total over the payment amount
    // before it reaches the database.
    const record = normalizeRecord(body.record)
    if (record.type !== 'payment') {
      return NextResponse.json({ error: 'Not a payment record' }, { status: 400 })
    }
    const validation = validateRecord(record, locale)
    if (!validation.valid) {
      return NextResponse.json(
        {
          error: validation.errors[0],
          errors: validation.errors,
          warnings: validation.warnings,
          code: 'RECORD_INVALID',
        },
        { status: 422 },
      )
    }

    const payment = {
      party: record.party,
      amount: record.amount,
      currency: record.currency,
      exchange_rate: record.exchangeRate,
      payment_date: record.date,
      payment_type: toDbPaymentType(record.paymentType),
      payment_method: record.paymentMethod || 'bank_transfer',
      bank_account_name: record.bankAccountName,
    }
    const allocations = (record.allocations ?? []).map((a) => ({
      invoice_number: a.invoiceNumber,
      amount: a.amount,
    }))

    const { data, error } = await guard.supabase.rpc('post_payment_transaction', {
      p_request: { org_id: orgId, request_key: key, payment, allocations },
    })
    if (error) throw error

    const result = (data ?? {}) as Record<string, unknown>
    return NextResponse.json({ ...result, warnings: validation.warnings })
  } catch (error: unknown) {
    // Supabase's rpc() throws a plain PostgrestError object, not an Error
    // instance — mirrors the same fix already applied in
    // /api/records/confirm/route.ts, so a payment RPC failure (e.g. "No
    // matching bank account named ...") reaches the client instead of a
    // generic 'Atomic payment failed'.
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message: unknown }).message)
          : 'Atomic payment failed'
    const details =
      typeof error === 'object' && error !== null && 'details' in error
        ? String((error as { details: unknown }).details)
        : undefined
    const hint =
      typeof error === 'object' && error !== null && 'hint' in error
        ? String((error as { hint: unknown }).hint)
        : undefined
    console.error('[payments] posting failed:', message, { details, hint })
    return NextResponse.json({ error: message, details, hint }, { status: 500 })
  }
}

// Payment history had no read path — POST-only meant Reports/RecordsTab
// could never list payments once posted (9.10/9.11 depend on this).
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const orgId = searchParams.get('orgId')
    const limit = Math.min(Number(searchParams.get('limit')) || 100, 500)

    // No roles restriction: any org member may read payment history, same
    // as /api/reports (which exposes the full general ledger to any member).
    const guard = await requireOrgAccess(orgId)
    if (!guard.ok) return guard.response

    const { data, error } = await guard.supabase
      .from('payments')
      .select(
        // NOTE: payments.bank_account_id references accounts(id) — the
        // resolved ledger account — not bank_accounts(id). The RPC
        // (017_payment_transaction_name_resolution.sql) stores the ledger
        // account id there, matching the FK. Embed accounts, not
        // bank_accounts, or PostgREST has no relationship to embed on.
        'id, payment_number, payment_type, payment_date, amount, amount_aed, currency, payment_method, reference_number, journal_entry_id, contact:contacts(id, name), ledger_account:accounts(id, code, name)',
      )
      .eq('org_id', orgId)
      .order('payment_date', { ascending: false })
      .limit(limit)

    if (error) throw error
    return NextResponse.json({ payments: data ?? [] })
  } catch (error) {
    const message = (error as { message?: string })?.message || 'Failed to load payments'
    console.error('payments GET failed', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
