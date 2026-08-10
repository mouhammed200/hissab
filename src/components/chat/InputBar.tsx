'use client';

import React, { useState, useRef, useEffect, ChangeEvent, KeyboardEvent } from 'react';

interface InputBarProps {
  onSend: (message: string) => void;
  onFileUpload?: (file: File) => void;
  loading?: boolean;
  disabled?: boolean;
}

export default function InputBar({ onSend, onFileUpload, loading = false, disabled = false }: InputBarProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const adjustHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 96)}px`; // roughly 4 lines
    }
  };

  useEffect(() => {
    adjustHeight();
  }, [text]);

  const handleSend = () => {
    if (text.trim() && !disabled && !loading) {
      onSend(text.trim());
      setText('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onFileUpload) {
      onFileUpload(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="p-4 border-t border-[var(--border-subtle)] bg-[var(--bg-primary)]">
      <div className="flex items-end gap-2 p-2 rounded-xl glass">
        <button 
          type="button"
          onClick={() => alert('Camera UI Placeholder')}
          className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          disabled={disabled || loading}
          title="Take photo"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
        </button>
        
        <button 
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          disabled={disabled || loading}
          title="Upload file"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
        </button>
        <input 
          type="file" 
          ref={fileInputRef} 
          onChange={handleFileChange} 
          className="hidden" 
          accept="image/*,application/pdf"
        />

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a transaction, ask a question..."
          className="flex-1 max-h-[96px] bg-transparent border-none outline-none resize-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)] py-2"
          rows={1}
          disabled={disabled || loading}
        />

        {loading ? (
          <div className="flex items-center gap-1 p-3">
            <div className="w-2 h-2 rounded-full bg-[var(--accent)] animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-2 h-2 rounded-full bg-[var(--accent)] animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-2 h-2 rounded-full bg-[var(--accent)] animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        ) : text.trim() ? (
          <button 
            onClick={handleSend}
            disabled={disabled}
            className="p-2 rounded-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        ) : (
          <button 
            type="button"
            onClick={() => alert('Voice Record UI Placeholder')}
            className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            disabled={disabled}
            title="Record audio"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
          </button>
        )}
      </div>
    </div>
  );
}
