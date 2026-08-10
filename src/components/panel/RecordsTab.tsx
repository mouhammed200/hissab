'use client'

import React, { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useLocale } from '@/lib/i18n/locale'

interface RecordsTabProps {
  orgId: string
  refreshTrigger?: number
}

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', minimumFractionDigits: 2 }).format(amount)
}

export default function RecordsTab({ orgId, refreshTrigger }: RecordsTabProps) {
  const { t, locale } = useLocale()
  const [records, setRecords] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filterType, setFilterType] = useState('All')
  const [filterPeriod, setFilterPeriod] = useState('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    async function fetchRecords() {
      setLoading(true)
      const supabase = createClient()
      
      try {
        const { data: invoices } = await supabase.from('invoices').select('*').eq('org_id', orgId)
        const { data: employees } = await supabase.from('employees').select('*').eq('org_id', orgId)
        
        const unified = []
        
        if (invoices) {
          for (const inv of invoices) {
            unified.push({
              id: inv.id,
              type: inv.type === 'SALE' ? 'Sale' : 'Purchase',
              icon: inv.type === 'SALE' ? '📈' : '🛒',
              title: inv.party_name || (locale === 'ar' ? 'طرف غير معروف' : 'Unknown Party'),
              subtitle: `${inv.status} • ${new Date(inv.date || inv.created_at).toLocaleDateString(locale === 'ar' ? 'ar-AE' : 'en-AE')}`,
              amount: Number(inv.total_amount) || 0,
              color: inv.type === 'SALE' ? 'text-emerald-400' : 'text-amber-400',
              rawDate: new Date(inv.date || inv.created_at)
            })
          }
        }
        
        if (employees) {
          for (const emp of employees) {
            unified.push({
              id: emp.id,
              type: 'Employee',
              icon: '👤',
              title: `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || (locale === 'ar' ? 'موظف' : 'Employee'),
              subtitle: `${emp.department || 'General'} • ${new Date(emp.join_date || emp.created_at).toLocaleDateString(locale === 'ar' ? 'ar-AE' : 'en-AE')}`,
              amount: Number(emp.base_salary) || 0,
              color: 'text-blue-400',
              rawDate: new Date(emp.created_at)
            })
          }
        }
        
        unified.sort((a, b) => b.rawDate.getTime() - a.rawDate.getTime())
        setRecords(unified)
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    
    fetchRecords()
  }, [orgId, refreshTrigger, locale])

  const now = new Date()
  const filteredRecords = records.filter(r => {
    if (filterType !== 'All' && r.type !== filterType) return false
    if (search && !r.title.toLowerCase().includes(search.toLowerCase())) return false
    if (filterPeriod === 'month') {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      if (r.rawDate < startOfMonth) return false
    } else if (filterPeriod === 'quarter') {
      const q = Math.floor(now.getMonth() / 3)
      const startOfQ = new Date(now.getFullYear(), q * 3, 1)
      if (r.rawDate < startOfQ) return false
    } else if (filterPeriod === 'year') {
      const startOfYear = new Date(now.getFullYear(), 0, 1)
      if (r.rawDate < startOfYear) return false
    }
    return true
  })

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Filter Bar */}
      <div className="flex flex-wrap sm:flex-nowrap gap-2 sm:gap-3">
        <select 
          className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-1.5 text-xs sm:text-sm text-[var(--text-primary)] outline-none focus:border-emerald-500 transition-colors"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
        >
          <option value="All">{t('records.allTypes')}</option>
          <option value="Sale">{t('records.sales')}</option>
          <option value="Purchase">{t('records.purchases')}</option>
          <option value="Employee">{t('records.employees')}</option>
        </select>
        
        <select
          className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-1.5 text-xs sm:text-sm text-[var(--text-primary)] outline-none focus:border-emerald-500 transition-colors"
          value={filterPeriod}
          onChange={(e) => setFilterPeriod(e.target.value)}
        >
          <option value="all">{t('records.allTime')}</option>
          <option value="month">{t('records.thisMonth')}</option>
          <option value="quarter">{t('records.thisQuarter')}</option>
          <option value="year">{t('records.thisYear')}</option>
        </select>

        <input 
          type="text" 
          placeholder={t('records.search')}
          className="flex-1 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg px-3 py-1.5 text-xs sm:text-sm text-[var(--text-primary)] outline-none focus:border-emerald-500 transition-colors min-w-[120px]"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Records List */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {loading ? (
          <div className="text-[var(--text-muted)] text-sm p-4 text-center">{t('records.loading')}</div>
        ) : filteredRecords.length > 0 ? (
          filteredRecords.map((record) => (
            <div key={record.id} className="glass-hover rounded-lg p-3 sm:p-4 flex items-center gap-3 sm:gap-4 cursor-pointer transition-all">
              <span className="text-lg sm:text-xl">{record.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs sm:text-sm font-medium text-[var(--text-primary)] truncate">{record.title}</p>
                <p className="text-[10px] sm:text-xs text-[var(--text-muted)] truncate">{record.subtitle}</p>
              </div>
              <p className={`text-xs sm:text-sm font-semibold shrink-0 ${record.color}`}>{formatCurrency(record.amount)}</p>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center h-48 text-[var(--text-muted)]">
            <span className="text-4xl mb-3">📭</span>
            <p className="text-sm">{t('records.noRecords')}</p>
          </div>
        )}
      </div>
    </div>
  )
}
