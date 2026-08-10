import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { LocaleProvider } from '@/lib/i18n/locale'

const inter = Inter({ subsets: ['latin', 'latin-ext'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: 'Hissab — UAE Accounting',
  description: 'AI-powered accounting for UAE businesses. Chat-first, zero forms.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    // lang and dir are set dynamically client-side by LocaleProvider
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <LocaleProvider>
          {children}
        </LocaleProvider>
      </body>
    </html>
  )
}
