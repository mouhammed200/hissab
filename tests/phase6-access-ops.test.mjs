import assert from 'node:assert/strict'
import fs from 'node:fs'
const en=JSON.parse(fs.readFileSync('src/messages/en.json','utf8'))
const ar=JSON.parse(fs.readFileSync('src/messages/ar.json','utf8'))
const css=fs.readFileSync('src/app/globals.css','utf8')
const shell=fs.readFileSync('src/components/AppShell.tsx','utf8')
const health=fs.readFileSync('src/app/api/health/route.ts','utf8')
const limit=fs.readFileSync('src/lib/ops/rate-limit.ts','utf8')
assert.deepEqual(Object.keys(en.records).sort(), Object.keys(ar.records).sort())
assert.match(css,/focus-visible/); assert.match(css,/prefers-reduced-motion/); assert.match(shell,/skip-link/); assert.match(health,/status: 'healthy'/); assert.match(limit,/consume_rate_limit/)
console.log('Arabic/accessibility/operations checks passed')