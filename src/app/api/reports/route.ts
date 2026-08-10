import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const orgId = searchParams.get('orgId')
    const report = searchParams.get('report')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const asOfDate = searchParams.get('asOfDate') || new Date().toISOString()

    if (!orgId || !report) {
      return NextResponse.json({ error: 'Missing required parameters (orgId, report)' }, { status: 400 })
    }

    let reportData = null
    let rpcError = null

    switch (report) {
      case 'trial_balance':
        const tbResult = await supabase.rpc('fn_trial_balance', { 
          p_org_id: orgId, 
          p_as_of_date: asOfDate 
        })
        reportData = tbResult.data
        rpcError = tbResult.error
        break
        
      case 'profit_loss':
        const plResult = await supabase.rpc('fn_profit_and_loss', { 
          p_org_id: orgId, 
          p_start: startDate || new Date(new Date().getFullYear(), 0, 1).toISOString(), 
          p_end: endDate || new Date().toISOString() 
        })
        reportData = plResult.data
        rpcError = plResult.error
        break
        
      case 'balance_sheet':
        const bsResult = await supabase.rpc('fn_balance_sheet', { 
          p_org_id: orgId, 
          p_as_of: asOfDate 
        })
        reportData = bsResult.data
        rpcError = bsResult.error
        break
        
      case 'aged_receivable':
        const arResult = await supabase.rpc('fn_aged_report', { 
          p_org_id: orgId, 
          p_type: 'receivable', 
          p_as_of: asOfDate 
        })
        reportData = arResult.data
        rpcError = arResult.error
        break
        
      case 'aged_payable':
        const apResult = await supabase.rpc('fn_aged_report', { 
          p_org_id: orgId, 
          p_type: 'payable', 
          p_as_of: asOfDate 
        })
        reportData = apResult.data
        rpcError = apResult.error
        break
        
      case 'vat_return':
        const vrResult = await supabase.rpc('fn_vat_return', {
          p_org_id: orgId,
          p_start: startDate || new Date(new Date().getFullYear(), 0, 1).toISOString(),
          p_end: endDate || new Date().toISOString()
        })
        reportData = vrResult.data
        rpcError = vrResult.error
        break

      default:
        return NextResponse.json({ error: 'Unknown report type' }, { status: 400 })
    }

    if (rpcError) {
      console.error(`RPC Error for ${report}:`, rpcError)
      return NextResponse.json({ error: rpcError.message }, { status: 500 })
    }

    return NextResponse.json({ data: reportData })

  } catch (error: any) {
    console.error('Reports API error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
