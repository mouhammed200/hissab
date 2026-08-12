-- 014 - STORAGE, SHARED RATE LIMITING, RECURRING, AND FULL VOID COVERAGE
BEGIN;

-- 1. Private evidence bucket and object policies.
INSERT INTO storage.buckets (id, name, public)
VALUES ('evidence', 'evidence', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS evidence_read ON storage.objects;
DROP POLICY IF EXISTS evidence_insert ON storage.objects;
DROP POLICY IF EXISTS evidence_update ON storage.objects;
DROP POLICY IF EXISTS evidence_delete ON storage.objects;
CREATE POLICY evidence_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='evidence' AND public.user_has_org_access((storage.foldername(name))[1]::uuid));
CREATE POLICY evidence_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='evidence' AND public.user_has_org_write_access((storage.foldername(name))[1]::uuid));
CREATE POLICY evidence_update ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id='evidence' AND public.user_has_org_write_access((storage.foldername(name))[1]::uuid))
WITH CHECK (bucket_id='evidence' AND public.user_has_org_write_access((storage.foldername(name))[1]::uuid));
CREATE POLICY evidence_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id='evidence' AND public.user_has_org_write_access((storage.foldername(name))[1]::uuid));

-- 2. Shared rate limiter. This survives multiple app instances.
CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
  bucket_key TEXT PRIMARY KEY, window_started_at TIMESTAMPTZ NOT NULL, request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE rate_limit_buckets ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.consume_rate_limit(p_key TEXT, p_limit INTEGER, p_window_seconds INTEGER DEFAULT 60)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_now TIMESTAMPTZ:=now(); v_row rate_limit_buckets%ROWTYPE; v_allowed BOOLEAN; v_remaining INTEGER;
BEGIN
 SELECT * INTO v_row FROM rate_limit_buckets WHERE bucket_key=p_key FOR UPDATE;
 IF NOT FOUND OR v_now-v_row.window_started_at >= make_interval(secs=>p_window_seconds) THEN
   INSERT INTO rate_limit_buckets(bucket_key,window_started_at,request_count,updated_at) VALUES(p_key,v_now,1,v_now)
   ON CONFLICT(bucket_key) DO UPDATE SET window_started_at=EXCLUDED.window_started_at,request_count=1,updated_at=v_now;
   RETURN jsonb_build_object('allowed',true,'remaining',greatest(0,p_limit-1));
 END IF;
 v_allowed := v_row.request_count < p_limit;
 UPDATE rate_limit_buckets SET request_count=request_count+1,updated_at=v_now WHERE bucket_key=p_key;
 v_remaining := greatest(0,p_limit-v_row.request_count-1);
 RETURN jsonb_build_object('allowed',v_allowed,'remaining',v_remaining);
END; $fn$;
REVOKE ALL ON FUNCTION public.consume_rate_limit(TEXT,INTEGER,INTEGER) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(TEXT,INTEGER,INTEGER) TO authenticated;

-- 3. Recurring entries now use the same atomic posting boundary.
CREATE OR REPLACE FUNCTION public.post_recurring_transaction(p_request JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_user UUID:=auth.uid(); v_org UUID:=(p_request->>'org_id')::UUID; v_template UUID:=(p_request->>'template_id')::UUID; v_key TEXT:=NULLIF(p_request->>'request_key',''); v_date DATE:=COALESCE(NULLIF(p_request->>'date','')::DATE,current_date); v_desc TEXT:=COALESCE(p_request->>'description','Recurring entry'); v_lines JSONB:=coalesce(p_request->'journal_lines','[]'::jsonb); v_line JSONB; v_entry UUID; v_account UUID; v_d NUMERIC:=0; v_c NUMERIC:=0;
BEGIN
 IF v_user IS NULL OR v_org IS NULL OR v_template IS NULL OR v_key IS NULL THEN RAISE EXCEPTION 'Missing recurring posting fields'; END IF;
 PERFORM v_key::uuid;
 IF NOT EXISTS(SELECT 1 FROM org_members WHERE org_id=v_org AND user_id=v_user AND role IN('owner','admin','accountant')) THEN RAISE EXCEPTION 'No recurring posting access'; END IF;
 IF NOT EXISTS(SELECT 1 FROM recurring_templates WHERE id=v_template AND org_id=v_org AND is_active) THEN RAISE EXCEPTION 'Recurring template not found or inactive'; END IF;
 INSERT INTO posting_requests(org_id,request_key) VALUES(v_org,v_key) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN SELECT jsonb_build_object('success',true,'duplicate',true,'journalEntryId',id) INTO v_line FROM journal_entries WHERE org_id=v_org AND reference=v_key LIMIT 1; RETURN coalesce(v_line,jsonb_build_object('success',true,'duplicate',true)); END IF;
 FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines) LOOP
   SELECT id INTO v_account FROM accounts WHERE org_id=v_org AND (id=(v_line->>'account_id')::uuid OR code=v_line->>'account_code') AND is_active;
   IF v_account IS NULL THEN RAISE EXCEPTION 'Recurring account not found'; END IF;
   v_d:=v_d+coalesce((v_line->>'debit')::numeric,0); v_c:=v_c+coalesce((v_line->>'credit')::numeric,0);
 END LOOP;
 IF v_d<=0 OR abs(v_d-v_c)>.005 THEN RAISE EXCEPTION 'Recurring journal is unbalanced'; END IF;
 INSERT INTO journal_entries(org_id,created_by,date,reference,description,source_type,source_id,status,posted_at,posted_by)
 VALUES(v_org,v_user,v_date,v_key,v_desc,'recurring_template',v_template,'posted',now(),v_user) RETURNING id INTO v_entry;
 FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines) LOOP
   SELECT id INTO v_account FROM accounts WHERE org_id=v_org AND (id=(v_line->>'account_id')::uuid OR code=v_line->>'account_code') AND is_active;
   INSERT INTO journal_lines(org_id,journal_entry_id,account_id,debit,credit,description) VALUES(v_org,v_entry,v_account,coalesce((v_line->>'debit')::numeric,0),coalesce((v_line->>'credit')::numeric,0),v_line->>'description');
 END LOOP;
 INSERT INTO audit_logs(org_id,user_id,action,table_name,record_id,new_values,actor_type) VALUES(v_org,v_user,'created','journal_entries',v_entry,jsonb_build_object('source','recurring_template','template_id',v_template),'human');
 RETURN jsonb_build_object('success',true,'duplicate',false,'journalEntryId',v_entry);
END; $fn$;
REVOKE ALL ON FUNCTION public.post_recurring_transaction(JSONB) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.post_recurring_transaction(JSONB) TO authenticated;

-- 4. Extend atomic voids to all supported source records.
CREATE OR REPLACE FUNCTION public.void_record_transaction(p_request JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_user UUID:=auth.uid(); v_org UUID:=(p_request->>'org_id')::UUID; v_source UUID:=(p_request->>'source_id')::UUID; v_reason TEXT:=NULLIF(p_request->>'reason',''); v_type TEXT:=coalesce(p_request->>'source_type','invoice'); v_table TEXT; v_journal UUID; v_old JSONB; v_reversal UUID; v_status TEXT;
BEGIN
 IF v_user IS NULL OR v_reason IS NULL THEN RAISE EXCEPTION 'Actor and correction reason are required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM org_members WHERE org_id=v_org AND user_id=v_user AND role IN('owner','admin','accountant')) THEN RAISE EXCEPTION 'No void access'; END IF;
 IF v_type='invoice' THEN v_table:='invoices'; SELECT to_jsonb(x),x.journal_entry_id INTO v_old,v_journal FROM invoices x WHERE x.id=v_source AND x.org_id=v_org FOR UPDATE; IF v_old IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF; UPDATE invoices SET status='void' WHERE id=v_source;
 ELSIF v_type='payment' THEN v_table:='payments'; SELECT to_jsonb(x),x.journal_entry_id INTO v_old,v_journal FROM payments x WHERE x.id=v_source AND x.org_id=v_org FOR UPDATE; IF v_old IS NULL THEN RAISE EXCEPTION 'Payment not found'; END IF; UPDATE payments SET notes=coalesce(notes,'')||' [VOIDED: '||v_reason||']' WHERE id=v_source;
 ELSIF v_type='employee' THEN v_table:='employees'; SELECT to_jsonb(x) INTO v_old FROM employees x WHERE x.id=v_source AND x.org_id=v_org FOR UPDATE; IF v_old IS NULL THEN RAISE EXCEPTION 'Employee not found'; END IF; UPDATE employees SET status='terminated',termination_reason=coalesce(termination_reason,'employer'),termination_date=current_date WHERE id=v_source;
 ELSIF v_type='asset' THEN v_table:='fixed_assets'; SELECT to_jsonb(x) INTO v_old FROM fixed_assets x WHERE x.id=v_source AND x.org_id=v_org FOR UPDATE; IF v_old IS NULL THEN RAISE EXCEPTION 'Asset not found'; END IF; UPDATE fixed_assets SET status='disposed' WHERE id=v_source;
 ELSIF v_type='relatedParty' THEN v_table:='related_party_transactions'; SELECT to_jsonb(x),x.journal_entry_id INTO v_old,v_journal FROM related_party_transactions x WHERE x.id=v_source AND x.org_id=v_org FOR UPDATE; IF v_old IS NULL THEN RAISE EXCEPTION 'Related-party record not found'; END IF;
 ELSIF v_type='bank_match' THEN v_table:='bank_transactions'; SELECT to_jsonb(x),x.matched_journal_entry_id INTO v_old,v_journal FROM bank_transactions x WHERE x.id=v_source AND x.org_id=v_org FOR UPDATE; IF v_old IS NULL THEN RAISE EXCEPTION 'Bank transaction not found'; END IF; UPDATE bank_transactions SET reconciliation_status='unmatched',matched_journal_entry_id=NULL,matched_by=NULL,matched_at=NULL WHERE id=v_source;
 ELSE RAISE EXCEPTION 'Unsupported void source type'; END IF;
 IF v_journal IS NOT NULL THEN
   INSERT INTO journal_entries(org_id,created_by,date,reference,description,source_type,source_id,status,posted_at,posted_by) SELECT org_id,v_user,date,'REV-'||id::text,'Reversal: '||description,'reversal',v_source,'posted',now(),v_user FROM journal_entries WHERE id=v_journal RETURNING id INTO v_reversal;
   INSERT INTO journal_lines(org_id,journal_entry_id,account_id,debit,credit,description,vat_category,vat_rate,vat_amount,contact_id) SELECT org_id,v_reversal,account_id,credit,debit,'Reversal: '||description,vat_category,vat_rate,vat_amount,contact_id FROM journal_lines WHERE journal_entry_id=v_journal;
   UPDATE journal_entries SET status='void' WHERE id=v_journal AND org_id=v_org;
 END IF;
 INSERT INTO audit_logs(org_id,user_id,action,table_name,record_id,old_values,new_values,correction_reason,evidence_link,actor_type) VALUES(v_org,v_user,'voided',v_table,v_source,v_old,jsonb_build_object('status','void','reason',v_reason,'reversal_journal_id',v_reversal),v_reason,p_request->>'evidence_link','human');
 RETURN jsonb_build_object('success',true,'sourceId',v_source,'reversalJournalId',v_reversal,'sourceTable',v_table);
END; $fn$;

REVOKE ALL ON FUNCTION public.void_record_transaction(JSONB) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.void_record_transaction(JSONB) TO authenticated;
COMMIT;
