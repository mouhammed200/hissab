-- ============================================================
-- 012 - NON-eINVOICE UAE COMPLIANCE CLOSURE
-- ============================================================
-- Closes the remaining product-side gaps. PINT AE / accredited ASP remains
-- intentionally outside this migration by request.
BEGIN;

-- --------------------------- VAT return persistence and locking
ALTER TYPE vat_return_status ADD VALUE IF NOT EXISTS 'reviewed';
ALTER TYPE vat_return_status ADD VALUE IF NOT EXISTS 'amended';
ALTER TYPE vat_return_status ADD VALUE IF NOT EXISTS 'locked';
ALTER TABLE vat_returns ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id), ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS payment_date DATE, ADD COLUMN IF NOT EXISTS fta_reference TEXT, ADD COLUMN IF NOT EXISTS supporting_schedule JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.build_vat_return(p_org_id UUID, p_start DATE, p_end DATE)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
DECLARE v_output NUMERIC:=0; v_input NUMERIC:=0; v_sales NUMERIC:=0; v_purchases NUMERIC:=0; v_items JSONB;
BEGIN
 IF NOT public.user_has_org_access(p_org_id) THEN RAISE EXCEPTION 'No organization access'; END IF;
 SELECT COALESCE(SUM(CASE WHEN i.invoice_type='sales_invoice' THEN ii.subtotal ELSE 0 END),0),COALESCE(SUM(CASE WHEN i.invoice_type='purchase_invoice' THEN ii.subtotal ELSE 0 END),0),COALESCE(SUM(CASE WHEN i.invoice_type='sales_invoice' THEN ii.vat_amount ELSE 0 END),0),COALESCE(SUM(CASE WHEN i.invoice_type='purchase_invoice' THEN ii.vat_amount ELSE 0 END),0),jsonb_agg(jsonb_build_object('invoice_id',i.id,'invoice_type',i.invoice_type,'category',ii.vat_category,'net',ii.subtotal,'vat',ii.vat_amount)) INTO v_sales,v_purchases,v_output,v_input,v_items
 FROM invoices i JOIN invoice_items ii ON ii.invoice_id=i.id AND ii.org_id=p_org_id WHERE i.org_id=p_org_id AND i.status IN('approved','sent','paid','partially_paid') AND COALESCE(i.date_of_supply,i.issue_date) BETWEEN p_start AND p_end;
 RETURN jsonb_build_object('period_start',p_start,'period_end',p_end,'sales_net',round(v_sales,2),'purchases_net',round(v_purchases,2),'output_vat',round(v_output,2),'recoverable_input_vat',round(v_input,2),'net_vat_payable',round(v_output-v_input,2),'supporting_schedule',coalesce(v_items,'[]'::jsonb),'source','posted_invoice_facts');
END; $fn$;
REVOKE ALL ON FUNCTION public.build_vat_return(UUID,DATE,DATE) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.build_vat_return(UUID,DATE,DATE) TO authenticated;

CREATE OR REPLACE FUNCTION public.persist_vat_return(p_request JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_user UUID:=auth.uid(); v_org UUID:=(p_request->>'org_id')::UUID; v_start DATE:=(p_request->>'period_start')::DATE; v_end DATE:=(p_request->>'period_end')::DATE; v_data JSONB; v_id UUID; v_status TEXT:=coalesce(p_request->>'status','draft');
BEGIN
 IF v_user IS NULL OR NOT EXISTS(SELECT 1 FROM org_members WHERE org_id=v_org AND user_id=v_user AND role IN('owner','admin','accountant')) THEN RAISE EXCEPTION 'No VAT return access'; END IF;
 IF v_status NOT IN('draft','reviewed','filed','paid','amended','locked') THEN RAISE EXCEPTION 'Invalid VAT return status'; END IF;
 v_data:=public.build_vat_return(v_org,v_start,v_end);
 INSERT INTO vat_returns(org_id,period_key,period_start,period_end,filing_deadline,status,box_1_amount,box_1_vat,box_5_amount,box_5_vat,box_13_total_output_vat,box_17_total_input_vat,box_18_net_vat_payable,supporting_schedule,reviewed_by,reviewed_at,fta_reference,payment_date)
 VALUES(v_org,to_char(v_start,'YYYY-MM-DD')||'/'||to_char(v_end,'YYYY-MM-DD'),v_start,v_end,v_end+28,v_status::vat_return_status,(v_data->>'sales_net')::numeric,(v_data->>'output_vat')::numeric,(v_data->>'purchases_net')::numeric,(v_data->>'recoverable_input_vat')::numeric,(v_data->>'output_vat')::numeric,(v_data->>'recoverable_input_vat')::numeric,(v_data->>'net_vat_payable')::numeric,v_data->'supporting_schedule',CASE WHEN v_status IN('reviewed','filed','paid','locked') THEN v_user END,CASE WHEN v_status IN('reviewed','filed','paid','locked') THEN now() END,p_request->>'fta_reference',NULLIF(p_request->>'payment_date','')::date)
 ON CONFLICT(org_id,period_key) DO UPDATE SET status=EXCLUDED.status,supporting_schedule=EXCLUDED.supporting_schedule,box_1_amount=EXCLUDED.box_1_amount,box_1_vat=EXCLUDED.box_1_vat,box_5_amount=EXCLUDED.box_5_amount,box_5_vat=EXCLUDED.box_5_vat,box_13_total_output_vat=EXCLUDED.box_13_total_output_vat,box_17_total_input_vat=EXCLUDED.box_17_total_input_vat,box_18_net_vat_payable=EXCLUDED.box_18_net_vat_payable,reviewed_by=EXCLUDED.reviewed_by,reviewed_at=EXCLUDED.reviewed_at,fta_reference=EXCLUDED.fta_reference,payment_date=EXCLUDED.payment_date
 RETURNING id INTO v_id;
 INSERT INTO audit_logs(org_id,user_id,action,table_name,record_id,new_values,correction_reason,actor_type) VALUES(v_org,v_user,'upserted','vat_returns',v_id,jsonb_build_object('status',v_status,'period_start',v_start,'period_end',v_end),'VAT return workflow','human');
 RETURN jsonb_build_object('success',true,'id',v_id,'data',v_data);
END; $fn$;
REVOKE ALL ON FUNCTION public.persist_vat_return(JSONB) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.persist_vat_return(JSONB) TO authenticated;

-- --------------------------- Bank matching and controlled reconciliation
CREATE OR REPLACE FUNCTION public.reconcile_bank_transaction(p_request JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_user UUID:=auth.uid(); v_org UUID:=(p_request->>'org_id')::UUID; v_bank UUID:=(p_request->>'bank_transaction_id')::UUID; v_journal UUID:=NULLIF(p_request->>'journal_entry_id','')::UUID; v_status TEXT:=coalesce(p_request->>'status','matched'); v_old JSONB;
BEGIN
 IF v_user IS NULL OR NOT EXISTS(SELECT 1 FROM org_members WHERE org_id=v_org AND user_id=v_user AND role IN('owner','admin','accountant')) THEN RAISE EXCEPTION 'No reconciliation access'; END IF;
 IF v_status NOT IN('unmatched','matched','reconciled','review') THEN RAISE EXCEPTION 'Invalid reconciliation status'; END IF;
 SELECT to_jsonb(bt) INTO v_old FROM bank_transactions bt WHERE bt.id=v_bank AND bt.org_id=v_org FOR UPDATE;
 IF v_old IS NULL THEN RAISE EXCEPTION 'Bank transaction not found'; END IF;
 UPDATE bank_transactions SET reconciliation_status=v_status,matched_journal_entry_id=v_journal,matched_by=v_user,matched_at=CASE WHEN v_status IN('matched','reconciled') THEN now() END WHERE id=v_bank AND org_id=v_org;
 INSERT INTO audit_logs(org_id,user_id,action,table_name,record_id,old_values,new_values,correction_reason,actor_type) VALUES(v_org,v_user,'reconciled','bank_transactions',v_bank,v_old,jsonb_build_object('status',v_status,'journal_entry_id',v_journal),coalesce(p_request->>'reason','bank reconciliation'),'human');
 RETURN jsonb_build_object('success',true,'bankTransactionId',v_bank,'status',v_status);
END; $fn$;
REVOKE ALL ON FUNCTION public.reconcile_bank_transaction(JSONB) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.reconcile_bank_transaction(JSONB) TO authenticated;

-- --------------------------- Excise facts and tiered calculation boundary
CREATE TABLE IF NOT EXISTS public.excise_product_facts(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,invoice_item_id UUID REFERENCES invoice_items(id) ON DELETE CASCADE,category TEXT NOT NULL CHECK(category IN('none','tobacco','eSmoking','energyDrinks','sweetenedHigh','sweetenedMed','sweetenedLow')),volume_litres NUMERIC(15,6) NOT NULL DEFAULT 0,sugar_grams_per_100ml NUMERIC(15,6),rate NUMERIC(15,6) NOT NULL DEFAULT 0,excise_amount NUMERIC(15,2) NOT NULL DEFAULT 0,conformity_evidence TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
ALTER TABLE excise_product_facts ENABLE ROW LEVEL SECURITY;
CREATE POLICY excise_facts_read ON excise_product_facts FOR SELECT TO authenticated USING(public.user_has_org_access(org_id));
CREATE POLICY excise_facts_write ON excise_product_facts FOR ALL TO authenticated USING(public.user_has_org_write_access(org_id)) WITH CHECK(public.user_has_org_write_access(org_id));

CREATE OR REPLACE FUNCTION public.calculate_excise(p_category TEXT,p_volume NUMERIC,p_sugar NUMERIC DEFAULT NULL)
RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE AS $fn$
BEGIN
 IF p_category IN('tobacco','eSmoking','energyDrinks') THEN RETURN round(greatest(p_volume,0)*100,2); END IF;
 IF p_category='sweetenedHigh' THEN RETURN round(greatest(p_volume,0)*1.00,2); END IF;
 IF p_category='sweetenedMed' THEN RETURN round(greatest(p_volume,0)*0.75,2); END IF;
 IF p_category='sweetenedLow' THEN RETURN round(greatest(p_volume,0)*0.50,2); END IF;
 RETURN 0;
END; $fn$;
REVOKE ALL ON FUNCTION public.calculate_excise(TEXT,NUMERIC,NUMERIC) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.calculate_excise(TEXT,NUMERIC,NUMERIC) TO authenticated;

-- --------------------------- Audit completeness and scheduled actor semantics
CREATE OR REPLACE FUNCTION public.audit_row_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_org UUID; v_id UUID; v_old JSONB; v_new JSONB;
BEGIN
 v_org:=coalesce((to_jsonb(NEW)->>'org_id')::uuid,(to_jsonb(OLD)->>'org_id')::uuid); v_id:=coalesce((to_jsonb(NEW)->>'id')::uuid,(to_jsonb(OLD)->>'id')::uuid); v_old:=CASE WHEN TG_OP IN('UPDATE','DELETE') THEN to_jsonb(OLD) END; v_new:=CASE WHEN TG_OP IN('INSERT','UPDATE') THEN to_jsonb(NEW) END;
 INSERT INTO audit_logs(org_id,user_id,action,table_name,record_id,old_values,new_values,actor_type) VALUES(v_org,auth.uid(),lower(TG_OP),TG_TABLE_NAME,v_id,v_old,v_new,CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'human' END); RETURN coalesce(NEW,OLD);
END; $fn$;
DROP TRIGGER IF EXISTS trg_audit_vat_returns ON vat_returns; CREATE TRIGGER trg_audit_vat_returns AFTER INSERT OR UPDATE OR DELETE ON vat_returns FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
DROP TRIGGER IF EXISTS trg_audit_bank_transactions ON bank_transactions; CREATE TRIGGER trg_audit_bank_transactions AFTER INSERT OR UPDATE OR DELETE ON bank_transactions FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

COMMIT;
