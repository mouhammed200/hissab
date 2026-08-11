import { NextRequest, NextResponse } from 'next/server'
import { getCbuaeExchangeRate } from '@/lib/accounting/fx'
import { createAdminClient } from '@/lib/supabase/admin'

const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'SAR', 'INR', 'CAD', 'AUD', 'CNY']

export async function GET(request: NextRequest) {
  // A missing secret must fail closed. The old guard made this endpoint public
  // whenever CRON_SECRET was absent.
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const today = new Date().toISOString().split('T')[0]
  const rates: Record<string, number> = {}

  try {
    const rows = []
    for (const currency of SUPPORTED_CURRENCIES) {
      const rateObj = await getCbuaeExchangeRate(currency, today)
      rates[currency] = rateObj.rateToAed
      rows.push({ currency_code: currency, rate_to_aed: rateObj.rateToAed, rate_date: today, source: rateObj.source })
    }

    // Persist only after the complete batch succeeds, so the table never holds
    // a silently partial daily snapshot.
    const admin = createAdminClient()
    const { error } = await admin.from('exchange_rates').upsert(rows, { onConflict: 'currency_code,rate_date' })
    if (error) throw error

    return NextResponse.json({ success: true, date: today, baseCurrency: 'AED', rates })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch exchange rates'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
