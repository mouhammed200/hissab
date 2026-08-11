import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireOrgAccess, WRITE_ROLES } from '@/lib/supabase/guard'

/**
 * Resolves the owning org for a template id, then verifies membership.
 * The id alone tells us nothing about who is allowed to touch it.
 */
async function guardTemplate(id: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false as const, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const { data: template } = await supabase
    .from('recurring_templates')
    .select('id, org_id')
    .eq('id', id)
    .maybeSingle()

  if (!template) {
    return { ok: false as const, response: NextResponse.json({ error: 'Template not found' }, { status: 404 }) }
  }

  return requireOrgAccess(template.org_id, { roles: WRITE_ROLES })
}

export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get('orgId')

  const guard = await requireOrgAccess(orgId)
  if (!guard.ok) return guard.response
  const { supabase } = guard

  const { data, error } = await supabase
    .from('recurring_templates')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { orgId, title, frequency, nextRunDate, endDate, templateType, payload } = body

  const guard = await requireOrgAccess(orgId, { roles: WRITE_ROLES })
  if (!guard.ok) return guard.response
  const { supabase } = guard

  if (!title || !frequency || !nextRunDate || !payload) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('recurring_templates')
    .insert({
      org_id: orgId,
      title,
      frequency,
      next_run_date: nextRunDate,
      end_date: endDate || null,
      template_type: templateType || 'journal_entry',
      payload,
      is_active: true,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data }, { status: 201 })
}

export async function PUT(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing template id' }, { status: 400 })

  const guard = await guardTemplate(id)
  if (!guard.ok) return guard.response
  const { supabase } = guard

  const body = await request.json()

  // Whitelist: never let the client rewrite org_id or id.
  const updates: Record<string, unknown> = {}
  if (body.title !== undefined) updates.title = body.title
  if (body.frequency !== undefined) updates.frequency = body.frequency
  if (body.nextRunDate !== undefined) updates.next_run_date = body.nextRunDate
  if (body.next_run_date !== undefined) updates.next_run_date = body.next_run_date
  if (body.endDate !== undefined) updates.end_date = body.endDate
  if (body.end_date !== undefined) updates.end_date = body.end_date
  if (body.templateType !== undefined) updates.template_type = body.templateType
  if (body.payload !== undefined) updates.payload = body.payload
  if (body.isActive !== undefined) updates.is_active = body.isActive
  if (body.is_active !== undefined) updates.is_active = body.is_active

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('recurring_templates')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing template id' }, { status: 400 })

  const guard = await guardTemplate(id)
  if (!guard.ok) return guard.response
  const { supabase } = guard

  const { error } = await supabase
    .from('recurring_templates')
    .update({ is_active: false })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, message: 'Template deactivated successfully' })
}
