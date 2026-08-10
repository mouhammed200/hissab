// Types matching the Supabase PostgreSQL schema

export type MemberRole = 'owner' | 'admin' | 'accountant' | 'viewer'
export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
export type AccountCategory = 
  | 'current_asset' | 'fixed_asset' | 'non_current_asset'
  | 'current_liability' | 'non_current_liability' | 'equity'
  | 'operating_revenue' | 'non_operating_revenue'
  | 'cost_of_goods_sold' | 'operating_expense' | 'tax_expense' | 'other_expense'
export type JournalStatus = 'draft' | 'posted' | 'void'
export type InvoiceType = 'sales_invoice' | 'purchase_invoice' | 'credit_note' | 'debit_note'
export type InvoiceStatus = 'draft' | 'approved' | 'sent' | 'paid' | 'partially_paid' | 'void'
export type VatCategory = 'standard' | 'zero' | 'exempt' | 'out_of_scope'
export type VatReturnStatus = 'draft' | 'filed' | 'paid'
export type PaymentMethod = 'bank_transfer' | 'cheque' | 'cash' | 'card'
export type Emirate = 'Abu Dhabi' | 'Dubai' | 'Sharjah' | 'Ajman' | 'Umm Al Quwain' | 'Ras Al Khaimah' | 'Fujairah'
export type ContactType = 'customer' | 'vendor' | 'both'
export type ContractType = 'limited' | 'unlimited'
export type TerminationReason = 'employer' | 'resignation' | 'expiry'
export type EmployeeStatus = 'active' | 'on_leave' | 'terminated'
export type AssetStatus = 'active' | 'fully_depreciated' | 'disposed'
export type ReconciliationStatus = 'unmatched' | 'matched' | 'reconciled'
export type RecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'

export interface Organization {
  id: string
  name: string
  legal_name: string | null
  trn: string | null
  license_number: string | null
  licensing_authority: string | null
  is_free_zone: boolean
  is_qualifying_free_zone_person: boolean
  corporate_tax_trn: string | null
  base_currency: string
  default_emirate: Emirate
  fiscal_year_end_month: number
  settings: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface OrgMember {
  id: string
  org_id: string
  user_id: string
  role: MemberRole
  created_at: string
}

export interface Account {
  id: string
  org_id: string
  code: string
  name: string
  name_ar: string | null
  type: AccountType
  category: AccountCategory
  parent_id: string | null
  is_system: boolean
  is_active: boolean
  created_at: string
}

export interface Contact {
  id: string
  org_id: string
  name: string
  name_ar: string | null
  contact_type: ContactType
  trn: string | null
  email: string | null
  phone: string | null
  address: string | null
  emirate: Emirate
  payment_terms_days: number
  is_active: boolean
  created_at: string
}

export interface JournalEntry {
  id: string
  org_id: string
  entry_number: number
  date: string
  reference: string | null
  description: string | null
  source_type: string
  source_id: string | null
  status: JournalStatus
  created_by: string
  posted_at: string | null
  posted_by: string | null
  created_at: string
  updated_at: string
}

export interface JournalLine {
  id: string
  org_id: string
  journal_entry_id: string
  account_id: string
  debit: number
  credit: number
  description: string | null
  vat_category: VatCategory
  vat_rate: number
  vat_amount: number
  contact_id: string | null
}

export interface Invoice {
  id: string
  org_id: string
  contact_id: string | null
  invoice_type: InvoiceType
  invoice_number: string
  issue_date: string
  due_date: string
  currency: string
  exchange_rate: number
  subtotal_amount: number
  vat_amount: number
  discount_amount: number
  total_amount: number
  amount_paid: number
  is_reverse_charge: boolean
  emirate: Emirate
  status: InvoiceStatus
  journal_entry_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface InvoiceItem {
  id: string
  org_id: string
  invoice_id: string
  account_id: string | null
  description: string
  quantity: number
  unit_price: number
  discount: number
  subtotal: number
  vat_category: VatCategory
  vat_rate: number
  vat_amount: number
  total: number
  excise_category: string
}

export interface Payment {
  id: string
  org_id: string
  payment_number: string
  contact_id: string
  payment_type: 'received' | 'made'
  payment_date: string
  bank_account_id: string | null
  amount: number
  currency: string
  exchange_rate: number
  payment_method: PaymentMethod
  reference_number: string | null
  journal_entry_id: string | null
  notes: string | null
  created_at: string
}

export interface Employee {
  id: string
  org_id: string
  employee_code: string | null
  full_name: string
  full_name_ar: string | null
  emirates_id: string | null
  hire_date: string
  termination_date: string | null
  contract_type: ContractType
  termination_reason: TerminationReason | null
  position: string | null
  basic_salary: number
  allowances: number
  bank_iban: string | null
  status: EmployeeStatus
  created_at: string
}

export interface FixedAsset {
  id: string
  org_id: string
  asset_code: string | null
  name: string
  asset_account_id: string | null
  accum_dep_account_id: string | null
  dep_expense_account_id: string | null
  purchase_date: string
  purchase_cost: number
  salvage_value: number
  useful_life_years: number
  depreciation_method: string
  supplier: string | null
  status: AssetStatus
  created_at: string
}

export interface AuditLog {
  id: string
  org_id: string
  user_id: string | null
  action: string
  table_name: string
  record_id: string
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  ip_address: string | null
  created_at: string
}

export interface AIConversation {
  id: string
  org_id: string
  user_id: string
  role: 'user' | 'assistant'
  content: string
  record_id: string | null
  metadata: Record<string, unknown>
  created_at: string
}
