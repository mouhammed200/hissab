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
  const { org, membership, refreshOrg } = useOrg()
  const canEditCompany = membership?.role === 'owner' || membership?.role === 'admin'
  const { t, locale, setLocale } = useLocale()
  const supabase = createClient()

  // User Profile State
  const [userEmail, setUserEmail] = useState('')
  const [fullName, setFullName] = useState('')

  // Company State
  const [name, setName] = useState('')
  const [legalName, setLegalName] = useState('')
  const [trn, setTrn] = useState('')
  const [emirate, setEmirate] = useState<Emirate>('Dubai')
  const [isFreeZone, setIsFreeZone] = useState(false)

  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    async function loadUserData() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        setUserEmail(user.email || '')
        setFullName(user.user_metadata?.full_name || '')
      }
    }

    if (open) {
      loadUserData()
      if (org) {
        setName(org.name || '')
        setLegalName(org.legal_name || '')
        setTrn(org.trn || '')
        setEmirate(org.default_emirate || 'Dubai')
        setIsFreeZone(org.is_free_zone || false)
      }
    }
  }, [open, org]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  const handleSave = async () => {
    if (!org) return
    setSaving(true)
    setMessage('')

    try {
      // 1. Update Organization Settings
      // Only owner/admin can write to `organizations` per RLS policy org_upd.
      // Supabase RLS silently matches zero rows on a denied UPDATE rather than
      // throwing, so a bare .update() looks identical to success even when
      // nothing changed. Guard on the client (canEditCompany disables the
      // fields below) AND verify server-side by selecting the updated row
      // back — if RLS blocked it, .select() returns an empty array here,
      // which we treat as a real failure instead of silently succeeding.
      if (canEditCompany) {
        const { data: updatedRows, error: orgErr } = await supabase
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
          .select('id')

        if (orgErr) throw orgErr
        if (!updatedRows || updatedRows.length === 0) {
          throw new Error(
            t('settings.permissionDenied') ||
            'You do not have permission to update company settings. Ask an owner or admin.'
          )
        }
      }

      // 2. Update User Profile Metadata
      if (fullName) {
        await supabase.auth.updateUser({
          data: { full_name: fullName }
        })
      }

      setMessage(t('settings.saved') || 'Settings saved successfully!')
      await refreshOrg()
      setTimeout(() => { setMessage(''); onClose() }, 1000)
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Failed to update settings'
      setMessage(`Error: ${errMsg}`)
    } finally {
      setSaving(false)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="glass rounded-2xl w-full max-w-lg mx-4 p-6 animate-slide-up max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6 border-b border-white/10 pb-4">
          <div>
            <h2 className="text-lg font-semibold text-[--text-primary]">{t('settings.title')}</h2>
            <p className="text-xs text-[--text-muted]">{t('settings.subtitle')}</p>
          </div>
          <button onClick={onClose} className="text-[--text-muted] hover:text-[--text-primary] transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="space-y-4">
          {/* User Profile Section */}
          <div className="bg-white/5 p-4 rounded-xl space-y-3 border border-white/5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-400">{t('settings.userProfile')}</h3>
            <div>
              <label className="block text-xs text-[--text-muted] mb-1">{t('settings.emailReadOnly')}</label>
              <input type="email" value={userEmail} disabled className="opacity-60 cursor-not-allowed text-xs w-full" />
            </div>
            <div>
              <label className="block text-xs text-[--text-muted] mb-1">{t('settings.fullName')}</label>
              <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="e.g. Mouhammed" className="text-xs w-full" />
            </div>
          </div>

          {/* Company Details Section */}
          <div className="bg-white/5 p-4 rounded-xl space-y-3 border border-white/5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-400">{t('settings.companyAndTax')}</h3>
            {!canEditCompany && (
              <p className="text-xs text-amber-400/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                {t('settings.companyEditRestricted') || 'Only an owner or admin can change company and tax settings.'}
              </p>
            )}
            <div>
              <label className="block text-xs text-[--text-muted] mb-1">{t('settings.companyName')}</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder={t('settings.companyNamePlaceholder')} disabled={!canEditCompany} className={`text-xs w-full ${!canEditCompany ? 'opacity-60 cursor-not-allowed' : ''}`} />
            </div>

            <div>
              <label className="block text-xs text-[--text-muted] mb-1">{t('settings.legalName')}</label>
              <input type="text" value={legalName} onChange={e => setLegalName(e.target.value)} placeholder={t('settings.legalNamePlaceholder')} disabled={!canEditCompany} className={`text-xs w-full ${!canEditCompany ? 'opacity-60 cursor-not-allowed' : ''}`} />
            </div>

            <div>
              <label className="block text-xs text-[--text-muted] mb-1">{t('settings.trn')}</label>
              <input type="text" value={trn} onChange={e => setTrn(e.target.value)} placeholder={t('settings.trnPlaceholder')} maxLength={15} disabled={!canEditCompany} className={`text-xs font-mono w-full ${!canEditCompany ? 'opacity-60 cursor-not-allowed' : ''}`} />
            </div>

            <div>
              <label className="block text-xs text-[--text-muted] mb-1">{t('settings.defaultEmirate')}</label>
              <select
                value={emirate}
                onChange={e => setEmirate(e.target.value as Emirate)}
                disabled={!canEditCompany}
                className={`w-full bg-[var(--bg-secondary)] border border-white/10 text-[--text-primary] rounded-xl px-3 py-2 text-xs outline-none focus:border-[--accent] transition-colors ${!canEditCompany ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                {EMIRATES.map(e => (
                  <option key={e} value={e} className="bg-[--bg-secondary]">
                    {t(`settings.emirates.${e}`) || e}
                  </option>
                ))}
              </select>
            </div>

            <button type="button" onClick={() => canEditCompany && setIsFreeZone(value => !value)} disabled={!canEditCompany} className={`flex items-center gap-3 group pt-1 text-start ${!canEditCompany ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
              <span 
                className={`w-9 h-5 rounded-full transition-colors relative ${isFreeZone ? 'bg-emerald-600' : 'bg-white/10'}`}
                role="switch" aria-checked={isFreeZone} aria-label={t('settings.freeZone')}
              >
                <div 
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                    locale === 'ar'
                      ? (isFreeZone ? '-translate-x-4' : '-translate-x-0.5')
                      : (isFreeZone ? 'translate-x-4' : 'translate-x-0.5')
                  }`} 
                />
              </span>
              <span className="text-xs text-[--text-secondary] group-hover:text-[--text-primary] transition-colors">{t('settings.freeZone')}</span>
            </button>
          </div>

          {/* Language Toggle */}
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-xs text-[--text-muted]">{t('settings.language')}</span>
            <div className="flex gap-2">
              <button
                type="button"
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
                type="button"
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
          <div className={`mt-4 p-3 rounded-xl text-xs ${message.startsWith('Error') ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}`}>
            {message}
          </div>
        )}

        <div className="flex items-center justify-between mt-6 pt-4 border-t border-white/5">
          <button type="button" onClick={handleLogout} className="text-xs text-red-400 hover:text-red-300 transition-colors">
            {t('settings.signOut')}
          </button>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs text-[--text-secondary] hover:text-[--text-primary] transition-colors">
              {t('settings.cancel')}
            </button>
            <button type="button" onClick={handleSave} disabled={saving} className="btn-primary text-xs">
              {saving ? t('settings.saving') : t('settings.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
