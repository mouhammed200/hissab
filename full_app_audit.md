> **STATUS: PARTIALLY SUPERSEDED (see FIX_REPORT.md).**
> Items H1, H2, L6 and M12 were already fixed in the source when this document
> was last circulated. The record-extraction defects (empty sale cards, zero-value
> postings, lost nested fields, acquisition-time depreciation, unused amountInAED,
> retired Gemini model) are fixed in FIX_REPORT.md. Remaining items in this file
> have not been re-verified.

# 🔍 Hissab Full Application Audit Report

> **Audited**: 40+ source files across Frontend, Panel, API Routes, Accounting Engine, Auth, i18n, and Infrastructure.
> **Date**: 2026-08-10

---

## 🔴 CRITICAL — Security & Data Integrity Vulnerabilities

These must be fixed **immediately** before any production deployment.

---

### C1. Multi-Tenant Security Breach in `useOrg.tsx` Fallback Logic

**File**: [useOrg.tsx](file:///c:/Users/bouzi/Downloads/Hissab/src/hooks/useOrg.tsx) — Lines 60–73

```ts
if (orgErr || !newOrg) {
  const { data: fallbackOrgs } = await supabase.from('organizations').select('*').limit(1)
  if (fallbackOrgs && fallbackOrgs.length > 0) {
    await supabase.from('org_members').insert({ org_id: fallbackOrg.id, user_id: user.id, role: 'owner' })
  }
}
```

> [!CAUTION]
> If org creation fails, the hook queries for **any** existing organization and assigns the new user as `owner`. A new user can hijack an existing company's entire financial workspace.

**Fix**: Remove the fallback entirely. If org creation fails, display an error — never attach to a random org.

---

### C2. Missing Organization Access Control on 7 API Routes

The following routes extract `orgId` from the request body/params but **never verify** the user is a member of that org:

| Route | File |
|:---|:---|
| `/api/records/confirm` | [confirm/route.ts](file:///c:/Users/bouzi/Downloads/Hissab/src/app/api/records/confirm/route.ts) L23 |
| `/api/records/void` | [void/route.ts](file:///c:/Users/bouzi/Downloads/Hissab/src/app/api/records/void/route.ts) L20 |
| `/api/reports` | [reports/route.ts](file:///c:/Users/bouzi/Downloads/Hissab/src/app/api/reports/route.ts) L14 |
| `/api/export/excel` | [excel/route.ts](file:///c:/Users/bouzi/Downloads/Hissab/src/app/api/export/excel/route.ts) L15 |
| `/api/recurring` | [recurring/route.ts](file:///c:/Users/bouzi/Downloads/Hissab/src/app/api/recurring/route.ts) L10,32,62,85 |
| `/api/recurring/process` | [process/route.ts](file:///c:/Users/bouzi/Downloads/Hissab/src/app/api/recurring/process/route.ts) L10 |
| `/api/bank/import` | [import/route.ts](file:///c:/Users/bouzi/Downloads/Hissab/src/app/api/bank/import/route.ts) L11 |

> [!CAUTION]
> Any authenticated user can read, write, void, or export **any organization's** financial data by changing `orgId`.

**Fix**: Add `org_members` membership check (same pattern as `/api/gemini` route) to every route.

---

### C3. Open Redirect Vulnerability in Auth Callback

**File**: [callback/route.ts](file:///c:/Users/bouzi/Downloads/Hissab/src/app/callback/route.ts) — Lines 7, 13

```ts
const next = searchParams.get('next') ?? '/app'
return NextResponse.redirect(`${origin}${next}`)
```

> [!WARNING]
> `next` parameter is unsanitized. Values like `//attacker.com` redirect authenticated users to external malicious sites.

**Fix**: Validate that `next` starts with `/` and does not start with `//`.

---

## 🔴 HIGH — Bugs Causing Empty/Broken UI & Wrong Data

These are the bugs causing the **empty record cards** and incorrect dashboard data you're seeing.

---

### H1. `ChatPane.tsx` L66: `'related_party'` vs `'relatedParty'` Type Mismatch

```ts
const isTransaction = parsedRecord && ['sale', 'purchase', 'employee', 'asset', 'related_party'].includes(parsedRecord.type);
```

**Impact**: Related party transactions never render a card. Schema uses `'relatedParty'` (camelCase).

---

### H2. `ChatPane.tsx` L52: Chat History Sends `role: 'assistant'` to Gemini (Requires `'model'`)

```ts
const chatHistory = messages.map(m => ({ role: m.role, content: m.content }));
```

**Impact**: Gemini API strictly requires `'user'` or `'model'`. Sending `'assistant'` causes `400 Bad Request` on multi-turn conversations, breaking all follow-up messages.

---

### H3. `DashboardTab.tsx` L76,96-97: Querying Non-Existent DB Columns (`type`, `date`)

```ts
supabase.from('invoices').select('type, total_amount, date, created_at, status')
// ...
if (inv.type === 'SALE') totalRevenue += amt
if (inv.type === 'PURCHASE') totalExpenses += amt
```

**Impact**: Actual DB columns are `invoice_type` (`'sales_invoice'`/`'purchase_invoice'`) and `issue_date`. Revenue, expenses, net profit, VAT, and **all chart data permanently show 0/empty**.

---

### H4. `RecordsTab.tsx` L39-42,56-58: Wrong Column Names for Invoices & Employees

| Code Uses | Actual DB Column | Effect |
|:---|:---|:---|
| `inv.type === 'SALE'` | `invoice_type === 'sales_invoice'` | All invoices shown as "Purchase" |
| `inv.party_name` | Does not exist (need join to `contacts`) | Always "Unknown Party" |
| `inv.date` | `issue_date` | Falls back to `created_at` |
| `emp.first_name` / `emp.last_name` | `full_name` | Always "Employee" |
| `emp.base_salary` | `basic_salary` | Always AED 0.00 |
| `emp.join_date` | `hire_date` | Wrong date |

---

### H5. `confirm/route.ts` L131: `record.isReverseCharge` vs Schema `record.reverseCharge`

```ts
journalLines = buildPurchaseJournalLines(totals?.subtotal || 0, totals?.vat || 0, record.isReverseCharge)
```

**Impact**: Gemini schema outputs `reverseCharge`. Route checks `isReverseCharge` (always `undefined`). **Reverse charge accounting is never triggered**.

---

### H6. `ReportsTab.tsx` L116-118: `renderTable` Always Shows "No Data" for Non-Array Reports

```ts
const renderTable = (rows: any[]) => {
  if (!rows.length) return <p>No data for this period.</p>
```

**Impact**: VAT Return, Balance Sheet, and P&L return single objects (not arrays). `object.length` is `undefined` → always shows "No data".

---

### H7. `void/route.ts` L32 vs `confirm/route.ts` L181: Audit Log Table Name Inconsistency

| Route | Table Used | Columns |
|:---|:---|:---|
| `confirm/route.ts` | `audit_logs` (plural) | `table_name`, `record_id`, `new_values` |
| `void/route.ts` | `audit_log` (singular) | `entity_type`, `entity_id`, `details` |

**Impact**: One of these will throw a runtime DB error depending on which table actually exists.

---

### H8. `excel/route.ts` L60,62,77: Invoice Export Produces `undefined` Cells

```ts
Date: inv.date,        // Actual column: issue_date
Subtotal: inv.subtotal // Actual column: subtotal_amount
```

**Impact**: All exported Excel invoice rows contain blank Date, Subtotal, and Item Total columns.

---

### H9. `recurring/process/route.ts` L43,55: Wrong Column Names for Journal Entries

```ts
entry_date: today,        // Actual column: date
account_code: line.account_code  // Actual column: account_id (UUID FK)
```

**Impact**: Recurring transaction processing always fails with PostgreSQL column-not-found errors.

---

### H10. Middleware Auth Cookie Loss on Redirect

**File**: [middleware.ts](file:///c:/Users/bouzi/Downloads/Hissab/src/lib/supabase/middleware.ts) — L35,42

```ts
return NextResponse.redirect(url) // Discards supabaseResponse with refreshed cookies
```

**Impact**: Refreshed auth tokens are lost during redirects, causing intermittent session drops.

---

## 🟠 MEDIUM — Accounting Compliance & Logic Errors

---

### M1. `vat.ts`: Outdated UAE Weekend Logic (Sat/Sun since Jan 2022)

Filing deadline shifts to Sunday instead of Monday. **Fix**: Weekend = Saturday (6) + Sunday (0), shift to Monday (1).

### M2. `vat.ts`: `isImport` Flag Ignored in VAT 201 Return

Import purchases go to Box 8 instead of Box 5/9. `box5Amount` hardcoded to `0`.

### M3. `corporate-tax.ts`: Missing 75% Loss Carry-Forward Cap (Article 37)

100% of `carriedForwardLosses` deducted instead of statutory maximum 75%.

### M4. `corporate-tax.ts`: AED 375K Threshold Incorrectly Applied to QFZP

Free Zone qualifying persons should not receive the 375K 0% band on non-qualifying income.

### M5. `gratuity.ts`: Historical Average Instead of Current Monthly Accrual

`cappedGratuity / (yearsOfService * 12)` returns lifetime average, not current-period expense.

### M6. `gratuity.ts`: Zero Accrual in First Year of Employment

IAS 19 requires monthly accrual from Month 1. Current code returns `0` until Year 1 completes.

### M7. `fx.ts`: Always Fetches Latest Rate Instead of Date-of-Supply Rate

Violates FTA VATP004 (Article 69) which requires rate on exact supply date. Also mislabels third-party API data as "CBUAE".

### M8. `journal.ts`: Unbalanced Fallback Journal Entry

When `vatCategory` is none of `standard`/`zero`/`exempt`, DR includes VAT but CR does not. **DR ≠ CR**.

### M9. `journal.ts`: Missing VAT Metadata on Purchase Lines

Purchase journal lines lack `vat_category`, `vat_amount`, preventing downstream VAT reports from identifying input VAT.

### M10. `confirm/route.ts` L135-138: Silent Dropping of Journal Lines

```ts
.filter((line: any) => line.account_id)
```

If an account code is missing from the Chart of Accounts, one side of the double entry is silently removed, creating **unbalanced journal entries**.

### M11. `DashboardTab.tsx` L130: VAT Calculated as 5% of Revenue

```ts
const vatDue = totalRevenue * 0.05
```

Should be `Output VAT - Input VAT`, not gross revenue × 5%. Ignores zero-rated, exempt, and recoverable input VAT.

### M12. `depreciation.ts`: UTC Timezone Date Shift & Skipped Acquisition Month

ISO conversion shifts dates -1 day in UAE timezone (UTC+4). Schedule starts at `month + 1`, skipping purchase month.

---

## 🟡 LOW — UX, i18n, and Code Quality Issues

---

### L1. `SettingsModal.tsx` L165-168: Free Zone Toggle Double-Click Bug

`onClick` on `<div>` inside `<label>` triggers twice (div click + label implicit click). Toggle appears non-responsive.

### L2. `MessageList.tsx` L65-67: Suggestion Cards Not Clickable

`cursor-pointer` styling but no `onClick` handler. Clicking suggestions does nothing.

### L3. `RecordCard.tsx`: No Edit Controls for Employee/Asset/Related Party

Save/Cancel buttons render, but no editable `<input>` fields exist for non-item record types.

### L4. `RecordCard.tsx`: Related Party Card Missing Amount & Transaction Details

Card body only shows Party + Relationship. Missing: `amount`, `transactionType`, `isArmsLength`.

### L5. `InputBar.tsx` L43-51: Speech Recognition Duplicates Words

`interimResults = true` + `setText(prev => prev + transcript)` causes repeated appending of interim fragments.

### L6. `ChatPane.tsx` L26: Quantity `0` Treated as `1`

`item.qty || 1` — falsy `0` falls back to `1`, miscalculating line totals.

### L7. `ChatPane.tsx` L201-203: File Upload Sends Filename Only

Camera/file capture only sends `"Uploaded file: photo.jpg"` text. Actual file bytes are discarded.

### L8. `validation.ts` L24: `NaN` Silent Pass When Discount is Undefined

`item.qty * item.price - undefined` = `NaN`. Validation silently passes.

### L9. `AppShell.tsx` L53: Blank Screen When `org` is Null

No error message or redirect — just returns `null` rendering a white page.

### L10. `Panel.tsx` L59: Hardcoded `border-l` Not RTL-Aware

Should use logical `border-s` for RTL Arabic layout.

### L11. `cron/exchange-rates`: Rates Fetched But Never Saved to Database

Rates returned in HTTP response but not persisted to `exchange_rates` table.

### L12. `cron/exchange-rates` L9: Auth Bypass When `CRON_SECRET` is Unset

If env var is missing, the `if` guard is bypassed entirely — endpoint is publicly accessible.

### L13. Various Files: Hardcoded Strings Instead of Translation Keys

Affects: `RecordCard.tsx` type labels, `MessageList.tsx` timestamps, `ReportsTab.tsx` loading/error states, `AuditTab.tsx` action/table names.

### L14. `locale.tsx`: SSR Hydration Mismatch

Defaults to `'en'` on server, then switches to `'ar'` client-side, causing Next.js hydration warnings and layout flicker.

### L15. `RecordsTab.tsx` L136: Clickable Row Styling But No `onClick` Handler

`cursor-pointer` with no click action.

---

## 📊 Summary by Severity

| Severity | Count | Key Impact |
|:---|:---:|:---|
| 🔴 **Critical** | 3 | Multi-tenant data breach, org hijacking, open redirect |
| 🔴 **High** | 10 | Empty cards, broken dashboard, wrong DB columns, lost auth cookies |
| 🟠 **Medium** | 12 | UAE tax law violations, unbalanced journals, wrong VAT/gratuity calculations |
| 🟡 **Low** | 15 | UX bugs, i18n gaps, code quality |
| **Total** | **40** | |

---

## 🎯 Recommended Fix Priority

> [!IMPORTANT]
> **Tier 1 (Before Deploy)**: C1, C2, C3, H1, H2, H3, H4, H5, H6, H7, H8, H9, H10
>
> **Tier 2 (Accounting Compliance)**: M1–M12
>
> **Tier 3 (UX Polish)**: L1–L15
