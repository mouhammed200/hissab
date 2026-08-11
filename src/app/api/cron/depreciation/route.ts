import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Monthly depreciation runner. Configure an external scheduler to GET this
 * endpoint once per day or once per month with Authorization: Bearer $CRON_SECRET.
 * Running daily is safe: the database function is idempotent and catches up
 * missed months without posting future periods.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const asOf = request.nextUrl.searchParams.get('asOf') || new Date().toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return NextResponse.json({ error: 'asOf must be YYYY-MM-DD' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: organizations, error: orgError } = await admin
    .from('organizations')
    .select('id')

  if (orgError) {
    return NextResponse.json({ error: orgError.message }, { status: 500 })
  }

  const results: Array<Record<string, unknown>> = []
  for (const organization of organizations || []) {
    const { data, error } = await admin.rpc('run_periodic_depreciation', {
      p_org_id: organization.id,
      p_as_of: asOf,
      p_actor_id: null,
    })

    if (error) {
      results.push({ orgId: organization.id, success: false, error: error.message })
      continue
    }
    results.push({ orgId: organization.id, ...(data as Record<string, unknown>) })
  }

  const failed = results.filter((result) => result.success === false)
  return NextResponse.json({
    success: failed.length === 0,
    asOf,
    organizations: results.length,
    processed: results.reduce((sum, result) => sum + Number(result.processed || 0), 0),
    generated: results.reduce((sum, result) => sum + Number(result.generated || 0), 0),
    failed: failed.length,
    results,
  }, { status: failed.length ? 207 : 200 })
}
