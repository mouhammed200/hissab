# Phase 06 - Prove it, then expand

Completed in code:

- Added persisted Corporate Tax workpapers with accounting-profit source, adjustments, taxable income, tax due, QFZP/relief state, reviewers, FTA reference, and lock states.
- Added a regulatory change log with source URL, effective date, affected rule, ticket, tests, owner, and verification status.
- Added audit request ID, correction reason, evidence link, and actor type fields for human and scheduled-job traceability.
- Added a posted-ledger Corporate Tax workpaper snapshot RPC.
- Added the compliance gate test command.
- Confirmed exchange-rate and depreciation cron routes fail closed without `CRON_SECRET`, persist/reuse job results, and reject future or malformed date inputs through their existing database runner controls.

## Required deployment gate

Apply migration `011_phase6_compliance_operations.sql`, run the full test suite, and execute the Phase 01 live Supabase gate. Then run a browser smoke suite covering chat extraction, registration, posting, payment, allocation, void/reversal, bank import, evidence upload, reports, export, Arabic, and settings.

Phase 06 is implementation-complete in source, but production compliance is not claimed until those live gates pass and a UAE tax adviser verifies the regulatory configuration.
