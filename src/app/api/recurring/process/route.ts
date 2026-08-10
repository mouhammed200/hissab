import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const searchParams = request.nextUrl.searchParams
  const orgId = searchParams.get('orgId')

  if (!orgId) {
    return NextResponse.json({ error: 'Missing orgId' }, { status: 400 })
  }

  const today = new Date().toISOString().split('T')[0] // 'YYYY-MM-DD'

  const { data: templates, error: fetchError } = await supabase
    .from('recurring_templates')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .lte('next_run_date', today)

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  if (!templates || templates.length === 0) {
    return NextResponse.json({ success: true, processed: 0 })
  }

  let processedCount = 0

  for (const template of templates) {
    const payload = template.payload

    // Create journal entry
    const { data: entry, error: entryError } = await supabase
      .from('journal_entries')
      .insert({
        org_id: orgId,
        entry_date: today,
        description: payload.description || template.title,
        status: 'posted'
      })
      .select('id')
      .single()

    if (entryError) continue // Skip and proceed to the next

    // Create journal lines
    const lines = payload.lines.map((line: any) => ({
      journal_entry_id: entry.id,
      account_code: line.account_code,
      debit: line.debit,
      credit: line.credit,
      description: line.description
    }))

    const { error: linesError } = await supabase.from('journal_lines').insert(lines)
    if (linesError) continue

    // Calculate next run date
    const currentRun = new Date(template.next_run_date)
    const nextRun = new Date(currentRun)
    switch (template.frequency) {
      case 'daily': nextRun.setDate(nextRun.getDate() + 1); break;
      case 'weekly': nextRun.setDate(nextRun.getDate() + 7); break;
      case 'monthly': nextRun.setMonth(nextRun.getMonth() + 1); break;
      case 'quarterly': nextRun.setMonth(nextRun.getMonth() + 3); break;
      case 'yearly': nextRun.setFullYear(nextRun.getFullYear() + 1); break;
    }

    const nextRunStr = nextRun.toISOString().split('T')[0]
    const endDateStr = template.end_date ? new Date(template.end_date).toISOString().split('T')[0] : null

    let isActive = true
    if (endDateStr && nextRunStr > endDateStr) {
      isActive = false
    }

    // Update template next_run_date and status
    await supabase
      .from('recurring_templates')
      .update({ next_run_date: nextRunStr, is_active: isActive })
      .eq('id', template.id)

    // Insert audit log
    await supabase
      .from('audit_logs')
      .insert({
        org_id: orgId,
        action: 'process_recurring_template',
        entity_type: 'recurring_template',
        entity_id: template.id,
        details: { journal_entry_id: entry.id, next_run_date: nextRunStr }
      })

    processedCount++
  }

  return NextResponse.json({ success: true, processed: processedCount })
}
