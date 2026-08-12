import assert from 'node:assert/strict'
import fs from 'node:fs'
const schema=fs.readFileSync('src/lib/gemini/schema.ts','utf8')
const prompt=fs.readFileSync('src/lib/gemini/prompts.ts','utf8')
const route=fs.readFileSync('src/app/api/gemini/route.ts','utf8')
const records=fs.readFileSync('src/components/panel/RecordsTab.tsx','utf8')
assert.doesNotMatch(schema, /generate_pdf|file_vat_return|set_budget/)
assert.match(prompt, /does not pretend to execute commands/)
assert.match(route, /Product honesty gate/)
assert.match(records, /related_party_transactions/)
assert.match(records, /fixed_assets/)
assert.match(records, /value=\"Asset\"/)
assert.match(records, /value=\"Related Party\"/)
console.log('phase 4 product honesty checks passed')
