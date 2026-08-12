import assert from 'node:assert/strict'
import fs from 'node:fs'

const migration = fs.readFileSync('supabase/migrations/008_phase2_accounting_spine.sql', 'utf8')
const contract = fs.readFileSync('src/lib/accounting/transaction-contract.ts', 'utf8')
const policy = fs.readFileSync('src/lib/accounting/policy.ts', 'utf8')
const confirm = fs.readFileSync('src/app/api/records/confirm/route.ts', 'utf8')

assert.match(migration, /date_of_supply DATE/)
assert.match(migration, /exchange_rate_source TEXT/)
assert.match(migration, /trg_assert_invoice_fact_totals/)
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.post_record_transaction/)
assert.match(contract, /buildTransactionContract/)
assert.match(contract, /assertBalanced\(journalLines\)/)
assert.match(policy, /Indicative FX rates cannot be used for posting/)
assert.match(policy, /categoryToRevenueAccount/)
assert.doesNotMatch(confirm, /computeTotalsInAed/)
assert.match(confirm, /buildTransactionContract/)
console.log('phase 2 accounting spine checks passed')
