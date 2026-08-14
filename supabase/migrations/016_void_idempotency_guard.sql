-- 016_void_idempotency_guard.sql
-- Fixes: void_record_transaction (014) had no check for a source already in a
-- voided/terminal state. Calling it twice on the same invoice/payment/asset/
-- employee/relatedParty/bank_match created a second reversal journal and a
-- second audit_logs row for the same underlying event, double-counting the
-- reversal in the ledger. This replaces the function with the same behavior
-- plus a pre-mutation guard per source type, and a defense-in-depth check
-- on the linked journal entry itself for the two types (payment, relatedParty)
-- that have no dedicated status column to check.

BEGIN;

CREATE OR REPLACE FUNCTION public.void_record_transaction(p_request JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE
  v_user UUID:=auth.uid();
  v_org UUID:=(p_request->>'org_id')::UUID;
  v_source UUID:=(p_request->>'source_id')::UUID;
  v_reason TEXT:=NULLIF(p_request->>'reason','');
  v_type TEXT:=coalesce(p_request->>'source_type','invoice');
  v_table TEXT;
  v_journal UUID;
  v_old JSONB;
  v_reversal UUID;
  v_journal_status journal_status;
BEGIN
  IF v_user IS NULL OR v_reason IS NULL THEN
    RAISE EXCEPTION 'Actor and correction reason are required';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM org_members WHERE org_id=v_org AND user_id=v_user AND role IN('owner','admin','accountant')) THEN
    RAISE EXCEPTION 'No void access';
  END IF;

  IF v_type='invoice' THEN
    v_table:='invoices';
    SELECT to_jsonb(x),x.journal_entry_id INTO v_old,v_journal FROM invoices x WHERE x.id=v_source AND x.org_id=v_org FOR UPDATE;
    IF v_old IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
    IF v_old->>'status'='void' THEN RAISE EXCEPTION 'Invoice already voided'; END IF;
    UPDATE invoices SET status='void' WHERE id=v_source;

  ELSIF v_type='payment' THEN
    v_table:='payments';
    SELECT to_jsonb(x),x.journal_entry_id INTO v_old,v_journal FROM payments x WHERE x.id=v_source AND x.org_id=v_org FOR UPDATE;
    IF v_old IS NULL THEN RAISE EXCEPTION 'Payment not found'; END IF;
    IF (v_old->>'notes') ILIKE '%[VOIDED:%' THEN RAISE EXCEPTION 'Payment already voided'; END IF;
    UPDATE payments SET notes=coalesce(notes,'')||' [VOIDED: '||v_reason||']' WHERE id=v_source;

  ELSIF v_type='employee' THEN
    v_table:='employees';
    SELECT to_jsonb(x) INTO v_old FROM employees x WHERE x.id=v_source AND x.org_id=v_org FOR UPDATE;
    IF v_old IS NULL THEN RAISE EXCEPTION 'Employee not found'; END IF;
    IF v_old->>'status'='terminated' THEN RAISE EXCEPTION 'Employee already terminated'; END IF;
    UPDATE employees SET status='terminated',termination_reason=coalesce(termination_reason,'employer'),termination_date=current_date WHERE id=v_source;

  ELSIF v_type='asset' THEN
    v_table:='fixed_assets';
    SELECT to_jsonb(x) INTO v_old FROM fixed_assets x WHERE x.id=v_source AND x.org_id=v_org FOR UPDATE;
    IF v_old IS NULL THEN RAISE EXCEPTION 'Asset not found'; END IF;
    IF v_old->>'status'='disposed' THEN RAISE EXCEPTION 'Asset already disposed'; END IF;
    UPDATE fixed_assets SET status='disposed' WHERE id=v_source;

  ELSIF v_type='relatedParty' THEN
    v_table:='related_party_transactions';
    SELECT to_jsonb(x),x.journal_entry_id INTO v_old,v_journal FROM related_party_transactions x WHERE x.id=v_source AND x.org_id=v_org FOR UPDATE;
    IF v_old IS NULL THEN RAISE EXCEPTION 'Related-party record not found'; END IF;
    -- no dedicated status column on this table; double-void is caught below via v_journal_status

  ELSIF v_type='bank_match' THEN
    v_table:='bank_transactions';
    SELECT to_jsonb(x),x.matched_journal_entry_id INTO v_old,v_journal FROM bank_transactions x WHERE x.id=v_source AND x.org_id=v_org FOR UPDATE;
    IF v_old IS NULL THEN RAISE EXCEPTION 'Bank transaction not found'; END IF;
    IF v_old->>'reconciliation_status'='unmatched' THEN RAISE EXCEPTION 'Bank transaction is already unmatched'; END IF;
    UPDATE bank_transactions SET reconciliation_status='unmatched',matched_journal_entry_id=NULL,matched_by=NULL,matched_at=NULL WHERE id=v_source;

  ELSE
    RAISE EXCEPTION 'Unsupported void source type';
  END IF;

  IF v_journal IS NOT NULL THEN
    SELECT status INTO v_journal_status FROM journal_entries WHERE id=v_journal FOR UPDATE;
    IF v_journal_status='void' THEN
      RAISE EXCEPTION 'Linked journal entry is already voided/reversed';
    END IF;
    INSERT INTO journal_entries(org_id,created_by,date,reference,description,source_type,source_id,status,posted_at,posted_by)
      SELECT org_id,v_user,date,'REV-'||id::text,'Reversal: '||description,'reversal',v_source,'posted',now(),v_user
      FROM journal_entries WHERE id=v_journal RETURNING id INTO v_reversal;
    INSERT INTO journal_lines(org_id,journal_entry_id,account_id,debit,credit,description,vat_category,vat_rate,vat_amount,contact_id)
      SELECT org_id,v_reversal,account_id,credit,debit,'Reversal: '||description,vat_category,vat_rate,vat_amount,contact_id
      FROM journal_lines WHERE journal_entry_id=v_journal;
    UPDATE journal_entries SET status='void' WHERE id=v_journal AND org_id=v_org;
  END IF;

  INSERT INTO audit_logs(org_id,user_id,action,table_name,record_id,old_values,new_values,correction_reason,evidence_link,actor_type)
    VALUES(v_org,v_user,'voided',v_table,v_source,v_old,jsonb_build_object('status','void','reason',v_reason,'reversal_journal_id',v_reversal),v_reason,p_request->>'evidence_link','human');

  RETURN jsonb_build_object('success',true,'sourceId',v_source,'reversalJournalId',v_reversal,'sourceTable',v_table);
END; $fn$;

REVOKE ALL ON FUNCTION public.void_record_transaction(JSONB) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.void_record_transaction(JSONB) TO authenticated;

COMMIT;
