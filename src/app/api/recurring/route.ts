import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const searchParams = request.nextUrl.searchParams
  const orgId = searchParams.get('orgId')
  
  if (!orgId) {
    return NextResponse.json({ error: 'Missing orgId' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('recurring_templates')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { orgId, title, frequency, nextRunDate, endDate, payload } = body

  if (!orgId || !title || !frequency || !nextRunDate || !payload) {
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
      payload,
      is_active: true
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data }, { status: 201 })
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const searchParams = request.nextUrl.searchParams
  const id = searchParams.get('id')
  
  if (!id) return NextResponse.json({ error: 'Missing template id' }, { status: 400 })

  const body = await request.json()
  
  const { data, error } = await supabase
    .from('recurring_templates')
    .update(body)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const searchParams = request.nextUrl.searchParams
  const id = searchParams.get('id')
  
  if (!id) return NextResponse.json({ error: 'Missing template id' }, { status: 400 })

  const { error } = await supabase
    .from('recurring_templates')
    .update({ is_active: false })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, message: 'Template deactivated successfully' })
}
