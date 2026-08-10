'use client'

import React, { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface RecordsTabProps {
  orgId: string
  refreshTrigger?: number
}

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', minimumFractionDigits: 2 }).format(amount)
}

export default function RecordsTab({ orgId, refreshTrigger }: RecordsTabProps) {
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
        
        // Transform data into a unified structure
        const unified = []
        
        if (invoices) {
          for (const inv of invoices) {
            unified.push({
              id: inv.id,
              type: inv.type === 'SALE' ? 'Sale' : 'Purchase',
              icon: inv.type === 'SALE' ? '📈' : '🛒',
              title: inv.party_name || 'Unknown Party',
              subtitle: `${inv.status} • ${new Date(inv.date || inv.created_at).toLocaleDateString()}`,
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
              title: `${emp.first_name} ${emp.last_name}`,
              subtitle: `${emp.department || 'N/A'} • Joined ${new Date(emp.join_date || emp.created_at).toLocaleDateString()}`,
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
  }, [orgId, refreshTrigger])

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
      <div className="flex gap-3">
        <select 
          className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-emerald-500 transition-colors"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
        >
          <option value="All">All Types</option>
          <option value="Sale">Sales</option>
          <option value="Purchase">Purchases</option>
          <option value="Employee">Employees</option>
        </select>
        
        <select
          className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-emerald-500 transition-colors"
          value={filterPeriod}
          onChange={(e) => setFilterPeriod(e.target.value)}
        >
          <option value="all">All Time</option>
          <option value="month">This Month</option>
          <option value="quarter">This Quarter</option>
          <option value="year">This Year</option>
        </select>

        <input 
          type="text" 
          placeholder="Search records..." 
          className="flex-1 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-emerald-500 transition-colors"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Records List */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-2">
        {loading ? (
          <div className="text-[var(--text-muted)] text-sm p-4">Loading records...</div>
        ) : filteredRecords.length > 0 ? (
          filteredRecords.map((record) => (
            <div key={record.id} className="glass-hover rounded-lg p-4 flex items-center gap-4 cursor-pointer transition-all">
              <span className="text-xl">{record.icon}</span>
              <div className="flex-1">
                <p className="text-sm font-medium text-[var(--text-primary)]">{record.title}</p>
                <p className="text-xs text-[var(--text-muted)]">{record.subtitle}</p>
              </div>
              <p className={`text-sm font-semibold ${record.color}`}>{formatCurrency(record.amount)}</p>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center h-48 text-[var(--text-muted)]">
            <span className="text-4xl mb-3">📭</span>
            <p>No records found.</p>
          </div>
        )}
      </div>
    </div>
  )
}
