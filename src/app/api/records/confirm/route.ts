import { NextResponse } from 'next/server'
import { requireOrgAccess, WRITE_ROLES } from '@/lib/supabase/guard'
import {
} from '@/lib/accounting/journal'
import {
  normalizeRecord,
  validateRecord,
  type NormalizedRecord,
} from '@/lib/records/normalize'
import { buildTransactionContract } from '@/lib/accounting/transaction-contract'

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

    // Re-normalize server-side. The client payload is never trusted, and this
    // guarantees the posted record is shaped exactly like the reviewed one.
    const record = normalizeRecord(body.record)
    const validation = validateRecord(record, locale)

    if (!validation.valid) {
      // Hard stop. Previously a record with no items fell through to
      // `record.amount || record.purchaseCost`, produced a 0.00 total, and the
      // database rejected it with an opaque "Unbalanced journal" error.
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

    // Phase 02 authority: derive source totals, AED facts, VAT category, and
    // journal lines from one typed contract. The client cannot provide any of
    // these accounting decisions.
    let contract
    try {
      contract = buildTransactionContract(record)
    } catch (contractError) {
      const message = contractError instanceof Error ? contractError.message : 'Transaction facts are invalid'
      return NextResponse.json({ error: message, code: 'TRANSACTION_CONTRACT_INVALID' }, { status: 422 })
    }

    const { facts, journalLines: lines } = contract
    const totals = facts.source
    const aedTotals = facts.monetary.aed

    const { data, error } = await guard.supabase.rpc('post_record_transaction', {
      p_request: {
        org_id: orgId,
        request_key: key,
        record,
        totals,
        totals_aed: aedTotals,
        journal_lines: lines,
      },
    })
    if (error) throw error

    const result = (data ?? {}) as Record<string, unknown>
    return NextResponse.json({ ...result, warnings: validation.warnings })
  } catch (error: unknown) {
    // Supabase's rpc() throws a plain PostgrestError object, not an Error
    // instance, so `error instanceof Error` was always false here and the
    // real database message never reached the logs or the client — every
    // posting failure surfaced as the generic "Atomic posting failed".
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message: unknown }).message)
          : 'Atomic posting failed'
    const details =
      typeof error === 'object' && error !== null && 'details' in error
        ? String((error as { details: unknown }).details)
        : undefined
    const hint =
      typeof error === 'object' && error !== null && 'hint' in error
        ? String((error as { hint: unknown }).hint)
        : undefined
    console.error('[confirm] posting failed:', message, { details, hint })
    return NextResponse.json({ error: message, details, hint }, { status: 500 })
  }
}
