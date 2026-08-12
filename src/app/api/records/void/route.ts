import { NextResponse } from 'next/server'
import { requireOrgAccess, WRITE_ROLES } from '@/lib/supabase/guard'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { orgId, invoiceId, paymentId, sourceType, reason } = body
    const guard = await requireOrgAccess(orgId, { roles: WRITE_ROLES })
    if (!guard.ok) return guard.response
    if (!reason?.trim()) return NextResponse.json({ error: 'A correction reason is required' }, { status: 400 })
    const sourceId = invoiceId || paymentId
    if (!sourceId) return NextResponse.json({ error: 'Provide invoiceId or paymentId' }, { status: 400 })
    const { data, error } = await guard.supabase.rpc('void_record_transaction', {
      p_request: { org_id: orgId, source_id: sourceId, source_type: sourceType || (paymentId ? 'payment' : 'invoice'), reason },
    })
    if (error) throw error
    return NextResponse.json(data)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Atomic void failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
