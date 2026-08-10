import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppShell from '@/components/AppShell'

export const metadata = {
  title: 'Hissab — Dashboard',
  description: 'AI-powered UAE accounting dashboard',
}

export default async function AppPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return <AppShell userId={user.id} />
}
