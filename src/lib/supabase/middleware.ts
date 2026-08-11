import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isCallback = path.startsWith('/callback')
  const isAuthPage = path.startsWith('/login') || path.startsWith('/signup') || isCallback

  /**
   * Carries the refreshed Supabase auth cookies onto a redirect response.
   * Returning a bare NextResponse.redirect() here would discard the rotated
   * tokens that getUser() just wrote, causing intermittent session drops.
   */
  const redirectTo = (pathname: string) => {
    const url = request.nextUrl.clone()
    url.pathname = pathname
    url.search = ''
    const response = NextResponse.redirect(url)
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie)
    })
    return response
  }

  // Not logged in and not on an auth page -> login
  if (!user && !isAuthPage && path !== '/') {
    return redirectTo('/login')
  }

  // Logged in and sitting on login/signup -> app.
  // /callback is excluded: it must be allowed to run its code exchange.
  if (user && isAuthPage && !isCallback) {
    return redirectTo('/app')
  }

  return supabaseResponse
}
