'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useOrg } from '@/hooks/useOrg'
import { useLocale } from '@/lib/i18n/locale'
import type { Emirate } from '@/types/database'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

const EMIRATES: Emirate[] = [
  'Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman',
  'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah',
]

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { org, refreshOrg } = useOrg()
  const { t, locale, setLocale } = useLocale()
  const supabase = createClient()

  const [name, setName] = useState('')
  const [legalName, setLegalName] = useState('')
  const [trn, setTrn] = useState('')
  const [emirate, setEmirate] = useState<Emirate>('Dubai')
  const [isFreeZone, setIsFreeZone] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (org) {
      setName(org.name || '')
      setLegalName(org.legal_name || '')
      setTrn(org.trn || '')
      setEmirate(org.default_emirate || 'Dubai')
      setIsFreeZone(org.is_free_zone || false)
    }
  }, [org])

  if (!open) return null

  const handleSave = async () => {
    if (!org) return
    setSaving(true)
    setMessage('')

    const { error } = await supabase
      .from('organizations')
      .update({
        name,
        legal_name: legalName || null,
        trn: trn || null,
        default_emirate: emirate,
        is_free_zone: isFreeZone,
        updated_at: new Date().toISOString(),
      })
      .eq('id', org.id)

    if (error) {
      setMessage(`Error: ${error.message}`)
    } else {
      setMessage('Settings saved!')
      await refreshOrg()
      setTimeout(() => { setMessage(''); onClose() }, 1000)
    }
    setSaving(false)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="glass rounded-2xl w-full max-w-lg mx-4 p-6 animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-[--text-primary]">{t('settings.title')}</h2>
          <button onClick={onClose} className="text-[--text-muted] hover:text-[--text-primary] transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-[--text-muted] mb-1.5">{t('settings.companyName')}</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder={t('settings.companyNamePlaceholder')} />
          </div>

          <div>
            <label className="block text-xs text-[--text-muted] mb-1.5">{t('settings.legalName')}</label>
            <input type="text" value={legalName} onChange={e => setLegalName(e.target.value)} placeholder={t('settings.legalNamePlaceholder')} />
          </div>

          <div>
            <label className="block text-xs text-[--text-muted] mb-1.5">{t('settings.trn')}</label>
            <input type="text" value={trn} onChange={e => setTrn(e.target.value)} placeholder={t('settings.trnPlaceholder')} maxLength={15} />
          </div>

          <div>
            <label className="block text-xs text-[--text-muted] mb-1.5">{t('settings.defaultEmirate')}</label>
            <select
              value={emirate}
              onChange={e => setEmirate(e.target.value as Emirate)}
              className="w-full bg-white/5 border border-white/10 text-[--text-primary] rounded-xl px-4 py-3 text-sm outline-none focus:border-[--accent] transition-colors"
            >
              {EMIRATES.map(e => <option key={e} value={e} className="bg-[--bg-secondary]">{e}</option>)}
            </select>
          </div>

          <label className="flex items-center gap-3 cursor-pointer group">
            <div className={`w-10 h-6 rounded-full transition-colors relative ${isFreeZone ? 'bg-emerald-600' : 'bg-white/10'}`}
              onClick={() => setIsFreeZone(!isFreeZone)}>
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${isFreeZone ? 'translate-x-5' : 'translate-x-1'}`} />
            </div>
            <span className="text-sm text-[--text-secondary] group-hover:text-[--text-primary] transition-colors">{t('settings.freeZone')}</span>
          </label>

          {/* Language toggle */}
          <div className="flex items-center justify-between py-1">
            <span className="text-sm text-[--text-muted]">{t('settings.language')}</span>
            <div className="flex gap-2">
              <button
                onClick={() => setLocale('en')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  locale === 'en'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white/5 text-[--text-secondary] hover:bg-white/10'
                }`}
              >
                English
              </button>
              <button
                onClick={() => setLocale('ar')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  locale === 'ar'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white/5 text-[--text-secondary] hover:bg-white/10'
                }`}
              >
                العربية
              </button>
            </div>
          </div>
        </div>

        {message && (
          <div className={`mt-4 p-3 rounded-xl text-sm ${message.startsWith('Error') ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}`}>
            {message}
          </div>
        )}

        <div className="flex items-center justify-between mt-6 pt-4 border-t border-white/5">
          <button onClick={handleLogout} className="text-sm text-red-400 hover:text-red-300 transition-colors">
            {t('settings.signOut')}
          </button>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm text-[--text-secondary] hover:text-[--text-primary] transition-colors">
              {t('settings.cancel')}
            </button>
            <button onClick={handleSave} disabled={saving} className="btn-primary text-sm">
              {saving ? t('settings.saving') : t('settings.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
