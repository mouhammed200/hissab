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
  const { t } = useLocale()
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [showPanel, setShowPanel] = useState(true)

  const handleRecordConfirmed = useCallback(() => {
    setRefreshTrigger(prev => prev + 1)
  }, [])

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[--bg-primary]">
        <div className="text-center animate-fade-in">
          <div className="text-5xl mb-4">حساب</div>
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

  if (!org) return null

  return (
    <div className="h-screen flex overflow-hidden bg-[--bg-primary]">
      {/* Chat Pane */}
      <div className={`flex-1 min-w-0 flex flex-col transition-all duration-300 ${showPanel ? 'lg:max-w-[60%]' : ''}`}>
        <ChatPane
          orgId={org.id}
          userId={userId}
          onRecordConfirmed={handleRecordConfirmed}
        />
      </div>

      {/* Panel Toggle (mobile) */}
      <button
        onClick={() => setShowPanel(p => !p)}
        className="lg:hidden fixed bottom-20 right-4 z-50 w-12 h-12 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-lg shadow-emerald-900/30 hover:bg-emerald-500 transition-colors"
        aria-label="Toggle panel"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {showPanel ? (
            <path d="M18 6L6 18M6 6l12 12" />
          ) : (
            <>
              <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />
            </>
          )}
        </svg>
      </button>

      {/* Panel */}
      <div className={`
        fixed lg:relative inset-y-0 right-0 z-40
        w-full lg:w-[40%] lg:min-w-[400px] lg:max-w-[550px]
        transform transition-transform duration-300 ease-in-out
        ${showPanel ? 'translate-x-0' : 'translate-x-full lg:translate-x-0 lg:hidden'}
        border-l border-[--border-subtle]
      `}>
        <Panel orgId={org.id} refreshTrigger={refreshTrigger} onRealtimeRefresh={handleRecordConfirmed} />
      </div>
    </div>
  )
}

export default function AppShell({ userId }: { userId: string }) {
  return (
    <OrgProvider>
      <AppContent userId={userId} />
    </OrgProvider>
  )
}
