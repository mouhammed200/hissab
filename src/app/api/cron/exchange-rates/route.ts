import { NextRequest, NextResponse } from 'next/server'
import { getCbuaeExchangeRate } from '@/lib/accounting/fx'

const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'SAR', 'INR', 'CAD', 'AUD', 'CNY']

export async function GET(request: NextRequest) {
  // Verify cron authorization (optional CRON_SECRET header)
  const authHeader = request.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const today = new Date().toISOString().split('T')[0]
  const rates: Record<string, number> = {}

  try {
    for (const currency of SUPPORTED_CURRENCIES) {
      const rateObj = await getCbuaeExchangeRate(currency, today)
      rates[currency] = rateObj.rateToAed
    }

    return NextResponse.json({
      success: true,
      date: today,
      baseCurrency: 'AED',
      rates,
      note: 'Rates synced with Central Bank of the UAE (CBUAE) official exchange rate standards.',
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch exchange rates'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
