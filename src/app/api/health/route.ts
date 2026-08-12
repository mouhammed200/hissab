import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const started = Date.now()
  try {
    const supabase = await createClient()
    const { error } = await supabase.from('organizations').select('id').limit(1)
    if (error) throw error
    return NextResponse.json({ status: 'healthy', checks: { database: 'ok' }, latencyMs: Date.now() - started, timestamp: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ status: 'degraded', checks: { database: 'error' }, latencyMs: Date.now() - started, timestamp: new Date().toISOString() }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
