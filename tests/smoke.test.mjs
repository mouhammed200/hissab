import assert from 'node:assert/strict'
import fs from 'node:fs'
const schema = fs.readFileSync('supabase/migrations/001_foundation.sql','utf8')
assert.match(schema, /CREATE TABLE org_members/)
assert.match(fs.readFileSync('supabase/migrations/003_security_and_atomic_posting.sql','utf8'), /mem_insert_admin/)
assert.match(fs.readFileSync('src/app/api/cron/exchange-rates/route.ts','utf8'), /CRON_SECRET/)
console.log('security smoke checks passed')
