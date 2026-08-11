# Hissab — Tier 1 Fix Pass

Extract this archive over your repo root. Every file keeps its original path,
so paths line up 1:1 with the project. 14 files changed, 1 file added.

## Critical

| ID | File | Fix |
|:---|:---|:---|
| C1 | `src/hooks/useOrg.tsx` | Removed the fallback that attached a new user as `owner` of an arbitrary existing organization. Failure now throws. |
| C2 | `src/lib/supabase/guard.ts` **(new)** | `requireOrgAccess()` — authenticates the caller and verifies `org_members` membership, with optional role gating. |
| C2 | 7 API routes | All now call `requireOrgAccess`. Write routes additionally require `owner` / `admin` / `accountant`. |
| C3 | `src/app/callback/route.ts` | `next` is validated: must start with `/` and must not start with `//` or `/\`. Redirects built via `new URL(next, origin)`. |

Routes now guarded: `records/confirm`, `records/void`, `reports`, `export/excel`,
`recurring` (GET/POST/PUT/DELETE), `recurring/process`, `bank/import`.

`recurring` PUT/DELETE only receive a template `id`, so they resolve the owning
`org_id` first, then check membership. PUT also whitelists updatable columns so a
client can no longer rewrite `org_id`.

## High

| ID | File | Fix |
|:---|:---|:---|
| H1 | `ChatPane.tsx` | `'related_party'` -> `'relatedParty'` to match the Gemini schema. Related-party cards render again. |
| H2 | `ChatPane.tsx` | Chat history maps `assistant` -> `model`. Multi-turn no longer 400s. |
| H3 | `DashboardTab.tsx` | `invoice_type` / `issue_date` / `subtotal_amount` instead of `type` / `date`. Void + draft invoices excluded. |
| H4 | `RecordsTab.tsx` | `invoice_type`, `contacts(name)` join, `issue_date`, `full_name`, `basic_salary`, `hire_date`, `position`. |
| H5 | `confirm/route.ts` | Reads `record.reverseCharge` (schema field), also persists it to `invoices.is_reverse_charge`. |
| H6 | `ReportsTab.tsx` | Non-array report payloads normalized to arrays. Single-record reports render as a vertical key/value list. |
| H7 | `void/route.ts` | Writes to `audit_logs` with `table_name` / `record_id` / `new_values`. `audit_log` (singular) does not exist. |
| H8 | `excel/route.ts` | `issue_date`, `subtotal_amount`, `item.total`, plus `transaction_date` for related-party txns. |
| H9 | `recurring/process/route.ts` | `date` not `entry_date`, `created_by` populated, account codes resolved to `account_id` UUIDs. |
| H10 | `lib/supabase/middleware.ts` | Redirects copy the refreshed Supabase cookies, so rotated tokens survive. `/callback` excluded from the logged-in bounce. |

## Additional bugs found in the code that the audit missed

These were hard blockers, not polish:

1. **`journal_lines.org_id` was never set.** The column is `NOT NULL` and under RLS,
   so *every* journal line insert failed. Fixed in `confirm/route.ts` and
   `recurring/process/route.ts`.
2. **`contacts` insert used `type`.** The column is `contact_type`, so creating a
   new customer/vendor during confirm always errored out.
3. **`invoices` was updated to `status: 'posted'`.** Not a member of the
   `invoice_status` enum. Now only `journal_entry_id` is written; status stays `approved`.
4. **Zero-value journal lines.** `journal_lines` enforces `CHECK (debit > 0 OR credit > 0)`,
   so a zero-VAT line aborted the insert. Zero lines are filtered.
5. **`record.vatCategory` did not exist.** Sales fell through to the unbalanced
   fallback branch of `buildSaleJournalLines`. VAT treatment is now derived from the items.
6. **`fn_vat_return()` is not in the database.** The VAT 201 report is now computed
   in the route via `buildVatReturn201()` instead of calling a missing RPC.
7. **Silently dropped journal lines (M10).** Missing account codes now return
   HTTP 422 with the offending codes instead of posting half a double entry.
8. **`bank/import` never sent `bank_account_id`.** The column is `NOT NULL`; the route
   now falls back to the org's first active bank account and validates ownership.
9. **Report RPCs received full ISO timestamps** for `DATE` parameters. Now `YYYY-MM-DD`.

## Freebies from Tier 2/3 picked up along the way

- **M11**: dashboard VAT is now `output VAT - input VAT`, not 5% of gross revenue.
  Revenue and expenses are net of VAT.
- **M12 (partial)**: date handling switched to string slicing to avoid the UTC-4h shift.
- **L6**: `qty` of `0` no longer becomes `1` in `ChatPane` totals and invoice items.
- `bank/import` gained quoted-CSV parsing, DD/MM/YYYY support, debit/credit column
  support, a 5 MB cap, and a per-row rejection report.

## Still open

- **Tier 2 (M1-M10, M12)**: UAE tax logic in `src/lib/accounting/*`. Needs your call on
  the rules before I touch the math.
- **Tier 3 (L1-L15)**: UX and i18n polish.
- **`RecordCard.tsx` reads `record.relatedPartyDetails?.*`** but Gemini emits flat
  `party` / `relationship` / `transactionType` / `amount` / `isArmsLength`. The card
  now renders, but its related-party fields still show placeholders. That is L3/L4.
- **No `type` for the Supabase client**, so route queries are untyped. Generating
  types from the schema would have caught most of the column-name bugs above.
