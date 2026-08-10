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
}

type TabType = 'dashboard' | 'records' | 'reports' | 'audit'

export default function Panel({ orgId, refreshTrigger, onRealtimeRefresh }: PanelProps) {
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

  const { t } = useLocale()

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)] border-l border-[var(--border-subtle)]">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
        <div className="flex gap-6">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`flex items-center gap-2 pb-1 transition-colors relative ${activeTab === 'dashboard' ? 'text-emerald-400' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            <span className="font-medium text-sm">{t('panel.dashboard')}</span>
            {activeTab === 'dashboard' && <div className="absolute -bottom-[17px] left-0 right-0 h-0.5 bg-emerald-500 rounded-t-full" />}
          </button>
          
          <button
            onClick={() => setActiveTab('records')}
            className={`flex items-center gap-2 pb-1 transition-colors relative ${activeTab === 'records' ? 'text-emerald-400' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
            <span className="font-medium text-sm">{t('panel.records')}</span>
            {activeTab === 'records' && <div className="absolute -bottom-[17px] left-0 right-0 h-0.5 bg-emerald-500 rounded-t-full" />}
          </button>
          
          <button
            onClick={() => setActiveTab('reports')}
            className={`flex items-center gap-2 pb-1 transition-colors relative ${activeTab === 'reports' ? 'text-emerald-400' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            <span className="font-medium text-sm">{t('panel.reports')}</span>
            {activeTab === 'reports' && <div className="absolute -bottom-[17px] left-0 right-0 h-0.5 bg-emerald-500 rounded-t-full" />}
          </button>
          
          <button
            onClick={() => setActiveTab('audit')}
            className={`flex items-center gap-2 pb-1 transition-colors relative ${activeTab === 'audit' ? 'text-emerald-400' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
            <span className="font-medium text-sm">{t('panel.audit')}</span>
            {activeTab === 'audit' && <div className="absolute -bottom-[17px] left-0 right-0 h-0.5 bg-emerald-500 rounded-t-full" />}
          </button>
        </div>
        
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <button
          id="settings-btn"
          onClick={() => setSettingsOpen(true)}
          title="Settings"
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
        </button>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'dashboard' && <DashboardTab orgId={orgId} refreshTrigger={refreshTrigger} />}
        {activeTab === 'records' && <RecordsTab orgId={orgId} refreshTrigger={refreshTrigger} />}
        {activeTab === 'reports' && <ReportsTab orgId={orgId} />}
        {activeTab === 'audit' && <AuditTab orgId={orgId} refreshTrigger={refreshTrigger} />}
      </div>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
