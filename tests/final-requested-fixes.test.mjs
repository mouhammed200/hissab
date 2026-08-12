import assert from 'node:assert/strict'
import fs from 'node:fs'
const sql=fs.readFileSync('supabase/migrations/014_storage_ops_lifecycle.sql','utf8')
const gemini=fs.readFileSync('src/app/api/gemini/route.ts','utf8')
const recurring=fs.readFileSync('src/app/api/recurring/process/route.ts','utf8')
const report=fs.readFileSync('FINAL_COMPLIANCE_COMPLEXITY_REPORT.md','utf8')
assert.match(sql,/storage\.buckets/); assert.match(sql,/evidence_read/); assert.match(sql,/consume_rate_limit/); assert.match(sql,/post_recurring_transaction/); assert.match(sql,/v_type='employee'/); assert.match(sql,/v_type='bank_match'/)
assert.match(gemini,/consumeSharedRateLimit/); assert.doesNotMatch(gemini,/rateLimit\(/)
assert.match(recurring,/post_recurring_transaction/); assert.doesNotMatch(recurring,/\.from\('journal_entries'\).*\.insert/)
assert.match(report,/migrations `001` through `014`/); assert.match(report,/Download the full reviewed code bundle/)
console.log('requested fixes checks passed')