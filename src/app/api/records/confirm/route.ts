import { NextResponse } from 'next/server'
import { requireOrgAccess, WRITE_ROLES } from '@/lib/supabase/guard'
import { buildSaleJournalLines, buildPurchaseJournalLines, buildSalaryLines, buildAssetPurchaseLines, buildDepreciationLines, type JournalLineInput } from '@/lib/accounting/journal'
import { calculateMonthlyDepreciation } from '@/lib/accounting/depreciation'

function num(value: unknown, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback }
function totalsFor(record: any) {
  if (!Array.isArray(record.items)) return { subtotal: num(record.amount || record.purchaseCost), vat: 0, discount: 0, total: num(record.amount || record.purchaseCost) }
  let subtotal=0, vat=0, discount=0
  for (const item of record.items) { const q=num(item.qty,1), p=num(item.price), d=num(item.discount); const net=Math.max(0,q*p-d); const rate=item.category==='standard' ? .05 : 0; subtotal+=net; discount+=d; vat+=net*rate }
  return { subtotal, vat, discount, total: subtotal+vat }
}
function journalLines(record: any, totals: any): JournalLineInput[] {
  if (record.type==='sale') return buildSaleJournalLines(totals.subtotal, totals.vat, Array.isArray(record.items)&&record.items.some((i:any)=>i.category==='standard')?'standard':'zero')
  if (record.type==='purchase') return buildPurchaseJournalLines(totals.subtotal, totals.vat, Boolean(record.reverseCharge))
  if (record.type==='employee') return buildSalaryLines(num(record.basicSalary)+num(record.allowances), `Salary: ${record.name || 'Employee'}`)
  if (record.type==='asset') { const cost=num(record.purchaseCost || record.purchasePrice); return [...buildAssetPurchaseLines(cost,true), ...buildDepreciationLines(calculateMonthlyDepreciation({ purchaseCost:cost, salvageValue:num(record.salvageValue), usefulLifeYears:num(record.usefulLifeYears,5), purchaseDate:record.purchaseDate || record.date || new Date().toISOString().slice(0,10) }))] }
  return []
}
export async function POST(req: Request) {
  try {
    const body = await req.json(); const { orgId, record } = body
    const guard = await requireOrgAccess(orgId, { roles: WRITE_ROLES }); if (!guard.ok) return guard.response
    if (!record?.type) return NextResponse.json({ error: 'Missing record' }, { status: 400 })
    const totals = totalsFor(record); const key = req.headers.get('idempotency-key') || body.requestKey
    if (!key) return NextResponse.json({ error: 'Missing Idempotency-Key' }, { status: 400 })
    const { data, error } = await guard.supabase.rpc('post_record_transaction', { p_request: { org_id: orgId, request_key: key, record, totals, journal_lines: journalLines(record, totals) } })
    if (error) throw error
    return NextResponse.json(data)
  } catch (error: any) { return NextResponse.json({ error: error.message || 'Atomic posting failed' }, { status: 500 }) }
}
