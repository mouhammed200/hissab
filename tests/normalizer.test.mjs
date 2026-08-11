/**
 * Deterministic coverage for every record type the assistant can emit.
 *
 * Run: npm test   (requires Node 22.6+ for native TypeScript stripping)
 *
 * These cases are written against real failures observed in production, not
 * hypotheticals. Each one names the bug it locks down.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeRecord,
  validateRecord,
  computeTotals,
  computeTotalsInAed,
  isTransaction,
} from '../src/lib/records/normalize.ts'

/* ------------------------------------------------------------------ sale */

test('sale: itemized record keeps its details and totals correctly', () => {
  const record = normalizeRecord({
    type: 'sale',
    party: 'Acme Corp',
    currency: 'AED',
    items: [{ description: 'Laptop', qty: 5, price: 3000, discount: 0, category: 'standard' }],
  })
  const totals = computeTotals(record)
  assert.equal(record.items.length, 1)
  assert.equal(record.items[0].lineTotal, 15000)
  assert.equal(totals.subtotal, 15000)
  assert.equal(totals.vat, 750)
  assert.equal(totals.total, 15750)
  assert.equal(validateRecord(record).valid, true)
})

test('sale: detail-less record is rebuilt as a lump sum, never posted as zero', () => {
  // The exact production failure: "Sold 5 laptops to Acme Corp for 15,000 AED"
  // came back with no items, rendered as a blank "General" card, and posted 0.00.
  const record = normalizeRecord({ type: 'sale', party: 'Acme Corp', total: 15000 })
  assert.equal(record.items.length, 1)
  assert.equal(record.subtype, 'lumpSum')
  assert.equal(computeTotals(record).total, 15750)
  assert.match(record._normalizerWarnings.join(' '), /rebuilt a single lump-sum line/)
  assert.equal(validateRecord(record).valid, true)
})

test('sale: unrecoverable record is rejected with a readable reason', () => {
  const record = normalizeRecord({ type: 'sale', party: 'Acme Corp' })
  const result = validateRecord(record)
  assert.equal(result.valid, false)
  assert.match(result.errors[0], /at least one line item/)
})

test('sale: party is never silently invented', () => {
  const record = normalizeRecord({
    type: 'sale',
    items: [{ description: 'Service', qty: 1, price: 500, discount: 0, category: 'standard' }],
  })
  assert.equal(record.party, undefined)
  assert.match(validateRecord(record).warnings.join(' '), /No customer name/)
})

test('sale: mismatched line totals are recalculated and flagged', () => {
  const record = normalizeRecord({
    type: 'sale',
    party: 'Acme Corp',
    items: [{ description: 'Laptop', qty: 5, price: 3000, discount: 0, category: 'standard', lineTotal: 99 }],
  })
  assert.equal(record.items[0].lineTotal, 15000)
  assert.match(record._normalizerWarnings.join(' '), /did not match/)
})

test('sale: qty of zero is preserved, not promoted to one', () => {
  const record = normalizeRecord({
    type: 'sale',
    party: 'Acme Corp',
    items: [{ description: 'Sample', qty: 0, price: 100, discount: 0, category: 'standard' }],
  })
  assert.equal(record.items[0].qty, 0)
  assert.equal(validateRecord(record).valid, false)
})

test('sale: TRN warning fires above the FTA 10,000 AED threshold', () => {
  const record = normalizeRecord({
    type: 'sale',
    party: 'Acme Corp',
    items: [{ description: 'Laptop', qty: 5, price: 3000, discount: 0, category: 'standard' }],
  })
  assert.match(validateRecord(record).warnings.join(' '), /buyer TRN/)
})

/* -------------------------------------------------------------- currency */

test('foreign currency: AED totals come from the converted amount', () => {
  const record = normalizeRecord({
    type: 'sale',
    party: 'Globex',
    currency: 'USD',
    exchangeRate: 3.6725,
    amountInAED: 36725,
    vatInAED: 1836.25,
    items: [{ description: 'Licence', qty: 1, price: 10000, discount: 0, category: 'standard' }],
  })
  const aed = computeTotalsInAed(record)
  assert.equal(aed.subtotal, 36725)
  assert.equal(aed.total, 38561.25)
  // The record currency total must stay in USD.
  assert.equal(computeTotals(record).total, 10500)
})

test('foreign currency: no rate means no posting', () => {
  const record = normalizeRecord({
    type: 'sale',
    party: 'Globex',
    currency: 'USD',
    items: [{ description: 'Licence', qty: 1, price: 10000, discount: 0, category: 'standard' }],
  })
  assert.equal(computeTotalsInAed(record), null)
  assert.match(validateRecord(record).errors.join(' '), /no AED conversion/)
})

/* -------------------------------------------------------------- purchase */

test('purchase: lump sum renders with a line instead of an empty card', () => {
  const record = normalizeRecord({
    type: 'purchase',
    subtype: 'lumpSum',
    party: 'Carrefour',
    amount: 500,
  })
  assert.equal(record.items.length, 1)
  assert.equal(record.items[0].price, 500)
  assert.equal(validateRecord(record).valid, true)
})

test('purchase: zero-rated items carry no VAT', () => {
  const record = normalizeRecord({
    type: 'purchase',
    party: 'Export Co',
    items: [{ description: 'Export freight', qty: 1, price: 1000, discount: 0, category: 'zero' }],
  })
  assert.equal(computeTotals(record).vat, 0)
})

test('purchase: unknown VAT categories fall back to standard, never to nothing', () => {
  const record = normalizeRecord({
    type: 'purchase',
    party: 'Vendor',
    items: [{ description: 'Thing', qty: 1, price: 1000, discount: 0, category: 'outOfScope' }],
  })
  assert.equal(record.items[0].category, 'standard')
  assert.equal(computeTotals(record).vat, 50)
})

/* -------------------------------------------------------------- employee */

test('employee: nested employeeDetails survive normalization', () => {
  const record = normalizeRecord({
    type: 'employee',
    employeeDetails: {
      name: 'Fatima',
      position: 'Developer',
      basicSalary: 15000,
      allowances: 3000,
      hireDate: '2024-01-01',
      contractType: 'unlimited',
    },
  })
  assert.equal(record.name, 'Fatima')
  assert.equal(record.basicSalary, 15000)
  assert.equal(record.allowances, 3000)
  assert.equal(record.hireDate, '2024-01-01')
  assert.equal(validateRecord(record).valid, true)
})

test('employee: no salary is a hard error', () => {
  const record = normalizeRecord({ type: 'employee', name: 'Fatima' })
  assert.equal(validateRecord(record).valid, false)
  assert.match(validateRecord(record).errors.join(' '), /basic salary/)
})

/* ----------------------------------------------------------------- asset */

test('asset: nested assetDetails map onto the root fields', () => {
  const record = normalizeRecord({
    type: 'asset',
    assetDetails: { name: 'Delivery Van', cost: 90000, salvageValue: 5000, usefulLife: 6, supplier: 'Al Habtoor' },
  })
  assert.equal(record.assetName, 'Delivery Van')
  assert.equal(record.purchaseCost, 90000)
  assert.equal(record.usefulLifeYears, 6)
  assert.equal(record.supplier, 'Al Habtoor')
  assert.equal(validateRecord(record).valid, true)
})

test('asset: salvage value above cost is rejected', () => {
  const record = normalizeRecord({ type: 'asset', assetName: 'Van', purchaseCost: 1000, salvageValue: 5000 })
  assert.match(validateRecord(record).errors.join(' '), /Salvage value/)
})

/* --------------------------------------------------------- related party */

test('relatedParty: nested details are flattened and validated', () => {
  const record = normalizeRecord({
    type: 'relatedParty',
    relatedPartyDetails: { party: 'Zenith FZE', relationship: 'sister company', amount: 200000, isArmsLength: true },
  })
  assert.equal(record.party, 'Zenith FZE')
  assert.equal(record.amount, 200000)
  assert.equal(record.isArmsLength, true)
  assert.equal(validateRecord(record).valid, true)
})

test("relatedParty: unstated arm's-length status is warned about, not assumed silently", () => {
  const record = normalizeRecord({ type: 'relatedParty', party: 'Zenith FZE', amount: 200000 })
  assert.match(validateRecord(record).warnings.join(' '), /Arm's-length/)
})

test('relatedParty: missing amount blocks the record', () => {
  const record = normalizeRecord({ type: 'relatedParty', party: 'Zenith FZE' })
  assert.equal(validateRecord(record).valid, false)
})

/* -------------------------------------------------------- query / action */

test('query: answer text is preserved and the record is not treated as a transaction', () => {
  const record = normalizeRecord({ type: 'query', queryResponse: 'Your VAT due is AED 4,200.' })
  assert.equal(isTransaction(record.type), false)
  assert.equal(validateRecord(record).valid, true)
  assert.equal(record.queryResponse, 'Your VAT due is AED 4,200.')
})

test('action: actionType is mandatory', () => {
  assert.equal(validateRecord(normalizeRecord({ type: 'action' })).valid, false)
  assert.equal(
    validateRecord(normalizeRecord({ type: 'action', actionType: 'set_recurring', actionPayload: { amount: 15000 } }))
      .valid,
    true,
  )
})

/* ------------------------------------------------------------- resilience */

test('numeric strings and negatives are coerced without inventing digits', () => {
  const record = normalizeRecord({
    type: 'sale',
    party: 'Acme Corp',
    items: [{ description: 'Laptop', qty: '5', price: '3,000', discount: '-100', category: 'standard' }],
  })
  assert.equal(record.items[0].qty, 5)
  assert.equal(record.items[0].price, 3000)
  assert.equal(record.items[0].discount, 100)
  assert.equal(record.items[0].lineTotal, 14900)
})

test('garbage input degrades to an invalid record rather than throwing', () => {
  for (const input of [null, undefined, {}, { type: 'nonsense' }, { type: 'sale', items: 'not-an-array' }]) {
    const record = normalizeRecord(input)
    assert.ok(Array.isArray(record.items))
    assert.doesNotThrow(() => validateRecord(record))
  }
})
