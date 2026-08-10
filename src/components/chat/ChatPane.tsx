'use client';

import React, { useState } from 'react';
import MessageList, { ChatMessage } from './MessageList';
import InputBar from './InputBar';
import RecordCard, { ParsedRecord, RecordTotals, ParsedItem } from './RecordCard';
import LocaleSwitcher from '@/components/shared/LocaleSwitcher';
import { useLocale } from '@/lib/i18n/locale';

interface ChatPaneProps {
  orgId: string;
  userId: string;
  onRecordConfirmed?: () => void;
  onTogglePanel?: () => void;
  showPanel?: boolean;
}

export default function ChatPane({ orgId, userId, onRecordConfirmed, onTogglePanel, showPanel = true }: ChatPaneProps) {
  const { locale } = useLocale();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const calcTotals = (items: ParsedItem[]): RecordTotals => {
    let subtotal = 0, vatTotal = 0, discountTotal = 0;
    for (const item of items) {
      const gross = (item.qty || 1) * (item.price || 0);
      const disc = item.discount || 0;
      const net = Math.max(0, gross - disc);
      subtotal += net;
      discountTotal += disc;
      const rate = item.category === 'standard' ? 0.05 : 0;
      vatTotal += net * rate;
    }
    return { subtotal, vat: vatTotal, discount: discountTotal, total: subtotal + vatTotal };
  };

  const handleSend = async (content: string) => {
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
      const chatHistory = messages.map(m => ({ role: m.role, content: m.content }));
      
      const response = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: content, orgId, chatHistory })
      });
      
      const data = await response.json();
      
      const parsedRecord: ParsedRecord | undefined = data.data ?? data.record;
      let totals: RecordTotals | undefined;
      
      if (parsedRecord && (parsedRecord.type === 'sale' || parsedRecord.type === 'purchase') && parsedRecord.items) {
        totals = calcTotals(parsedRecord.items);
      }

      const assistantMsgText = data.text || ((parsedRecord as any)?.queryResponse) || (locale === 'ar' ? 'تم استخراج المعاملة بنجاح.' : 'Transaction record extracted.');

      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: assistantMsgText,
        record: parsedRecord,
        recordTotals: totals,
        recordStatus: parsedRecord ? 'pending' : undefined,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantMsg]);
    } catch (error) {
      console.error('Error fetching chat response:', error);
      const errorMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: locale === 'ar' 
          ? 'عذراً، حدث خطأ أثناء معالجة طلبك. يرجى المحاولة لاحقاً.' 
          : "I'm sorry, I encountered an error while processing your request. Please try again later.",
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
        headers: { 'Content-Type': 'application/json' },
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
    handleSend(`Uploaded file: ${file.name}`);
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
              title={showPanel ? 'Hide Panel' : 'Show Panel'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/5 hover:bg-white/10 text-[var(--text-secondary)] border border-white/10 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
              </svg>
              <span className="hidden sm:inline">{showPanel ? (locale === 'ar' ? 'إخفاء اللوحة' : 'Hide Panel') : (locale === 'ar' ? 'إظهار اللوحة' : 'Show Panel')}</span>
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
