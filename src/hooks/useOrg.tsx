'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Organization, OrgMember } from '@/types/database'

interface OrgContextType {
  org: Organization | null
  membership: OrgMember | null
  loading: boolean
  error: string | null
  refreshOrg: () => Promise<void>
}

const OrgContext = createContext<OrgContextType>({
  org: null, membership: null, loading: true, error: null,
  refreshOrg: async () => {},
})

export function OrgProvider({ children }: { children: React.ReactNode }) {
  const [org, setOrg] = useState<Organization | null>(null)
  const [membership, setMembership] = useState<OrgMember | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  const refreshOrg = async () => {
    try {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      // Get user's first org membership
      const { data: mem, error: memErr } = await supabase
        .from('org_members')
        .select('*')
        .eq('user_id', user.id)
        .limit(1)
        .single()

      if (memErr || !mem) {
        // New user — create org from signup metadata
        const meta = user.user_metadata
        const companyName = meta?.company_name || meta?.full_name || 'My Company'

        const { data: newOrg, error: orgErr } = await supabase
          .from('organizations')
          .insert({ name: companyName })
          .select()
          .single()

        if (orgErr || !newOrg) {
          setError('Failed to create organization')
          setLoading(false)
          return
        }

        // Add user as owner
        const { data: newMem } = await supabase
          .from('org_members')
          .insert({ org_id: newOrg.id, user_id: user.id, role: 'owner' })
          .select()
          .single()

        // Seed chart of accounts
        await supabase.rpc('seed_default_chart_of_accounts', { p_org_id: newOrg.id })

        setOrg(newOrg)
        setMembership(newMem)
      } else {
        // Existing user — load their org
        const { data: existingOrg } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', mem.org_id)
          .single()

        setOrg(existingOrg)
        setMembership(mem)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refreshOrg() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <OrgContext.Provider value={{ org, membership, loading, error, refreshOrg }}>
      {children}
    </OrgContext.Provider>
  )
}

export const useOrg = () => useContext(OrgContext)
