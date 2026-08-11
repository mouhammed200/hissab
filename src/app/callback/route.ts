import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Only allow same-origin, path-relative redirects.
 * Rejects protocol-relative ('//evil.com'), backslash ('/\evil.com') and
 * absolute ('https://evil.com') targets that would send a freshly
 * authenticated user off-site.
 */
function safeNextPath(raw: string | null): string {
  const fallback = '/app'
  if (!raw) return fallback
  if (!raw.startsWith('/')) return fallback
  if (raw.startsWith('//') || raw.startsWith('/\\')) return fallback
  return raw
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = safeNextPath(searchParams.get('next'))

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(new URL(next, origin))
    }
  }

  return NextResponse.redirect(new URL('/login?error=auth_callback_error', origin))
}
