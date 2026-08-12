-- ============================================================
-- 008 - PHASE 02: BUILD THE ACCOUNTING SPINE
-- ============================================================
-- One typed source/AED/VAT fact pair, one organisation policy, and one
-- database-level reconciliation check. The API contract in
-- src/lib/accounting/transaction-contract.ts mirrors these facts.

BEGIN;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS accounting_basis TEXT NOT NULL DEFAULT 'accrual',
  ADD COLUMN IF NOT EXISTS reporting_standard TEXT NOT NULL DEFAULT 'IFRS for SMEs';

ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS organizations_accounting_basis_check,
  DROP CONSTRAINT IF EXISTS organizations_reporting_standard_check;
ALTER TABLE organizations
  ADD CONSTRAINT organizations_accounting_basis_check
    CHECK (accounting_basis IN ('accrual', 'cash')),
  ADD CONSTRAINT organizations_reporting_standard_check
    CHECK (reporting_standard IN ('IFRS', 'IFRS for SMEs', 'other'));

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS date_of_supply DATE,
  ADD COLUMN IF NOT EXISTS exchange_rate_date DATE,
  ADD COLUMN IF NOT EXISTS exchange_rate_source TEXT,
  ADD COLUMN IF NOT EXISTS facts_version INTEGER NOT NULL DEFAULT 1;

UPDATE invoices SET date_of_supply = issue_date WHERE date_of_supply IS NULL;
UPDATE invoices SET exchange_rate_date = COALESCE(date_of_supply, issue_date)
WHERE exchange_rate_date IS NULL;
UPDATE invoices SET exchange_rate_source = CASE
  WHEN currency = 'AED' THEN 'BASE_CURRENCY'
  ELSE 'LEGACY_UNVERIFIED'
END WHERE exchange_rate_source IS NULL;

ALTER TABLE invoices
  DROP CONSTRAINT IF EXISTS invoices_exchange_rate_source_check;
ALTER TABLE invoices
  ADD CONSTRAINT invoices_exchange_rate_source_check CHECK (
    exchange_rate_source IN ('BASE_CURRENCY', 'CBUAE', 'CBUAE_PEGGED', 'LEGACY_UNVERIFIED')
  );

-- Item categories drive VAT and account mapping. Never let a client post a
-- journal for a category the policy layer did not understand.
ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS facts_version INTEGER NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.assert_invoice_fact_totals()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_invoice invoices%ROWTYPE;
  v_subtotal NUMERIC(15,2);
  v_vat NUMERIC(15,2);
  v_discount NUMERIC(15,2);
  v_total NUMERIC(15,2);
  v_rate NUMERIC;
BEGIN
  SELECT * INTO v_invoice FROM public.invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF NOT FOUND OR v_invoice.status = 'void' THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT
    ROUND(COALESCE(SUM(subtotal), 0), 2),
    ROUND(COALESCE(SUM(vat_amount), 0), 2),
    ROUND(COALESCE(SUM(discount), 0), 2),
    ROUND(COALESCE(SUM(total), 0), 2)
  INTO v_subtotal, v_vat, v_discount, v_total
  FROM public.invoice_items
  WHERE invoice_id = v_invoice.id AND org_id = v_invoice.org_id;

  IF v_subtotal <> ROUND(v_invoice.subtotal_amount, 2)
     OR v_vat <> ROUND(v_invoice.vat_amount, 2)
     OR v_discount <> ROUND(v_invoice.discount_amount, 2)
     OR v_total <> ROUND(v_invoice.total_amount, 2) THEN
    RAISE EXCEPTION 'Invoice facts do not reconcile to items: invoice %, items %',
      v_invoice.total_amount, v_total;
  END IF;

  v_rate := COALESCE(v_invoice.exchange_rate, 1);
  IF v_invoice.currency = 'AED' AND (
    ROUND(COALESCE(v_invoice.total_amount_aed, 0), 2) <> ROUND(v_invoice.total_amount, 2)
    OR ROUND(COALESCE(v_invoice.vat_amount_aed, 0), 2) <> ROUND(v_invoice.vat_amount, 2)
  ) THEN
    RAISE EXCEPTION 'AED invoice must store matching source and AED totals';
  END IF;

  IF v_invoice.currency <> 'AED' AND v_invoice.exchange_rate_source IN ('LEGACY_UNVERIFIED') THEN
    RAISE EXCEPTION 'Foreign invoice requires an official exchange-rate source before posting';
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $fn$;

DROP TRIGGER IF EXISTS trg_assert_invoice_fact_totals ON invoice_items;
CREATE CONSTRAINT TRIGGER trg_assert_invoice_fact_totals
AFTER INSERT OR UPDATE OR DELETE ON invoice_items
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.assert_invoice_fact_totals();

-- Explicit policy record, so accounting basis and reporting standard are facts,
-- not scattered defaults in UI code.
CREATE TABLE IF NOT EXISTS public.accounting_policies (
  org_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  base_currency VARCHAR(3) NOT NULL DEFAULT 'AED' CHECK (base_currency = 'AED'),
  accounting_basis TEXT NOT NULL DEFAULT 'accrual' CHECK (accounting_basis IN ('accrual','cash')),
  reporting_standard TEXT NOT NULL DEFAULT 'IFRS for SMEs' CHECK (reporting_standard IN ('IFRS','IFRS for SMEs','other')),
  standard_vat_rate NUMERIC(5,4) NOT NULL DEFAULT 0.05 CHECK (standard_vat_rate >= 0 AND standard_vat_rate <= 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE accounting_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accounting_policies_read ON accounting_policies;
DROP POLICY IF EXISTS accounting_policies_write ON accounting_policies;
CREATE POLICY accounting_policies_read ON accounting_policies FOR SELECT TO authenticated
USING (public.user_has_org_access(org_id));
CREATE POLICY accounting_policies_write ON accounting_policies FOR ALL TO authenticated
USING (public.user_has_org_write_access(org_id))
WITH CHECK (public.user_has_org_write_access(org_id));

CREATE OR REPLACE FUNCTION public.ensure_accounting_policy()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
BEGIN
  INSERT INTO accounting_policies(org_id, accounting_basis, reporting_standard)
  VALUES (NEW.id, NEW.accounting_basis, NEW.reporting_standard)
  ON CONFLICT (org_id) DO NOTHING;
  RETURN NEW;
END; $fn$;
DROP TRIGGER IF EXISTS trg_ensure_accounting_policy ON organizations;
CREATE TRIGGER trg_ensure_accounting_policy
AFTER INSERT ON organizations FOR EACH ROW
EXECUTE FUNCTION public.ensure_accounting_policy();
REVOKE ALL ON FUNCTION public.ensure_accounting_policy() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.seed_accounting_policy(p_org_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
BEGIN
  INSERT INTO accounting_policies(org_id) VALUES (p_org_id)
  ON CONFLICT (org_id) DO NOTHING;
END; $fn$;
REVOKE ALL ON FUNCTION public.seed_accounting_policy(UUID) FROM PUBLIC, anon, authenticated;

-- Seed policy rows for existing workspaces. New onboarding also receives the
-- policy through the bootstrap function in the application transaction.
INSERT INTO public.accounting_policies(org_id, accounting_basis, reporting_standard)
SELECT id, accounting_basis, reporting_standard FROM public.organizations
ON CONFLICT (org_id) DO NOTHING;

-- Replace the earlier posting body after the new fact columns exist. The
-- authoritative RPC now persists date/source facts alongside source and AED.

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

    INSERT INTO invoices(org_id,contact_id,invoice_type,invoice_number,issue_date,date_of_supply,due_date,emirate,currency,exchange_rate,exchange_rate_date,exchange_rate_source,subtotal_amount,vat_amount,discount_amount,total_amount,subtotal_amount_aed,vat_amount_aed,total_amount_aed,is_reverse_charge,status)
    VALUES (
      v_org,v_contact_id,
      CASE WHEN v_type='sale' THEN 'sales_invoice'::invoice_type ELSE 'purchase_invoice'::invoice_type END,
      v_number,v_issue_date,
      COALESCE(NULLIF(v_record->>'dateOfSupply','')::DATE,v_issue_date),
      COALESCE(NULLIF(v_record->>'dueDate','')::DATE,v_issue_date),
      COALESCE(NULLIF(v_record->>'emirate',''),'Dubai')::emirate_enum,
      COALESCE(NULLIF(v_record->>'currency',''),'AED'),
      COALESCE(NULLIF(v_record->>'exchangeRate','')::NUMERIC,1),
      COALESCE(NULLIF(v_record->>'exchangeRateDate','')::DATE,v_issue_date),
      CASE WHEN COALESCE(NULLIF(v_record->>'currency',''),'AED') = 'AED' THEN 'BASE_CURRENCY' ELSE COALESCE(NULLIF(v_record->>'exchangeRateSource',''),'CBUAE') END,
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
REVOKE ALL ON FUNCTION public.assert_invoice_fact_totals() FROM PUBLIC, anon, authenticated;

COMMIT;
