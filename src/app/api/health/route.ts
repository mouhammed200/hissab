import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const started = Date.now()
  try {
    // Liveness check only: uses the service-role client, not the anon/session
    // client. RLS intentionally denies anonymous callers (see migration 007,
    // "Anonymous callers get nothing"), so an unauthenticated request through
    // the normal client would always report unhealthy even when the database
    // is fine. The service-role client bypasses RLS, which is correct here
    // since this route only proves connectivity, not a real user's access.
    const supabase = createAdminClient()
    const { error } = await supabase.from('organizations').select('id').limit(1)
    if (error) throw error
    return NextResponse.json({ status: 'healthy', checks: { database: 'ok' }, latencyMs: Date.now() - started, timestamp: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ status: 'degraded', checks: { database: 'error' }, latencyMs: Date.now() - started, timestamp: new Date().toISOString() }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}