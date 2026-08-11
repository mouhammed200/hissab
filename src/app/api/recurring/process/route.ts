import { NextRequest, NextResponse } from 'next/server'
import { requireOrgAccess, WRITE_ROLES } from '@/lib/supabase/guard'

interface PayloadLine {
  account_code?: string
  account_id?: string
  debit?: number
  credit?: number
  description?: string
}

export async function POST(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get('orgId')

  // SECURITY: membership check — this posts journal entries into the ledger.
  const guard = await requireOrgAccess(orgId, { roles: WRITE_ROLES })
  if (!guard.ok) return guard.response
  const { supabase, user } = guard

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
    return NextResponse.json({ success: true, processed: 0, skipped: [] })
  }

  // journal_lines.account_id is a UUID FK — payloads carry account codes.
  const { data: accounts } = await supabase
    .from('accounts')
    .select('id, code')
    .eq('org_id', orgId)
  const accountMap = Object.fromEntries((accounts || []).map((a) => [a.code, a.id])) as Record<string, string>

  let processedCount = 0
  const skipped: Array<{ id: string; reason: string }> = []

  for (const template of templates) {
    const payload = template.payload || {}
    const payloadLines: PayloadLine[] = Array.isArray(payload.lines) ? payload.lines : []

    if (payloadLines.length === 0) {
      skipped.push({ id: template.id, reason: 'Template payload has no lines' })
      continue
    }

    const resolved = payloadLines.map((line) => ({
      account_id: line.account_id || (line.account_code ? accountMap[line.account_code] : undefined),
      debit: Number(line.debit || 0),
      credit: Number(line.credit || 0),
      description: line.description ?? null,
      original: line,
    }))

    const missing = resolved.filter((l) => !l.account_id).map((l) => l.original.account_code || 'unknown')
    if (missing.length > 0) {
      skipped.push({ id: template.id, reason: `Unknown account code(s): ${missing.join(', ')}` })
      continue
    }

    const totalDebit = resolved.reduce((sum, l) => sum + l.debit, 0)
    const totalCredit = resolved.reduce((sum, l) => sum + l.credit, 0)
    if (Math.abs(totalDebit - totalCredit) > 0.005) {
      skipped.push({
        id: template.id,
        reason: `Unbalanced template: DR ${totalDebit.toFixed(2)} != CR ${totalCredit.toFixed(2)}`,
      })
      continue
    }

    // Column is `date`, not `entry_date`. created_by is NOT NULL.
    const { data: entry, error: entryError } = await supabase
      .from('journal_entries')
      .insert({
        org_id: orgId,
        created_by: user.id,
        date: today,
        description: payload.description || template.title,
        source_type: 'recurring_template',
        source_id: template.id,
        status: 'posted',
        posted_at: new Date().toISOString(),
        posted_by: user.id,
      })
      .select('id')
      .single()

    if (entryError || !entry) {
      skipped.push({ id: template.id, reason: entryError?.message || 'Could not create journal entry' })
      continue
    }

    const lines = resolved
      .filter((l) => l.debit > 0 || l.credit > 0)
      .map((l) => ({
        org_id: orgId, // NOT NULL on journal_lines
        journal_entry_id: entry.id,
        account_id: l.account_id,
        debit: l.debit,
        credit: l.credit,
        description: l.description,
      }))

    const { error: linesError } = await supabase.from('journal_lines').insert(lines)
    if (linesError) {
      // Roll back the header so we never leave an empty posted entry behind.
      await supabase.from('journal_entries').delete().eq('id', entry.id).eq('org_id', orgId)
      skipped.push({ id: template.id, reason: linesError.message })
      continue
    }

    // Advance the schedule from the scheduled date, catching up if runs were missed.
    const nextRun = new Date(`${template.next_run_date}T00:00:00Z`)
    const advance = () => {
      switch (template.frequency) {
        case 'daily': nextRun.setUTCDate(nextRun.getUTCDate() + 1); break
        case 'weekly': nextRun.setUTCDate(nextRun.getUTCDate() + 7); break
        case 'monthly': nextRun.setUTCMonth(nextRun.getUTCMonth() + 1); break
        case 'quarterly': nextRun.setUTCMonth(nextRun.getUTCMonth() + 3); break
        case 'yearly': nextRun.setUTCFullYear(nextRun.getUTCFullYear() + 1); break
        default: nextRun.setUTCMonth(nextRun.getUTCMonth() + 1)
      }
    }
    advance()
    while (nextRun.toISOString().split('T')[0] <= today) advance()

    const nextRunStr = nextRun.toISOString().split('T')[0]
    const endDateStr = template.end_date ? String(template.end_date).split('T')[0] : null
    const isActive = !(endDateStr && nextRunStr > endDateStr)

    await supabase
      .from('recurring_templates')
      .update({ next_run_date: nextRunStr, is_active: isActive })
      .eq('id', template.id)
      .eq('org_id', orgId)

    // audit_logs columns: table_name / record_id / new_values (+ user_id)
    await supabase.from('audit_logs').insert({
      org_id: orgId,
      user_id: user.id,
      action: 'process_recurring_template',
      table_name: 'recurring_templates',
      record_id: template.id,
      new_values: { journal_entry_id: entry.id, next_run_date: nextRunStr, is_active: isActive },
    })

    processedCount++
  }

  return NextResponse.json({ success: true, processed: processedCount, skipped })
}
