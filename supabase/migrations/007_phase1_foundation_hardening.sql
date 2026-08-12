-- ============================================================
-- 007 - PHASE 01 GATE: STABILIZE THE FOUNDATION
-- ============================================================
-- Closes the roadmap Phase 01 deliverables and the P0 release-gate blockers
-- that live in the database:
--
--   1. Transactional onboarding   (org + owner membership + COA, one commit)
--   2. RPC privilege review       (locked search_path, explicit REVOKE/GRANT)
--   3. Composite org integrity    (a child row cannot cross tenants)
--   4. Role-aware RLS matrix      (viewers stop being able to write)
--   5. Concurrency-safe numbering (COUNT(*)+1 was a race, not a rule)
--
-- Idempotent. Runs as one transaction.
-- ============================================================

BEGIN;

-- ============================================================
-- SECTION 1 - ACCESS HELPERS
-- ============================================================
-- user_has_org_access was SECURITY DEFINER with an unpinned search_path, which
-- lets a caller with temp-schema rights shadow org_members. Pin it.

CREATE OR REPLACE FUNCTION public.user_has_org_access(p_org_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = p_org_id AND user_id = auth.uid()
  );
$fn$;

-- New: membership alone is not permission to write. 'viewer' reads only.
CREATE OR REPLACE FUNCTION public.user_has_org_write_access(p_org_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = p_org_id AND user_id = auth.uid()
      AND role IN ('owner', 'admin', 'accountant')
  );
$fn$;

COMMENT ON FUNCTION public.user_has_org_write_access(UUID) IS
  'True when the current user may create or modify financial records in this org. Viewers excluded.';

-- ============================================================
-- SECTION 2 - ROLE-AWARE RLS MATRIX
-- ============================================================
-- Before: every table used FOR ALL USING (user_has_org_access(org_id)), so a
-- viewer could INSERT journal lines and DELETE invoices. Split read from write.

DO $mig$
DECLARE
  t TEXT;
  p RECORD;
  targets TEXT[] := ARRAY[
    'accounts','contacts','journal_entries','journal_lines','invoices',
    'invoice_items','payments','payment_allocations','employees',
    'gratuity_accruals','fixed_assets','depreciation_schedules',
    'related_party_transactions','vat_returns','bank_accounts',
    'bank_transactions','recurring_templates','budgets','budget_lines',
    'attachments','posting_requests'
  ];
BEGIN
  FOREACH t IN ARRAY targets LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN CONTINUE; END IF;

    FOR p IN SELECT policyname FROM pg_policies
             WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
      'USING (public.user_has_org_access(org_id))', t || '_read', t);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
      'USING (public.user_has_org_write_access(org_id)) '
      'WITH CHECK (public.user_has_org_write_access(org_id))', t || '_write', t);
  END LOOP;
END $mig$;

-- Audit log is append-only. No UPDATE or DELETE policy exists, deliberately.
DROP POLICY IF EXISTS aud_ins ON audit_logs;
DROP POLICY IF EXISTS aud_sel ON audit_logs;
DROP POLICY IF EXISTS audit_logs_read ON audit_logs;
DROP POLICY IF EXISTS audit_logs_append ON audit_logs;
CREATE POLICY audit_logs_read ON audit_logs
  FOR SELECT TO authenticated USING (public.user_has_org_access(org_id));
CREATE POLICY audit_logs_append ON audit_logs
  FOR INSERT TO authenticated WITH CHECK (public.user_has_org_access(org_id));

-- Organizations may no longer be created by any authenticated user.
-- Creation goes through bootstrap_organization() only (Section 5).
DROP POLICY IF EXISTS org_ins ON organizations;
DROP POLICY IF EXISTS org_ins_authenticated ON organizations;

-- ============================================================
-- SECTION 3 - COMPOSITE ORG INTEGRITY
-- ============================================================
-- A single-column FK lets journal_lines.account_id point at another tenant's
-- account. Composite (org_id, id) keys make that structurally impossible.

DO $mig$
DECLARE
  t TEXT;
  parents TEXT[] := ARRAY[
    'accounts','contacts','journal_entries','invoices','payments',
    'bank_accounts','fixed_assets','employees','budgets'
  ];
BEGIN
  FOREACH t IN ARRAY parents LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = t || '_org_id_id_key'
        AND conrelid = ('public.' || quote_ident(t))::regclass
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (org_id, id)',
                     t, t || '_org_id_id_key');
    END IF;
  END LOOP;
END $mig$;

-- Rebuild child references as tenant-pinned composite foreign keys.
-- NULL child columns remain permitted (MATCH SIMPLE).
DO $mig$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('journal_lines',              'account_id',              'accounts'),
      ('journal_lines',              'contact_id',              'contacts'),
      ('invoice_items',              'account_id',              'accounts'),
      ('invoices',                   'contact_id',              'contacts'),
      ('invoices',                   'journal_entry_id',        'journal_entries'),
      ('payments',                   'contact_id',              'contacts'),
      ('payments',                   'bank_account_id',         'accounts'),
      ('payments',                   'journal_entry_id',        'journal_entries'),
      ('payment_allocations',        'invoice_id',              'invoices'),
      ('gratuity_accruals',          'journal_entry_id',        'journal_entries'),
      ('fixed_assets',               'asset_account_id',        'accounts'),
      ('fixed_assets',               'accum_dep_account_id',    'accounts'),
      ('fixed_assets',               'dep_expense_account_id',  'accounts'),
      ('depreciation_schedules',     'journal_entry_id',        'journal_entries'),
      ('related_party_transactions', 'journal_entry_id',        'journal_entries'),
      ('bank_accounts',              'ledger_account_id',       'accounts'),
      ('bank_transactions',          'matched_journal_entry_id','journal_entries'),
      ('budget_lines',               'account_id',              'accounts'),
      ('accounts',                   'parent_id',               'accounts')
    ) AS v(child, col, parent)
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
                   r.child, r.child || '_' || r.col || '_fkey');
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
                   r.child, r.child || '_org_' || r.col || '_fkey');
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I '
      'FOREIGN KEY (org_id, %I) REFERENCES public.%I (org_id, id) ON UPDATE CASCADE',
      r.child, r.child || '_org_' || r.col || '_fkey', r.col, r.parent);
  END LOOP;
END $mig$;

-- Cascading children: same org pin, cascade preserved.
DO $mig$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('journal_lines',          'journal_entry_id', 'journal_entries'),
      ('invoice_items',          'invoice_id',       'invoices'),
      ('payment_allocations',    'payment_id',       'payments'),
      ('depreciation_schedules', 'asset_id',         'fixed_assets'),
      ('gratuity_accruals',      'employee_id',      'employees'),
      ('bank_transactions',      'bank_account_id',  'bank_accounts'),
      ('budget_lines',           'budget_id',        'budgets')
    ) AS v(child, col, parent)
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
                   r.child, r.child || '_' || r.col || '_fkey');
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
                   r.child, r.child || '_org_' || r.col || '_fkey');
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I '
      'FOREIGN KEY (org_id, %I) REFERENCES public.%I (org_id, id) ON DELETE CASCADE',
      r.child, r.child || '_org_' || r.col || '_fkey', r.col, r.parent);
  END LOOP;
END $mig$;

-- ============================================================
-- SECTION 4 - CONCURRENCY-SAFE DOCUMENT NUMBERING
-- ============================================================
-- SELECT COUNT(*) + 1 ... WHERE invoice_number LIKE ... hands the same number
-- to two concurrent posts. Replace it with a locked counter row.

CREATE TABLE IF NOT EXISTS public.document_number_sequences (
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prefix     TEXT NOT NULL,
  period_key TEXT NOT NULL,
  next_value INT  NOT NULL DEFAULT 1,
  PRIMARY KEY (org_id, prefix, period_key)
);

ALTER TABLE public.document_number_sequences ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only the SECURITY DEFINER allocator touches it.

CREATE OR REPLACE FUNCTION public.next_document_number(
  p_org_id UUID, p_prefix TEXT, p_date DATE
) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_period TEXT := TO_CHAR(p_date, 'YYYYMMDD');
  v_n INT;
BEGIN
  INSERT INTO public.document_number_sequences (org_id, prefix, period_key, next_value)
  VALUES (p_org_id, p_prefix, v_period, 1)
  ON CONFLICT (org_id, prefix, period_key)
  DO UPDATE SET next_value = document_number_sequences.next_value + 1
  RETURNING next_value INTO v_n;

  RETURN p_prefix || '-' || v_period || '-' || LPAD(v_n::TEXT, 4, '0');
END; $fn$;

COMMENT ON FUNCTION public.next_document_number(UUID, TEXT, DATE) IS
  'Allocates the next org-scoped document number. Serialized by row lock, safe under concurrency.';

-- ============================================================
-- SECTION 5 - TRANSACTIONAL ONBOARDING
-- ============================================================
-- Before: the browser inserted an organization, then a membership, then seeded
-- accounts, as three independent calls. A failure after step one left an
-- orphaned org and a user permanently locked out of their own workspace.

-- The seeder becomes internal and gets a pinned search path.
ALTER FUNCTION public.seed_default_chart_of_accounts(UUID) SECURITY DEFINER;
ALTER FUNCTION public.seed_default_chart_of_accounts(UUID) SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.bootstrap_organization(
  p_name TEXT, p_emirate TEXT DEFAULT 'Dubai'
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_user   UUID := auth.uid();
  v_org_id UUID;
  v_name   TEXT := NULLIF(BTRIM(COALESCE(p_name, '')), '');
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000';
  END IF;

  -- Idempotent: a user who already belongs somewhere gets that org back.
  SELECT org_id INTO v_org_id FROM org_members
  WHERE user_id = v_user ORDER BY created_at LIMIT 1;

  IF v_org_id IS NOT NULL THEN
    RETURN (SELECT jsonb_build_object('created', false, 'organization', to_jsonb(o))
            FROM organizations o WHERE o.id = v_org_id);
  END IF;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'A workspace name is required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO organizations (name, default_emirate)
  VALUES (v_name, COALESCE(NULLIF(p_emirate, ''), 'Dubai')::emirate_enum)
  RETURNING id INTO v_org_id;

  INSERT INTO org_members (org_id, user_id, role)
  VALUES (v_org_id, v_user, 'owner');

  PERFORM public.seed_default_chart_of_accounts(v_org_id);

  INSERT INTO audit_logs (org_id, user_id, action, table_name, record_id, new_values)
  VALUES (v_org_id, v_user, 'created', 'organizations', v_org_id,
          jsonb_build_object('name', v_name, 'bootstrap', true));

  RETURN (SELECT jsonb_build_object('created', true, 'organization', to_jsonb(o))
          FROM organizations o WHERE o.id = v_org_id);
END; $fn$;

COMMENT ON FUNCTION public.bootstrap_organization(TEXT, TEXT) IS
  'Creates an organization, its owner membership, and its chart of accounts in one transaction. The only supported way to create an org.';

-- ============================================================
-- SECTION 6 - POSTING RPC: SAFE NUMBERING + UUID IDEMPOTENCY KEY
-- ============================================================
-- Identical to 005 except: the invoice number comes from the sequence
-- allocator, request_key must be a UUID, the contact lookup is org-pinned,
-- the audit row no longer stores the whole request envelope, and the audit
-- table_name records a real table instead of the record type string.

CREATE OR REPLACE FUNCTION public.post_record_transaction(p_request JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_user UUID := auth.uid();
  v_org UUID := (p_request->>'org_id')::UUID;
  v_key TEXT := NULLIF(p_request->>'request_key', '');
  v_record JSONB := COALESCE(p_request->'record', '{}'::jsonb);
  v_totals JSONB := COALESCE(p_request->'totals', '{}'::jsonb);
  v_totals_aed JSONB := COALESCE(p_request->'totals_aed', p_request->'totals', '{}'::jsonb);
  v_type TEXT := p_request->'record'->>'type';
  v_contact_id UUID; v_invoice_id UUID; v_journal_id UUID; v_record_id UUID;
  v_number TEXT; v_prefix TEXT; v_party TEXT; v_line JSONB; v_account_id UUID;
  v_debit NUMERIC; v_credit NUMERIC;
  v_total_debit NUMERIC := 0; v_total_credit NUMERIC := 0;
  v_issue_date DATE := COALESCE(NULLIF(v_record->>'date','')::DATE, CURRENT_DATE);
  v_description TEXT; v_role member_role; v_audit_table TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000'; END IF;
  IF v_org IS NULL OR v_key IS NULL THEN
    RAISE EXCEPTION 'org_id and request_key are required';
  END IF;

  -- Idempotency keys must be UUIDs. Timestamps collide and are guessable.
  BEGIN
    PERFORM v_key::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'request_key must be a UUID';
  END;

  SELECT role INTO v_role FROM org_members WHERE org_id=v_org AND user_id=v_user;
  IF v_role IS NULL OR v_role NOT IN ('owner','admin','accountant') THEN
    RAISE EXCEPTION 'No posting access' USING ERRCODE = '42501';
  END IF;

  IF v_type IN ('sale','purchase') THEN
    IF jsonb_array_length(COALESCE(v_record->'items','[]'::jsonb)) = 0 THEN
      RAISE EXCEPTION 'A % must have at least one line item', v_type;
    END IF;
    IF COALESCE((v_totals->>'total')::NUMERIC,0) <= 0 THEN
      RAISE EXCEPTION 'A % must have a total greater than zero', v_type;
    END IF;
  END IF;

  INSERT INTO posting_requests(org_id, request_key) VALUES (v_org, v_key)
  ON CONFLICT (org_id, request_key) DO NOTHING;
  IF NOT FOUND THEN
    SELECT jsonb_build_object('success', true, 'duplicate', true,
                              'recordId', source_id, 'journalEntryId', id)
    INTO v_line FROM journal_entries
    WHERE org_id=v_org AND reference=v_key ORDER BY created_at DESC LIMIT 1;
    RETURN COALESCE(v_line, jsonb_build_object('success', true, 'duplicate', true));
  END IF;

  IF v_type IN ('sale','purchase') THEN
    v_prefix := CASE WHEN v_type='sale' THEN 'INV' ELSE 'BILL' END;
    -- Concurrency-safe. Replaces the old COUNT(*)+1 LIKE scan.
    v_number := public.next_document_number(v_org, v_prefix, v_issue_date);

    v_party := COALESCE(NULLIF(v_record->>'party',''), NULLIF(v_record->>'partyName',''),
                        NULLIF(v_record->>'name',''), 'General Contact');
    SELECT id INTO v_contact_id FROM contacts WHERE org_id=v_org AND name=v_party LIMIT 1;
    IF v_contact_id IS NULL THEN
      INSERT INTO contacts(org_id,name,contact_type)
      VALUES (v_org, v_party, CASE WHEN v_type='sale' THEN 'customer' ELSE 'vendor' END)
      RETURNING id INTO v_contact_id;
    END IF;

    INSERT INTO invoices(org_id,contact_id,invoice_type,invoice_number,issue_date,due_date,emirate,currency,exchange_rate,subtotal_amount,vat_amount,discount_amount,total_amount,subtotal_amount_aed,vat_amount_aed,total_amount_aed,is_reverse_charge,status)
    VALUES (
      v_org,v_contact_id,
      CASE WHEN v_type='sale' THEN 'sales_invoice'::invoice_type ELSE 'purchase_invoice'::invoice_type END,
      v_number,v_issue_date,
      COALESCE(NULLIF(v_record->>'dueDate','')::DATE,v_issue_date),
      COALESCE(NULLIF(v_record->>'emirate',''),'Dubai')::emirate_enum,
      COALESCE(NULLIF(v_record->>'currency',''),'AED'),
      COALESCE(NULLIF(v_record->>'exchangeRate','')::NUMERIC,1),
      COALESCE((v_totals->>'subtotal')::NUMERIC,0),
      COALESCE((v_totals->>'vat')::NUMERIC,0),
      COALESCE((v_totals->>'discount')::NUMERIC,0),
      COALESCE((v_totals->>'total')::NUMERIC,0),
      COALESCE((v_totals_aed->>'subtotal')::NUMERIC,(v_totals->>'subtotal')::NUMERIC,0),
      COALESCE((v_totals_aed->>'vat')::NUMERIC,(v_totals->>'vat')::NUMERIC,0),
      COALESCE((v_totals_aed->>'total')::NUMERIC,(v_totals->>'total')::NUMERIC,0),
      COALESCE((v_record->>'reverseCharge')::BOOLEAN,false),
      'approved'
    ) RETURNING id INTO v_invoice_id;
    v_record_id := v_invoice_id;
    v_audit_table := 'invoices';

    FOR v_line IN SELECT value FROM jsonb_array_elements(COALESCE(v_record->'items','[]'::jsonb)) LOOP
      INSERT INTO invoice_items(org_id,invoice_id,description,quantity,unit_price,discount,subtotal,vat_category,vat_rate,vat_amount,total,excise_category)
      VALUES (v_org,v_invoice_id,COALESCE(v_line->>'description',v_line->>'desc','Item'),COALESCE((v_line->>'qty')::NUMERIC,1),COALESCE((v_line->>'price')::NUMERIC,0),COALESCE((v_line->>'discount')::NUMERIC,0),GREATEST(0,COALESCE((v_line->>'qty')::NUMERIC,1)*COALESCE((v_line->>'price')::NUMERIC,0)-COALESCE((v_line->>'discount')::NUMERIC,0)),COALESCE(v_line->>'category','standard')::vat_category,CASE WHEN COALESCE(v_line->>'category','standard')='standard' THEN .05 ELSE 0 END,GREATEST(0,COALESCE((v_line->>'qty')::NUMERIC,1)*COALESCE((v_line->>'price')::NUMERIC,0)-COALESCE((v_line->>'discount')::NUMERIC,0))*CASE WHEN COALESCE(v_line->>'category','standard')='standard' THEN .05 ELSE 0 END,GREATEST(0,COALESCE((v_line->>'qty')::NUMERIC,1)*COALESCE((v_line->>'price')::NUMERIC,0)-COALESCE((v_line->>'discount')::NUMERIC,0))*(1+CASE WHEN COALESCE(v_line->>'category','standard')='standard' THEN .05 ELSE 0 END),COALESCE(v_line->>'exciseCategory','none'));
    END LOOP;
  ELSIF v_type='employee' THEN
    INSERT INTO employees(org_id,full_name,position,hire_date,basic_salary,allowances,contract_type,status) VALUES (v_org,COALESCE(v_record->>'name','Unnamed Employee'),NULLIF(v_record->>'position',''),COALESCE(NULLIF(COALESCE(v_record->>'hireDate',v_record->>'joinDate'),'')::DATE,CURRENT_DATE),COALESCE((v_record->>'basicSalary')::NUMERIC,0),COALESCE((v_record->>'allowances')::NUMERIC,0),COALESCE(v_record->>'contractType','unlimited'),'active') RETURNING id INTO v_record_id;
    v_audit_table := 'employees';
  ELSIF v_type='asset' THEN
    INSERT INTO fixed_assets(org_id,name,purchase_date,purchase_cost,salvage_value,useful_life_years,supplier,status) VALUES (v_org,COALESCE(v_record->>'assetName',v_record->>'name','Unnamed Asset'),COALESCE(NULLIF(COALESCE(v_record->>'purchaseDate',v_record->>'date'),'')::DATE,CURRENT_DATE),COALESCE((v_record->>'purchaseCost')::NUMERIC,(v_record->>'purchasePrice')::NUMERIC,0),COALESCE((v_record->>'salvageValue')::NUMERIC,0),COALESCE((v_record->>'usefulLifeYears')::INT,5),NULLIF(v_record->>'supplier',''),'active') RETURNING id INTO v_record_id;
    v_audit_table := 'fixed_assets';
  ELSIF v_type='relatedParty' THEN
    INSERT INTO related_party_transactions(org_id,related_party_name,relationship_type,transaction_type,transaction_date,amount,currency,is_arms_length,notes) VALUES (v_org,COALESCE(v_record->>'party',v_record->>'partyName','Unknown Party'),COALESCE(v_record->>'relationship','other'),COALESCE(v_record->>'transactionType','other'),v_issue_date,COALESCE((v_record->>'amount')::NUMERIC,0),COALESCE(NULLIF(v_record->>'currency',''),'AED'),COALESCE((v_record->>'isArmsLength')::BOOLEAN,true),NULLIF(v_record->>'notes','')) RETURNING id INTO v_record_id;
    v_audit_table := 'related_party_transactions';
  ELSE
    RAISE EXCEPTION 'Unsupported record type';
  END IF;

  IF jsonb_array_length(COALESCE(p_request->'journal_lines','[]'::jsonb)) > 0 THEN
    FOR v_line IN SELECT value FROM jsonb_array_elements(p_request->'journal_lines') LOOP
      v_debit := COALESCE((v_line->>'debit')::NUMERIC,0);
      v_credit := COALESCE((v_line->>'credit')::NUMERIC,0);
      IF v_debit < 0 OR v_credit < 0 OR (v_debit > 0 AND v_credit > 0) THEN
        RAISE EXCEPTION 'Invalid journal line';
      END IF;
      SELECT id INTO v_account_id FROM accounts
      WHERE org_id=v_org AND code=v_line->>'account_code' AND is_active=true;
      IF v_account_id IS NULL THEN
        RAISE EXCEPTION 'Missing account code: %', v_line->>'account_code';
      END IF;
      v_total_debit := v_total_debit + v_debit;
      v_total_credit := v_total_credit + v_credit;
    END LOOP;

    IF v_total_debit = 0 THEN
      RAISE EXCEPTION 'Journal has no value to post for this % record', COALESCE(v_type,'record');
    END IF;
    IF ABS(v_total_debit-v_total_credit) > .005 THEN
      RAISE EXCEPTION 'Unbalanced journal: debit % vs credit %', v_total_debit, v_total_credit;
    END IF;

    v_description := COALESCE(v_type,'record')||' '||COALESCE(v_number,v_record_id::TEXT);
    INSERT INTO journal_entries(org_id,created_by,date,reference,description,source_type,source_id,status,posted_at,posted_by)
    VALUES (v_org,v_user,v_issue_date,v_key,v_description,v_type,v_record_id,'posted',NOW(),v_user)
    RETURNING id INTO v_journal_id;

    FOR v_line IN SELECT value FROM jsonb_array_elements(p_request->'journal_lines') LOOP
      SELECT id INTO v_account_id FROM accounts
      WHERE org_id=v_org AND code=v_line->>'account_code' AND is_active=true;
      INSERT INTO journal_lines(org_id,journal_entry_id,account_id,debit,credit,description,vat_category,vat_rate,vat_amount,contact_id)
      VALUES (v_org,v_journal_id,v_account_id,COALESCE((v_line->>'debit')::NUMERIC,0),COALESCE((v_line->>'credit')::NUMERIC,0),v_line->>'description',COALESCE(v_line->>'vat_category','standard')::vat_category,COALESCE((v_line->>'vat_rate')::NUMERIC,0),COALESCE((v_line->>'vat_amount')::NUMERIC,0),NULLIF(v_line->>'contact_id','')::UUID);
    END LOOP;
  END IF;

  IF v_invoice_id IS NOT NULL AND v_journal_id IS NOT NULL THEN
    UPDATE invoices SET journal_entry_id=v_journal_id WHERE id=v_invoice_id AND org_id=v_org;
  END IF;

  INSERT INTO audit_logs(org_id,user_id,action,table_name,record_id,new_values)
  VALUES (v_org,v_user,'created',v_audit_table,v_record_id,
          jsonb_build_object('record', v_record, 'totals', v_totals,
                             'totals_aed', v_totals_aed, 'request_key', v_key,
                             'journal_entry_id', v_journal_id));

  RETURN jsonb_build_object('success',true,'duplicate',false,
                            'recordId',v_record_id,'journalEntryId',v_journal_id);
END; $fn$;

-- ============================================================
-- SECTION 7 - TRIGGER HARDENING
-- ============================================================
ALTER FUNCTION public.check_journal_entry_balance() SET search_path = public, pg_temp;
ALTER FUNCTION public.enforce_vat_period_lock()     SET search_path = public, pg_temp;

-- ============================================================
-- SECTION 8 - EXPLICIT PRIVILEGES
-- ============================================================
-- Postgres grants EXECUTE to PUBLIC by default. Take it back, then hand it
-- out deliberately. Anonymous callers get nothing.

REVOKE ALL ON FUNCTION public.user_has_org_access(UUID)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.user_has_org_write_access(UUID)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bootstrap_organization(TEXT, TEXT)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.post_record_transaction(JSONB)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_trial_balance(UUID, DATE)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_profit_and_loss(UUID, DATE, DATE)    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_balance_sheet(UUID, DATE)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_aged_report(UUID, VARCHAR, DATE)     FROM PUBLIC, anon;

-- Internal only: reachable from inside other SECURITY DEFINER functions.
REVOKE ALL ON FUNCTION public.seed_default_chart_of_accounts(UUID)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.next_document_number(UUID, TEXT, DATE)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE    public.document_number_sequences               FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.user_has_org_access(UUID)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_org_write_access(UUID)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_organization(TEXT, TEXT)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_record_transaction(JSONB)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_trial_balance(UUID, DATE)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_profit_and_loss(UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_balance_sheet(UUID, DATE)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_aged_report(UUID, VARCHAR, DATE)  TO authenticated;

COMMIT;
