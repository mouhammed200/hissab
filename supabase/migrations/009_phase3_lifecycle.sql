-- ============================================================
-- 009 - PHASE 03: COMPLETE THE POST-REGISTRATION LIFECYCLE
-- ============================================================
-- Payments, allocations, voids, bank fingerprints, and durable evidence
-- are real write paths, not just tables.
BEGIN;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS payment_date_of_supply DATE,
  ADD COLUMN IF NOT EXISTS amount_aed NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS exchange_rate_date DATE,
  ADD COLUMN IF NOT EXISTS exchange_rate_source TEXT,
  ADD COLUMN IF NOT EXISTS facts_version INTEGER NOT NULL DEFAULT 1;
UPDATE payments SET payment_date_of_supply = payment_date WHERE payment_date_of_supply IS NULL;
UPDATE payments SET amount_aed = ROUND(amount * COALESCE(exchange_rate, 1), 2) WHERE amount_aed IS NULL;
UPDATE payments SET exchange_rate_date = payment_date WHERE exchange_rate_date IS NULL;
UPDATE payments SET exchange_rate_source = CASE WHEN currency='AED' THEN 'BASE_CURRENCY' ELSE 'LEGACY_UNVERIFIED' END WHERE exchange_rate_source IS NULL;

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS row_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS import_batch_id UUID,
  ADD COLUMN IF NOT EXISTS matched_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS matched_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_transaction_fingerprint
  ON bank_transactions(org_id, bank_account_id, row_fingerprint)
  WHERE row_fingerprint IS NOT NULL;

ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS sha256_hash TEXT,
  ADD COLUMN IF NOT EXISTS source_channel TEXT,
  ADD COLUMN IF NOT EXISTS captured_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS payment_allocations_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  allocated_amount NUMERIC(15,2) NOT NULL,
  actor_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE payment_allocations_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_allocations_audit_read ON payment_allocations_audit FOR SELECT TO authenticated USING (public.user_has_org_access(org_id));
CREATE POLICY payment_allocations_audit_write ON payment_allocations_audit FOR INSERT TO authenticated WITH CHECK (public.user_has_org_write_access(org_id));

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
  VALUES(v_org,v_number,v_contact,v_type,v_date,v_date,v_bank,v_amount,ROUND(v_amount*v_rate,2),v_currency,v_rate,v_date,CASE WHEN v_currency='AED' THEN 'BASE_CURRENCY' ELSE COALESCE(v_payment->>'exchange_rate_source','CBUAE') END,COALESCE(v_payment->>'payment_method','bank_transfer'),v_key)
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

CREATE OR REPLACE FUNCTION public.void_record_transaction(p_request JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_user UUID := auth.uid(); v_org UUID := (p_request->>'org_id')::UUID; v_source UUID := (p_request->>'source_id')::UUID;
  v_reason TEXT := NULLIF(p_request->>'reason',''); v_type TEXT := COALESCE(p_request->>'source_type','invoice'); v_table TEXT; v_journal UUID; v_old JSONB; v_new JSONB; v_reversal UUID;
BEGIN
  IF v_user IS NULL OR v_reason IS NULL THEN RAISE EXCEPTION 'Actor and correction reason are required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM org_members WHERE org_id=v_org AND user_id=v_user AND role IN ('owner','admin','accountant')) THEN RAISE EXCEPTION 'No void access'; END IF;
  IF v_type='invoice' THEN
    v_table:='invoices'; SELECT to_jsonb(i),i.journal_entry_id INTO v_old,v_journal FROM invoices i WHERE i.id=v_source AND i.org_id=v_org FOR UPDATE;
    IF v_old IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF; UPDATE invoices SET status='void' WHERE id=v_source;
  ELSIF v_type='payment' THEN
    v_table:='payments'; SELECT to_jsonb(p),p.journal_entry_id INTO v_old,v_journal FROM payments p WHERE p.id=v_source AND p.org_id=v_org FOR UPDATE;
    IF v_old IS NULL THEN RAISE EXCEPTION 'Payment not found'; END IF;
    UPDATE payments SET notes=COALESCE(notes,'')||' [VOIDED: '||v_reason||']' WHERE id=v_source;
  ELSE RAISE EXCEPTION 'Unsupported void source type'; END IF;
  IF v_journal IS NOT NULL THEN
    INSERT INTO journal_entries(org_id,created_by,date,reference,description,source_type,source_id,status,posted_at,posted_by)
    SELECT org_id,v_user,date,'REV-'||id::TEXT,'Reversal: '||description,'reversal',v_source,'posted',NOW(),v_user FROM journal_entries WHERE id=v_journal RETURNING id INTO v_reversal;
    INSERT INTO journal_lines(org_id,journal_entry_id,account_id,debit,credit,description,vat_category,vat_rate,vat_amount,contact_id)
    SELECT org_id,v_reversal,account_id,credit,debit,'Reversal: '||description,vat_category,vat_rate,vat_amount,contact_id FROM journal_lines WHERE journal_entry_id=v_journal;
    UPDATE journal_entries SET status='void' WHERE id=v_journal AND org_id=v_org;
  END IF;
  SELECT to_jsonb(x) INTO v_new FROM (SELECT v_source AS id, 'void' AS status, v_reason AS correction_reason) x;
  INSERT INTO audit_logs(org_id,user_id,action,table_name,record_id,old_values,new_values) VALUES(v_org,v_user,'voided',v_table,v_source,v_old,v_new);
  RETURN jsonb_build_object('success',true,'sourceId',v_source,'reversalJournalId',v_reversal);
END; $fn$;

REVOKE ALL ON FUNCTION public.post_payment_transaction(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_payment_transaction(JSONB) TO authenticated;
REVOKE ALL ON FUNCTION public.void_record_transaction(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_record_transaction(JSONB) TO authenticated;

COMMIT;
