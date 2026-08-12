-- ============================================================
-- 011 - PHASE 06: PROVE IT, THEN EXPAND
-- ============================================================
-- Persist compliance workings, regulatory changes, and system-actor job facts.
BEGIN;

CREATE TABLE IF NOT EXISTS public.corporate_tax_workpapers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tax_period_start DATE NOT NULL, tax_period_end DATE NOT NULL, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','reviewed','filed','locked')),
  accounting_profit NUMERIC(15,2) NOT NULL DEFAULT 0, exempt_income NUMERIC(15,2) NOT NULL DEFAULT 0,
  non_deductible_expenses NUMERIC(15,2) NOT NULL DEFAULT 0, related_party_adjustments NUMERIC(15,2) NOT NULL DEFAULT 0,
  transitional_adjustments NUMERIC(15,2) NOT NULL DEFAULT 0, carried_forward_losses NUMERIC(15,2) NOT NULL DEFAULT 0,
  taxable_income NUMERIC(15,2) NOT NULL DEFAULT 0, tax_due NUMERIC(15,2) NOT NULL DEFAULT 0,
  qfzp_status TEXT NOT NULL DEFAULT 'not_applicable', relief_election TEXT, source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  prepared_by UUID REFERENCES auth.users(id), reviewed_by UUID REFERENCES auth.users(id), fta_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, tax_period_start, tax_period_end)
);
ALTER TABLE corporate_tax_workpapers ENABLE ROW LEVEL SECURITY;
CREATE POLICY ct_workpapers_read ON corporate_tax_workpapers FOR SELECT TO authenticated USING(public.user_has_org_access(org_id));
CREATE POLICY ct_workpapers_write ON corporate_tax_workpapers FOR ALL TO authenticated USING(public.user_has_org_write_access(org_id)) WITH CHECK(public.user_has_org_write_access(org_id));

CREATE TABLE IF NOT EXISTS public.regulatory_change_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL, effective_date DATE, affected_rule TEXT NOT NULL, implementation_ticket TEXT,
  test_cases TEXT, owner_id UUID REFERENCES auth.users(id), status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','implemented','verified','superseded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE regulatory_change_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY regulatory_log_read ON regulatory_change_log FOR SELECT TO authenticated USING(org_id IS NULL OR public.user_has_org_access(org_id));
CREATE POLICY regulatory_log_write ON regulatory_change_log FOR ALL TO authenticated USING(org_id IS NULL OR public.user_has_org_write_access(org_id)) WITH CHECK(org_id IS NULL OR public.user_has_org_write_access(org_id));

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS request_id TEXT, ADD COLUMN IF NOT EXISTS correction_reason TEXT, ADD COLUMN IF NOT EXISTS evidence_link TEXT, ADD COLUMN IF NOT EXISTS actor_type TEXT NOT NULL DEFAULT 'human';

CREATE OR REPLACE FUNCTION public.fn_corporate_tax_workpaper(p_org_id UUID, p_start DATE, p_end DATE)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $fn$
DECLARE v_profit NUMERIC := 0; v_revenue NUMERIC := 0; v_work JSONB;
BEGIN
  IF NOT public.user_has_org_access(p_org_id) THEN RAISE EXCEPTION 'No organization access'; END IF;
  SELECT COALESCE(SUM(CASE WHEN a.type='revenue' THEN jl.credit-jl.debit WHEN a.type='expense' THEN jl.debit-jl.credit ELSE 0 END),0), COALESCE(SUM(CASE WHEN a.type='revenue' THEN jl.credit-jl.debit ELSE 0 END),0)
  INTO v_profit,v_revenue FROM journal_entries je JOIN journal_lines jl ON jl.journal_entry_id=je.id JOIN accounts a ON a.id=jl.account_id
  WHERE je.org_id=p_org_id AND a.org_id=p_org_id AND je.status='posted' AND je.date BETWEEN p_start AND p_end;
  v_work := jsonb_build_object('accounting_profit',ROUND(v_profit,2),'revenue',ROUND(v_revenue,2),'source','posted_ledger','period_start',p_start,'period_end',p_end);
  RETURN v_work;
END; $fn$;
REVOKE ALL ON FUNCTION public.fn_corporate_tax_workpaper(UUID,DATE,DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_corporate_tax_workpaper(UUID,DATE,DATE) TO authenticated;

COMMIT;
