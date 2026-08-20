BEGIN;

-- fn_trial_balance already returns account_name_ar (see 020), but
-- fn_balance_sheet and fn_profit_and_loss only return account_name even
-- though both read from the same accounts table, which has had a
-- name_ar column since 001_foundation. This widens both functions to
-- match trial balance so Arabic-locale reports can render the Arabic
-- account name where one was entered, falling back to name in the
-- frontend when name_ar is null (accounts entered without an Arabic
-- name stay as originally entered, not auto-translated).

DROP FUNCTION IF EXISTS fn_balance_sheet(UUID, DATE);

CREATE OR REPLACE FUNCTION fn_balance_sheet(p_org_id UUID, p_as_of DATE)
RETURNS TABLE (bs_type account_type, category account_category, account_code VARCHAR, account_name VARCHAR, account_name_ar VARCHAR, balance NUMERIC(15,2)) AS $$ BEGIN RETURN QUERY
SELECT a.type,a.category,a.code,a.name,a.name_ar,(CASE WHEN a.type='asset' THEN COALESCE(SUM(jl.debit-jl.credit),0) ELSE COALESCE(SUM(jl.credit-jl.debit),0) END)::NUMERIC(15,2)
FROM accounts a LEFT JOIN journal_lines jl ON jl.account_id=a.id LEFT JOIN journal_entries je ON jl.journal_entry_id=je.id AND je.org_id=p_org_id AND je.status IN ('posted','void') AND je.date<=p_as_of
WHERE a.org_id=p_org_id AND a.type IN ('asset','liability','equity') AND je.id IS NOT NULL GROUP BY a.id,a.type,a.category,a.code,a.name,a.name_ar HAVING COALESCE(SUM(jl.debit),0)!=0 OR COALESCE(SUM(jl.credit),0)!=0 ORDER BY a.type,a.code;
END; $$ LANGUAGE plpgsql STABLE;

DROP FUNCTION IF EXISTS fn_profit_and_loss(UUID, DATE, DATE);

CREATE OR REPLACE FUNCTION fn_profit_and_loss(p_org_id UUID, p_start DATE, p_end DATE)
RETURNS TABLE (category account_category, account_code VARCHAR, account_name VARCHAR, account_name_ar VARCHAR, amount NUMERIC(15,2))
AS $$ BEGIN RETURN QUERY
  SELECT a.category, a.code, a.name, a.name_ar,
    (CASE WHEN a.type='revenue' THEN COALESCE(SUM(jl.credit-jl.debit),0) ELSE COALESCE(SUM(jl.debit-jl.credit),0) END)::NUMERIC(15,2)
  FROM accounts a JOIN journal_lines jl ON jl.account_id=a.id JOIN journal_entries je ON jl.journal_entry_id=je.id
  WHERE a.org_id=p_org_id AND a.type IN ('revenue','expense') AND je.status IN ('posted','void') AND je.date BETWEEN p_start AND p_end
  GROUP BY a.id, a.category, a.code, a.name, a.name_ar, a.type ORDER BY a.category, a.code;
END; $$ LANGUAGE plpgsql STABLE;

-- Permissions unchanged by CREATE OR REPLACE, but re-asserted for clarity
-- and to guard against a future migration accidentally dropping and
-- recreating these functions without re-granting.
REVOKE ALL ON FUNCTION public.fn_balance_sheet(UUID, DATE)      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_balance_sheet(UUID, DATE)   TO authenticated;
REVOKE ALL ON FUNCTION public.fn_profit_and_loss(UUID, DATE, DATE)    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_profit_and_loss(UUID, DATE, DATE) TO authenticated;

COMMIT;
