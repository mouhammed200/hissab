BEGIN;

-- Fix: payment_method column is enum payment_method, but the COALESCE(...,'bank_transfer')
-- expression was untyped text, causing every /api/payments POST to fail with
-- "column \"payment_method\" is of type payment_method but expression is of type text".
CREATE OR REPLACE FUNCTION public.post_payment_transaction(p_request JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_user UUID := auth.uid(); v_org UUID := (p_request->>'org_id')::UUID;
  v_key TEXT := NULLIF(p_request->>'request_key',''); v_payment JSONB := COALESCE(p_request->'payment','{}'::jsonb);
  v_allocs JSONB := COALESCE(p_request->'allocations','[]'::jsonb); v_payment_id UUID; v_journal_id UUID;
  v_contact UUID := (v_payment->>'contact_id')::UUID; v_bank_account UUID := (v_payment->>'bank_account_id')::UUID; v_bank UUID;
  v_type TEXT := COALESCE(v_payment->>'payment_type','received'); v_amount NUMERIC := (v_payment->>'amount')::NUMERIC;
  v_currency TEXT := COALESCE(NULLIF(v_payment->>'currency',''),'AED'); v_rate NUMERIC := COALESCE(NULLIF(v_payment->>'exchange_rate','')::NUMERIC,1);
  v_date DATE := COALESCE(NULLIF(v_payment->>'payment_date','')::DATE,CURRENT_DATE); v_line JSONB;
  v_invoice UUID; v_alloc NUMERIC; v_available NUMERIC; v_invoice_balance NUMERIC; v_allocated NUMERIC := 0;
  v_debit_code TEXT; v_credit_code TEXT; v_number TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF v_org IS NULL OR v_key IS NULL THEN RAISE EXCEPTION 'org_id and request_key are required'; END IF;
  PERFORM v_key::UUID;
  IF NOT EXISTS (SELECT 1 FROM org_members WHERE org_id=v_org AND user_id=v_user AND role IN ('owner','admin','accountant')) THEN RAISE EXCEPTION 'No payment access'; END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'Payment amount must be positive'; END IF;
  IF NOT EXISTS (SELECT 1 FROM contacts WHERE org_id=v_org AND id=v_contact) THEN RAISE EXCEPTION 'Contact is not in this organization'; END IF;
  SELECT ledger_account_id INTO v_bank FROM bank_accounts WHERE org_id=v_org AND id=v_bank_account AND is_active;
  IF v_bank IS NULL THEN RAISE EXCEPTION 'Bank account is not in this organization or has no ledger account'; END IF;

  INSERT INTO posting_requests(org_id, request_key) VALUES (v_org,v_key) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    SELECT jsonb_build_object('success',true,'duplicate',true,'paymentId',p.id,'journalEntryId',p.journal_entry_id) INTO v_line FROM payments p WHERE p.org_id=v_org AND p.reference_number=v_key LIMIT 1;
    RETURN COALESCE(v_line,jsonb_build_object('success',true,'duplicate',true));
  END IF;

  v_number := public.next_document_number(v_org, CASE WHEN v_type='received' THEN 'PMT-IN' ELSE 'PMT-OUT' END, v_date);
  INSERT INTO payments(org_id,payment_number,contact_id,payment_type,payment_date,payment_date_of_supply,bank_account_id,amount,amount_aed,currency,exchange_rate,exchange_rate_date,exchange_rate_source,payment_method,reference_number)
  VALUES(v_org,v_number,v_contact,v_type,v_date,v_date,v_bank,v_amount,ROUND(v_amount*v_rate,2),v_currency,v_rate,v_date,CASE WHEN v_currency='AED' THEN 'BASE_CURRENCY' ELSE COALESCE(v_payment->>'exchange_rate_source','CBUAE') END,COALESCE(v_payment->>'payment_method','bank_transfer')::payment_method,v_key)
  RETURNING id INTO v_payment_id;

  SELECT COALESCE(SUM(pa.allocated_amount),0) INTO v_available FROM payment_allocations pa WHERE pa.payment_id=v_payment_id;
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_allocs) LOOP
    v_invoice := (v_line->>'invoice_id')::UUID; v_alloc := (v_line->>'amount')::NUMERIC;
    SELECT total_amount_aed - amount_paid INTO v_invoice_balance FROM invoices WHERE id=v_invoice AND org_id=v_org AND status <> 'void' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invoice is not in this organization'; END IF;
    IF v_alloc <= 0 OR v_alloc > (v_amount*v_rate - v_allocated) OR v_alloc > v_invoice_balance THEN RAISE EXCEPTION 'Allocation exceeds available payment or invoice balance'; END IF;
    INSERT INTO payment_allocations(org_id,payment_id,invoice_id,allocated_amount) VALUES(v_org,v_payment_id,v_invoice,v_alloc);
    INSERT INTO payment_allocations_audit(org_id,payment_id,invoice_id,allocated_amount,actor_id) VALUES(v_org,v_payment_id,v_invoice,v_alloc,v_user);
    UPDATE invoices SET amount_paid=ROUND(amount_paid+v_alloc,2), status=CASE WHEN ROUND(amount_paid+v_alloc,2) >= total_amount_aed THEN 'paid' WHEN amount_paid+v_alloc > 0 THEN 'partially_paid' ELSE status END WHERE id=v_invoice AND org_id=v_org;
    v_allocated := v_allocated + v_alloc;
  END LOOP;

  v_debit_code := CASE WHEN v_type='received' THEN '1020' ELSE '2010' END;
  v_credit_code := CASE WHEN v_type='received' THEN '1100' ELSE '1020' END;
  INSERT INTO journal_entries(org_id,created_by,date,reference,description,source_type,source_id,status,posted_at,posted_by)
  VALUES(v_org,v_user,v_date,v_key,'Payment '||v_number,'payment',v_payment_id,'posted',NOW(),v_user) RETURNING id INTO v_journal_id;
  INSERT INTO journal_lines(org_id,journal_entry_id,account_id,debit,credit,description)
  SELECT v_org,v_journal_id,id,CASE WHEN code=v_debit_code THEN ROUND(v_amount*v_rate,2) ELSE 0 END,CASE WHEN code=v_credit_code THEN ROUND(v_amount*v_rate,2) ELSE 0 END,'Payment '||v_number FROM accounts WHERE org_id=v_org AND code IN(v_debit_code,v_credit_code);
  IF (SELECT COUNT(*) FROM journal_lines WHERE journal_entry_id=v_journal_id) <> 2 THEN RAISE EXCEPTION 'Payment accounts are missing'; END IF;
  UPDATE payments SET journal_entry_id=v_journal_id WHERE id=v_payment_id;
  INSERT INTO audit_logs(org_id,user_id,action,table_name,record_id,new_values) VALUES(v_org,v_user,'created','payments',v_payment_id,jsonb_build_object('payment',v_payment,'allocations',v_allocs,'journal_entry_id',v_journal_id));
  RETURN jsonb_build_object('success',true,'duplicate',false,'paymentId',v_payment_id,'journalEntryId',v_journal_id);
END; $fn$;

REVOKE ALL ON FUNCTION public.post_payment_transaction(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_payment_transaction(JSONB) TO authenticated;

COMMIT;
