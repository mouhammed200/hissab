-- ============================================================
-- HISSAB UAE ACCOUNTING SAAS — COMPLETE DATABASE SCHEMA
-- Run this entire file in the Supabase SQL Editor
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ENUMS
CREATE TYPE member_role AS ENUM ('owner', 'admin', 'accountant', 'viewer');
CREATE TYPE account_type AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense');
CREATE TYPE account_category AS ENUM (
  'current_asset', 'fixed_asset', 'non_current_asset',
  'current_liability', 'non_current_liability', 'equity',
  'operating_revenue', 'non_operating_revenue',
  'cost_of_goods_sold', 'operating_expense', 'tax_expense', 'other_expense'
);
CREATE TYPE journal_status AS ENUM ('draft', 'posted', 'void');
CREATE TYPE invoice_type AS ENUM ('sales_invoice', 'purchase_invoice', 'credit_note', 'debit_note');
CREATE TYPE invoice_status AS ENUM ('draft', 'approved', 'sent', 'paid', 'partially_paid', 'void');
CREATE TYPE vat_category AS ENUM ('standard', 'zero', 'exempt', 'out_of_scope');
CREATE TYPE vat_return_status AS ENUM ('draft', 'filed', 'paid');
CREATE TYPE payment_method AS ENUM ('bank_transfer', 'cheque', 'cash', 'card');
CREATE TYPE emirate_enum AS ENUM (
  'Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman',
  'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah'
);

-- 1. ORGANIZATIONS & MEMBERS
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  legal_name VARCHAR(255),
  trn VARCHAR(15),
  license_number VARCHAR(100),
  licensing_authority VARCHAR(100),
  is_free_zone BOOLEAN DEFAULT FALSE,
  is_qualifying_free_zone_person BOOLEAN DEFAULT FALSE,
  corporate_tax_trn VARCHAR(15),
  base_currency VARCHAR(3) DEFAULT 'AED',
  default_emirate emirate_enum DEFAULT 'Dubai',
  fiscal_year_end_month INT DEFAULT 12 CHECK (fiscal_year_end_month BETWEEN 1 AND 12),
  settings JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE org_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role member_role NOT NULL DEFAULT 'accountant',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, user_id)
);

-- RLS HELPER
CREATE OR REPLACE FUNCTION public.user_has_org_access(p_org_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.org_members WHERE org_id = p_org_id AND user_id = auth.uid());
$$;

-- 2. CHART OF ACCOUNTS
CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(50) NOT NULL, name VARCHAR(255) NOT NULL, name_ar VARCHAR(255),
  type account_type NOT NULL, category account_category NOT NULL,
  parent_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
  is_system BOOLEAN DEFAULT FALSE, is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(org_id, code)
);

-- 3. CONTACTS
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL, name_ar VARCHAR(255),
  contact_type VARCHAR(20) CHECK (contact_type IN ('customer', 'vendor', 'both')) NOT NULL DEFAULT 'customer',
  trn VARCHAR(15), email VARCHAR(255), phone VARCHAR(50), address TEXT,
  emirate emirate_enum DEFAULT 'Dubai', payment_terms_days INT DEFAULT 30,
  is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. JOURNAL ENTRIES & LINES
CREATE TABLE journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entry_number SERIAL, date DATE NOT NULL, reference VARCHAR(100), description TEXT,
  source_type VARCHAR(50) DEFAULT 'manual', source_id UUID,
  status journal_status DEFAULT 'draft',
  created_by UUID NOT NULL REFERENCES auth.users(id),
  posted_at TIMESTAMPTZ, posted_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE journal_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  debit NUMERIC(15,2) DEFAULT 0 CHECK (debit >= 0),
  credit NUMERIC(15,2) DEFAULT 0 CHECK (credit >= 0),
  description TEXT, vat_category vat_category DEFAULT 'standard',
  vat_rate NUMERIC(5,4) DEFAULT 0, vat_amount NUMERIC(15,2) DEFAULT 0,
  contact_id UUID REFERENCES contacts(id),
  CHECK (debit > 0 OR credit > 0), CHECK (NOT (debit > 0 AND credit > 0))
);

-- DOUBLE-ENTRY BALANCE TRIGGER
CREATE OR REPLACE FUNCTION check_journal_entry_balance() RETURNS TRIGGER AS $$
DECLARE v_d NUMERIC(15,2); v_c NUMERIC(15,2); v_s journal_status; v_id UUID;
BEGIN
  v_id := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
  SELECT status INTO v_s FROM journal_entries WHERE id = v_id;
  IF v_s = 'posted' THEN
    SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0) INTO v_d, v_c FROM journal_lines WHERE journal_entry_id = v_id;
    IF v_d != v_c THEN RAISE EXCEPTION 'Unbalanced entry %: DR % != CR %', v_id, v_d, v_c; END IF;
    IF v_d = 0 THEN RAISE EXCEPTION 'Posted entry % has zero total', v_id; END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_check_journal_balance
AFTER INSERT OR UPDATE OR DELETE ON journal_lines
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_journal_entry_balance();

-- 5. INVOICES & ITEMS
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE RESTRICT,
  invoice_type invoice_type NOT NULL, invoice_number VARCHAR(100) NOT NULL,
  issue_date DATE NOT NULL, due_date DATE NOT NULL,
  currency VARCHAR(3) DEFAULT 'AED', exchange_rate NUMERIC(10,6) DEFAULT 1,
  subtotal_amount NUMERIC(15,2) DEFAULT 0, vat_amount NUMERIC(15,2) DEFAULT 0,
  discount_amount NUMERIC(15,2) DEFAULT 0, total_amount NUMERIC(15,2) DEFAULT 0,
  amount_paid NUMERIC(15,2) DEFAULT 0, is_reverse_charge BOOLEAN DEFAULT FALSE,
  emirate emirate_enum NOT NULL DEFAULT 'Dubai', status invoice_status DEFAULT 'draft',
  journal_entry_id UUID REFERENCES journal_entries(id), notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, invoice_type, invoice_number)
);

CREATE TABLE invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
  description TEXT NOT NULL, quantity NUMERIC(12,4) DEFAULT 1, unit_price NUMERIC(15,2) DEFAULT 0,
  discount NUMERIC(15,2) DEFAULT 0, subtotal NUMERIC(15,2) DEFAULT 0,
  vat_category vat_category DEFAULT 'standard', vat_rate NUMERIC(5,4) DEFAULT 0.05,
  vat_amount NUMERIC(15,2) DEFAULT 0, total NUMERIC(15,2) DEFAULT 0,
  excise_category VARCHAR(50) DEFAULT 'none'
);

-- 6. PAYMENTS
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payment_number VARCHAR(50) NOT NULL,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  payment_type VARCHAR(20) CHECK (payment_type IN ('received', 'made')) NOT NULL,
  payment_date DATE NOT NULL, bank_account_id UUID REFERENCES accounts(id),
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  currency VARCHAR(3) DEFAULT 'AED', exchange_rate NUMERIC(10,6) DEFAULT 1,
  payment_method payment_method DEFAULT 'bank_transfer', reference_number VARCHAR(100),
  journal_entry_id UUID REFERENCES journal_entries(id), notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(org_id, payment_number)
);

CREATE TABLE payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  allocated_amount NUMERIC(15,2) NOT NULL CHECK (allocated_amount > 0),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. EMPLOYEES & GRATUITY
CREATE TABLE employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_code VARCHAR(50), full_name VARCHAR(255) NOT NULL, full_name_ar VARCHAR(255),
  emirates_id VARCHAR(18), hire_date DATE NOT NULL, termination_date DATE,
  contract_type VARCHAR(20) CHECK (contract_type IN ('limited', 'unlimited')) DEFAULT 'unlimited',
  termination_reason VARCHAR(20) CHECK (termination_reason IN ('employer', 'resignation', 'expiry')),
  position VARCHAR(100), basic_salary NUMERIC(15,2) NOT NULL CHECK (basic_salary >= 0),
  allowances NUMERIC(15,2) DEFAULT 0, bank_iban VARCHAR(34),
  status VARCHAR(20) CHECK (status IN ('active', 'on_leave', 'terminated')) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE gratuity_accruals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  as_of_date DATE NOT NULL, years_of_service NUMERIC(5,2) NOT NULL,
  daily_basic_rate NUMERIC(15,2) NOT NULL, accrued_amount NUMERIC(15,2) NOT NULL,
  journal_entry_id UUID REFERENCES journal_entries(id), created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. FIXED ASSETS & DEPRECIATION
CREATE TABLE fixed_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_code VARCHAR(50), name VARCHAR(255) NOT NULL,
  asset_account_id UUID REFERENCES accounts(id), accum_dep_account_id UUID REFERENCES accounts(id),
  dep_expense_account_id UUID REFERENCES accounts(id),
  purchase_date DATE NOT NULL, purchase_cost NUMERIC(15,2) NOT NULL CHECK (purchase_cost > 0),
  salvage_value NUMERIC(15,2) DEFAULT 0, useful_life_years INT DEFAULT 5 CHECK (useful_life_years > 0),
  depreciation_method VARCHAR(30) DEFAULT 'straight_line', supplier VARCHAR(255),
  status VARCHAR(20) CHECK (status IN ('active', 'fully_depreciated', 'disposed')) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE depreciation_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
  period_date DATE NOT NULL, depreciation_amount NUMERIC(15,2) NOT NULL,
  accumulated_depreciation NUMERIC(15,2) NOT NULL, net_book_value NUMERIC(15,2) NOT NULL,
  is_posted BOOLEAN DEFAULT FALSE, journal_entry_id UUID REFERENCES journal_entries(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. RELATED PARTY TRANSACTIONS
CREATE TABLE related_party_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  related_party_name VARCHAR(255) NOT NULL, relationship_type VARCHAR(100) NOT NULL,
  transaction_type VARCHAR(50) NOT NULL, transaction_date DATE NOT NULL,
  amount NUMERIC(15,2) NOT NULL, currency VARCHAR(3) DEFAULT 'AED',
  is_arms_length BOOLEAN DEFAULT TRUE, transfer_pricing_doc_ref VARCHAR(255),
  notes TEXT, journal_entry_id UUID REFERENCES journal_entries(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. VAT RETURNS (FTA 201)
CREATE TABLE vat_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_key VARCHAR(20) NOT NULL, period_start DATE NOT NULL,
  period_end DATE NOT NULL, filing_deadline DATE NOT NULL,
  status vat_return_status DEFAULT 'draft',
  box_1_amount NUMERIC(15,2) DEFAULT 0, box_1_vat NUMERIC(15,2) DEFAULT 0,
  box_2_amount NUMERIC(15,2) DEFAULT 0, box_2_vat NUMERIC(15,2) DEFAULT 0,
  box_3_amount NUMERIC(15,2) DEFAULT 0, box_3_vat NUMERIC(15,2) DEFAULT 0,
  box_4_amount NUMERIC(15,2) DEFAULT 0, box_4_vat NUMERIC(15,2) DEFAULT 0,
  box_5_amount NUMERIC(15,2) DEFAULT 0, box_5_vat NUMERIC(15,2) DEFAULT 0,
  box_6_amount NUMERIC(15,2) DEFAULT 0, box_6_vat NUMERIC(15,2) DEFAULT 0,
  box_7_amount NUMERIC(15,2) DEFAULT 0, box_7_vat NUMERIC(15,2) DEFAULT 0,
  box_8_amount NUMERIC(15,2) DEFAULT 0, box_8_vat NUMERIC(15,2) DEFAULT 0,
  box_9_amount NUMERIC(15,2) DEFAULT 0, box_10_amount NUMERIC(15,2) DEFAULT 0,
  box_11_amount NUMERIC(15,2) DEFAULT 0, box_11_vat NUMERIC(15,2) DEFAULT 0,
  box_12_amount NUMERIC(15,2) DEFAULT 0, box_12_vat NUMERIC(15,2) DEFAULT 0,
  box_13_total_output_vat NUMERIC(15,2) DEFAULT 0,
  box_14_amount NUMERIC(15,2) DEFAULT 0, box_14_vat NUMERIC(15,2) DEFAULT 0,
  box_15_amount NUMERIC(15,2) DEFAULT 0, box_15_vat NUMERIC(15,2) DEFAULT 0,
  box_16_vat NUMERIC(15,2) DEFAULT 0, box_17_total_input_vat NUMERIC(15,2) DEFAULT 0,
  box_18_net_vat_payable NUMERIC(15,2) DEFAULT 0,
  filed_at TIMESTAMPTZ, filed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(org_id, period_key)
);

-- VAT PERIOD LOCKING
CREATE OR REPLACE FUNCTION enforce_vat_period_lock() RETURNS TRIGGER AS $$
DECLARE v_org UUID; v_dt DATE; v_locked BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN v_org := OLD.org_id; v_dt := OLD.date;
  ELSE v_org := NEW.org_id; v_dt := NEW.date; END IF;
  SELECT EXISTS (SELECT 1 FROM vat_returns WHERE org_id = v_org AND status IN ('filed','paid') AND v_dt BETWEEN period_start AND period_end) INTO v_locked;
  IF v_locked THEN RAISE EXCEPTION 'Blocked: date % is in a filed VAT period', v_dt; END IF;
  RETURN COALESCE(NEW, OLD);
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lock_vat_period BEFORE INSERT OR UPDATE OR DELETE ON journal_entries
FOR EACH ROW EXECUTE FUNCTION enforce_vat_period_lock();

-- 11. OPERATIONAL TABLES
CREATE TABLE bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bank_name VARCHAR(100) NOT NULL, account_name VARCHAR(100) NOT NULL,
  account_number VARCHAR(50), iban VARCHAR(34), swift_code VARCHAR(11),
  currency VARCHAR(3) DEFAULT 'AED', ledger_account_id UUID REFERENCES accounts(id),
  is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE bank_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bank_account_id UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  transaction_date DATE NOT NULL, description TEXT NOT NULL, amount NUMERIC(15,2) NOT NULL,
  reference_number VARCHAR(100),
  reconciliation_status VARCHAR(20) CHECK (reconciliation_status IN ('unmatched','matched','reconciled')) DEFAULT 'unmatched',
  matched_journal_entry_id UUID REFERENCES journal_entries(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE recurring_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  frequency VARCHAR(20) CHECK (frequency IN ('daily','weekly','monthly','quarterly','yearly')) NOT NULL,
  next_run_date DATE NOT NULL, end_date DATE,
  template_type VARCHAR(50) DEFAULT 'journal_entry', payload JSONB NOT NULL,
  is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  fiscal_year INT NOT NULL, name VARCHAR(255) NOT NULL,
  status VARCHAR(20) DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, fiscal_year)
);

CREATE TABLE budget_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  budget_id UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  period_month INT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  budgeted_amount NUMERIC(15,2) DEFAULT 0, UNIQUE(budget_id, account_id, period_month)
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id), action VARCHAR(50) NOT NULL,
  table_name VARCHAR(50) NOT NULL, record_id UUID NOT NULL,
  old_values JSONB, new_values JSONB, ip_address VARCHAR(45),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  record_type VARCHAR(50) NOT NULL, record_id UUID NOT NULL,
  file_name VARCHAR(255) NOT NULL, file_path TEXT NOT NULL,
  file_size_bytes INT NOT NULL, mime_type VARCHAR(100) NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES auth.users(id), created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  role VARCHAR(10) NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL, record_id UUID, metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. ROW LEVEL SECURITY (all tables)
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_sel ON organizations FOR SELECT USING (id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY org_ins ON organizations FOR INSERT WITH CHECK (true);
CREATE POLICY org_upd ON organizations FOR UPDATE USING (id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role IN ('owner','admin')));

ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY mem_all ON org_members FOR ALL USING (public.user_has_org_access(org_id)) WITH CHECK (true);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_accounts ON accounts FOR ALL USING (public.user_has_org_access(org_id)) WITH CHECK (public.user_has_org_access(org_id));
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_contacts ON contacts FOR ALL USING (public.user_has_org_access(org_id)) WITH CHECK (public.user_has_org_access(org_id));
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_je ON journal_entries FOR ALL USING (public.user_has_org_access(org_id)) WITH CHECK (public.user_has_org_access(org_id));
ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_jl ON journal_lines FOR ALL USING (public.user_has_org_access(org_id)) WITH CHECK (public.user_has_org_access(org_id));
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_inv ON invoices FOR ALL USING (public.user_has_org_access(org_id)) WITH CHECK (public.user_has_org_access(org_id));
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_inv_items ON invoice_items FOR ALL USING (public.user_has_org_access(org_id)) WITH CHECK (public.user_has_org_access(org_id));
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_pay ON payments FOR ALL USING (public.user_has_org_access(org_id)) WITH CHECK (public.user_has_org_access(org_id));
ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_pa ON payment_allocations FOR ALL USING (public.user_has_org_access(org_id)) WITH CHECK (public.user_has_org_access(org_id));
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_emp ON employees FOR ALL USING (public.user_has_org_access(org_id)) WITH CHECK (public.user_has_org_access(org_id));
ALTER TABLE gratuity_accruals ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_grat ON gratuity_accruals FOR ALL USING (public.user_has_org_access(org_id)) WITH CHECK (public.user_has_org_access(org_id));
ALTER TABLE fixed_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_fa ON fixed_assets FOR ALL USING (public.user_has_org_access(org_id)) WITH CHECK (public.user_has_org_access(org_id));
ALTER TABLE depreciation_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_dep ON depreciation_schedules FOR ALL USING (public.user_has_org_access(org_id)) WITH CHECK (public.user_has_org_access(org_id));
ALTER TABLE related_party_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_rpt ON related_party_transactions FOR ALL USING (public.user_has_org_access(org_id)) WITH CHECK (public.user_has_org_access(org_id));
ALTER TABLE vat_returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_vat ON vat_returns FOR ALL USING (public.user_has_org_access(org_id)) WITH CHECK (public.user_has_org_access(org_id));
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_ba ON bank_accounts FOR ALL USING (public.user_has_org_access(org_id)) WITH CHECK (public.user_has_org_access(org_id));
ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_bt ON bank_transactions FOR ALL USING (public.user_has_org_access(org_id)) WITH CHECK (public.user_has_org_access(org_id));
ALTER TABLE recurring_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_rec ON recurring_templates FOR ALL USING (public.user_has_org_access(org_id)) WITH CHECK (public.user_has_org_access(org_id));
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_bud ON budgets FOR ALL USING (public.user_has_org_access(org_id)) WITH CHECK (public.user_has_org_access(org_id));
ALTER TABLE budget_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_bl ON budget_lines FOR ALL USING (public.user_has_org_access(org_id)) WITH CHECK (public.user_has_org_access(org_id));
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY aud_ins ON audit_logs FOR INSERT WITH CHECK (public.user_has_org_access(org_id));
CREATE POLICY aud_sel ON audit_logs FOR SELECT USING (public.user_has_org_access(org_id));
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_att ON attachments FOR ALL USING (public.user_has_org_access(org_id)) WITH CHECK (public.user_has_org_access(org_id));
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_ai ON ai_conversations FOR ALL USING (public.user_has_org_access(org_id)) WITH CHECK (public.user_has_org_access(org_id));

-- 13. INDEXES
CREATE INDEX idx_je_org_date ON journal_entries(org_id, date);
CREATE INDEX idx_je_org_status ON journal_entries(org_id, status);
CREATE INDEX idx_jl_org_account ON journal_lines(org_id, account_id);
CREATE INDEX idx_jl_entry ON journal_lines(journal_entry_id);
CREATE INDEX idx_inv_org_date ON invoices(org_id, issue_date);
CREATE INDEX idx_inv_org_contact ON invoices(org_id, contact_id);
CREATE INDEX idx_inv_status ON invoices(org_id, status);
CREATE INDEX idx_pay_org_date ON payments(org_id, payment_date);
CREATE INDEX idx_con_org_name ON contacts(org_id, name);
CREATE INDEX idx_emp_org ON employees(org_id);
CREATE INDEX idx_fa_org ON fixed_assets(org_id);
CREATE INDEX idx_aud_org_ts ON audit_logs(org_id, created_at DESC);
CREATE INDEX idx_ai_org ON ai_conversations(org_id, created_at);
CREATE INDEX idx_bt_org ON bank_transactions(org_id, transaction_date);

-- 14. CHART OF ACCOUNTS SEED
CREATE OR REPLACE FUNCTION seed_default_chart_of_accounts(p_org_id UUID) RETURNS VOID AS $$
BEGIN
  INSERT INTO accounts (org_id, code, name, name_ar, type, category, is_system) VALUES
  (p_org_id,'1010','Petty Cash','الصندوق','asset','current_asset',TRUE),
  (p_org_id,'1020','Operating Bank Account','الحساب البنكي التشغيلي','asset','current_asset',TRUE),
  (p_org_id,'1100','Accounts Receivable','الذمم المدينة','asset','current_asset',TRUE),
  (p_org_id,'1200','Inventory','المخزون','asset','current_asset',FALSE),
  (p_org_id,'1400','Recoverable Input VAT','ضريبة القيمة المضافة المستردة','asset','current_asset',TRUE),
  (p_org_id,'1500','Property Plant & Equipment','الممتلكات والمعدات','asset','fixed_asset',FALSE),
  (p_org_id,'1510','Accumulated Depreciation','الاستهلاك المتراكم','asset','fixed_asset',TRUE),
  (p_org_id,'2010','Accounts Payable','الذمم الدائنة','liability','current_liability',TRUE),
  (p_org_id,'2100','Output VAT Payable','ضريبة القيمة المضافة المستحقة','liability','current_liability',TRUE),
  (p_org_id,'2150','Net VAT Clearing','تسوية ضريبة القيمة المضافة','liability','current_liability',TRUE),
  (p_org_id,'2200','Accrued Expenses','المصاريف المستحقة','liability','current_liability',FALSE),
  (p_org_id,'2300','End of Service Gratuity','مكافأة نهاية الخدمة','liability','non_current_liability',TRUE),
  (p_org_id,'2400','Corporate Tax Payable','ضريبة الشركات المستحقة','liability','current_liability',TRUE),
  (p_org_id,'3000','Share Capital','رأس المال','equity','equity',TRUE),
  (p_org_id,'3100','Retained Earnings','الأرباح المحتجزة','equity','equity',TRUE),
  (p_org_id,'4000','Sales Revenue - Standard Rated','إيرادات المبيعات - الفئة القياسية','revenue','operating_revenue',TRUE),
  (p_org_id,'4100','Sales Revenue - Zero Rated','إيرادات المبيعات - الفئة الصفرية','revenue','operating_revenue',TRUE),
  (p_org_id,'4200','Sales Revenue - Exempt','إيرادات المبيعات - المعفاة','revenue','operating_revenue',TRUE),
  (p_org_id,'5000','Cost of Goods Sold','تكلفة البضاعة المباعة','expense','cost_of_goods_sold',TRUE),
  (p_org_id,'6000','Salaries & Wages','الرواتب والأجور','expense','operating_expense',TRUE),
  (p_org_id,'6100','Gratuity Expense','مصروف مكافأة نهاية الخدمة','expense','operating_expense',TRUE),
  (p_org_id,'6200','Rent Expense','مصروف الإيجار','expense','operating_expense',FALSE),
  (p_org_id,'6300','Utilities Expense','مصروف المرافق','expense','operating_expense',FALSE),
  (p_org_id,'6400','Depreciation Expense','مصروف الاستهلاك','expense','operating_expense',TRUE),
  (p_org_id,'6500','General & Administrative','المصاريف العمومية والإدارية','expense','operating_expense',FALSE),
  (p_org_id,'7000','Corporate Tax Expense','مصروف ضريبة الشركات','expense','tax_expense',TRUE);
END; $$ LANGUAGE plpgsql;

-- 15. REPORT FUNCTIONS

CREATE OR REPLACE FUNCTION fn_trial_balance(p_org_id UUID, p_as_of_date DATE)
RETURNS TABLE (account_id UUID, account_code VARCHAR, account_name VARCHAR, account_name_ar VARCHAR, account_type account_type, total_debit NUMERIC(15,2), total_credit NUMERIC(15,2), net_balance NUMERIC(15,2))
AS $$ BEGIN RETURN QUERY
  SELECT a.id, a.code, a.name, a.name_ar, a.type,
    COALESCE(SUM(jl.debit),0)::NUMERIC(15,2), COALESCE(SUM(jl.credit),0)::NUMERIC(15,2),
    (CASE WHEN a.type IN ('asset','expense') THEN COALESCE(SUM(jl.debit-jl.credit),0) ELSE COALESCE(SUM(jl.credit-jl.debit),0) END)::NUMERIC(15,2)
  FROM accounts a LEFT JOIN journal_lines jl ON jl.account_id = a.id
  LEFT JOIN journal_entries je ON jl.journal_entry_id = je.id AND je.status = 'posted' AND je.date <= p_as_of_date
  WHERE a.org_id = p_org_id AND a.is_active = TRUE
  GROUP BY a.id, a.code, a.name, a.name_ar, a.type
  HAVING COALESCE(SUM(jl.debit),0) != 0 OR COALESCE(SUM(jl.credit),0) != 0
  ORDER BY a.code;
END; $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION fn_profit_and_loss(p_org_id UUID, p_start DATE, p_end DATE)
RETURNS TABLE (category account_category, account_code VARCHAR, account_name VARCHAR, amount NUMERIC(15,2))
AS $$ BEGIN RETURN QUERY
  SELECT a.category, a.code, a.name,
    (CASE WHEN a.type='revenue' THEN COALESCE(SUM(jl.credit-jl.debit),0) ELSE COALESCE(SUM(jl.debit-jl.credit),0) END)::NUMERIC(15,2)
  FROM accounts a JOIN journal_lines jl ON jl.account_id=a.id JOIN journal_entries je ON jl.journal_entry_id=je.id
  WHERE a.org_id=p_org_id AND a.type IN ('revenue','expense') AND je.status='posted' AND je.date BETWEEN p_start AND p_end
  GROUP BY a.id, a.category, a.code, a.name, a.type ORDER BY a.category, a.code;
END; $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION fn_balance_sheet(p_org_id UUID, p_as_of DATE)
RETURNS TABLE (bs_type account_type, category account_category, account_code VARCHAR, account_name VARCHAR, balance NUMERIC(15,2))
AS $$ BEGIN RETURN QUERY
  SELECT a.type, a.category, a.code, a.name,
    (CASE WHEN a.type='asset' THEN COALESCE(SUM(jl.debit-jl.credit),0) ELSE COALESCE(SUM(jl.credit-jl.debit),0) END)::NUMERIC(15,2)
  FROM accounts a LEFT JOIN journal_lines jl ON jl.account_id=a.id
  LEFT JOIN journal_entries je ON jl.journal_entry_id=je.id AND je.status='posted' AND je.date<=p_as_of
  WHERE a.org_id=p_org_id AND a.type IN ('asset','liability','equity')
  GROUP BY a.id, a.type, a.category, a.code, a.name
  HAVING COALESCE(SUM(jl.debit),0)!=0 OR COALESCE(SUM(jl.credit),0)!=0
  ORDER BY a.type, a.code;
END; $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION fn_aged_report(p_org_id UUID, p_type VARCHAR, p_as_of DATE)
RETURNS TABLE (contact_id UUID, contact_name VARCHAR, current_0_30 NUMERIC(15,2), days_31_60 NUMERIC(15,2), days_61_90 NUMERIC(15,2), days_90_plus NUMERIC(15,2), total_due NUMERIC(15,2))
AS $$ DECLARE v_t invoice_type;
BEGIN
  IF p_type='receivable' THEN v_t:='sales_invoice'; ELSE v_t:='purchase_invoice'; END IF;
  RETURN QUERY
  SELECT c.id, c.name,
    COALESCE(SUM(CASE WHEN (p_as_of-i.due_date)<=30 THEN i.total_amount-i.amount_paid ELSE 0 END),0)::NUMERIC(15,2),
    COALESCE(SUM(CASE WHEN (p_as_of-i.due_date) BETWEEN 31 AND 60 THEN i.total_amount-i.amount_paid ELSE 0 END),0)::NUMERIC(15,2),
    COALESCE(SUM(CASE WHEN (p_as_of-i.due_date) BETWEEN 61 AND 90 THEN i.total_amount-i.amount_paid ELSE 0 END),0)::NUMERIC(15,2),
    COALESCE(SUM(CASE WHEN (p_as_of-i.due_date)>90 THEN i.total_amount-i.amount_paid ELSE 0 END),0)::NUMERIC(15,2),
    COALESCE(SUM(i.total_amount-i.amount_paid),0)::NUMERIC(15,2)
  FROM contacts c JOIN invoices i ON i.contact_id=c.id
  WHERE c.org_id=p_org_id AND i.invoice_type=v_t AND i.status IN ('approved','sent','partially_paid')
    AND i.issue_date<=p_as_of AND (i.total_amount-i.amount_paid)>0
  GROUP BY c.id, c.name;
END; $$ LANGUAGE plpgsql STABLE;

-- DONE. Run in Supabase SQL Editor.

-- 16. DAILY EXCHANGE RATE SNAPSHOTS
-- Used by the scheduled rate importer. Keep this table separate from invoices so
-- historical invoices retain their recorded rate and source.
CREATE TABLE IF NOT EXISTS exchange_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  currency_code VARCHAR(3) NOT NULL,
  rate_to_aed NUMERIC(18,8) NOT NULL CHECK (rate_to_aed > 0),
  rate_date DATE NOT NULL,
  source VARCHAR(30) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(currency_code, rate_date)
);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_currency_date ON exchange_rates(currency_code, rate_date DESC);
