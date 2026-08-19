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
    <div className="glass rounded-xl overflow-hidden mb-3 min-w-0 w-full">
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
        <div className="p-4 border-t border-white/5 text-sm min-w-0">
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

  // Payment history has its own read path (/api/payments) rather than
  // /api/reports, so it's tracked separately from reportData/loadingMap.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [payments, setPayments] = useState<any[]>([])
  const [paymentsLoaded, setPaymentsLoaded] = useState(false)
  const [paymentsLoading, setPaymentsLoading] = useState(false)

  const fetchPayments = useCallback(async () => {
    if (paymentsLoaded) return
    setPaymentsLoading(true)
    try {
      const res = await fetch(`/api/payments?orgId=${encodeURIComponent(orgId)}`)
      const json = await res.json()
      if (res.ok) {
        setPayments(json.payments ?? [])
        setPaymentsLoaded(true)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setPaymentsLoading(false)
    }
  }, [orgId, paymentsLoaded])

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
      if (res.ok) {
        // VAT Return, Balance Sheet and P&L can come back as a single object.
        // Storing it raw made `.length` undefined, so every table said "No data".
        const raw = json.data
        const rows = Array.isArray(raw) ? raw : raw ? [raw] : []
        setReportData(p => ({ ...p, [type]: rows }))
      }
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
    const safeRows = Array.isArray(rows) ? rows : rows ? [rows] : []
    if (!safeRows.length) return <p className="text-[var(--text-muted)] italic text-center py-4">No data for this period.</p>
    const keys = Object.keys(safeRows[0] ?? {})
    if (!keys.length) return <p className="text-[var(--text-muted)] italic text-center py-4">No data for this period.</p>

    // Single-record reports (VAT 201, summaries) read far better vertically
    // than as one very wide row.
    if (safeRows.length === 1 && keys.length > 6) {
      const row = safeRows[0]
      return (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
          {keys.map(k => (
            <div key={k} className="flex items-baseline justify-between gap-3 border-b border-[var(--border-subtle)] py-1.5 last:border-0">
              <dt className="text-[var(--text-muted)] capitalize">{k.replace(/_/g, ' ')}</dt>
              <dd className="text-[var(--text-secondary)] font-medium tabular-nums">
                {typeof row[k] === 'number' ? fmt(row[k]) : (row[k] ?? '-')}
              </dd>
            </div>
          ))}
        </dl>
      )
    }

    const rowsToRender = safeRows
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
              {keys.map(k => <th key={k} className="pb-2 pr-4 font-medium capitalize">{k.replace(/_/g, ' ')}</th>)}
            </tr>
          </thead>
          <tbody>
            {rowsToRender.map((row, i) => (
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
    <div className="flex flex-col space-y-2 min-w-0">
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

      <Accordion title={t('reports.paymentHistory')} onOpen={fetchPayments} loading={paymentsLoading}>
        {payments.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
                  <th className="pb-2 pr-4 font-medium">{t('reports.paymentDate')}</th>
                  <th className="pb-2 pr-4 font-medium">{t('reports.paymentParty')}</th>
                  <th className="pb-2 pr-4 font-medium">{t('reports.paymentDirection')}</th>
                  <th className="pb-2 pr-4 font-medium">{t('reports.paymentMethodCol')}</th>
                  <th className="pb-2 pr-4 font-medium text-right">{t('reports.paymentAmount')}</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr
                    key={p.id}
                    className={`border-b border-[var(--border-subtle)] last:border-0 hover:bg-white/5 ${p.voided ? 'opacity-50 grayscale' : ''}`}
                  >
                    <td className="py-2 pr-4 text-[var(--text-secondary)]">{p.payment_date ? String(p.payment_date).slice(0, 10) : '-'}</td>
                    <td className="py-2 pr-4 text-[var(--text-secondary)]">
                      {p.contact?.name || p.payment_number || '-'}
                      {p.voided && (
                        <span className="ml-2 text-[10px] font-normal text-red-400 align-middle">
                          {t('record.voided')}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-[var(--text-secondary)]">
                      {p.payment_type === 'received' ? t('record.received') : t('record.sent')}
                    </td>
                    <td className="py-2 pr-4 text-[var(--text-secondary)]">{p.payment_method || '-'}</td>
                    <td className="py-2 pr-4 text-[var(--text-secondary)] text-right tabular-nums">
                      {fmt(Number(p.amount) || 0)} {p.currency || 'AED'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[var(--text-muted)] italic text-center py-4">{t('reports.noData')}</p>
        )}
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


          
