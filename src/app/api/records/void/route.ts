import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { orgId, invoiceId, journalEntryId } = body

    if (!orgId) {
      return NextResponse.json({ error: 'Missing orgId' }, { status: 400 })
    }

    // Basic access check (should ideally verify org access)
    // 1. Update invoice status
    if (invoiceId) {
      const { error: invError } = await supabase
        .from('invoices')
        .update({ status: 'void' })
        .eq('id', invoiceId)
        .eq('org_id', orgId)
        
      if (invError) throw invError
      
      // 3. Audit log
      await supabase.from('audit_log').insert({
        org_id: orgId,
        user_id: user.id,
        action: 'voided',
        entity_type: 'invoice',
        entity_id: invoiceId,
        details: { invoiceId }
      })
    }

    // 2. Update JE status
    if (journalEntryId) {
      const { error: jeError } = await supabase
        .from('journal_entries')
        .update({ status: 'void' })
        .eq('id', journalEntryId)
        .eq('org_id', orgId)
        
      if (jeError) throw jeError
      
      // 3. Audit log
      await supabase.from('audit_log').insert({
        org_id: orgId,
        user_id: user.id,
        action: 'voided',
        entity_type: 'journal_entry',
        entity_id: journalEntryId,
        details: { journalEntryId }
      })
    }

    return NextResponse.json({ success: true })
    
  } catch (error: any) {
    console.error('Error voiding record:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
