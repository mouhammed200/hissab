import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { 
  buildSaleJournalLines, 
  buildPurchaseJournalLines, 
  buildSalaryLines, 
  buildAssetPurchaseLines, 
  buildDepreciationLines 
} from '@/lib/accounting/journal'
import { calculateGratuity } from '@/lib/accounting/gratuity'
import { calculateMonthlyDepreciation } from '@/lib/accounting/depreciation'

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { orgId, record, totals } = body

    if (!orgId || !record || !record.type) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Lookup account IDs
    const { data: accounts } = await supabase
      .from('accounts')
      .select('id, code')
      .eq('org_id', orgId)
      
    const accountMap = Object.fromEntries((accounts || []).map(a => [a.code, a.id]))

    const dateStr = new Date().toISOString().replace(/-/g, '').slice(0, 8) // YYYYMMDD

    let recordId: string | undefined
    let journalEntryId: string | undefined

    if (record.type === 'sale' || record.type === 'purchase') {
      const isSale = record.type === 'sale'
      
      // 1. Find or create contact
      const resolvedPartyName = record.party || record.partyName || record.contactName || record.name || 'General Contact'
      let contactId: string
      const { data: existingContact } = await supabase
        .from('contacts')
        .select('id')
        .eq('org_id', orgId)
        .eq('name', resolvedPartyName)
        .single()
        
      if (existingContact) {
        contactId = existingContact.id
      } else {
        const { data: newContact, error: contactError } = await supabase
          .from('contacts')
          .insert({ org_id: orgId, name: resolvedPartyName, type: isSale ? 'customer' : 'vendor' })
          .select('id')
          .single()
          
        if (contactError) throw contactError
        contactId = newContact.id
      }

      // 2. Generate invoice/bill number
      const prefix = isSale ? 'INV' : 'BILL'
      const { data: existingInvoices } = await supabase
        .from('invoices')
        .select('invoice_number')
        .eq('org_id', orgId)
        .like('invoice_number', `${prefix}-${dateStr}-%`)
        
      const counter = (existingInvoices?.length || 0) + 1
      const invoiceNumber = `${prefix}-${dateStr}-${counter.toString().padStart(4, '0')}`

      // 3. Insert into invoices
      const { data: invoice, error: invoiceError } = await supabase
        .from('invoices')
        .insert({
          org_id: orgId,
          contact_id: contactId,
          invoice_type: isSale ? 'sales_invoice' : 'purchase_invoice',
          invoice_number: invoiceNumber,
          issue_date: record.date || new Date().toISOString().split('T')[0],
          due_date: record.dueDate || new Date().toISOString().split('T')[0],
          emirate: record.emirate || 'Dubai',
          subtotal_amount: totals?.subtotal || 0,
          vat_amount: totals?.vat || 0,
          discount_amount: totals?.discount || 0,
          total_amount: totals?.total || 0,
          status: 'approved'
        })
        .select('id')
        .single()
        
      if (invoiceError) throw invoiceError
      recordId = invoice.id

      // 4. Insert items
      if (record.items && record.items.length > 0) {
        const itemsToInsert = record.items.map((item: any) => ({
          org_id: orgId,
          invoice_id: recordId,
          description: item.description || item.desc,
          quantity: item.qty || item.quantity || 1,
          unit_price: item.price || item.unit_price || 0,
          discount: item.discount || 0,
          subtotal: (item.qty || 1) * (item.price || 0) - (item.discount || 0),
          vat_category: item.category || 'standard',
          vat_rate: item.category === 'standard' ? 0.05 : 0,
          vat_amount: item.category === 'standard' ? ((item.qty || 1) * (item.price || 0) - (item.discount || 0)) * 0.05 : 0,
          total: ((item.qty || 1) * (item.price || 0) - (item.discount || 0)) * (item.category === 'standard' ? 1.05 : 1),
          excise_category: item.exciseCategory || 'none'
        }))
        
        const { error: itemsError } = await supabase
          .from('invoice_items')
          .insert(itemsToInsert)
          
        if (itemsError) throw itemsError
      }

      // 5. Build journal entry
      let journalLines = []
      if (isSale) {
        journalLines = buildSaleJournalLines(totals?.subtotal || 0, totals?.vat || 0, record.vatCategory)
      } else {
        journalLines = buildPurchaseJournalLines(totals?.subtotal || 0, totals?.vat || 0, record.isReverseCharge)
      }

      // Map codes to IDs in journal lines
      const mappedLines = journalLines.map((line: any) => ({
        ...line,
        account_id: accountMap[line.account_code]
      })).filter((line: any) => line.account_id) // Filter out lines where account wasn't found (or handle error)

      // 6. Insert journal_entry and lines
      if (mappedLines.length > 0) {
        const { data: je, error: jeError } = await supabase
          .from('journal_entries')
          .insert({
            org_id: orgId,
            created_by: user.id,
            date: record.date || new Date().toISOString().split('T')[0],
            description: `${isSale ? 'Sale' : 'Purchase'} ${invoiceNumber}`,
            source_type: isSale ? 'sales_invoice' : 'purchase_invoice',
            source_id: recordId,
            status: 'posted'
          })
          .select('id')
          .single()
          
        if (jeError) throw jeError
        journalEntryId = je.id

        const linesToInsert = mappedLines.map((line: any) => ({
          journal_entry_id: journalEntryId,
          account_id: line.account_id,
          debit: line.debit,
          credit: line.credit,
          description: line.description
        }))
        
        const { error: linesError } = await supabase
          .from('journal_lines')
          .insert(linesToInsert)
          
        if (linesError) throw linesError
        
        // 7. Link JE to invoice
        await supabase
          .from('invoices')
          .update({ journal_entry_id: journalEntryId, status: 'posted' })
          .eq('id', recordId)
      }

      // 8. Insert audit log
      await supabase.from('audit_logs').insert({
        org_id: orgId,
        user_id: user.id,
        action: 'created',
        table_name: 'invoices',
        record_id: recordId,
        new_values: { invoice_number: invoiceNumber, type: record.type }
      })

    } else if (record.type === 'employee') {
      // 1. Insert employee
      const { data: employee, error: empError } = await supabase
        .from('employees')
        .insert({
          org_id: orgId,
          full_name: record.name,
          position: record.position || record.role,
          hire_date: record.hireDate || record.joinDate || new Date().toISOString().split('T')[0],
          basic_salary: record.basicSalary || 0,
          allowances: record.allowances || 0,
          contract_type: record.contractType || 'unlimited',
          status: 'active'
        })
        .select('id')
        .single()
        
      if (empError) throw empError
      recordId = employee.id

      // 2. Gratuity accrual (example logic, assuming function returns lines or values)
      const gratuity = calculateGratuity({
        basicSalary: record.basicSalary || 0,
        hireDate: record.hireDate || record.joinDate || new Date().toISOString(),
        contractType: record.contractType || 'unlimited',
      })
      const totalSalary = (record.basicSalary || 0) + (record.allowances || 0)
      const salaryLines = buildSalaryLines(totalSalary, `Salary: ${record.name}`)
      const mappedLines = salaryLines.map((line: any) => ({
        ...line,
        account_id: accountMap[line.account_code]
      })).filter((line: any) => line.account_id)

      // 4. Insert JE
      if (mappedLines.length > 0) {
        const { data: je, error: jeError } = await supabase
          .from('journal_entries')
          .insert({
            org_id: orgId,
            created_by: user.id,
            date: new Date().toISOString().split('T')[0],
            description: `Salary: ${record.name}`,
            source_type: 'employee',
            source_id: recordId,
            status: 'posted'
          })
          .select('id')
          .single()
          
        if (jeError) throw jeError
        journalEntryId = je.id

        const linesToInsert = mappedLines.map((line: any) => ({
          journal_entry_id: journalEntryId,
          account_id: line.account_id,
          debit: line.debit,
          credit: line.credit,
          description: line.description
        }))
        
        await supabase.from('journal_lines').insert(linesToInsert)
      }

      // 5. Audit
      await supabase.from('audit_logs').insert({
        org_id: orgId,
        user_id: user.id,
        action: 'created',
        table_name: 'employees',
        record_id: recordId,
        new_values: { name: record.name }
      })

    } else if (record.type === 'asset') {
      // 1. Insert fixed asset
      const { data: asset, error: assetError } = await supabase
        .from('fixed_assets')
        .insert({
          org_id: orgId,
          name: record.assetName || record.name,
          purchase_date: record.purchaseDate || new Date().toISOString().split('T')[0],
          purchase_cost: record.purchaseCost || record.purchasePrice || 0,
          salvage_value: record.salvageValue || 0,
          useful_life_years: record.usefulLifeYears || 5,
          supplier: record.supplier || null,
          status: 'active'
        })
        .select('id')
        .single()
        
      if (assetError) throw assetError
      recordId = asset.id

      // 2. Asset purchase journal
      const purchaseCost = record.purchaseCost || record.purchasePrice || 0
      const purchaseLines = buildAssetPurchaseLines(purchaseCost, true)
      const mappedPurchaseLines = purchaseLines.map((line: any) => ({
        ...line,
        account_id: accountMap[line.account_code]
      })).filter((line: any) => line.account_id)

      if (mappedPurchaseLines.length > 0) {
        const { data: je, error: jeError } = await supabase
          .from('journal_entries')
          .insert({
            org_id: orgId,
            created_by: user.id,
            date: record.purchaseDate || new Date().toISOString().split('T')[0],
            description: `Asset Purchase: ${record.assetName || record.name}`,
            source_type: 'fixed_asset',
            source_id: recordId,
            status: 'posted'
          })
          .select('id')
          .single()
          
        if (jeError) throw jeError
        journalEntryId = je.id
        
        await supabase.from('journal_lines').insert(mappedPurchaseLines.map((line: any) => ({
          journal_entry_id: journalEntryId,
          account_id: line.account_id,
          debit: line.debit,
          credit: line.credit,
          description: line.description
        })))
      }

      // 3. First depreciation
      const depreciationAmount = calculateMonthlyDepreciation({
        purchaseCost,
        salvageValue: record.salvageValue || 0,
        usefulLifeYears: record.usefulLifeYears || 5,
        purchaseDate: record.purchaseDate || new Date().toISOString().split('T')[0]
      })
      const depLines = buildDepreciationLines(depreciationAmount)
      const mappedDepLines = depLines.map((line: any) => ({
        ...line,
        account_id: accountMap[line.account_code]
      })).filter((line: any) => line.account_id)
      
      // 4 & 5. Insert depreciation JE
      if (mappedDepLines.length > 0) {
        const { data: depJe, error: depJeError } = await supabase
          .from('journal_entries')
          .insert({
            org_id: orgId,
            created_by: user.id,
            date: new Date().toISOString().split('T')[0],
            description: `Depreciation: ${record.assetName || record.name}`,
            source_type: 'depreciation',
            source_id: recordId,
            status: 'posted'
          })
          .select('id')
          .single()
          
        if (depJeError) throw depJeError
        
        await supabase.from('journal_lines').insert(mappedDepLines.map((line: any) => ({
          journal_entry_id: depJe.id,
          account_id: line.account_id,
          debit: line.debit,
          credit: line.credit,
          description: line.description
        })))
        
        // 6. Insert depreciation schedule
        await supabase.from('depreciation_schedules').insert({
          org_id: orgId,
          asset_id: recordId,
          journal_entry_id: depJe.id,
          period_date: new Date().toISOString().split('T')[0],
          depreciation_amount: depreciationAmount,
          accumulated_depreciation: depreciationAmount,
          net_book_value: purchaseCost - depreciationAmount,
          is_posted: true
        })
      }

      // 7. Audit log
      await supabase.from('audit_logs').insert({
        org_id: orgId,
        user_id: user.id,
        action: 'created',
        table_name: 'fixed_assets',
        record_id: recordId,
        new_values: { name: record.assetName || record.name }
      })

    } else if (record.type === 'relatedParty') {
      // 1. Insert related_party_transaction
      const { data: rpt, error: rptError } = await supabase
        .from('related_party_transactions')
        .insert({
          org_id: orgId,
          related_party_name: record.party || record.partyName,
          relationship_type: record.relationship || 'other',
          transaction_type: record.transactionType || 'other',
          transaction_date: record.date || new Date().toISOString().split('T')[0],
          amount: record.amount || 0,
          currency: record.currency || 'AED',
          is_arms_length: record.isArmsLength ?? true,
          notes: record.notes || null
        })
        .select('id')
        .single()
        
      if (rptError) throw rptError
      recordId = rpt.id
      
      // 2. Audit log
      await supabase.from('audit_logs').insert({
        org_id: orgId,
        user_id: user.id,
        action: 'created',
        table_name: 'related_party_transactions',
        record_id: recordId,
        new_values: { party: record.party || record.partyName }
      })
    } else {
      return NextResponse.json({ error: 'Unsupported record type' }, { status: 400 })
    }

    return NextResponse.json({ success: true, recordId, journalEntryId })

  } catch (error: any) {
    console.error('Error confirming record:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
