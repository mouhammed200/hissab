import { NextResponse } from 'next/server'
import { requireOrgAccess, WRITE_ROLES } from '@/lib/supabase/guard'
import {
  buildSaleJournalLines,
  buildPurchaseJournalLines,
  buildSalaryLines,
  buildAssetPurchaseLines,
  type JournalLineInput,
} from '@/lib/accounting/journal'
import {
  normalizeRecord,
  validateRecord,
  computeTotals,
  computeTotalsInAed,
  type NormalizedRecord,
  type RecordTotals,
} from '@/lib/records/normalize'

/**
 * Builds the journal for a record. Amounts are always AED: the ledger is a
 * single-currency ledger, so a foreign-currency invoice posts its converted
 * value and the original currency is retained on the invoice row.
 */
function journalLines(record: NormalizedRecord, aedTotals: RecordTotals): JournalLineInput[] {
  const description = record.party ? `${record.type}: ${record.party}` : undefined

  if (record.type === 'sale') {
    const category = record.items.some((item) => item.category === 'standard')
      ? 'standard'
      : record.items.some((item) => item.category === 'exempt')
        ? 'exempt'
        : 'zero'
    return buildSaleJournalLines(aedTotals.subtotal, aedTotals.vat, category, description)
  }

  if (record.type === 'purchase') {
    return buildPurchaseJournalLines(
      aedTotals.subtotal,
      aedTotals.vat,
      Boolean(record.reverseCharge),
      description,
    )
  }

  if (record.type === 'employee') {
    return buildSalaryLines(
      (record.basicSalary ?? 0) + (record.allowances ?? 0),
      `Salary: ${record.name ?? 'Employee'}`,
    )
  }

  if (record.type === 'asset') {
    // Acquisition only: DR Fixed Assets / CR Bank.
    //
    // Depreciation is NOT posted here. The previous implementation appended a
    // full month of depreciation (DR 6400 / CR 1510) to the acquisition entry,
    // which understated net book value from day one and double-counted the
    // first period once the monthly run caught up. Periodic depreciation is
    // owned by the scheduled run against the depreciation_schedules table.
    return buildAssetPurchaseLines(record.purchaseCost ?? 0, true, `Asset: ${record.assetName ?? 'Asset'}`)
  }

  // relatedParty records are registered for disclosure purposes and carry no
  // journal of their own; the underlying sale/purchase/loan is posted separately.
  return []
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { orgId } = body

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
    const validation = validateRecord(record)

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

    const totals = computeTotals(record)
    const aedTotals = computeTotalsInAed(record)

    if (aedTotals === null) {
      return NextResponse.json(
        {
          error: `No AED conversion available for this ${record.currency} record. Set an exchange rate before posting.`,
          code: 'FX_REQUIRED',
        },
        { status: 422 },
      )
    }

    const lines = journalLines(record, aedTotals)

    // Balance is asserted before the round trip so the user gets a readable
    // message instead of a Postgres exception surfaced as a 500.
    if (lines.length) {
      const debit = lines.reduce((sum, line) => sum + line.debit, 0)
      const credit = lines.reduce((sum, line) => sum + line.credit, 0)
      if (debit <= 0 || Math.abs(debit - credit) > 0.005) {
        return NextResponse.json(
          {
            error: `This ${record.type} does not produce a balanced journal entry (debit ${debit.toFixed(2)} vs credit ${credit.toFixed(2)}). Check the amounts and try again.`,
            code: 'UNBALANCED',
          },
          { status: 422 },
        )
      }
    }

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
    const message = error instanceof Error ? error.message : 'Atomic posting failed'
    console.error('[confirm] posting failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
