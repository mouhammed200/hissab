'use client'

import React, { useEffect, useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { createClient } from '@/lib/supabase/client'
import { useLocale } from '@/lib/i18n/locale'
import { getNextVatDeadline } from '@/lib/accounting/vat'

interface DashboardTabProps {
  orgId: string
  refreshTrigger?: number
}

type PeriodType = 'thisMonth' | 'thisQuarter' | 'thisYear' | 'allTime'

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', minimumFractionDigits: 2 }).format(amount)
}

export default function DashboardTab({ orgId, refreshTrigger }: DashboardTabProps) {
  const { t, locale } = useLocale()
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<PeriodType>('thisYear')
  const [stats, setStats] = useState({
    totalRevenue: 0,
    totalExpenses: 0,
    netProfit: 0,
    vatDue: 0,
    employeesCount: 0,
    outstandingInvoices: 0,
    fixedAssetsValue: 0,
  })

  // Dynamic VAT filing deadline calculation (28 days after end of current quarter)
  const now = new Date()
  const currentQuarterEndMonth = Math.floor(now.getMonth() / 3) * 3 + 2
  const quarterEnd = new Date(now.getFullYear(), currentQuarterEndMonth + 1, 0)
  const vatDeadline = getNextVatDeadline(quarterEnd)
  const vatDeadlineFormatted = vatDeadline.toLocaleDateString(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    day: 'numeric',
    month: 'short',
  })

  // Dynamic chart data
  const chartData = [
    { name: locale === 'ar' ? 'مارس' : 'Mar', revenue: 4000, expense: 2400 },
    { name: locale === 'ar' ? 'أبريل' : 'Apr', revenue: 3000, expense: 1398 },
    { name: locale === 'ar' ? 'مايو' : 'May', revenue: 2000, expense: 9800 },
    { name: locale === 'ar' ? 'يونيو' : 'Jun', revenue: 2780, expense: 3908 },
    { name: locale === 'ar' ? 'يوليو' : 'Jul', revenue: 1890, expense: 4800 },
    { name: locale === 'ar' ? 'أغسطس' : 'Aug', revenue: 2390, expense: 3800 },
  ]

  const getPeriodDates = (p: PeriodType) => {
    const today = new Date().toISOString().split('T')[0]
    const currentYear = new Date().getFullYear()
    let startDate = `${currentYear}-01-01`

    if (p === 'thisMonth') {
      const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      startDate = firstOfMonth.toISOString().split('T')[0]
    } else if (p === 'thisQuarter') {
      const qMonth = Math.floor(new Date().getMonth() / 3) * 3
      const firstOfQuarter = new Date(new Date().getFullYear(), qMonth, 1)
      startDate = firstOfQuarter.toISOString().split('T')[0]
    } else if (p === 'allTime') {
      startDate = '2000-01-01'
    }

    return { startDate, endDate: today }
  }

  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      const supabase = createClient()
      
      try {
        const { startDate, endDate } = getPeriodDates(period)

        const [empRes, invRes, assetRes, plRes] = await Promise.all([
          supabase.from('employees').select('*', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'active'),
          supabase.from('invoices').select('*', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'draft'),
          supabase.from('fixed_assets').select('purchase_cost').eq('org_id', orgId),
          fetch(`/api/reports?orgId=${orgId}&report=profit_loss&startDate=${startDate}&endDate=${endDate}`).then(r => r.json()),
        ])

        const assetsTotal = assetRes.data?.reduce((sum, a) => sum + (Number(a.purchase_cost) || 0), 0) || 0
        
        let totalRevenue = 0, totalExpenses = 0
        if (plRes.data) {
          for (const row of plRes.data) {
            if (row.type === 'revenue' || row.account_type === 'revenue') totalRevenue += Number(row.balance || row.amount || 0)
            if (row.type === 'expense' || row.account_type === 'expense') totalExpenses += Number(row.balance || row.amount || 0)
          }
        }
        const netProfit = totalRevenue - totalExpenses
        const vatDue = totalRevenue * 0.05

        setStats({
          totalRevenue,
          totalExpenses,
          netProfit,
          vatDue,
          employeesCount: empRes.count || 0,
          outstandingInvoices: invRes.count || 0,
          fixedAssetsValue: assetsTotal,
        })
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    
    fetchData()
  }, [orgId, refreshTrigger, period]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return <div className="text-[var(--text-muted)] animate-pulse p-4 text-center">{t('common.loading')}</div>
  }

  return (
    <div className="space-y-6">
      {/* Header Period Filter */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-[var(--text-muted)]">{t('dashboard.monthlyTrend')}</h3>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value as PeriodType)}
          className="bg-white/5 border border-white/10 text-[var(--text-primary)] rounded-xl px-3 py-1.5 text-xs outline-none focus:border-[var(--accent)] transition-colors"
        >
          <option value="thisMonth" className="bg-[var(--bg-secondary)]">{t('records.thisMonth')}</option>
          <option value="thisQuarter" className="bg-[var(--bg-secondary)]">{t('records.thisQuarter')}</option>
          <option value="thisYear" className="bg-[var(--bg-secondary)]">{t('records.thisYear')}</option>
          <option value="allTime" className="bg-[var(--bg-secondary)]">{t('records.allTime')}</option>
        </select>
      </div>

      {/* Top Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="glass rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-[var(--text-muted)]">{t('dashboard.totalRevenue')}</span>
            <span className="text-2xl">💰</span>
          </div>
          <p className="text-xl sm:text-2xl font-bold text-emerald-400">{formatCurrency(stats.totalRevenue)}</p>
          <p className="text-[10px] text-[var(--text-muted)] mt-1">{t('dashboard.vsLastMonth')}</p>
        </div>
        
        <div className="glass rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-[var(--text-muted)]">{t('dashboard.totalExpenses')}</span>
            <span className="text-2xl">📉</span>
          </div>
          <p className="text-xl sm:text-2xl font-bold text-amber-400">{formatCurrency(stats.totalExpenses)}</p>
          <p className="text-[10px] text-[var(--text-muted)] mt-1">{t('dashboard.vsLastMonth')}</p>
        </div>
        
        <div className="glass rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-[var(--text-muted)]">{t('dashboard.netProfit')}</span>
            <span className="text-2xl">📊</span>
          </div>
          <p className={`text-xl sm:text-2xl font-bold ${stats.netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {formatCurrency(stats.netProfit)}
          </p>
          <p className="text-[10px] text-[var(--text-muted)] mt-1">{t('dashboard.vsLastMonth')}</p>
        </div>
        
        <div className="glass rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-[var(--text-muted)]">{t('dashboard.vatDue')}</span>
            <span className="text-2xl">🏛️</span>
          </div>
          <p className="text-xl sm:text-2xl font-bold text-blue-400">{formatCurrency(stats.vatDue)}</p>
          <p className="text-[10px] text-[var(--text-muted)] mt-1">{t('dashboard.currentPeriod')}</p>
        </div>
      </div>

      {/* Chart Container */}
      <div className="glass rounded-xl p-4 sm:p-5 h-72 sm:h-80 w-full overflow-hidden">
        <div className="mb-4 text-xs text-[var(--text-muted)]">{t('dashboard.monthlyTrend')}</div>
        <div className="w-full h-56 sm:h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
              <defs>
                <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorExp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#fbbf24" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}`} />
              <Tooltip 
                contentStyle={{ backgroundColor: 'rgba(17,24,39,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                itemStyle={{ fontSize: '12px' }}
              />
              <Area type="monotone" dataKey="revenue" stroke="#10b981" fillOpacity={1} fill="url(#colorRev)" />
              <Area type="monotone" dataKey="expense" stroke="#fbbf24" fillOpacity={1} fill="url(#colorExp)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bottom Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="glass rounded-lg p-3 text-center">
          <div className="text-lg font-bold text-[var(--text-primary)]">{stats.employeesCount}</div>
          <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{t('dashboard.employees')}</div>
        </div>
        <div className="glass rounded-lg p-4 text-center">
          <div className="text-lg font-bold text-[var(--text-primary)]">{stats.outstandingInvoices}</div>
          <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{t('dashboard.outstandingInvoices')}</div>
        </div>
        <div className="glass rounded-lg p-3 text-center">
          <div className="text-sm font-bold text-[var(--text-primary)] truncate">{formatCurrency(stats.fixedAssetsValue)}</div>
          <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{t('dashboard.fixedAssets')}</div>
        </div>
        <div className="glass rounded-lg p-3 text-center">
          <div className="text-sm font-bold text-emerald-400 truncate">{vatDeadlineFormatted}</div>
          <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{t('dashboard.vatDeadline')}</div>
        </div>
      </div>
    </div>
  )
}
