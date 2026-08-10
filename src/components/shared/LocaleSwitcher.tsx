'use client'

import { useLocale } from '@/lib/i18n/locale'

export default function LocaleSwitcher() {
  const { locale, setLocale } = useLocale()

  return (
    <button
      id="locale-switcher"
      onClick={() => setLocale(locale === 'en' ? 'ar' : 'en')}
      title={locale === 'en' ? 'Switch to Arabic' : 'التبديل إلى الإنجليزية'}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
        border border-white/10 text-[var(--text-secondary)] hover:text-[var(--text-primary)]
        hover:border-emerald-500/40 hover:bg-emerald-500/5 transition-all duration-200"
    >
      <span className="text-base leading-none">{locale === 'en' ? '🇦🇪' : '🇬🇧'}</span>
      <span>{locale === 'en' ? 'عربي' : 'EN'}</span>
    </button>
  )
}
