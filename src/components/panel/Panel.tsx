'use client'

import React, { useState, useEffect } from 'react'
import DashboardTab from './DashboardTab'
import RecordsTab from './RecordsTab'
import ReportsTab from './ReportsTab'
import AuditTab from './AuditTab'
import SettingsModal from '@/components/shared/SettingsModal'
import LocaleSwitcher from '@/components/shared/LocaleSwitcher'
import { createClient } from '@/lib/supabase/client'
import { useLocale } from '@/lib/i18n/locale'

interface PanelProps {
  orgId: string
  refreshTrigger?: number
  onRealtimeRefresh?: () => void
  onClosePanel?: () => void
  onToggleFullScreenPanel?: () => void
  isFullScreenPanel?: boolean
}

type TabType = 'dashboard' | 'records' | 'reports' | 'audit'

export default function Panel({ 
  orgId, 
  refreshTrigger, 
  onRealtimeRefresh, 
  onClosePanel,
  onToggleFullScreenPanel,
  isFullScreenPanel = false
}: PanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>('dashboard')
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Supabase Realtime: refresh panel whenever invoices or journal_entries change
  useEffect(() => {
    if (!orgId || !onRealtimeRefresh) return
    const supabase = createClient()
    const channel = supabase
      .channel(`panel-refresh-${orgId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'invoices', filter: `org_id=eq.${orgId}` },
        () => onRealtimeRefresh()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'journal_entries', filter: `org_id=eq.${orgId}` },
        () => onRealtimeRefresh()
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [orgId, onRealtimeRefresh])

  const { t, locale } = useLocale()

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)] border-s border-[var(--border-subtle)] overflow-hidden">
      {/* Sub-Bar 1: Workspace Actions & Controls */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]">
        <div className="font-bold text-lg text-[var(--accent)] gradient-text">
          {locale === 'ar' ? 'حساب' : 'Hissab'}
        </div>

        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          
          <button
            id="settings-btn"
            onClick={() => setSettingsOpen(true)}
            title={t('settings.title')}
            className="p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors rounded-lg hover:bg-white/5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          </button>

          {onToggleFullScreenPanel && (
            <button
              onClick={onToggleFullScreenPanel}
              title={isFullScreenPanel ? t('panel.splitScreen') : t('panel.fullScreenPanel')}
              className="p-1.5 text-[var(--text-secondary)] hover:text-emerald-400 transition-colors rounded-lg hover:bg-white/5 hidden sm:block"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {isFullScreenPanel ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                )}
              </svg>
            </button>
          )}

          {onClosePanel && (
            <button
              onClick={onClosePanel}
              title={t('panel.hidePanel')}
              className="p-1.5 text-[var(--text-secondary)] hover:text-red-400 transition-colors rounded-lg hover:bg-white/5"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          )}
        </div>
      </div>

      {/* Sub-Bar 2: Dedicated Scrollable Clean Text Tabs */}
      <div className="flex items-center gap-4 sm:gap-6 px-4 sm:px-6 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] overflow-x-auto whitespace-nowrap scrollbar-none">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`pb-1 transition-colors relative text-xs sm:text-sm font-semibold shrink-0 ${
            activeTab === 'dashboard' ? 'text-emerald-400' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          {t('panel.dashboard')}
          {activeTab === 'dashboard' && <div className="absolute -bottom-[9px] left-0 right-0 h-0.5 bg-emerald-500 rounded-t-full" />}
        </button>
        
        <button
          onClick={() => setActiveTab('records')}
          className={`pb-1 transition-colors relative text-xs sm:text-sm font-semibold shrink-0 ${
            activeTab === 'records' ? 'text-emerald-400' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          {t('panel.records')}
          {activeTab === 'records' && <div className="absolute -bottom-[9px] left-0 right-0 h-0.5 bg-emerald-500 rounded-t-full" />}
        </button>
        
        <button
          onClick={() => setActiveTab('reports')}
          className={`pb-1 transition-colors relative text-xs sm:text-sm font-semibold shrink-0 ${
            activeTab === 'reports' ? 'text-emerald-400' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          {t('panel.reports')}
          {activeTab === 'reports' && <div className="absolute -bottom-[9px] left-0 right-0 h-0.5 bg-emerald-500 rounded-t-full" />}
        </button>
        
        <button
          onClick={() => setActiveTab('audit')}
          className={`pb-1 transition-colors relative text-xs sm:text-sm font-semibold shrink-0 ${
            activeTab === 'audit' ? 'text-emerald-400' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          {t('panel.audit')}
          {activeTab === 'audit' && <div className="absolute -bottom-[9px] left-0 right-0 h-0.5 bg-emerald-500 rounded-t-full" />}
        </button>
      </div>
      
      {/* Active Tab View */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {activeTab === 'dashboard' && <DashboardTab orgId={orgId} refreshTrigger={refreshTrigger} />}
        {activeTab === 'records' && <RecordsTab orgId={orgId} refreshTrigger={refreshTrigger} />}
        {activeTab === 'reports' && <ReportsTab orgId={orgId} />}
        {activeTab === 'audit' && <AuditTab orgId={orgId} refreshTrigger={refreshTrigger} />}
      </div>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
