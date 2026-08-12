import assert from 'node:assert/strict'
import fs from 'node:fs'
const sql=fs.readFileSync('supabase/migrations/012_non_einvoice_compliance_closure.sql','utf8')
assert.match(sql,/persist_vat_return/); assert.match(sql,/build_vat_return/); assert.match(sql,/reconcile_bank_transaction/); assert.match(sql,/calculate_excise/); assert.match(sql,/audit_row_change/)
assert.match(fs.readFileSync('src/app/api/vat/route.ts','utf8'),/persist_vat_return/)
assert.match(fs.readFileSync('src/app/api/bank/reconcile/route.ts','utf8'),/reconcile_bank_transaction/)
assert.match(fs.readFileSync('src/app/api/excise/route.ts','utf8'),/excise_product_facts/)
console.log('non-eInvoicing compliance closure checks passed')
