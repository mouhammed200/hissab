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
      setError(null)
      const { data: { user }, error: userErr } = await supabase.auth.getUser()
      if (userErr || !user) {
        setLoading(false)
        return
      }

      // 1. Query user's org membership
      const { data: mems } = await supabase
        .from('org_members')
        .select('*')
        .eq('user_id', user.id)
        .limit(1)

      const mem = mems && mems.length > 0 ? mems[0] : null

      if (!mem) {
        // 2. Newly signed-in user (created manually in Supabase Auth) — auto-create organization & member
        const meta = user.user_metadata || {}
        const emailPrefix = user.email ? user.email.split('@')[0] : 'My Business'
        const companyName = meta.company_name || meta.full_name || `${emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1)} Trading`

        // Insert Organization
        const { data: newOrg, error: orgErr } = await supabase
          .from('organizations')
          .insert({ name: companyName, default_emirate: 'Dubai' })
          .select()
          .single()

        if (orgErr || !newOrg) {
          // SECURITY: never fall back to an existing organization here. Attaching a
          // brand new user to whatever org happens to be readable would hand them
          // owner rights over another company's financial data.
          throw new Error(
            orgErr?.message || 'Could not create your workspace. Please contact support.'
          )
        }

        // Insert Member
        const { data: newMem } = await supabase
          .from('org_members')
          .insert({ org_id: newOrg.id, user_id: user.id, role: 'owner' })
          .select()
          .single()

        // Seed chart of accounts (ignore RPC error if function doesn't exist yet)
        try {
          await supabase.rpc('seed_default_chart_of_accounts', { p_org_id: newOrg.id })
        } catch {
          // Silently ignore if RPC seed function is not installed in database
        }

        setOrg(newOrg)
        setMembership(newMem || { id: newOrg.id, org_id: newOrg.id, user_id: user.id, role: 'owner', created_at: new Date().toISOString() })
      } else {
        // 3. Existing user with org membership — load organization details
        const { data: existingOrg, error: orgErr } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', mem.org_id)
          .single()

        if (orgErr || !existingOrg) {
          throw new Error('Organization not found')
        }

        setOrg(existingOrg)
        setMembership(mem)
      }
    } catch (err) {
      console.error('Org Provider Error:', err)
      setError(err instanceof Error ? err.message : 'Failed to load workspace')
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
