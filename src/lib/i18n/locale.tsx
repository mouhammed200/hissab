'use client'

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import en from '@/messages/en.json'
import ar from '@/messages/ar.json'

export type Locale = 'en' | 'ar'

type Messages = typeof en

// Flatten nested keys: e.g. t('chat.welcome')
type FlatKey<T, Prefix extends string = ''> = {
  [K in keyof T]: T[K] extends Record<string, unknown>
    ? FlatKey<T[K], `${Prefix}${K & string}.`>
    : `${Prefix}${K & string}`
}[keyof T]

type TranslationKey = FlatKey<Messages>

const messages: Record<Locale, Messages> = { en, ar }

// Resolve dot-notation key from nested object
function resolve(obj: Record<string, unknown>, key: string): string {
  return key.split('.').reduce((acc: unknown, part) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part]
    return undefined
  }, obj as unknown) as string ?? key
}

interface LocaleContextType {
  locale: Locale
  dir: 'ltr' | 'rtl'
  setLocale: (locale: Locale) => void
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string
}

const LocaleContext = createContext<LocaleContextType>({
  locale: 'en',
  dir: 'ltr',
  setLocale: () => {},
  t: (key) => key,
})

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en')

  // On mount, load from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('hissab_locale') as Locale | null
    if (saved === 'ar' || saved === 'en') {
      setLocaleState(saved)
    } else {
      // Auto-detect from browser
      const browserLang = navigator.language?.startsWith('ar') ? 'ar' : 'en'
      setLocaleState(browserLang)
    }
  }, [])

  // Apply dir + lang to <html> on locale change
  useEffect(() => {
    const dir = locale === 'ar' ? 'rtl' : 'ltr'
    document.documentElement.setAttribute('lang', locale)
    document.documentElement.setAttribute('dir', dir)
    document.documentElement.setAttribute('data-locale', locale)
  }, [locale])

  const setLocale = useCallback((newLocale: Locale) => {
    localStorage.setItem('hissab_locale', newLocale)
    setLocaleState(newLocale)
  }, [])

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>): string => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let text = resolve(messages[locale] as any, key as string)
      if (!text || text === key) {
        // Fallback to English
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        text = resolve(messages.en as any, key as string)
      }
      if (vars) {
        Object.entries(vars).forEach(([k, v]) => {
          text = text.replace(`{{${k}}}`, String(v))
        })
      }
      return text || key
    },
    [locale]
  )

  return (
    <LocaleContext.Provider value={{ locale, dir: locale === 'ar' ? 'rtl' : 'ltr', setLocale, t }}>
      {children}
    </LocaleContext.Provider>
  )
}

export const useLocale = () => useContext(LocaleContext)
