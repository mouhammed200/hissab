import assert from 'node:assert/strict'
import fs from 'node:fs'
const report=fs.readFileSync('FINAL_COMPLIANCE_COMPLEXITY_REPORT.md','utf8')
const app=fs.readFileSync('src/components/AppShell.tsx','utf8')
const gemini=fs.readFileSync('src/app/api/gemini/route.ts','utf8')
const schema=fs.readFileSync('src/lib/gemini/schema.ts','utf8')
assert.match(report,/PINT AE ?\/ ?(accredited )?ASP/)
assert.match(report,/browser smoke tests/)
assert.match(app,/id="main-content"/)
assert.match(gemini,/requestId/)
assert.doesNotMatch(schema,/PINT AE|accredited ASP/)
console.log('final checklist checks passed')