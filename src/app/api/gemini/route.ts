import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseTransaction } from '@/lib/gemini/client'
import { convertForeignInvoiceToAed } from '@/lib/accounting/fx'
import { normalizeRecord, validateRecord, computeTotals, hasItemizedTotals } from '@/lib/records/normalize'
import { consumeSharedRateLimit, safeRequestId } from '@/lib/ops/rate-limit'

// Route handlers are dynamic by default, but Netlify's edge/durable cache
// layer (@netlify/plugin-nextjs) was observed caching or coalescing POST
// responses to this route even with force-dynamic set — that Next.js signal
// alone isn't enough to stop Netlify's own edge cache. An explicit
// Cache-Control: no-store on every response is what Netlify's edge actually
// honors, so every NextResponse.json call below goes through this wrapper.
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

function json(body: unknown, init?: ResponseInit) {
  const res = NextResponse.json(body, init)
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  res.headers.set('Netlify-CDN-Cache-Control', 'no-store')
  return res
}

const MAX_MESSAGE_CHARS = 20_000

export async function POST(request: NextRequest) {
  // 1. Authenticate
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const requestId = safeRequestId(request)
    const limited = await consumeSharedRateLimit(supabase, `${user.id}:${request.headers.get('x-forwarded-for') || 'unknown'}`, 20)
    if (!limited.allowed) return json({ error: 'Rate limit exceeded. Try again shortly.', requestId }, { status: 429 })
    const body = await request.json()
    if (typeof body.message !== 'string' || body.message.length > MAX_MESSAGE_CHARS) {
      return json({ error: 'Message is missing or too large' }, { status: 413 })
    }
    const { message, orgId, chatHistory, fileData, locale } = body as {
      message: string
      orgId: string
      chatHistory?: Array<{ role: 'user' | 'model'; content: string }>
      fileData?: { mimeType: string; data: string }
      locale?: 'en' | 'ar'
    }

    if (!message || !orgId) {
      return json({ error: 'Missing message or orgId' }, { status: 400 })
    }


    // 2. Verify user has access to this org
    const { data: membership } = await supabase
      .from('org_members')
      .select('role')
      .eq('org_id', orgId)
      .eq('user_id', user.id)
      .single()

    if (!membership) {
      return json({ error: 'No access to this organization' }, { status: 403 })
    }

    // 3. Fetch context data for queries (summary stats)
    const { data: orgData } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .single()

    // 4. Call Gemini. Reject oversized inline uploads before sending them upstream.
    if (fileData && (!fileData.mimeType || !fileData.data || fileData.data.length > 8_000_000)) {
      return json({ error: 'Attachment is missing or too large (max 6 MB)' }, { status: 413 })
    }
    const result = await parseTransaction({
      userMessage: message,
      contextData: {
        organization: orgData,
        userRole: membership.role,
      },
      chatHistory,
      fileData,
      locale: locale === 'ar' ? 'ar' : 'en',
    })

    if (!result.success) {
      return json({ error: result.error }, { status: 500 })
    }

    // 5. Normalize before anything else touches the payload. This flattens
    //    nested detail objects, coerces numbers, rebuilds a lump-sum line when
    //    the model returned a sale/purchase with no items, and re-derives every
    //    line total. Replaces the old items-only arithmetic pass, which left
    //    every other record type unvalidated.
    const rawData = result.data ?? {}
    const record = normalizeRecord(rawData)

    // Product honesty gate: chat may extract transactions and answer queries.
    // It must never advertise an action unless a real executor is wired.
    if (record.type === 'action') {
      return json({
        success: true,
        data: { type: 'query', queryResponse: 'This command is not available from chat. Use the reviewed control in Hissab instead.', currency: 'AED', items: [] },
        totals: computeTotals({ items: [] }),
        validation: { valid: true, errors: [], warnings: ['Chat actions are disabled until an executable command is available.'] },
        text: 'This command is not available from chat. Use the reviewed control in Hissab instead.',
      })
    }

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
          console.error('[gemini]', { requestId, event: 'fx_conversion_failed', error: fxError instanceof Error ? fxError.message : String(fxError) })
        }
      }
    }

    // 7. Validate per record type. Errors block confirmation in the UI;
    //    warnings are shown on the card so the user can correct before posting.
    const validation = validateRecord(record, locale === 'ar' ? 'ar' : 'en')

    const textResponse =
      record.queryResponse || (rawData.explanation as string | undefined) || record.notes || ''

    // 8. Save conversation to DB
    await supabase.from('ai_conversations').insert([
      { org_id: orgId, user_id: user.id, role: 'user', content: message },
      { org_id: orgId, user_id: user.id, role: 'assistant', content: JSON.stringify(record) },
    ])

    return json({
      requestId,
      success: true,
      data: record,
      totals: hasItemizedTotals(record.type) ? computeTotals(record) : undefined,
      validation,
      text: textResponse,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    return json({ error: message }, { status: 500 })
  }
}
