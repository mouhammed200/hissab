'use client';

import React, { useEffect, useRef } from 'react';
import RecordCard, { ParsedRecord, RecordTotals } from './RecordCard';
import { useLocale } from '@/lib/i18n/locale';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  record?: ParsedRecord;
  recordTotals?: RecordTotals;
  recordStatus?: 'pending' | 'confirmed' | 'voided' | 'editing';
  /** Blocking validation problems returned by the normalizer or the API. */
  recordErrors?: string[];
  /** Non-blocking notices the user should read before confirming. */
  recordWarnings?: string[];
  dbRecordId?: string;
  timestamp: Date;
}

interface MessageListProps {
  messages: ChatMessage[];
  onConfirmRecord: (messageId: string) => void;
  onVoidRecord: (messageId: string) => void;
  onEditRecord: (messageId: string) => void;
  onSaveEdit: (messageId: string, updated: ParsedRecord) => void;
  onCancelEdit: (messageId: string) => void;
  onSuggestion: (text: string) => void;
}

const formatTime = (date: Date, locale: string) => {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  const diff = Math.floor((new Date().getTime() - d.getTime()) / 60000);

  if (locale === 'ar') {
    if (diff < 1) return 'الآن';
    if (diff < 60) return `منذ ${diff} دقيقة`;
    return d.toLocaleTimeString('ar-AE', { hour: '2-digit', minute: '2-digit' });
  }

  if (diff < 1) return 'Just now';
  if (diff < 60) return `${diff} min ago`;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export default function MessageList({
  messages,
  onConfirmRecord,
  onVoidRecord,
  onEditRecord,
  onSaveEdit,
  onCancelEdit,
  onSuggestion
}: MessageListProps) {
  const endOfMessagesRef = useRef<HTMLDivElement>(null);
  const { t, locale } = useLocale();

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center overflow-y-auto">
        <div className="w-16 h-16 rounded-full bg-[var(--bg-secondary)] flex items-center justify-center mb-4 text-3xl">✨</div>
        <h3 className="text-xl font-medium text-[var(--text-primary)] mb-2 gradient-text">{t('chat.welcome')}</h3>
        <p className="text-[var(--text-secondary)] max-w-md mb-8">{t('chat.welcomeSubtitle')}</p>
        
        <div className="grid grid-cols-1 gap-3 w-full max-w-md">
          <button type="button" onClick={() => onSuggestion(t('chat.suggestions.sale'))} className="p-3 glass glass-hover rounded-lg text-sm text-[var(--text-secondary)] ltr:text-left rtl:text-right cursor-pointer border border-[var(--border-subtle)] text-start">{t('chat.suggestions.sale')}</button>
          <button type="button" onClick={() => onSuggestion(t('chat.suggestions.expense'))} className="p-3 glass glass-hover rounded-lg text-sm text-[var(--text-secondary)] ltr:text-left rtl:text-right cursor-pointer border border-[var(--border-subtle)] text-start">{t('chat.suggestions.expense')}</button>
          <button type="button" onClick={() => onSuggestion(t('chat.suggestions.query'))} className="p-3 glass glass-hover rounded-lg text-sm text-[var(--text-secondary)] ltr:text-left rtl:text-right cursor-pointer border border-[var(--border-subtle)] text-start">{t('chat.suggestions.query')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
      {messages.map((msg) => {
        const userContent = msg.content?.trim() || (locale === 'ar' ? 'معاملة جديدة' : 'Transaction Message');
        const isUser = msg.role === 'user';
        
        return (
          <div key={msg.id} className={`flex flex-col max-w-[85%] ${isUser ? 'self-end' : 'self-start'}`}>
            {isUser ? (
              <div className="bg-[var(--accent)] bg-opacity-20 text-[var(--text-primary)] border border-[var(--border-accent)] rounded-2xl rounded-tr-sm px-4 py-3 shadow-lg glow-accent">
                <p className="whitespace-pre-wrap text-sm">{userContent}</p>
              </div>
            ) : (
              <>
                {msg.content && (
                  <div className="glass text-[var(--text-primary)] border border-[var(--border-subtle)] rounded-2xl rounded-tl-sm px-4 py-3 shadow-lg mb-2">
                    <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                  </div>
                )}
                {msg.record && (
                  <div className="w-full mt-1">
                    <RecordCard
                      record={msg.record}
                      totals={msg.recordTotals}
                      status={msg.recordStatus || 'pending'}
                      errors={msg.recordErrors}
                      warnings={msg.recordWarnings}
                      onConfirm={() => onConfirmRecord(msg.id)}
                      onVoid={() => onVoidRecord(msg.id)}
                      onEdit={() => onEditRecord(msg.id)}
                      onSaveEdit={(updated) => onSaveEdit(msg.id, updated)}
                      onCancelEdit={() => onCancelEdit(msg.id)}
                    />
                  </div>
                )}
              </>
            )}
            <span className={`text-[10px] text-[var(--text-muted)] mt-1 px-1 ${
              isUser ? 'text-end self-end' : 'text-start self-start'
            }`}>
              {formatTime(msg.timestamp, locale)}
            </span>
          </div>
        );
      })}
      <div ref={endOfMessagesRef} />
    </div>
  );
}
