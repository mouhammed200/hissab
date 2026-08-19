BEGIN;

-- 009_phase3_lifecycle.sql created uq_bank_transaction_fingerprint as a
-- PARTIAL unique index (WHERE row_fingerprint IS NOT NULL). Postgres can
-- only use a partial index as an ON CONFLICT arbiter if the conflict
-- target's predicate matches the index predicate exactly. The bank import
-- route (src/app/api/bank/import/route.ts) calls Supabase's .upsert() with
-- onConflict: 'org_id,bank_account_id,row_fingerprint' and no predicate,
-- which Postgres cannot match to the partial index — every import upsert
-- fails with "there is no unique or exclusion constraint matching the
-- ON CONFLICT specification", regardless of the CSV contents.
--
-- Fix: drop the partial predicate. Standard Postgres unique indexes already
-- treat NULL as distinct from every other value (including other NULLs),
-- so legacy rows with row_fingerprint IS NULL remain unaffected — this
-- migration does not change behavior for those rows, it only makes the
-- index usable as an unqualified ON CONFLICT target.

DROP INDEX IF EXISTS uq_bank_transaction_fingerprint;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_transaction_fingerprint
  ON bank_transactions(org_id, bank_account_id, row_fingerprint);

COMMIT;
