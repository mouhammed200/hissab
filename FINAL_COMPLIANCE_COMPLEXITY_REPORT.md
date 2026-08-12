# Hissab final code review and UAE checklist report

**Review basis:** supplied source bundle, architecture before/after HTML, implementation roadmap HTML, and UAE compliance checklist PDF supplied by Muhammed. **Review date:** 12 August 2026, Africa/Lagos.

## Executive verdict

The six-phase roadmap plus the non-eInvoicing closure migration are represented in the source and the architecture is materially cleaner, but **the UAE compliance release gate is not passed** until the live Supabase and browser gates pass. The bundle contains implementation work and tests; it has not been proven in the real Supabase environment, and the PINT AE/eInvoicing ASP boundary is not implemented.

Correct product claim today: **Hissab invoice capture and accounting prototype with a hardened accounting foundation.** Do not claim officially compliant UAE accounting/tax software yet.

## Before and after complexity

The supplied before/after architecture identifies ten competing accounting authorities before the rebuild:

1. Gemini/schema interpretation
2. Normalizer arithmetic
3. UI/card totals
4. Confirm route logic
5. Journal helper logic
6. Posting RPC logic
7. Direct table writes
8. Report queries
9. Export queries
10. Cron/recurring writes

The target architecture has four authorities:

1. Typed transaction contract
2. Policy service
3. Atomic posting/lifecycle RPCs
4. Posted-ledger read authority

**Architecture-path reduction:** `(10 - 4) / 10 = 60%`.

That is the honest percentage. It measures competing accounting paths, not source-line deletion. The current reviewed bundle is **79 code/test/migration files and 8,697 lines**, because hardening and tests were added before legacy paths can safely be removed. A LOC percentage would be misleading.

## Checklist review

| Checklist area | Status | Evidence / gap |
|---|---|---|
| Transactional onboarding and RLS | Implemented in code, live gate open | `007_phase1_foundation_hardening.sql`, `bootstrap_organization`, Phase 01 tests |
| Atomic posting boundary | Implemented for invoice records, live gate open | `008_phase2_accounting_spine.sql`, typed contract, posting RPC |
| Source/AED/VAT facts | Implemented for invoice/payment paths, live gate open | date-of-supply, FX date/source, AED totals |
| Payments and allocations | Implemented in code, live gate open | `post_payment_transaction`, amount and invoice-balance checks |
| Voids and corrections | Implemented in code for invoice, payment, employee, asset, related-party, and bank-match | migration 014 extends the atomic reversal RPC; live gate still required |
| Evidence retention | Implemented in code, deployment open | SHA-256, MIME/size, storage link, actor; private bucket policies still required |
| Bank reconciliation | Implemented in code, live gate open | duplicate-safe import plus controlled match/review/reconciled RPC |
| VAT facts and returns | Implemented in code, live gate open | posted-ledger builder plus persisted draft/reviewed/filed/paid/amended/locked workflow |
| Corporate Tax | Implemented in code, adviser/live gate open | posted-ledger workpaper snapshot, adjustments/workpaper persistence, existing QFZP/SBR/loss calculator |
| Excise | Implemented in code, scope limited | excise product facts and tier calculator; validate classifications/rates with UAE adviser before production |
| eInvoicing PINT AE / accredited ASP | Not implemented | no canonical PINT AE model or ASP adapter found |
| Audit and governance | Implemented in code, live gate open | audit diff trigger, correction reason, evidence link, request ID, actor type |
| Reports and exports | Implemented in code, live gate open | posted-ledger snapshot, manifest, source currency context, loud query failures |
| AI honesty | Implemented as a product boundary | unsupported chat actions removed/blocked; real command executors still absent |
| Arabic/accessibility/operations | Implemented in code, live deployment gate open | Arabic key parity, RTL, focus-visible, skip link, reduced motion, health endpoint, request IDs, shared DB AI rate limit |

## Non-eInvoicing closure applied in this revision

Migration `013_accessibility_operations.sql` adds an operational event table and retention-policy configuration. Migration `014_storage_ops_lifecycle.sql` adds the private evidence bucket and object policies, shared database rate limiting, recurring-posting RPC, and full employee/asset/related-party/bank-match void support. Migration `012_non_einvoice_compliance_closure.sql` adds persistent VAT return states and supporting schedules, bank reconciliation state transitions, excise product facts and tier calculation, audit triggers, and workflow APIs for VAT, bank reconciliation, and excise. This revision also adds Arabic key parity checks, RTL/keyboard/reduced-motion accessibility baselines, a no-store database health endpoint, request IDs, structured operational errors, and shared in-process AI rate limiting. The requested exception remains: PINT AE / accredited ASP eInvoicing is intentionally not implemented.

## Full code download

[Download the full reviewed code bundle](See the complete-code download link in the delivery message for this report)

## Exactly what to do next

1. Create a disposable Supabase staging project. Do not run this on production first.
2. Apply migrations `001` through `014` in order. Migration `014` creates the private `evidence` bucket and policies, so do not create a second bucket with a different name.
3. Verify Storage policies by testing: member read of `{org_id}/...`, non-member denial, viewer upload denial, accountant upload success, and cross-organization object denial.
4. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, and mandatory `CRON_SECRET`.
5. Run `npm ci`, typecheck, lint, structural tests, and the live Supabase Phase 01-06 gates.
6. Test AI throttling from two app instances or concurrent requests. Confirm counts are shared through `consume_rate_limit`, not process memory.
7. Test recurring processing twice for the same due template and confirm one posted journal, no direct journal insert path, and correct schedule advancement.
8. Test atomic voids for invoice, payment, employee, asset, related-party, and bank-match sources, including reversal journals, old/new audit values, reason, actor, and evidence link.
9. Run browser smoke tests in English and Arabic: extraction, review, registration, posting, payment, allocation, void, bank import/reconciliation, VAT, reports, export, settings, evidence, keyboard navigation, screen-reader labels, and reduced-motion mode.
10. Deploy `/api/health` behind your platform monitoring and alert on 503s, latency, 4xx/5xx/429 rates, failed exports/uploads, failed postings, and cron partial failures.
11. Run a staging backup/restore drill and verify evidence retrieval, audit export, VAT schedules, Corporate Tax workpapers, and retention-policy configuration.
12. Have a UAE-licensed tax adviser review VAT, Corporate Tax, excise, retention, and the explicit eInvoicing exception.
13. Keep PINT AE/accredited ASP eInvoicing disabled as a compliance claim. It is the only deliberate product-scope exception requested here.
14. Only after all live gates, browser tests, backup drill, and adviser review pass, deploy to production and publish the exact supported non-eInvoicing UAE accounting scope.

## Release decision

**Not release-ready as officially compliant UAE accounting/tax software.** The architecture direction is right and the core is substantially safer, but the missing PINT AE/ASP path and incomplete persistent tax/reconciliation workflows are hard blockers, not polish.
