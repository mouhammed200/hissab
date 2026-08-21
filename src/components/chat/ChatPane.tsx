'use client';

import React, { useEffect, useState } from 'react';
import MessageList, { ChatMessage } from './MessageList';
import InputBar from './InputBar';
import { ParsedRecord, RecordTotals } from './RecordCard';
import { computeTotals, hasItemizedTotals, isTransaction, normalizeRecord, validateRecord } from '@/lib/records/normalize';
import LocaleSwitcher from '@/components/shared/LocaleSwitcher';
import { useLocale } from '@/lib/i18n/locale';
import { createClient } from '@/lib/supabase/client';

interface ChatPaneProps {
  orgId: string;
  userId: string;
  onRecordConfirmed?: () => void;
  onTogglePanel?: () => void;
  showPanel?: boolean;
}

export default function ChatPane({ orgId, userId, onRecordConfirmed, onTogglePanel, showPanel = false }: ChatPaneProps) {
  const { locale, t } = useLocale();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  // Mirrors WRITE_ROLES in src/lib/supabase/guard.ts. Fetched client-side so
  // the void button can be hidden for viewer-role members instead of only
  // failing with a 403 after they've already been prompted for a reason.
  const [canVoid, setCanVoid] = useState(true);
  // Free-chat mode: when on, the structured engine (schema, normalize,
  // validate, RecordCard) is frozen — untouched, not deleted — and Gemini
  // just replies in plain text like an ordinary chatbot. Default is off, so
  // nothing about existing behavior changes unless the user flips this.
  const [freeMode, setFreeMode] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from('org_members')
      .select('role')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const role = data?.role;
        setCanVoid(role === 'owner' || role === 'admin' || role === 'accountant');
      });
    return () => { cancelled = true; };
  }, [orgId, userId]);


  const handleSend = async (content: string, fileData?: { mimeType: string; data: string }) => {
    if (!content.trim()) return;

    const userMsgId = Date.now().toString();
    const newMsg: ChatMessage = {
      id: userMsgId,
      role: 'user',
      content,
      timestamp: new Date()
    };
    
    setMessages(prev => [...prev, newMsg]);
    setLoading(true);

    try {
      // Gemini only accepts 'user' | 'model'. Sending 'assistant' returns a
      // 400 and kills every follow-up turn in the conversation.
      const chatHistory = messages.map(m => ({
        role: (m.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
        content: m.content,
      }));
      
      const response = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: content, orgId, chatHistory, fileData, locale, freeMode })
      });
      
      const resJson = await response.json();
      if (!response.ok || !resJson.success) {
        throw new Error(resJson.error || 'Failed to process message');
      }

      // Free mode: skip the entire structured pipeline below (normalize,
      // validate, totals, RecordCard fields) and just show the plain reply.
      if (freeMode) {
        const freeMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: resJson.freeText || '',
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, freeMsg]);
        return;
      }

      // The API already normalizes and validates. Re-running the normalizer here
      // is cheap and keeps the UI correct even if the response is replayed from
      // history or an older client version is talking to a newer API.
      const parsedRecord: ParsedRecord | undefined = resJson.data ? normalizeRecord(resJson.data, locale) : undefined;
      const transaction = Boolean(parsedRecord && isTransaction(parsedRecord.type));

      const validation = resJson.validation ?? (parsedRecord ? validateRecord(parsedRecord, locale) : undefined);
      const totals: RecordTotals | undefined =
        parsedRecord && hasItemizedTotals(parsedRecord.type) ? computeTotals(parsedRecord) : undefined;

      const textAnswer = resJson.text || parsedRecord?.queryResponse || parsedRecord?.notes || '';

      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: textAnswer || (transaction ? (locale === 'ar' ? 'تم استخراج تفاصيل المعاملة. يرجى المراجعة والتأكيد:' : 'Transaction details extracted. Please review and confirm:') : ''),
        record: transaction ? parsedRecord : undefined,
        recordTotals: transaction ? totals : undefined,
        recordStatus: transaction ? 'pending' : undefined,
        recordErrors: transaction ? validation?.errors ?? [] : undefined,
        recordWarnings: transaction ? validation?.warnings ?? [] : undefined,
        // Generated once here and reused on confirm. post_record_transaction()
        // requires a real UUID; `${orgId}:${messageId}` (the old key) never was one.
        idempotencyKey: transaction ? crypto.randomUUID() : undefined,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantMsg]);
    } catch (error) {
      console.error('Error fetching chat response:', error);
      const errorMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: locale === 'ar' 
          ? 'عذراً، حدث خطأ أثناء الاتصال بالذكاء الاصطناعي. يرجى المحاولة مجدداً.' 
          : "I'm sorry, I encountered an error while communicating with AI. Please try again.",
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmRecord = async (messageId: string) => {
    const msg = messages.find(m => m.id === messageId);
    if (!msg?.record) return;

    // Never let the user confirm a record the server will reject.
    const preflight = validateRecord(msg.record, locale);
    if (!preflight.valid) {
      setMessages(prev => prev.map(m =>
        m.id === messageId ? { ...m, recordErrors: preflight.errors, recordStatus: 'pending' } : m
      ));
      return;
    }

    setMessages(prev => prev.map(m =>
      m.id === messageId ? { ...m, recordStatus: 'confirmed', recordErrors: [] } : m
    ));

    try {
      // Fall back to a fresh UUID only for messages created before this fix
      // shipped (already in memory client-side); every new message gets one
      // at parse time above.
      const idempotencyKey = msg.idempotencyKey ?? crypto.randomUUID();
      const isPayment = msg.record.type === 'payment';
      const res = await fetch(isPayment ? '/api/payments' : '/api/records/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          orgId,
          record: msg.record,
          totals: msg.recordTotals,
          locale,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // The old code logged this to the console and quietly flipped the card
        // back to pending, so a rejected posting looked like a dead button.
        const reasons: string[] = Array.isArray(data.errors) && data.errors.length
          ? data.errors
          : [data.error || (locale === 'ar'
              ? 'تعذر ترحيل السجل. يرجى المحاولة مجدداً.'
              : 'The record could not be posted. Please try again.')];

        setMessages(prev => prev.map(m =>
          m.id === messageId
            ? { ...m, recordStatus: 'pending', recordErrors: reasons }
            : m
        ));
        return;
      }

      setMessages(prev => prev.map(m =>
        m.id === messageId
          ? { ...m, dbRecordId: data.recordId ?? data.paymentId, recordErrors: [], recordWarnings: data.warnings ?? m.recordWarnings }
          : m
      ));
      onRecordConfirmed?.();
    } catch (err) {
      console.error('Confirm error:', err);
      setMessages(prev => prev.map(m =>
        m.id === messageId
          ? {
              ...m,
              recordStatus: 'pending',
              recordErrors: [locale === 'ar'
                ? 'تعذر الاتصال بالخادم. لم يتم حفظ السجل.'
                : 'Could not reach the server. Nothing was saved.'],
            }
          : m
      ));
    }
  };

  const handleVoidRecord = async (messageId: string, reason?: string) => {
    const msg = messages.find(m => m.id === messageId);
    if (!msg) return;

    // A record only reaches the DB (gets a dbRecordId) after confirm. Voiding
    // one for real requires a reason (guard.ts / void_record_transaction
    // migration 016); dismissing a still-pending draft is purely local and
    // never needed one — collapsing both cases behind one reason prompt was
    // a bug (it blocked plain "dismiss draft" clicks too).
    if (msg.dbRecordId && !reason?.trim()) return;

    setMessages(prev => prev.map(m =>
      m.id === messageId ? { ...m, recordStatus: 'voided' } : m
    ));

    try {
      if (msg.dbRecordId) {
        // Chat-created records report their kind via record.type. Map that to
        // the void route's sourceType + id-field contract (src/app/api/records/void/route.ts
        // SOURCE_ID_FIELDS). sale/purchase both land in the invoices table.
        const VOID_FIELD_BY_RECORD_TYPE: Record<string, { sourceType: string; idField: string }> = {
          sale: { sourceType: 'invoice', idField: 'invoiceId' },
          purchase: { sourceType: 'invoice', idField: 'invoiceId' },
          employee: { sourceType: 'employee', idField: 'employeeId' },
          asset: { sourceType: 'asset', idField: 'assetId' },
          relatedParty: { sourceType: 'relatedParty', idField: 'relatedPartyId' },
          payment: { sourceType: 'payment', idField: 'paymentId' },
        };
        const mapping = msg.record?.type ? VOID_FIELD_BY_RECORD_TYPE[msg.record.type] : undefined;
        // Fall back to legacy invoice-only behavior if the record type is
        // missing or isn't voidable from chat (e.g. 'query'/'action').
        const voidBody = mapping
          ? { orgId, sourceType: mapping.sourceType, [mapping.idField]: msg.dbRecordId, reason }
          : { orgId, invoiceId: msg.dbRecordId, reason };

        const res = await fetch('/api/records/void', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(voidBody),
        });
        if (!res.ok) {
          const data = await res.json();
          console.error('Void failed:', data.error);
          setMessages(prev => prev.map(m =>
            m.id === messageId ? { ...m, recordStatus: 'confirmed' } : m
          ));
          return;
        }
        onRecordConfirmed?.();
      }
    } catch (err) {
      console.error('Void error:', err);
    }
  };

  const handleEditRecord = (messageId: string) => {
    setMessages(prev => prev.map(msg => 
      msg.id === messageId ? { ...msg, recordStatus: 'editing' } : msg
    ));
  };

  const handleSaveEdit = (messageId: string, updatedRecord: ParsedRecord) => {
    setMessages(prev => prev.map(msg => {
      if (msg.id === messageId) {
        // Re-run the full normalizer on edits so a manually edited record is
        // held to exactly the same contract as a freshly parsed one.
        const normalized = normalizeRecord(updatedRecord, locale);
        const revalidated = validateRecord(normalized, locale);
        return {
          ...msg,
          record: normalized,
          recordTotals: hasItemizedTotals(normalized.type) ? computeTotals(normalized) : undefined,
          recordErrors: revalidated.errors,
          recordWarnings: revalidated.warnings,
          recordStatus: 'pending'
        };
      }
      return msg;
    }));
  };

  const handleCancelEdit = (messageId: string) => {
    setMessages(prev => prev.map(msg => 
      msg.id === messageId ? { ...msg, recordStatus: 'pending' } : msg
    ));
  };

  const handleFileUpload = (file: File) => {
    if (file.size > 6 * 1024 * 1024) {
      // Was: handleSend(`Attachment ${file.name} is too large...`) — that faked a
      // user chat message and routed it through /api/gemini, burning a real LLM
      // call just to get a reworded rejection back. This is now a local-only
      // message, no network call, matching the error-message pattern below.
      const sizeErrorMsg: ChatMessage = {
        id: Date.now().toString(),
        role: 'assistant',
        content: locale === 'ar'
          ? `الملف ${file.name} كبير جدًا. يرجى رفع ملف أصغر من 6 ميجابايت.`
          : `${file.name} is too large. Please upload a file under 6 MB.`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, sizeErrorMsg]);
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const comma = result.indexOf(',')
      const data = comma >= 0 ? result.slice(comma + 1) : result
      handleSend(`Please read and extract the accounting information from ${file.name}.`, {
        mimeType: file.type || 'application/octet-stream',
        data,
      })
    }
    reader.onerror = () => handleSend(`I could not read ${file.name}. Please try again.`)
    reader.readAsDataURL(file)
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)] border-r border-[var(--border-subtle)]">
      {/* Header */}
      <div className="p-3 sm:p-4 border-b border-[var(--border-subtle)] flex justify-between items-center bg-[var(--bg-card)]">
        <div className="flex items-center gap-3">
          <div className="font-bold text-2xl text-[var(--accent)] gradient-text">
            {locale === 'ar' ? 'حساب' : 'Hissab'}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Free-chat mode toggle. Off by default — flips the request flag
              only; the structured engine underneath is untouched either way. */}
          <button
            type="button"
            onClick={() => setFreeMode((prev) => !prev)}
            title={freeMode ? t('chat.freeModeOn') : t('chat.freeModeOff')}
            aria-pressed={freeMode}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              freeMode
                ? 'bg-amber-500/20 text-amber-400 border-amber-500/30 hover:bg-amber-500/30'
                : 'bg-white/5 text-[var(--text-muted)] border-[var(--border-subtle)] hover:bg-white/10'
            }`}
          >
            <span className="text-sm leading-none">{freeMode ? '🗣️' : '📋'}</span>
            <span>{freeMode ? t('chat.freeModeOn') : t('chat.freeModeOff')}</span>
          </button>

          {/* Header Locale Switcher */}
          <LocaleSwitcher />

          {/* Toggle Panel Button */}
          {onTogglePanel && (
            <button
              type="button"
              onClick={onTogglePanel}
              title={showPanel ? t('panel.hidePanel') : t('panel.showPanel')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 border border-emerald-500/30 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
              </svg>
              <span>{t('panel.showPanel')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Message List */}
      <MessageList 
        orgId={orgId}
        messages={messages}
        onConfirmRecord={handleConfirmRecord}
        onVoidRecord={handleVoidRecord}
        onEditRecord={handleEditRecord}
        onSaveEdit={handleSaveEdit}
        onCancelEdit={handleCancelEdit}
        onSuggestion={handleSend}
        canVoid={canVoid}
      />

      {/* Input Area */}
      <InputBar 
        onSend={handleSend}
        onFileUpload={handleFileUpload}
        loading={loading}
      />
    </div>
  );
             }
        
