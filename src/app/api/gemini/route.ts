import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseTransaction } from '@/lib/gemini/client'
import { convertForeignInvoiceToAed } from '@/lib/accounting/fx'
import { normalizeRecord, validateRecord, computeTotals } from '@/lib/records/normalize'

const requestWindows = new Map<string, { startedAt: number; count: number }>()
const MAX_REQUESTS_PER_MINUTE = 20
const MAX_MESSAGE_CHARS = 20_000

export async function POST(request: NextRequest) {
  // 1. Authenticate
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    if (typeof body.message !== 'string' || body.message.length > MAX_MESSAGE_CHARS) {
      return NextResponse.json({ error: 'Message is missing or too large' }, { status: 413 })
    }
    const { message, orgId, chatHistory, fileData } = body as {
      message: string
      orgId: string
      chatHistory?: Array<{ role: 'user' | 'model'; content: string }>
      fileData?: { mimeType: string; data: string }
    }

    if (!message || !orgId) {
      return NextResponse.json({ error: 'Missing message or orgId' }, { status: 400 })
    }

    const throttleKey = `${user.id}:${body.orgId}`
    const now = Date.now()
    const window = requestWindows.get(throttleKey)
    if (!window || now - window.startedAt >= 60_000) requestWindows.set(throttleKey, { startedAt: now, count: 1 })
    else if (window.count >= MAX_REQUESTS_PER_MINUTE) return NextResponse.json({ error: 'Rate limit exceeded. Try again shortly.' }, { status: 429 })
    else window.count += 1

    // 2. Verify user has access to this org
    const { data: membership } = await supabase
      .from('org_members')
      .select('role')
      .eq('org_id', orgId)
      .eq('user_id', user.id)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'No access to this organization' }, { status: 403 })
    }

    // 3. Fetch context data for queries (summary stats)
    const { data: orgData } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .single()

    // 4. Call Gemini. Reject oversized inline uploads before sending them upstream.
    if (fileData && (!fileData.mimeType || !fileData.data || fileData.data.length > 8_000_000)) {
      return NextResponse.json({ error: 'Attachment is missing or too large (max 6 MB)' }, { status: 413 })
    }
    const result = await parseTransaction({
      userMessage: message,
      contextData: {
        organization: orgData,
        userRole: membership.role,
      },
      chatHistory,
      fileData,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    // 5. Normalize before anything else touches the payload. This flattens
    //    nested detail objects, coerces numbers, rebuilds a lump-sum line when
    //    the model returned a sale/purchase with no items, and re-derives every
    //    line total. Replaces the old items-only arithmetic pass, which left
    //    every other record type unvalidated.
    const rawData = result.data ?? {}
    const record = normalizeRecord(rawData)

    // 6. Foreign currency CBUAE enrichment, computed from normalized items so a
    //    lump-sum record converts exactly like an itemized one.
    if (record.currency !== 'AED') {
      const totals = computeTotals(record)
      const subtotalForeign = totals.subtotal > 0 ? totals.subtotal : (record.amount ?? 0)

      if (subtotalForeign > 0) {
        try {
          const hasStandardRated = record.items.some((item) => item.category === 'standard')
          const fxResult = await convertForeignInvoiceToAed(
            subtotalForeign,
            record.currency,
            hasStandardRated ? 'standard' : 'zero',
            record.date,
          )
          record.exchangeRate = fxResult.exchangeRate
          record.amountInAED = fxResult.amountInAed
          record.vatInAED = fxResult.vatInAed
          record.notes = record.notes ? `${record.notes} | ${fxResult.ftaCompliantNote}` : fxResult.ftaCompliantNote
        } catch (fxError) {
          // No rate is a blocking problem for the ledger, not a silent one.
          // validateRecord turns the missing conversion into a hard error.
          console.error('[gemini] FX conversion failed:', fxError)
        }
      }
    }

    // 7. Validate per record type. Errors block confirmation in the UI;
    //    warnings are shown on the card so the user can correct before posting.
    const validation = validateRecord(record)

    const textResponse =
      record.queryResponse || (rawData.explanation as string | undefined) || record.notes || ''

    // 8. Save conversation to DB
    await supabase.from('ai_conversations').insert([
      { org_id: orgId, user_id: user.id, role: 'user', content: message },
      { org_id: orgId, user_id: user.id, role: 'assistant', content: JSON.stringify(record) },
    ])

    return NextResponse.json({
      success: true,
      data: record,
      totals: computeTotals(record),
      validation,
      text: textResponse,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
