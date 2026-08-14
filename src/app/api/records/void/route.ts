import { NextResponse } from 'next/server'
import { requireOrgAccess, WRITE_ROLES } from '@/lib/supabase/guard'

// Maps each supported void source type to the request-body field that carries
// its ID. Previously this route only accepted invoiceId/paymentId, so the
// other four types the void_record_transaction RPC already supports
// (employee, asset, relatedParty, bank_match) were unreachable through the
// app even though the database logic for them was correct.
const SOURCE_ID_FIELDS: Record<string, string> = {
  invoice: 'invoiceId',
  payment: 'paymentId',
  employee: 'employeeId',
  asset: 'assetId',
  relatedParty: 'relatedPartyId',
  bank_match: 'bankTransactionId',
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { orgId, sourceType, reason, evidenceLink } = body
    const guard = await requireOrgAccess(orgId, { roles: WRITE_ROLES })
    if (!guard.ok) return guard.response
    if (!reason?.trim()) return NextResponse.json({ error: 'A correction reason is required' }, { status: 400 })

    // Backward-compatible: infer sourceType from whichever legacy id field is present.
    const resolvedType: string =
      sourceType || (body.paymentId ? 'payment' : body.invoiceId ? 'invoice' : '')
    const idField = SOURCE_ID_FIELDS[resolvedType]
    if (!idField) {
      return NextResponse.json(
        { error: `Unsupported or missing sourceType. Expected one of: ${Object.keys(SOURCE_ID_FIELDS).join(', ')}` },
        { status: 400 }
      )
    }
    const sourceId = body[idField]
    if (!sourceId) {
      return NextResponse.json({ error: `Provide ${idField} for sourceType "${resolvedType}"` }, { status: 400 })
    }

    const { data, error } = await guard.supabase.rpc('void_record_transaction', {
      p_request: { org_id: orgId, source_id: sourceId, source_type: resolvedType, reason, evidence_link: evidenceLink || null },
    })
    if (error) throw error
    return NextResponse.json(data)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Atomic void failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
