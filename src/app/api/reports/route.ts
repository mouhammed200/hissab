import { NextResponse } from 'next/server'
import { requireOrgAccess } from '@/lib/supabase/guard'
import { buildVatReturn201, type VatLineItem } from '@/lib/accounting/vat'
import type { Emirate, VatCategory } from '@/types/database'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const orgId = searchParams.get('orgId')
    const report = searchParams.get('report')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const today = new Date().toISOString().split('T')[0]
    const asOfDate = searchParams.get('asOfDate') || today
    const yearStart = `${new Date().getFullYear()}-01-01`

    // SECURITY: membership check — reports expose the full general ledger.
    const guard = await requireOrgAccess(orgId)
    if (!guard.ok) return guard.response
    const { supabase } = guard

    if (!report) {
      return NextResponse.json({ error: 'Missing required parameter (report)' }, { status: 400 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let reportData: any = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let rpcError: any = null

    switch (report) {
      case 'snapshot': {
        const snapshot = await supabase.rpc('fn_hissab_read_snapshot', { p_org_id: orgId, p_start: startDate || yearStart, p_end: endDate || today })
        reportData = snapshot.data
        rpcError = snapshot.error
        break
      }
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
          p_start: startDate || yearStart, 
          p_end: endDate || today 
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
        
      case 'vat_return': {
        // There is no fn_vat_return() in the database, so the old RPC call always
        // failed. Build the FTA 201 in application code from posted invoices.
        const periodStart = startDate || yearStart
        const periodEnd = endDate || today

        const { data: vatInvoices, error: vatError } = await supabase
          .from('invoices')
          .select('invoice_type, emirate, is_reverse_charge, invoice_items(subtotal, vat_category)')
          .eq('org_id', orgId)
          .gte('issue_date', periodStart)
          .lte('issue_date', periodEnd)
          .not('status', 'in', '("void","draft")')

        if (vatError) {
          rpcError = vatError
          break
        }

        const salesItems: VatLineItem[] = []
        const purchaseItems: VatLineItem[] = []

        for (const inv of vatInvoices || []) {
          const items = (inv.invoice_items || []) as Array<{ subtotal: number; vat_category: VatCategory }>
          const target = inv.invoice_type === 'sales_invoice' ? salesItems : purchaseItems
          if (inv.invoice_type !== 'sales_invoice' && inv.invoice_type !== 'purchase_invoice') continue

          for (const item of items) {
            target.push({
              subtotal: Number(item.subtotal) || 0,
              vatCategory: (item.vat_category || 'standard') as VatCategory,
              emirate: (inv.emirate || 'Dubai') as Emirate,
              isReverseCharge: Boolean(inv.is_reverse_charge),
            })
          }
        }

        reportData = {
          period_start: periodStart,
          period_end: periodEnd,
          ...buildVatReturn201(salesItems, purchaseItems),
        }
        break
      }

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
