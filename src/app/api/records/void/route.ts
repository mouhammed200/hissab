import { NextResponse } from 'next/server'
import { requireOrgAccess, WRITE_ROLES } from '@/lib/supabase/guard'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { orgId, invoiceId, journalEntryId } = body

    // SECURITY: membership check — previously any user could void another org's records.
    const guard = await requireOrgAccess(orgId, { roles: WRITE_ROLES })
    if (!guard.ok) return guard.response
    const { supabase, user } = guard

    if (!invoiceId && !journalEntryId) {
      return NextResponse.json(
        { error: 'Provide invoiceId and/or journalEntryId' },
        { status: 400 }
      )
    }

    if (invoiceId) {
      const { data: voided, error: invError } = await supabase
        .from('invoices')
        .update({ status: 'void' })
        .eq('id', invoiceId)
        .eq('org_id', orgId)
        .select('id, journal_entry_id')
        .maybeSingle()

      if (invError) throw invError
      if (!voided) {
        return NextResponse.json({ error: 'Invoice not found in this organization' }, { status: 404 })
      }

      // audit_logs (plural) is the table that exists; columns are
      // table_name / record_id / new_values.
      await supabase.from('audit_logs').insert({
        org_id: orgId,
        user_id: user.id,
        action: 'voided',
        table_name: 'invoices',
        record_id: invoiceId,
        new_values: { status: 'void' },
      })

      // Void the linked journal entry too, otherwise the ledger keeps the entry alive.
      const linkedJe = journalEntryId || voided.journal_entry_id
      if (linkedJe) {
        const { error: jeError } = await supabase
          .from('journal_entries')
          .update({ status: 'void' })
          .eq('id', linkedJe)
          .eq('org_id', orgId)
        if (jeError) throw jeError

        await supabase.from('audit_logs').insert({
          org_id: orgId,
          user_id: user.id,
          action: 'voided',
          table_name: 'journal_entries',
          record_id: linkedJe,
          new_values: { status: 'void' },
        })
      }

      return NextResponse.json({ success: true })
    }

    const { data: voidedJe, error: jeError } = await supabase
      .from('journal_entries')
      .update({ status: 'void' })
      .eq('id', journalEntryId)
      .eq('org_id', orgId)
      .select('id')
      .maybeSingle()

    if (jeError) throw jeError
    if (!voidedJe) {
      return NextResponse.json({ error: 'Journal entry not found in this organization' }, { status: 404 })
    }

    await supabase.from('audit_logs').insert({
      org_id: orgId,
      user_id: user.id,
      action: 'voided',
      table_name: 'journal_entries',
      record_id: journalEntryId,
      new_values: { status: 'void' },
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error voiding record:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
