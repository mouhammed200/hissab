import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseTransaction } from '@/lib/gemini/client'
import { verifyArithmetic } from '@/lib/accounting/validation'
import { convertForeignInvoiceToAed } from '@/lib/accounting/fx'

export async function POST(request: NextRequest) {
  // 1. Authenticate
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { message, orgId, chatHistory } = body as {
      message: string
      orgId: string
      chatHistory?: Array<{ role: 'user' | 'model'; content: string }>
    }

    if (!message || !orgId) {
      return NextResponse.json({ error: 'Missing message or orgId' }, { status: 400 })
    }

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

    // 4. Call Gemini
    const result = await parseTransaction({
      userMessage: message,
      contextData: {
        organization: orgData,
        userRole: membership.role,
      },
      chatHistory,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    const data = result.data!
    
    // Extract text response for chat
    const textResponse = (data.queryResponse as string) || (data.explanation as string) || (data.notes as string) || ''

    // 5. Post-parse arithmetic verification for transaction records
    if (data.items && Array.isArray(data.items)) {
      const items = data.items as Array<{ qty: number; price: number; discount: number; lineTotal?: number }>
      const check = verifyArithmetic(items)
      if (!check.valid) {
        for (const correction of check.corrections) {
          items[correction.index].lineTotal = correction.expected
        }
        data._arithmeticCorrected = true
      }
    }

    // 5b. Foreign Currency CBUAE Exchange Rate Enrichment
    const currency = (data.currency as string) || 'AED'
    if (currency !== 'AED') {
      let subtotalForeign = 0
      if (data.items && Array.isArray(data.items)) {
        subtotalForeign = (data.items as Array<{ qty?: number; price?: number; discount?: number }>).reduce(
          (sum, item) => sum + ((item.qty || 1) * (item.price || 0) - (item.discount || 0)),
          0
        )
      } else if (typeof data.amount === 'number') {
        subtotalForeign = data.amount
      }

      if (subtotalForeign > 0) {
        const fxResult = await convertForeignInvoiceToAed(subtotalForeign, currency, 'standard', data.date as string)
        data.exchangeRate = fxResult.exchangeRate
        data.amountInAED = fxResult.amountInAed
        data.vatInAED = fxResult.vatInAed
        data.notes = data.notes ? `${data.notes} | ${fxResult.ftaCompliantNote}` : fxResult.ftaCompliantNote
      }
    }

    // 6. Save conversation to DB
    await supabase.from('ai_conversations').insert([
      { org_id: orgId, user_id: user.id, role: 'user', content: message },
      { org_id: orgId, user_id: user.id, role: 'assistant', content: JSON.stringify(data) },
    ])

    return NextResponse.json({ 
      success: true, 
      data,
      text: textResponse 
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
