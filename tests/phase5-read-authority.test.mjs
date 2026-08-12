import assert from 'node:assert/strict'
import fs from 'node:fs'
const sql=fs.readFileSync('supabase/migrations/010_phase5_read_authority.sql','utf8')
const dash=fs.readFileSync('src/components/panel/DashboardTab.tsx','utf8')
const reports=fs.readFileSync('src/app/api/reports/route.ts','utf8')
const exportRoute=fs.readFileSync('src/app/api/export/excel/route.ts','utf8')
assert.match(sql,/fn_hissab_read_snapshot/)
assert.match(sql,/source','posted_ledger/)
assert.match(dash,/fn_hissab_read_snapshot/)
assert.doesNotMatch(dash,/allInvoicesRes/)
assert.match(reports,/case 'snapshot'/)
assert.match(exportRoute,/Export Manifest/)
assert.match(exportRoute,/if \(error\)/)
console.log('phase 5 read authority checks passed')
