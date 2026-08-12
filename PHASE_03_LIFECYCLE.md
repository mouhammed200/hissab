# Phase 03 - Complete the lifecycle

Implemented the missing post-registration write paths:

- Atomic payment creation and journal posting, including received/made payments.
- Multi-invoice allocation with amount and invoice-balance limits.
- Atomic invoice/payment void with reversal journal, source resolution, reason, actor, and audit record.
- Bank import fingerprints and duplicate-safe upsert, preserving quote-aware parsing and import batch IDs.
- Durable evidence upload with allowlisted MIME types, size limit, SHA-256, storage path, source channel, actor, and record link.
- Phase 03 route and structural gate tests.

Apply `009_phase3_lifecycle.sql` after the Phase 02 migration. Configure a private Supabase Storage bucket named `evidence` with object-level policies before enabling uploads.

This phase still requires the real Supabase environment gate. It does not claim VAT return, Corporate Tax, PINT AE/ASP, or excise completion.
