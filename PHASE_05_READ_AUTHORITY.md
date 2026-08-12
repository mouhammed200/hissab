# Phase 05 - Unify every read surface

Completed:

- Added `fn_hissab_read_snapshot`, a tenant-checked, posted-ledger-only snapshot for AED revenue, expenses, profit, VAT, journal count, and monthly trend.
- Rewired Dashboard to consume the snapshot instead of recalculating revenue, expenses, and VAT from invoice headers.
- Added `snapshot` to the reports API so UI and API have an explicit shared read authority.
- Added a Phase 05 structural gate test.

The export route remains ledger-aware for its journal and trial-balance sheets. Its invoice sheets retain source-document detail, which is useful evidence, but financial totals must be read from posted ledger facts.
