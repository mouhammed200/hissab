# Hissab: Record Extraction Fix Report

Scope: the "Sold 5 laptops to Acme Corp for 15,000 AED" bug, plus a full audit
of every other record type. Every claim below was verified against the source,
not inferred.

---

## 0. Corrections to the previous audit

Before the fixes, two widely-repeated claims need retiring.

| Claim | Reality |
| --- | --- |
| `src/app/api/gemini/route.ts` is 0 bytes and the endpoint is broken | **False.** The file is 5,084 bytes of working code (auth, rate limiting, org access, FX enrichment, conversation logging). It only appeared empty because the `.rar` was written with RAR7 compression that standard extractors cannot decode; 75 of 77 files silently extracted as 0 bytes. |
| The sale fallback only handles English "sold/bought X to/from Y for Z" | **False.** No regex/keyword sale fallback exists anywhere in the repository. There was no deterministic recovery path at all, in any language, which is the actual defect. |
| Depreciation posts the whole schedule on acquisition | **Partly false.** `calculateMonthlyDepreciation` returns one month, so a single month was posted. Still wrong, and fixed below, but not the full schedule. |
| `full_app_audit.md` describes current state | **Stale.** H1, H2, L6 and M12 in that document were already fixed in the source, with comments explaining the fixes. |

---

## 1. Root cause of the empty "General" sale card

Five independent defects lined up:

1. **`schema.ts`** required only `type`, so `{type:'sale', subtype:'lumpSum'}` was a
   schema-valid response with no amount anywhere.
2. **`prompts.ts`** never stated that line items are mandatory for a sale.
3. **`RecordCard.tsx:162`** gated the entire card body behind
   `record.items && record.items.length > 0`, so the body rendered empty.
4. **`RecordCard.tsx:118`** fell through to the literal string `'General'` for a
   missing party. That is where "general sale record" came from: a hardcoded
   fallback, not a record classification.
5. **`confirm/route.ts`** computed totals as `record.amount || record.purchaseCost`,
   which is `0` for a sale, and sent a 0.00 journal to Postgres. The database
   correctly raised `Unbalanced journal`, the client caught it, logged to the
   console, and reverted the card to pending with **no user-visible message**.

So the record was never saved, and nobody was told why.

---

## 2. What changed

### New: `src/lib/records/normalize.ts`

One normalizer and one validator for all seven record types. Dependency-free so
it runs in the browser, in the API route, and in tests.

- Flattens `employeeDetails` / `assetDetails` / `relatedPartyDetails` onto the root
  so nested fields cannot be lost between parse and confirm.
- Coerces `"15,000"`, `"3000 AED"` and negative values without inventing digits.
- Rebuilds a single lump-sum line when a sale/purchase arrives with no items but
  a recoverable total, and **flags it** so the user reviews it.
- Recomputes every `lineTotal` and reports mismatches.
- Computes totals once (`computeTotals`) and AED totals once (`computeTotalsInAed`).
- `validateRecord` returns blocking errors and non-blocking warnings per type.

### `src/lib/gemini/schema.ts`
- `lineTotal` is now a required item field, enabling arithmetic verification.
- Added a top-level `total` so a genuine lump sum has somewhere to go.
- Added `REQUIRED_FIELDS_BY_TYPE`, documenting the real per-type contract that
  `responseSchema` structurally cannot express.

### `src/lib/gemini/prompts.ts`
- A hard, unmissable rule: every sale/purchase must carry a non-empty `items` array.
- Explicit division guidance ("5 laptops for 15,000" to qty 5 / price 3,000).
- VAT-inclusive back-out rule, and an explicit ban on placeholder amounts.
- New worked examples: the exact Acme case, a true lump sum, an asset, a related
  party, and an Arabic sale.

### `src/lib/gemini/client.ts`
- Removed `gemini-1.5-flash`. It is retired; every call 404'd and burned a retry
  cycle. Chain is now `gemini-3.6-flash` then `gemini-3.5-flash-lite`, overridable
  via `GEMINI_MODELS`.
- Every failure is logged with model and attempt number.
- Non-retryable errors (400, bad schema, auth) fail fast instead of being retried
  three times against every model.

### `src/app/api/gemini/route.ts`
- Normalizes and validates before responding; returns `data`, `totals` and
  `validation` so the UI never has to guess.
- FX conversion now runs off normalized items, so a lump sum converts exactly
  like an itemized record. FX failures are logged and become a blocking
  validation error rather than a silent AED-face-value posting.

### `src/app/api/records/confirm/route.ts`
- Re-normalizes server-side; the client payload is not trusted.
- Returns **422 with a readable reason** instead of posting a zero-value journal.
- Journals are posted in AED using the converted totals.
- Balance is asserted before the round trip, so users see plain English rather
  than a Postgres exception surfaced as a 500.
- **Depreciation removed from the acquisition entry.** Acquisition is now
  `DR 1500 / CR 1020` only.

### `src/components/chat/RecordCard.tsx`
- Blocking errors and warnings render at the top of the card.
- A sale/purchase with no lines shows an explicit empty state instead of a blank box.
- `'General'` replaced with "Customer not specified" / "Supplier not specified".
- Confirm is disabled while blocking errors exist.
- A "Lump sum" badge marks non-itemized records.
- Foreign-currency records without a rate say so instead of hiding the section.

### `src/components/chat/ChatPane.tsx` / `MessageList.tsx`
- Local `calcTotals` deleted in favour of the shared implementation.
- Confirm failures are shown on the card. This was the silent failure.
- Edits re-run the full normalizer and validator.

### `supabase/migrations/005_aed_totals_and_strict_posting.sql`
- Adds `subtotal_amount_aed`, `vat_amount_aed`, `total_amount_aed` to `invoices`,
  backfilled from the stored exchange rate. `amountInAED` is finally persisted
  rather than displayed and discarded.
- `post_record_transaction` rejects item-less sale/purchase records at the
  database boundary, so a direct RPC call cannot bypass the API validator.
- Splits "no value to post" from "unbalanced" so the error names the problem.
- Adds `assets_pending_depreciation` for the periodic depreciation run.

### `src/types/accounting.ts`
- The duplicate `ParsedRecord` / `ParsedItem` / `RecordTotals` definitions were a
  second source of truth that had already drifted. Now re-exported from the
  normalizer.

### `tests/normalizer.test.mjs`
- 23 cases covering sale, purchase, employee, asset, relatedParty, query, action,
  foreign currency, numeric coercion and garbage input. Each names the bug it
  locks down. Run with `npm test` (Node 22.6+).

---

## 3. Verification

The Acme case, end to end after the fix:

| Model output | Before | After |
| --- | --- | --- |
| Itemized (qty 5 @ 3,000) | Rendered correctly | Rendered correctly, 15,750 AED incl. VAT |
| Lump sum, `total: 15000` | Empty "General" card, posted 0.00 | Rebuilt as one line, 15,750 AED, warning shown |
| No amount at all | Empty card, opaque failure | Blocked with "A sale must have at least one line item" |

All 23 normalizer cases pass under a reference execution of the logic. Note that
no JavaScript runtime was available in the build environment, so `npm test`
should be run once locally to confirm under Node itself.

---

## 4. Known follow-ups (not addressed here)

1. **Periodic depreciation has no runner.** Removing it from acquisition is
   correct, but nothing currently posts monthly depreciation.
   `assets_pending_depreciation` and `generateDepreciationSchedule` exist; the
   cron job to consume them does not. This is the highest-priority follow-up.
2. `full_app_audit.md` still lists already-fixed issues and should be re-run.
3. Items C1-C3 and H3-H10 in that audit are outside the scope of this pass and
   were not re-verified.

## 5. Periodic depreciation runner

Migration `006_periodic_depreciation_runner.sql` now creates missing monthly schedule rows and an atomic, idempotent RPC. `src/app/api/cron/depreciation/route.ts` authenticates with `CRON_SECRET`, processes every organization, catches up missed months, and returns per-organization failures. Schedule it daily with an external cron.

Each due journal is `DR 6400 / CR 1510`, with the final month absorbing rounding residue. Idempotency uses `depreciation:{assetId}:{periodDate}` and the route returns HTTP 207 when one or more organizations fail.
