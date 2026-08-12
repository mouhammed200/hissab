'use client'

import { useState, useCallback } from 'react'
import { OrgProvider, useOrg } from '@/hooks/useOrg'
import { useLocale } from '@/lib/i18n/locale'
import dynamic from 'next/dynamic'

// Dynamic imports to avoid SSR issues with Supabase client
const ChatPane = dynamic(() => import('@/components/chat/ChatPane'), { ssr: false })
const Panel = dynamic(() => import('@/components/panel/Panel'), { ssr: false })

function AppContent({ userId }: { userId: string }) {
  const { org, loading, error } = useOrg()
  const { t, locale } = useLocale()
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [showPanel, setShowPanel] = useState(false) // Default to Chat focus

  const handleRecordConfirmed = useCallback(() => {
    setRefreshTrigger(prev => prev + 1)
  }, [])

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[--bg-primary]">
        <div className="text-center animate-fade-in">
          <div className="text-5xl mb-4 font-bold text-emerald-400">{locale === 'ar' ? 'حساب' : 'Hissab'}</div>
          <div className="flex items-center gap-2 justify-center">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
          <p className="text-[--text-muted] text-sm mt-3">{t('common.loadingWorkspace')}</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-[--bg-primary]">
        <div className="glass rounded-2xl p-8 max-w-md text-center animate-fade-in">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="text-lg font-semibold text-[--text-primary] mb-2">{t('common.error')}</h2>
          <p className="text-sm text-[--text-secondary] mb-4">{error}</p>
          <button onClick={() => window.location.reload()} className="btn-primary">
            {t('common.tryAgain')}
          </button>
        </div>
      </div>
    )
  }

  if (!org) {
    return (
      <div className="h-screen flex items-center justify-center bg-[--bg-primary]">
        <div className="glass rounded-2xl p-8 max-w-md text-center">
          <div className="text-4xl mb-4">🏢</div>
          <h2 className="text-lg font-semibold text-[--text-primary] mb-2">{t('common.error')}</h2>
          <p className="text-sm text-[--text-secondary]">{t('common.workspaceUnavailable')}</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <a className="skip-link" href="#main-content">{t('common.skipToContent')}</a>
    <div id="main-content" className="h-screen flex overflow-hidden bg-[--bg-primary]">
      {/* 100% Dedicated View Focus */}
      {!showPanel ? (
        <div className="w-full flex flex-col h-full animate-fade-in">
          <ChatPane
            orgId={org.id}
            userId={userId}
            onRecordConfirmed={handleRecordConfirmed}
            onTogglePanel={() => setShowPanel(true)}
            showPanel={false}
          />
        </div>
      ) : (
        <div className="w-full flex flex-col h-full animate-fade-in">
          <Panel 
            orgId={org.id} 
            refreshTrigger={refreshTrigger} 
            onRealtimeRefresh={handleRecordConfirmed} 
            onClosePanel={() => setShowPanel(false)}
          />
        </div>
      )}
    </div>
    </>
  )
}

export default function AppShell({ userId }: { userId: string }) {
  return (
    <OrgProvider>
      <AppContent userId={userId} />
    </OrgProvider>
  )
}
