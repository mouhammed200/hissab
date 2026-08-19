BEGIN;

-- 001_foundation.sql defined vat_returns.period_key as VARCHAR(20). But
-- 012_non_einvoice_compliance_closure.sql's persist_vat_return() builds
-- period_key as two full ISO dates joined by a slash:
--   to_char(v_start,'YYYY-MM-DD') || '/' || to_char(v_end,'YYYY-MM-DD')
-- That is unconditionally 21 characters (10 + 1 + 10), so every call to
-- persist_vat_return() fails with "value too long for type character
-- varying(20)" regardless of which period is filed. This is not
-- period-specific — it will fail for every org, every period, always.
--
-- Fix: widen period_key to comfortably exceed 21 chars. VARCHAR(30) leaves
-- headroom without being unbounded.

ALTER TABLE vat_returns ALTER COLUMN period_key TYPE VARCHAR(30);

COMMIT;
