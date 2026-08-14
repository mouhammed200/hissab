import assert from 'node:assert/strict'
import fs from 'node:fs'

const sql = fs.readFileSync('supabase/migrations/016_void_idempotency_guard.sql', 'utf8')

assert.match(sql, /CREATE OR REPLACE FUNCTION public\.void_record_transaction/)
assert.match(sql, /Invoice already voided/)
assert.match(sql, /Payment already voided/)
assert.match(sql, /Employee already terminated/)
assert.match(sql, /Asset already disposed/)
assert.match(sql, /Bank transaction is already unmatched/)
assert.match(sql, /Linked journal entry is already voided\/reversed/)
// guard must run before the reversal insert, not after
assert.ok(
  sql.indexOf('Linked journal entry is already voided') < sql.indexOf("INSERT INTO journal_entries(org_id,created_by,date,reference,description,source_type,source_id,status,posted_at,posted_by)\n      SELECT org_id,v_user,date,'REV-'"),
  'idempotency check must precede reversal journal insert'
)

console.log('void idempotency guard checks passed')
