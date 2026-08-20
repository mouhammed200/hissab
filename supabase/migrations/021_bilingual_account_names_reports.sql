BEGIN;

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

REVOKE ALL ON FUNCTION public.fn_balance_sheet(UUID, DATE)      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_balance_sheet(UUID, DATE)   TO authenticated;
REVOKE ALL ON FUNCTION public.fn_profit_and_loss(UUID, DATE, DATE)    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_profit_and_loss(UUID, DATE, DATE) TO authenticated;

DROP FUNCTION IF EXISTS fn_aged_report(UUID, VARCHAR, DATE);

CREATE OR REPLACE FUNCTION fn_aged_report(p_org_id UUID, p_type VARCHAR, p_as_of DATE)
RETURNS TABLE (contact_id UUID, contact_name VARCHAR, contact_name_ar VARCHAR, current_0_30 NUMERIC(15,2), days_31_60 NUMERIC(15,2), days_61_90 NUMERIC(15,2), days_90_plus NUMERIC(15,2), total_due NUMERIC(15,2))
AS $$ DECLARE v_t invoice_type;
BEGIN
  IF p_type='receivable' THEN v_t:='sales_invoice'; ELSE v_t:='purchase_invoice'; END IF;
  RETURN QUERY
  SELECT c.id, c.name, c.name_ar,
    COALESCE(SUM(CASE WHEN (p_as_of-i.due_date)<=30 THEN i.total_amount-i.amount_paid ELSE 0 END),0)::NUMERIC(15,2),
    COALESCE(SUM(CASE WHEN (p_as_of-i.due_date) BETWEEN 31 AND 60 THEN i.total_amount-i.amount_paid ELSE 0 END),0)::NUMERIC(15,2),
    COALESCE(SUM(CASE WHEN (p_as_of-i.due_date) BETWEEN 61 AND 90 THEN i.total_amount-i.amount_paid ELSE 0 END),0)::NUMERIC(15,2),
    COALESCE(SUM(CASE WHEN (p_as_of-i.due_date)>90 THEN i.total_amount-i.amount_paid ELSE 0 END),0)::NUMERIC(15,2),
    COALESCE(SUM(i.total_amount-i.amount_paid),0)::NUMERIC(15,2)
  FROM contacts c JOIN invoices i ON i.contact_id=c.id
  WHERE c.org_id=p_org_id AND i.invoice_type=v_t AND i.status IN ('approved','sent','partially_paid')
    AND i.issue_date<=p_as_of AND (i.total_amount-i.amount_paid)>0
  GROUP BY c.id, c.name, c.name_ar;
END; $$ LANGUAGE plpgsql STABLE;

REVOKE ALL ON FUNCTION public.fn_aged_report(UUID, VARCHAR, DATE)    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_aged_report(UUID, VARCHAR, DATE) TO authenticated;

COMMIT;
