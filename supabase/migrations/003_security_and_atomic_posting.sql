-- Lock down tenant membership management. Existing members may read their own
-- memberships; only owners/admins may create, update, or remove memberships.
DROP POLICY IF EXISTS mem_all ON org_members;
CREATE POLICY mem_select ON org_members FOR SELECT USING (user_id = auth.uid() OR public.user_has_org_access(org_id));
CREATE POLICY mem_insert_admin ON org_members FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM org_members actor WHERE actor.org_id = org_members.org_id AND actor.user_id = auth.uid() AND actor.role IN ('owner','admin'))
);
CREATE POLICY mem_update_admin ON org_members FOR UPDATE USING (
  EXISTS (SELECT 1 FROM org_members actor WHERE actor.org_id = org_members.org_id AND actor.user_id = auth.uid() AND actor.role IN ('owner','admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM org_members actor WHERE actor.org_id = org_members.org_id AND actor.user_id = auth.uid() AND actor.role IN ('owner','admin'))
);
CREATE POLICY mem_delete_admin ON org_members FOR DELETE USING (
  EXISTS (SELECT 1 FROM org_members actor WHERE actor.org_id = org_members.org_id AND actor.user_id = auth.uid() AND actor.role IN ('owner','admin'))
);

DROP POLICY IF EXISTS org_ins ON organizations;
CREATE POLICY org_ins_authenticated ON organizations FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Reports must exclude draft/void/future entries in the JOIN predicate and all
-- aggregates must be scoped to the requested organization.
CREATE OR REPLACE FUNCTION fn_trial_balance(p_org_id UUID, p_as_of_date DATE)
RETURNS TABLE (account_id UUID, account_code VARCHAR, account_name VARCHAR, account_name_ar VARCHAR, account_type account_type, total_debit NUMERIC(15,2), total_credit NUMERIC(15,2), net_balance NUMERIC(15,2)) AS $$ BEGIN RETURN QUERY
SELECT a.id,a.code,a.name,a.name_ar,a.type,COALESCE(SUM(jl.debit),0)::NUMERIC(15,2),COALESCE(SUM(jl.credit),0)::NUMERIC(15,2),(CASE WHEN a.type IN ('asset','expense') THEN COALESCE(SUM(jl.debit-jl.credit),0) ELSE COALESCE(SUM(jl.credit-jl.debit),0) END)::NUMERIC(15,2)
FROM accounts a LEFT JOIN journal_lines jl ON jl.account_id=a.id AND jl.org_id=p_org_id LEFT JOIN journal_entries je ON jl.journal_entry_id=je.id AND je.org_id=p_org_id AND je.status='posted' AND je.date<=p_as_of_date
WHERE a.org_id=p_org_id AND a.is_active=TRUE AND je.id IS NOT NULL GROUP BY a.id,a.code,a.name,a.name_ar,a.type HAVING COALESCE(SUM(jl.debit),0)!=0 OR COALESCE(SUM(jl.credit),0)!=0 ORDER BY a.code;
END; $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION fn_balance_sheet(p_org_id UUID, p_as_of DATE)
RETURNS TABLE (bs_type account_type, category account_category, account_code VARCHAR, account_name VARCHAR, balance NUMERIC(15,2)) AS $$ BEGIN RETURN QUERY
SELECT a.type,a.category,a.code,a.name,(CASE WHEN a.type='asset' THEN COALESCE(SUM(jl.debit-jl.credit),0) ELSE COALESCE(SUM(jl.credit-jl.debit),0) END)::NUMERIC(15,2)
FROM accounts a LEFT JOIN journal_lines jl ON jl.account_id=a.id AND jl.org_id=p_org_id LEFT JOIN journal_entries je ON jl.journal_entry_id=je.id AND je.org_id=p_org_id AND je.status='posted' AND je.date<=p_as_of
WHERE a.org_id=p_org_id AND a.type IN ('asset','liability','equity') AND je.id IS NOT NULL GROUP BY a.id,a.type,a.category,a.code,a.name HAVING COALESCE(SUM(jl.debit),0)!=0 OR COALESCE(SUM(jl.credit),0)!=0 ORDER BY a.type,a.code;
END; $$ LANGUAGE plpgsql STABLE;

-- Atomic posting primitive for future callers. All rows are inserted in one
-- transaction and duplicate client requests are rejected.
CREATE TABLE IF NOT EXISTS posting_requests (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, request_key TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(org_id, request_key));
ALTER TABLE posting_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY posting_requests_org ON posting_requests FOR ALL USING (public.user_has_org_access(org_id)) WITH CHECK (public.user_has_org_access(org_id));
