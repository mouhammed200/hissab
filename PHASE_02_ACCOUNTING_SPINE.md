# Phase 02 - Build the accounting spine

## Completed in code

- Added `src/lib/accounting/policy.ts`: one policy authority for UAE VAT, accounting basis, reporting standard, revenue account mapping, source/AED monetary facts, and balanced-journal assertions.
- Added `src/lib/accounting/transaction-contract.ts`: one typed contract that derives source totals, AED totals, VAT category, and journal lines before posting.
- Rewired `/api/records/confirm` to use that contract. Client-provided totals and journal lines are no longer the route's accounting authority.
- Added migration `008_phase2_accounting_spine.sql`: date-of-supply and FX source/date facts, accounting policy persistence, new-organization policy seeding, deferred invoice-to-item total reconciliation, and a replacement posting RPC that stores the new facts.
- Added `tests/phase2-accounting-spine.test.mjs` for the structural contract checks.

## Exit signal

Every supported invoice posting now follows:

`normalized input -> typed transaction contract -> policy-derived facts -> balanced journal -> atomic RPC`

The source currency and AED totals are stored together, with exchange-rate date and source. Foreign-currency posting fails closed in the application when the rate is merely indicative or missing.

## Not silently claimed

The Phase 02 code still needs the live Supabase gate to pass. Phase 02 does not close the remaining P0 lifecycle work: payments, allocations, void/reversal, evidence retention, VAT return persistence, eInvoicing ASP boundary, and full report reconciliation.
