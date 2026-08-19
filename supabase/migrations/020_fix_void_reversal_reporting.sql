BEGIN;

-- Bug: void_record_transaction (016) voids the original journal entry
-- (status='void') and inserts a separate reversal entry with status='posted'
-- carrying the mirrored debit/credit. fn_trial_balance, fn_balance_sheet,
-- and fn_profit_and_loss all filter je.status='posted' only, so the
-- original's contribution is excluded but the reversal's contribution is
-- included on its own — the pair never nets to zero as intended. Every
-- voided transaction with a linked journal entry (payment, invoice,
-- relatedParty, bank_match) permanently inflates these three reports by the
-- voided amount.
--
-- Fix: widen the status filter in all three functions to include 'void' as
-- well as 'posted', so an original (void) entry and its reversal (posted)
-- entry both count and cancel out arithmetically, exactly as the reversal
-- was designed to do. This does not change void_record_transaction itself,
-- so the existing idempotency guard (which checks for status='void' to
-- block double-voiding) is untouched.

CREATE OR REPLACE FUNCTION fn_trial_balance(p_org_id UUID, p_as_of_date DATE)
RETURNS TABLE (account_id UUID, account_code VARCHAR, account_name VARCHAR, account_name_ar VARCHAR, account_type account_type, total_debit NUMERIC(15,2), total_credit NUMERIC(15,2), net_balance NUMERIC(15,2)) AS $$ BEGIN RETURN QUERY
SELECT a.id,a.code,a.name,a.name_ar,a.type,COALESCE(SUM(jl.debit),0)::NUMERIC(15,2),COALESCE(SUM(jl.credit),0)::NUMERIC(15,2),(CASE WHEN a.type IN ('asset','expense') THEN COALESCE(SUM(jl.debit-jl.credit),0) ELSE COALESCE(SUM(jl.credit-jl.debit),0) END)::NUMERIC(15,2)
FROM accounts a LEFT JOIN journal_lines jl ON jl.account_id=a.id AND jl.org_id=p_org_id LEFT JOIN journal_entries je ON jl.journal_entry_id=je.id AND je.org_id=p_org_id AND je.status IN ('posted','void') AND je.date<=p_as_of_date
WHERE a.org_id=p_org_id AND a.is_active=TRUE AND je.id IS NOT NULL GROUP BY a.id,a.code,a.name,a.name_ar,a.type HAVING COALESCE(SUM(jl.debit),0)!=0 OR COALESCE(SUM(jl.credit),0)!=0 ORDER BY a.code;
END; $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION fn_balance_sheet(p_org_id UUID, p_as_of DATE)
RETURNS TABLE (bs_type account_type, category account_category, account_code VARCHAR, account_name VARCHAR, balance NUMERIC(15,2)) AS $$ BEGIN RETURN QUERY
SELECT a.type,a.category,a.code,a.name,(CASE WHEN a.type='asset' THEN COALESCE(SUM(jl.debit-jl.credit),0) ELSE COALESCE(SUM(jl.credit-jl.debit),0) END)::NUMERIC(15,2)
FROM accounts a LEFT JOIN journal_lines jl ON jl.account_id=a.id LEFT JOIN journal_entries je ON jl.journal_entry_id=je.id AND je.org_id=p_org_id AND je.status IN ('posted','void') AND je.date<=p_as_of
WHERE a.org_id=p_org_id AND a.type IN ('asset','liability','equity') AND je.id IS NOT NULL GROUP BY a.id,a.type,a.category,a.code,a.name HAVING COALESCE(SUM(jl.debit),0)!=0 OR COALESCE(SUM(jl.credit),0)!=0 ORDER BY a.type,a.code;
END; $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION fn_profit_and_loss(p_org_id UUID, p_start DATE, p_end DATE)
RETURNS TABLE (category account_category, account_code VARCHAR, account_name VARCHAR, amount NUMERIC(15,2))
AS $$ BEGIN RETURN QUERY
  SELECT a.category, a.code, a.name,
    (CASE WHEN a.type='revenue' THEN COALESCE(SUM(jl.credit-jl.debit),0) ELSE COALESCE(SUM(jl.debit-jl.credit),0) END)::NUMERIC(15,2)
  FROM accounts a JOIN journal_lines jl ON jl.account_id=a.id JOIN journal_entries je ON jl.journal_entry_id=je.id
  WHERE a.org_id=p_org_id AND a.type IN ('revenue','expense') AND je.status IN ('posted','void') AND je.date BETWEEN p_start AND p_end
  GROUP BY a.id, a.category, a.code, a.name, a.type ORDER BY a.category, a.code;
END; $$ LANGUAGE plpgsql STABLE;

-- Permissions unchanged by CREATE OR REPLACE, but re-asserted for clarity
-- and to guard against a future migration accidentally dropping and
-- recreating these functions without re-granting.
REVOKE ALL ON FUNCTION public.fn_trial_balance(UUID, DATE)      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_trial_balance(UUID, DATE)   TO authenticated;
REVOKE ALL ON FUNCTION public.fn_balance_sheet(UUID, DATE)      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_balance_sheet(UUID, DATE)   TO authenticated;
REVOKE ALL ON FUNCTION public.fn_profit_and_loss(UUID, DATE, DATE)    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_profit_and_loss(UUID, DATE, DATE) TO authenticated;

COMMIT;
