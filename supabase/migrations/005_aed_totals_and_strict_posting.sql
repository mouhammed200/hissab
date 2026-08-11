-- 005: Persist AED-converted totals and make invalid postings fail loudly.
--
-- Problem this fixes:
--   1. amountInAED was computed by the API, displayed in the UI, and then
--      thrown away. A USD invoice posted its foreign face value into an AED
--      ledger, so revenue and VAT were understated by the exchange rate.
--   2. A record with no line items produced totals of 0.00 and tripped the
--      generic 'Unbalanced journal' exception, which surfaced to the user as a
--      500 with no explanation.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS subtotal_amount_aed NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS vat_amount_aed NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS total_amount_aed NUMERIC(15,2);

COMMENT ON COLUMN invoices.total_amount_aed IS
  'Invoice total converted to AED at the CBUAE rate for the date of supply. Equals total_amount for AED invoices. This is the value reflected in the journal.';

-- Backfill existing rows using the stored exchange rate.
UPDATE invoices
SET subtotal_amount_aed = ROUND(subtotal_amount * COALESCE(exchange_rate, 1), 2),
    vat_amount_aed      = ROUND(vat_amount * COALESCE(exchange_rate, 1), 2),
    total_amount_aed    = ROUND(total_amount * COALESCE(exchange_rate, 1), 2)
WHERE total_amount_aed IS NULL;

CREATE OR REPLACE FUNCTION public.post_record_transaction(p_request JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_org UUID := (p_request->>'org_id')::UUID;
  v_key TEXT := NULLIF(p_request->>'request_key', '');
  v_record JSONB := COALESCE(p_request->'record', '{}'::jsonb);
  v_totals JSONB := COALESCE(p_request->'totals', '{}'::jsonb);
  v_totals_aed JSONB := COALESCE(p_request->'totals_aed', p_request->'totals', '{}'::jsonb);
  v_type TEXT := p_request->'record'->>'type';
  v_contact_id UUID;
  v_invoice_id UUID;
  v_journal_id UUID;
  v_record_id UUID;
  v_number TEXT;
  v_prefix TEXT;
  v_count INT;
  v_line JSONB;
  v_account_id UUID;
  v_debit NUMERIC;
  v_credit NUMERIC;
  v_total_debit NUMERIC := 0;
  v_total_credit NUMERIC := 0;
  v_issue_date DATE := COALESCE(NULLIF(v_record->>'date','')::DATE, CURRENT_DATE);
  v_description TEXT;
  v_role member_role;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF v_org IS NULL OR v_key IS NULL THEN RAISE EXCEPTION 'org_id and request_key are required'; END IF;
  SELECT role INTO v_role FROM org_members WHERE org_id=v_org AND user_id=v_user;
  IF v_role IS NULL OR v_role NOT IN ('owner','admin','accountant') THEN RAISE EXCEPTION 'No posting access'; END IF;

  -- Reject detail-less sale/purchase records at the database boundary too, so a
  -- direct RPC call cannot bypass the API-side validator.
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
    SELECT COALESCE(
      jsonb_build_object('success', true, 'duplicate', true, 'recordId', source_id, 'journalEntryId', id),
      jsonb_build_object('success', true, 'duplicate', true)
    ) INTO v_line
    FROM journal_entries WHERE org_id=v_org AND reference=v_key ORDER BY created_at DESC LIMIT 1;
    RETURN COALESCE(v_line, jsonb_build_object('success', true, 'duplicate', true));
  END IF;

  IF v_type IN ('sale','purchase') THEN
    v_prefix := CASE WHEN v_type='sale' THEN 'INV' ELSE 'BILL' END;
    SELECT COUNT(*) + 1 INTO v_count FROM invoices WHERE org_id=v_org AND invoice_number LIKE v_prefix||'-'||TO_CHAR(v_issue_date,'YYYYMMDD')||'-%';
    v_number := v_prefix||'-'||TO_CHAR(v_issue_date,'YYYYMMDD')||'-'||LPAD(v_count::TEXT,4,'0');

    SELECT id INTO v_contact_id FROM contacts WHERE org_id=v_org AND name=COALESCE(v_record->>'party',v_record->>'partyName',v_record->>'name','General Contact') LIMIT 1;
    IF v_contact_id IS NULL THEN
      INSERT INTO contacts(org_id,name,contact_type) VALUES (v_org,COALESCE(v_record->>'party',v_record->>'partyName',v_record->>'name','General Contact'),CASE WHEN v_type='sale' THEN 'customer' ELSE 'vendor' END) RETURNING id INTO v_contact_id;
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

    FOR v_line IN SELECT value FROM jsonb_array_elements(COALESCE(v_record->'items','[]'::jsonb)) LOOP
      INSERT INTO invoice_items(org_id,invoice_id,description,quantity,unit_price,discount,subtotal,vat_category,vat_rate,vat_amount,total,excise_category)
      VALUES (v_org,v_invoice_id,COALESCE(v_line->>'description',v_line->>'desc','Item'),COALESCE((v_line->>'qty')::NUMERIC,1),COALESCE((v_line->>'price')::NUMERIC,0),COALESCE((v_line->>'discount')::NUMERIC,0),GREATEST(0,COALESCE((v_line->>'qty')::NUMERIC,1)*COALESCE((v_line->>'price')::NUMERIC,0)-COALESCE((v_line->>'discount')::NUMERIC,0)),COALESCE(v_line->>'category','standard')::vat_category,CASE WHEN COALESCE(v_line->>'category','standard')='standard' THEN .05 ELSE 0 END,GREATEST(0,COALESCE((v_line->>'qty')::NUMERIC,1)*COALESCE((v_line->>'price')::NUMERIC,0)-COALESCE((v_line->>'discount')::NUMERIC,0))*CASE WHEN COALESCE(v_line->>'category','standard')='standard' THEN .05 ELSE 0 END,GREATEST(0,COALESCE((v_line->>'qty')::NUMERIC,1)*COALESCE((v_line->>'price')::NUMERIC,0)-COALESCE((v_line->>'discount')::NUMERIC,0))*(1+CASE WHEN COALESCE(v_line->>'category','standard')='standard' THEN .05 ELSE 0 END),COALESCE(v_line->>'exciseCategory','none'));
    END LOOP;
  ELSIF v_type='employee' THEN
    INSERT INTO employees(org_id,full_name,position,hire_date,basic_salary,allowances,contract_type,status) VALUES (v_org,COALESCE(v_record->>'name','Unnamed Employee'),NULLIF(v_record->>'position',''),COALESCE(NULLIF(COALESCE(v_record->>'hireDate',v_record->>'joinDate'),'')::DATE,CURRENT_DATE),COALESCE((v_record->>'basicSalary')::NUMERIC,0),COALESCE((v_record->>'allowances')::NUMERIC,0),COALESCE(v_record->>'contractType','unlimited'), 'active') RETURNING id INTO v_record_id;
  ELSIF v_type='asset' THEN
    INSERT INTO fixed_assets(org_id,name,purchase_date,purchase_cost,salvage_value,useful_life_years,supplier,status) VALUES (v_org,COALESCE(v_record->>'assetName',v_record->>'name','Unnamed Asset'),COALESCE(NULLIF(COALESCE(v_record->>'purchaseDate',v_record->>'date'),'')::DATE,CURRENT_DATE),COALESCE((v_record->>'purchaseCost')::NUMERIC,(v_record->>'purchasePrice')::NUMERIC,0),COALESCE((v_record->>'salvageValue')::NUMERIC,0),COALESCE((v_record->>'usefulLifeYears')::INT,5),NULLIF(v_record->>'supplier',''),'active') RETURNING id INTO v_record_id;
  ELSIF v_type='relatedParty' THEN
    INSERT INTO related_party_transactions(org_id,related_party_name,relationship_type,transaction_type,transaction_date,amount,currency,is_arms_length,notes) VALUES (v_org,COALESCE(v_record->>'party',v_record->>'partyName','Unknown Party'),COALESCE(v_record->>'relationship','other'),COALESCE(v_record->>'transactionType','other'),v_issue_date,COALESCE((v_record->>'amount')::NUMERIC,0),COALESCE(NULLIF(v_record->>'currency',''),'AED'),COALESCE((v_record->>'isArmsLength')::BOOLEAN,true),NULLIF(v_record->>'notes','')) RETURNING id INTO v_record_id;
  ELSE RAISE EXCEPTION 'Unsupported record type'; END IF;

  IF jsonb_array_length(COALESCE(p_request->'journal_lines','[]'::jsonb)) > 0 THEN
    FOR v_line IN SELECT value FROM jsonb_array_elements(p_request->'journal_lines') LOOP
      v_debit := COALESCE((v_line->>'debit')::NUMERIC,0); v_credit := COALESCE((v_line->>'credit')::NUMERIC,0);
      IF v_debit < 0 OR v_credit < 0 OR (v_debit > 0 AND v_credit > 0) THEN RAISE EXCEPTION 'Invalid journal line'; END IF;
      SELECT id INTO v_account_id FROM accounts WHERE org_id=v_org AND code=v_line->>'account_code' AND is_active=true;
      IF v_account_id IS NULL THEN RAISE EXCEPTION 'Missing account code: %', v_line->>'account_code'; END IF;
      v_total_debit := v_total_debit + v_debit; v_total_credit := v_total_credit + v_credit;
    END LOOP;
    -- Distinguish the two failure modes instead of reporting both as 'unbalanced'.
    IF v_total_debit = 0 THEN
      RAISE EXCEPTION 'Journal has no value to post for this % record', COALESCE(v_type,'record');
    END IF;
    IF ABS(v_total_debit-v_total_credit) > .005 THEN
      RAISE EXCEPTION 'Unbalanced journal: debit % vs credit %', v_total_debit, v_total_credit;
    END IF;
    v_description := COALESCE(v_type,'record')||' '||COALESCE(v_number,v_record_id::TEXT);
    INSERT INTO journal_entries(org_id,created_by,date,reference,description,source_type,source_id,status,posted_at,posted_by) VALUES (v_org,v_user,v_issue_date,v_key,v_description,v_type,v_record_id,'posted',NOW(),v_user) RETURNING id INTO v_journal_id;
    FOR v_line IN SELECT value FROM jsonb_array_elements(p_request->'journal_lines') LOOP
      SELECT id INTO v_account_id FROM accounts WHERE org_id=v_org AND code=v_line->>'account_code' AND is_active=true;
      INSERT INTO journal_lines(org_id,journal_entry_id,account_id,debit,credit,description,vat_category,vat_rate,vat_amount,contact_id) VALUES (v_org,v_journal_id,v_account_id,COALESCE((v_line->>'debit')::NUMERIC,0),COALESCE((v_line->>'credit')::NUMERIC,0),v_line->>'description',COALESCE(v_line->>'vat_category','standard')::vat_category,COALESCE((v_line->>'vat_rate')::NUMERIC,0),COALESCE((v_line->>'vat_amount')::NUMERIC,0),NULLIF(v_line->>'contact_id','')::UUID);
    END LOOP;
  END IF;
  IF v_invoice_id IS NOT NULL AND v_journal_id IS NOT NULL THEN UPDATE invoices SET journal_entry_id=v_journal_id WHERE id=v_invoice_id; END IF;
  INSERT INTO audit_logs(org_id,user_id,action,table_name,record_id,new_values) VALUES (v_org,v_user,'created',CASE WHEN v_type IN ('sale','purchase') THEN 'invoices' ELSE v_type END,v_record_id,p_request);
  RETURN jsonb_build_object('success',true,'duplicate',false,'recordId',v_record_id,'journalEntryId',v_journal_id);
END; $$;

-- Fixed assets: depreciation is no longer posted as part of the acquisition
-- entry. This view exposes what the periodic run should post next.
CREATE OR REPLACE VIEW public.assets_pending_depreciation AS
SELECT fa.id AS asset_id, fa.org_id, fa.name, fa.purchase_date, fa.purchase_cost,
       fa.salvage_value, fa.useful_life_years,
       ROUND((fa.purchase_cost - COALESCE(fa.salvage_value,0)) / NULLIF(fa.useful_life_years * 12, 0), 2) AS monthly_depreciation,
       (SELECT MAX(ds.period_date) FROM depreciation_schedules ds WHERE ds.asset_id = fa.id AND ds.is_posted) AS last_posted_period
FROM fixed_assets fa
WHERE fa.status = 'active';
