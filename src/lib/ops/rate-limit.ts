import type { SupabaseClient } from '@supabase/supabase-js'

export async function consumeSharedRateLimit(supabase: SupabaseClient, key: string, limit: number, windowSeconds = 60) {
  const { data, error } = await supabase.rpc('consume_rate_limit', { p_key: key, p_limit: limit, p_window_seconds: windowSeconds })
  if (error) throw error
  return data as { allowed: boolean; remaining: number }
}

export function safeRequestId(request: Request) {
  return request.headers.get('x-request-id') || crypto.randomUUID()
}
