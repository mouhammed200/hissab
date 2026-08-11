import { NextResponse } from 'next/server'
import { requireOrgAccess } from '@/lib/supabase/guard'
import * as XLSX from 'xlsx'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const orgId = searchParams.get('orgId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const type = searchParams.get('type')

    // SECURITY: membership check — this endpoint dumps the entire books to Excel.
    const guard = await requireOrgAccess(orgId)
    if (!guard.ok) return guard.response
    const { supabase } = guard

    // Create workbook
    const wb = XLSX.utils.book_new()

    // Query builder helpers
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const withDateFilter = (query: any, dateField: string): any => {
      let q = query
      if (startDate) q = q.gte(dateField, startDate)
      if (endDate) q = q.lte(dateField, endDate)
      return q
    }

    // 1 & 2. Invoices (Sales & Purchases)
    if (!type || type === 'sale' || type === 'purchase') {
      const invoicesQuery = supabase
        .from('invoices')
        .select(`
          *,
          contacts(name),
          invoice_items(*)
        `)
        .eq('org_id', orgId)
        
      const { data: invoices } = await withDateFilter(invoicesQuery, 'issue_date')
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sales = (invoices || []).filter((i: any) => i.invoice_type === 'sales_invoice')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const purchases = (invoices || []).filter((i: any) => i.invoice_type === 'purchase_invoice')
      
      // Flatten items for Excel
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const formatInvoices = (invList: any[]) => invList.flatMap((inv: any) => {
        if (!inv.invoice_items || inv.invoice_items.length === 0) {
          return [{
            InvoiceNumber: inv.invoice_number,
            Date: inv.issue_date,
            DueDate: inv.due_date,
            Contact: inv.contacts?.name ?? '',
            Subtotal: inv.subtotal_amount,
            Discount: inv.discount_amount,
            VAT: inv.vat_amount,
            Total: inv.total_amount,
            Currency: inv.currency,
            Status: inv.status
          }]
        }
        return inv.invoice_items.map((item: any) => ({
          InvoiceNumber: inv.invoice_number,
          Date: inv.issue_date,
          DueDate: inv.due_date,
          Contact: inv.contacts?.name ?? '',
          Status: inv.status,
          ItemDescription: item.description,
          Quantity: item.quantity,
          UnitPrice: item.unit_price,
          Discount: item.discount,
          ItemSubtotal: item.subtotal,
          VATCategory: item.vat_category,
          VATRate: item.vat_rate,
          ItemVAT: item.vat_amount,
          ItemTotal: item.total,
          InvoiceSubtotal: inv.subtotal_amount,
          InvoiceVAT: inv.vat_amount,
          InvoiceTotal: inv.total_amount
        }))
      })

      if (!type || type === 'sale') {
        const wsSales = XLSX.utils.json_to_sheet(formatInvoices(sales))
        XLSX.utils.book_append_sheet(wb, wsSales, 'Sales')
      }
      if (!type || type === 'purchase') {
        const wsPurchases = XLSX.utils.json_to_sheet(formatInvoices(purchases))
        XLSX.utils.book_append_sheet(wb, wsPurchases, 'Purchases')
      }
    }

    // 3. Employees
    if (!type || type === 'employee') {
      const empQuery = supabase.from('employees').select('*').eq('org_id', orgId)
      const { data: employees } = await withDateFilter(empQuery, 'hire_date')
      
      const wsEmployees = XLSX.utils.json_to_sheet(employees || [])
      XLSX.utils.book_append_sheet(wb, wsEmployees, 'Employees')
    }

    // 4. Fixed Assets
    if (!type || type === 'asset') {
      const assetsQuery = supabase.from('fixed_assets').select('*').eq('org_id', orgId)
      const { data: assets } = await withDateFilter(assetsQuery, 'purchase_date')
      
      const wsAssets = XLSX.utils.json_to_sheet(assets || [])
      XLSX.utils.book_append_sheet(wb, wsAssets, 'Fixed Assets')
    }

    // 5. Related Party Transactions
    if (!type || type === 'relatedParty') {
      const rptQuery = supabase.from('related_party_transactions').select('*').eq('org_id', orgId)
      const { data: rpts } = await withDateFilter(rptQuery, 'transaction_date')
      
      const wsRpts = XLSX.utils.json_to_sheet(rpts || [])
      XLSX.utils.book_append_sheet(wb, wsRpts, 'Related Party Txns')
    }

    // 6. Journal Entries
    if (!type) {
      const jeQuery = supabase
        .from('journal_entries')
        .select(`
          *,
          journal_lines(
            account_id, debit, credit, description, accounts(code, name)
          )
        `)
        .eq('org_id', orgId)
        
      const { data: jes } = await withDateFilter(jeQuery, 'date')
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const formattedJes = (jes || []).flatMap((je: any) => 
        je.journal_lines.map((jl: any) => ({
          Date: je.date,
          EntryDescription: je.description,
          Status: je.status,
          AccountCode: jl.accounts?.code,
          AccountName: jl.accounts?.name,
          LineDescription: jl.description,
          Debit: jl.debit,
          Credit: jl.credit
        }))
      )
      const wsJes = XLSX.utils.json_to_sheet(formattedJes)
      XLSX.utils.book_append_sheet(wb, wsJes, 'Journal Entries')
    }

    // 7. Trial Balance
    if (!type) {
      const { data: tb } = await supabase.rpc('fn_trial_balance', { 
        p_org_id: orgId, 
        p_as_of_date: endDate || new Date().toISOString().split('T')[0] 
      })
      
      const wsTb = XLSX.utils.json_to_sheet(tb || [])
      XLSX.utils.book_append_sheet(wb, wsTb, 'Trial Balance')
    }

    // Generate buffer
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    const date = new Date().toISOString().split('T')[0]

    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="hissab-export-${date}.xlsx"`,
      },
    })

  } catch (error: any) {
    console.error('Export error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
