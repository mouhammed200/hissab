'use client';

import React, { useState } from 'react';
import MessageList, { ChatMessage } from './MessageList';
import InputBar from './InputBar';
import { ParsedRecord, RecordTotals, ParsedItem } from './RecordCard';

interface ChatPaneProps {
  orgId: string;
  userId: string;
  onRecordConfirmed?: () => void;
}

export default function ChatPane({ orgId, userId, onRecordConfirmed }: ChatPaneProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const calcTotals = (items: ParsedItem[]): RecordTotals => {
    let subtotal = 0, vatTotal = 0, discountTotal = 0;
    for (const item of items) {
      const gross = item.qty * item.price;
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
      
      // API returns { success, data } — data.data is the parsed record
      // fall back to data.record for compatibility
      const parsedRecord: ParsedRecord | undefined = data.data ?? data.record;
      let totals: RecordTotals | undefined;
      
      if (parsedRecord && (parsedRecord.type === 'sale' || parsedRecord.type === 'purchase') && parsedRecord.items) {
        totals = calcTotals(parsedRecord.items);
      }

      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.text || '',
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
        content: "I'm sorry, I encountered an error while processing your request. Please try again later.",
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

    // Optimistically mark as confirmed
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
        // Revert on failure
        setMessages(prev => prev.map(m =>
          m.id === messageId ? { ...m, recordStatus: 'pending' } : m
        ));
        return;
      }
      // Store the DB record ID on the message
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

    // Optimistically update UI
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
          // Revert on failure
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
      <div className="p-4 border-b border-[var(--border-subtle)] flex justify-between items-center bg-[var(--bg-card)]">
        <div className="font-bold text-2xl text-[var(--accent)] gradient-text">حساب</div>
        <div className="text-sm text-[var(--text-secondary)] font-medium">Hissab Inc.</div>
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
