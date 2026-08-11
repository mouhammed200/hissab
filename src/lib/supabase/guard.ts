import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { MemberRole } from '@/types/database'

type ServerClient = Awaited<ReturnType<typeof createClient>>

interface GuardSuccess {
  ok: true
  supabase: ServerClient
  user: { id: string }
  role: MemberRole
}

interface GuardFailure {
  ok: false
  response: NextResponse
}

export type OrgGuardResult = GuardSuccess | GuardFailure

/**
 * Authenticates the caller AND verifies they are a member of `orgId`.
 *
 * Every route that accepts an org identifier from the client MUST call this.
 * Without it, any authenticated user can read/write another tenant's data
 * simply by swapping the orgId in the request.
 */
export async function requireOrgAccess(
  orgId: string | null | undefined,
  options?: { roles?: MemberRole[] }
): Promise<OrgGuardResult> {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  if (!orgId) {
    return { ok: false, response: NextResponse.json({ error: 'Missing orgId' }, { status: 400 }) }
  }

  const { data: membership, error: memberError } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (memberError) {
    return { ok: false, response: NextResponse.json({ error: memberError.message }, { status: 500 }) }
  }

  if (!membership) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'No access to this organization' }, { status: 403 }),
    }
  }

  const role = membership.role as MemberRole

  if (options?.roles && !options.roles.includes(role)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }),
    }
  }

  return { ok: true, supabase, user: { id: user.id }, role }
}

/** Roles allowed to create, modify or void financial records. */
export const WRITE_ROLES: MemberRole[] = ['owner', 'admin', 'accountant']
