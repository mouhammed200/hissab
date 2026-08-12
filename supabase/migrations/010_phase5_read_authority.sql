-- ============================================================
-- 010 - PHASE 05: UNIFY EVERY READ SURFACE
-- ============================================================
-- Reports, dashboard, and exports consume the same posted-ledger snapshot.
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_hissab_read_snapshot(
  p_org_id UUID, p_start DATE, p_end DATE
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_revenue NUMERIC := 0; v_expense NUMERIC := 0; v_output_vat NUMERIC := 0; v_input_vat NUMERIC := 0;
  v_posted BIGINT := 0; v_source JSONB;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN RAISE EXCEPTION 'No organization access'; END IF;
  SELECT COALESCE(SUM(CASE WHEN a.type='revenue' THEN jl.credit-jl.debit ELSE 0 END),0),
         COALESCE(SUM(CASE WHEN a.type='expense' THEN jl.debit-jl.credit ELSE 0 END),0),
         COALESCE(SUM(CASE WHEN jl.account_id=(SELECT id FROM accounts WHERE org_id=p_org_id AND code='2100') THEN jl.credit-jl.debit ELSE 0 END),0),
         COALESCE(SUM(CASE WHEN jl.account_id=(SELECT id FROM accounts WHERE org_id=p_org_id AND code='1400') THEN jl.debit-jl.credit ELSE 0 END),0),
         COUNT(DISTINCT je.id)
  INTO v_revenue,v_expense,v_output_vat,v_input_vat,v_posted
  FROM journal_entries je JOIN journal_lines jl ON jl.journal_entry_id=je.id AND jl.org_id=p_org_id
  JOIN accounts a ON a.id=jl.account_id AND a.org_id=p_org_id
  WHERE je.org_id=p_org_id AND je.status='posted' AND je.date BETWEEN p_start AND p_end;

  SELECT jsonb_agg(jsonb_build_object('month',month_key,'revenue',revenue,'expense',expense) ORDER BY month_key)
  INTO v_source
  FROM (
    SELECT TO_CHAR(je.date,'YYYY-MM') month_key,
      COALESCE(SUM(CASE WHEN a.type='revenue' THEN jl.credit-jl.debit ELSE 0 END),0) revenue,
      COALESCE(SUM(CASE WHEN a.type='expense' THEN jl.debit-jl.credit ELSE 0 END),0) expense
    FROM journal_entries je JOIN journal_lines jl ON jl.journal_entry_id=je.id AND jl.org_id=p_org_id
    JOIN accounts a ON a.id=jl.account_id AND a.org_id=p_org_id
    WHERE je.org_id=p_org_id AND je.status='posted' AND je.date BETWEEN p_start AND p_end
    GROUP BY TO_CHAR(je.date,'YYYY-MM')
  ) monthly;

  RETURN jsonb_build_object(
    'org_id',p_org_id,'period_start',p_start,'period_end',p_end,'currency','AED',
    'revenue',ROUND(v_revenue,2),'expenses',ROUND(v_expense,2),'net_profit',ROUND(v_revenue-v_expense,2),
    'output_vat',ROUND(v_output_vat,2),'input_vat',ROUND(v_input_vat,2),
    'vat_due',ROUND(v_output_vat-v_input_vat,2),'posted_journal_count',v_posted,
    'monthly',COALESCE(v_source,'[]'::jsonb),'source','posted_ledger'
  );
END; $fn$;
REVOKE ALL ON FUNCTION public.fn_hissab_read_snapshot(UUID,DATE,DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_hissab_read_snapshot(UUID,DATE,DATE) TO authenticated;

COMMIT;
