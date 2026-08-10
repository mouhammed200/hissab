'use client'

import React, { useState, useCallback } from 'react'
import { useLocale } from '@/lib/i18n/locale'

interface ReportsTabProps {
  orgId: string
}

const fmt = (n: number) => new Intl.NumberFormat('en-AE', { minimumFractionDigits: 2 }).format(n ?? 0)

type ReportType = 'trial_balance' | 'profit_loss' | 'balance_sheet' | 'aged_receivable' | 'aged_payable' | 'vat_return'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Accordion({ title, onOpen, children, loading }: { title: string; onOpen: () => void; children: React.ReactNode; loading?: boolean }) {
  const [open, setOpen] = useState(false)

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next) onOpen()
  }

  return (
    <div className="glass rounded-xl overflow-hidden mb-3">
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition text-left"
      >
        <span className="font-medium text-[var(--text-primary)]">{title}</span>
        <svg className={`w-5 h-5 text-[var(--text-muted)] transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="p-4 border-t border-white/5 text-sm">
          {loading ? (
            <div className="flex items-center gap-2 text-[var(--text-muted)] py-4 justify-center">
              <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              Loading...
            </div>
          ) : children}
        </div>
      )}
    </div>
  )
}

export default function ReportsTab({ orgId }: ReportsTabProps) {
  const { t } = useLocale()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [reportData, setReportData] = useState<Record<ReportType, any[]>>({
    trial_balance: [],
    profit_loss: [],
    balance_sheet: [],
    aged_receivable: [],
    aged_payable: [],
    vat_return: [],
  })
  const [loadingMap, setLoadingMap] = useState<Record<ReportType, boolean>>({
    trial_balance: false, profit_loss: false, balance_sheet: false,
    aged_receivable: false, aged_payable: false, vat_return: false,
  })

  const fetchReport = useCallback(async (type: ReportType) => {
    if (reportData[type].length > 0) return // already loaded
    setLoadingMap(p => ({ ...p, [type]: true }))
    try {
      const today = new Date().toISOString().split('T')[0]
      const firstOfYear = `${new Date().getFullYear()}-01-01`
      const params = new URLSearchParams({
        orgId,
        report: type,
        startDate: firstOfYear,
        endDate: today,
        asOfDate: today,
      })
      const res = await fetch(`/api/reports?${params}`)
      const json = await res.json()
      if (res.ok) setReportData(p => ({ ...p, [type]: json.data || [] }))
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingMap(p => ({ ...p, [type]: false }))
    }
  }, [orgId, reportData])

  const handleBankUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const formData = new FormData()
    formData.append('file', file)
    formData.append('orgId', orgId)
    const res = await fetch('/api/bank/import', { method: 'POST', body: formData })
    if (res.ok) {
      const json = await res.json()
      alert(`Bank import complete: ${json.imported ?? 0} transactions imported.`)
    } else {
      alert('Bank import failed')
    }
  }

  const handleExcelExport = async () => {
    const url = `/api/export/excel?orgId=${orgId}`
    const res = await fetch(url)
    if (!res.ok) { alert('Export failed'); return }
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `hissab-export-${new Date().toISOString().slice(0, 10)}.xlsx`
    a.click()
  }

  // Helpers to render generic tables
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderTable = (rows: any[]) => {
    if (!rows.length) return <p className="text-[var(--text-muted)] italic text-center py-4">No data for this period.</p>
    const keys = Object.keys(rows[0])
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
              {keys.map(k => <th key={k} className="pb-2 pr-4 font-medium capitalize">{k.replace(/_/g, ' ')}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-white/5">
                {keys.map(k => (
                  <td key={k} className="py-2 pr-4 text-[var(--text-secondary)]">
                    {typeof row[k] === 'number' ? fmt(row[k]) : (row[k] ?? '-')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full space-y-2">
      {/* Export all button */}
      <button
        onClick={handleExcelExport}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        {t('reports.exportAll')}
      </button>

      <Accordion title={t('reports.trialBalance')} onOpen={() => fetchReport('trial_balance')} loading={loadingMap.trial_balance}>
        {renderTable(reportData.trial_balance)}
      </Accordion>

      <Accordion title={t('reports.profitLoss')} onOpen={() => fetchReport('profit_loss')} loading={loadingMap.profit_loss}>
        {renderTable(reportData.profit_loss)}
      </Accordion>

      <Accordion title={t('reports.balanceSheet')} onOpen={() => fetchReport('balance_sheet')} loading={loadingMap.balance_sheet}>
        {renderTable(reportData.balance_sheet)}
      </Accordion>

      <Accordion title={t('reports.vatReturn')} onOpen={() => fetchReport('vat_return')} loading={loadingMap.vat_return}>
        {renderTable(reportData.vat_return)}
      </Accordion>

      <Accordion title={t('reports.agedReceivables')} onOpen={() => fetchReport('aged_receivable')} loading={loadingMap.aged_receivable}>
        {renderTable(reportData.aged_receivable)}
      </Accordion>

      <Accordion title={t('reports.agedPayables')} onOpen={() => fetchReport('aged_payable')} loading={loadingMap.aged_payable}>
        {renderTable(reportData.aged_payable)}
      </Accordion>

      <Accordion title={t('reports.bankReconciliation')} onOpen={() => {}}>
        <div className="space-y-3">
          <p className="text-[var(--text-muted)] text-xs">{t('reports.uploadCsvHint')}</p>
          <label className="flex items-center gap-2 py-2.5 px-4 rounded-xl bg-white/5 hover:bg-white/10 text-sm text-[var(--text-secondary)] cursor-pointer transition-colors border border-white/10">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            {t('reports.uploadCsv')}
            <input type="file" accept=".csv" className="hidden" onChange={handleBankUpload} />
          </label>
        </div>
      </Accordion>
    </div>
  )
}

