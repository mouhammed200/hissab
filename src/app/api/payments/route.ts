import { NextResponse } from 'next/server'
import { requireOrgAccess, WRITE_ROLES } from '@/lib/supabase/guard'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const guard = await requireOrgAccess(body.orgId, { roles: WRITE_ROLES })
    if (!guard.ok) return guard.response
    const key = req.headers.get('idempotency-key') || body.requestKey
    if (!key) return NextResponse.json({ error: 'Missing Idempotency-Key' }, { status: 400 })
    const { data, error } = await guard.supabase.rpc('post_payment_transaction', {
      p_request: { org_id: body.orgId, request_key: key, payment: body.payment, allocations: body.allocations || [] },
    })
    if (error) throw error
    return NextResponse.json(data)
  } catch (error) {
    const message = (error as { message?: string })?.message || 'Atomic payment failed'
    console.error('post_payment_transaction failed', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
