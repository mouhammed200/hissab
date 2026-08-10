import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await request.formData()
  const file = formData.get('file') as File
  const orgId = formData.get('orgId') as string
  const bankAccountId = formData.get('bankAccountId') as string

  if (!file || !orgId) {
    return NextResponse.json({ error: 'Missing required fields (file, orgId)' }, { status: 400 })
  }

  const text = await file.text()
  const lines = text.split('\n').filter(l => l.trim())
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
  
  const transactions = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',')
    if (cols.length < 3) continue
    
    const dateIdx = headers.findIndex(h => h.includes('date'))
    const descIdx = headers.findIndex(h => h.includes('desc') || h.includes('narrative') || h.includes('detail'))
    const amountIdx = headers.findIndex(h => h.includes('amount') || h.includes('value'))
    const refIdx = headers.findIndex(h => h.includes('ref') || h.includes('reference'))
    
    transactions.push({
      org_id: orgId,
      bank_account_id: bankAccountId,
      transaction_date: cols[dateIdx >= 0 ? dateIdx : 0]?.trim(),
      description: cols[descIdx >= 0 ? descIdx : 1]?.trim(),
      amount: parseFloat(cols[amountIdx >= 0 ? amountIdx : 2]?.trim() || '0'),
      reference_number: refIdx >= 0 ? cols[refIdx]?.trim() : null,
      reconciliation_status: 'unmatched' as const,
    })
  }

  if (transactions.length === 0) {
    return NextResponse.json({ error: 'No valid transactions found in CSV' }, { status: 400 })
  }

  const { data, error } = await supabase.from('bank_transactions').insert(transactions).select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, imported: data?.length || 0 })
}
