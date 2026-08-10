'use client'

import React, { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useLocale } from '@/lib/i18n/locale'

interface AuditTabProps {
  orgId: string
  refreshTrigger?: number
}

export default function AuditTab({ orgId, refreshTrigger }: AuditTabProps) {
  const { t, locale } = useLocale()
  const [logs, setLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchLogs() {
      setLoading(true)
      const supabase = createClient()
      try {
        const { data } = await supabase
          .from('audit_logs')
          .select('*')
          .eq('org_id', orgId)
          .order('created_at', { ascending: false })
          .limit(50)
          
        setLogs(data || [])
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    fetchLogs()
  }, [orgId, refreshTrigger])

  const getBadgeColor = (action: string) => {
    switch (action?.toLowerCase()) {
      case 'create':
      case 'created':
      case 'confirm':
      case 'confirmed':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
      case 'update':
      case 'updated':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/20'
      case 'delete':
      case 'deleted':
      case 'void':
      case 'voided':
        return 'bg-red-500/10 text-red-400 border-red-500/20'
      default:
        return 'bg-gray-500/10 text-gray-400 border-gray-500/20'
    }
  }

  if (loading) {
    return <div className="text-[var(--text-muted)] text-sm animate-pulse p-4 text-center">{t('audit.loading')}</div>
  }

  if (logs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-[var(--text-muted)]">
        <span className="text-4xl mb-3">🛡️</span>
        <p className="text-sm">{t('audit.noLogs')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full space-y-3">
      {logs.map((log) => (
        <div key={log.id} className="glass rounded-lg p-3 sm:p-4">
          <div className="flex items-center justify-between mb-2 gap-2">
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border uppercase ${getBadgeColor(log.action)}`}>
                {log.action || 'ACTION'}
              </span>
              <span className="text-xs sm:text-sm font-medium text-[var(--text-primary)] truncate">
                {log.table_name}
              </span>
            </div>
            <span className="text-[10px] sm:text-xs text-[var(--text-muted)] shrink-0">
              {new Date(log.created_at).toLocaleString(locale === 'ar' ? 'ar-AE' : 'en-AE')}
            </span>
          </div>
          
          <div className="flex justify-between items-end mt-2">
            <span className="text-xs text-[var(--text-secondary)]">
              {t('audit.user')}: <span className="text-[var(--text-primary)] font-mono text-[10px]">{log.user_id ? `${log.user_id.slice(0, 8)}...` : t('audit.system')}</span>
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
