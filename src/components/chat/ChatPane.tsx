'use client';

import React, { useState } from 'react';
import MessageList, { ChatMessage } from './MessageList';
import InputBar from './InputBar';
import { ParsedRecord, RecordTotals, ParsedItem } from './RecordCard';
import LocaleSwitcher from '@/components/shared/LocaleSwitcher';
import { useLocale } from '@/lib/i18n/locale';

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

  const calcTotals = (items: ParsedItem[]): RecordTotals => {
    let subtotal = 0, vatTotal = 0, discountTotal = 0;
    for (const item of items) {
      // A qty of 0 is legitimate; `||` would silently promote it to 1.
      const qty = Number.isFinite(item.qty) ? Number(item.qty) : 1;
      const gross = qty * (item.price || 0);
      const disc = item.discount || 0;
      const net = Math.max(0, gross - disc);
      subtotal += net;
      discountTotal += disc;
      const rate = item.category === 'standard' ? 0.05 : 0;
      vatTotal += net * rate;
    }
    return { subtotal, vat: vatTotal, discount: discountTotal, total: subtotal + vatTotal };
  };

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
        body: JSON.stringify({ message: content, orgId, chatHistory, fileData })
      });
      
      const resJson = await response.json();
      if (!response.ok || !resJson.success) {
        throw new Error(resJson.error || 'Failed to process message');
      }

      const parsedRecord: ParsedRecord | undefined = resJson.data;
      // Must match the Gemini schema exactly — it emits camelCase 'relatedParty'.
      const isTransaction = parsedRecord && ['sale', 'purchase', 'employee', 'asset', 'relatedParty'].includes(parsedRecord.type);

      let totals: RecordTotals | undefined;
      if (isTransaction && parsedRecord.items) {
        totals = calcTotals(parsedRecord.items);
      }

      // Extract Gemini natural text answer
      const textAnswer = resJson.text || (parsedRecord as any)?.queryResponse || (parsedRecord as any)?.explanation || (parsedRecord as any)?.notes || '';

      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: textAnswer || (isTransaction ? (locale === 'ar' ? 'تم استخراج تفاصيل المعاملة. يرجى المراجعة والتأكيد:' : 'Transaction details extracted. Please review and confirm:') : ''),
        record: isTransaction ? parsedRecord : undefined,
        recordTotals: isTransaction ? totals : undefined,
        recordStatus: isTransaction ? 'pending' : undefined,
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

    setMessages(prev => prev.map(m =>
      m.id === messageId ? { ...m, recordStatus: 'confirmed' } : m
    ));

    try {
      const res = await fetch('/api/records/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `${orgId}:${messageId}` },
        body: JSON.stringify({
          orgId,
          record: msg.record,
          totals: msg.recordTotals,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error('Confirm failed:', data.error);
        setMessages(prev => prev.map(m =>
          m.id === messageId ? { ...m, recordStatus: 'pending' } : m
        ));
        return;
      }
      setMessages(prev => prev.map(m =>
        m.id === messageId ? { ...m, dbRecordId: data.recordId } : m
      ));
    } catch (err) {
      console.error('Confirm error:', err);
    }

    onRecordConfirmed?.();
  };

  const handleVoidRecord = async (messageId: string) => {
    const msg = messages.find(m => m.id === messageId);
    if (!msg) return;

    setMessages(prev => prev.map(m =>
      m.id === messageId ? { ...m, recordStatus: 'voided' } : m
    ));

    try {
      if (msg.dbRecordId) {
        const res = await fetch('/api/records/void', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orgId,
            invoiceId: msg.dbRecordId,
          }),
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
        const newTotals = (updatedRecord.type === 'sale' || updatedRecord.type === 'purchase') && updatedRecord.items 
          ? calcTotals(updatedRecord.items) 
          : undefined;
        return { 
          ...msg, 
          record: updatedRecord, 
          recordTotals: newTotals, 
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
      handleSend(`Attachment ${file.name} is too large. Please upload a file under 6 MB.`)
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
        messages={messages}
        onConfirmRecord={handleConfirmRecord}
        onVoidRecord={handleVoidRecord}
        onEditRecord={handleEditRecord}
        onSaveEdit={handleSaveEdit}
        onCancelEdit={handleCancelEdit}
        onSuggestion={handleSend}
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
