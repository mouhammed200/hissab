'use client'

import React, { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface AuditTabProps {
  orgId: string
  refreshTrigger?: number
}

export default function AuditTab({ orgId, refreshTrigger }: AuditTabProps) {
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
    return <div className="text-[var(--text-muted)] text-sm animate-pulse">Loading audit logs...</div>
  }

  if (logs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-[var(--text-muted)]">
        <span className="text-4xl mb-3">🛡️</span>
        <p>No audit logs available yet.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full space-y-3">
      {logs.map((log) => (
        <div key={log.id} className="glass rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <span className={`text-xs font-semibold px-2 py-1 rounded border ${getBadgeColor(log.action)}`}>
                {log.action?.toUpperCase() || 'UNKNOWN'}
              </span>
              <span className="text-sm font-medium text-[var(--text-primary)]">
                {log.table_name}
              </span>
            </div>
            <span className="text-xs text-[var(--text-muted)]">
              {new Date(log.created_at).toLocaleString()}
            </span>
          </div>
          
          <div className="flex justify-between items-end mt-2">
            <span className="text-xs text-[var(--text-secondary)]">
              User: <span className="text-[var(--text-primary)]">{log.user_id || 'System'}</span>
            </span>
            <button className="text-xs text-emerald-400 hover:underline">View details</button>
          </div>
        </div>
      ))}
    </div>
  )
}
