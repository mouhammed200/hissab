export default async () => {
  const siteUrl = process.env.SITE_URL
  const secret = process.env.CRON_SECRET
  if (!siteUrl || !secret) return new Response('SITE_URL and CRON_SECRET are required', { status: 500 })
  const response = await fetch(`${siteUrl.replace(/\/$/, '')}/api/cron/exchange-rates`, {
    headers: { authorization: `Bearer ${secret}` },
  })
  return new Response(await response.text(), { status: response.status, headers: { 'content-type': 'application/json' } })
}

export const config = { schedule: '0 2 * * *' }
