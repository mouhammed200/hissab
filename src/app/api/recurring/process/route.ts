import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { requireOrgAccess, WRITE_ROLES } from '@/lib/supabase/guard'

// Deterministic idempotency key: same template + same scheduled run date
// always produces the same key, so two concurrent invocations of this route
// collide on purpose and the DB's `posting_requests` UNIQUE(org_id, request_key)
// guard (see post_recurring_transaction) catches the second one instead of
// both succeeding. A random key (crypto.randomUUID()) can never do this,
// since it differs on every call even for the same template/date.
function deterministicRequestKey(templateId: string, scheduledDate: string): string {
  const hex = createHash('sha256').update(`${templateId}:${scheduledDate}`).digest('hex').slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

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
  // Phase 06 gate: recurring entries are legacy until migrated to the same
  // atomic posting RPC. Keep the path explicit and idempotent; do not add new
  // posting semantics here.

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

    const requestKey = deterministicRequestKey(template.id, today)
    const { data: posted, error: postError } = await supabase.rpc('post_recurring_transaction', {
      p_request: {
        org_id: orgId,
        template_id: template.id,
        request_key: requestKey,
        date: today,
        description: payload.description || template.title,
        journal_lines: resolved.map((line) => ({
          account_id: line.account_id,
          debit: line.debit,
          credit: line.credit,
          description: line.description,
        })),
      },
    })
    if (postError || !posted?.success) {
      skipped.push({ id: template.id, reason: postError?.message || 'Atomic recurring post failed' })
      continue
    }
    const entryId = String(posted.journalEntryId || '')

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
      new_values: { journal_entry_id: entryId, next_run_date: nextRunStr, is_active: isActive },
    })

    processedCount++
  }

  return NextResponse.json({ success: true, processed: processedCount, skipped })
}
