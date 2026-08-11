'use client';

import React, { useState, useRef, useEffect, ChangeEvent, KeyboardEvent } from 'react';
import { useLocale } from '@/lib/i18n/locale';

interface InputBarProps {
  onSend: (message: string) => void;
  onFileUpload?: (file: File) => void;
  loading?: boolean;
  disabled?: boolean;
}

export default function InputBar({ onSend, onFileUpload, loading = false, disabled = false }: InputBarProps) {
  const { t, locale } = useLocale();
  const [text, setText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const speechBaseRef = useRef('');

  const adjustHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 96)}px`;
    }
  };

  useEffect(() => {
    adjustHeight();
  }, [text]);

  // Speech Recognition API setup
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = locale === 'ar' ? 'ar-AE' : 'en-US';

        recognition.onresult = (event: any) => {
          let finalTranscript = '';
          let interimTranscript = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const part = event.results[i][0].transcript;
            if (event.results[i].isFinal) finalTranscript += part;
            else interimTranscript += part;
          }
          // Re-render the current utterance from a stable base instead of
          // appending interim fragments repeatedly.
          if (finalTranscript) speechBaseRef.current = `${speechBaseRef.current} ${finalTranscript}`.trim();
          setText(`${speechBaseRef.current}${interimTranscript ? ` ${interimTranscript}` : ''}`.trim());
        };

        recognition.onerror = (event: any) => {
          console.warn('Speech recognition error:', event.error);
          setIsRecording(false);
        };

        recognition.onend = () => {
          setIsRecording(false);
        };

        recognitionRef.current = recognition;
      }
    }
  }, [locale]);

  const toggleRecording = () => {
    if (!recognitionRef.current) {
      alert(locale === 'ar' ? 'التسجيل الصوتي غير مدعوم في متصفحك.' : 'Voice recognition is not supported in your browser.');
      return;
    }

    if (isRecording) {
      recognitionRef.current.stop();
      setIsRecording(false);
    } else {
      try {
        recognitionRef.current.lang = locale === 'ar' ? 'ar-AE' : 'en-US';
        recognitionRef.current.start();
        setIsRecording(true);
      } catch (err) {
        console.error('Failed to start recording:', err);
        setIsRecording(false);
      }
    }
  };

  const handleSend = () => {
    if (text.trim() && !disabled && !loading) {
      onSend(text.trim());
      setText('');
      if (isRecording && recognitionRef.current) {
        recognitionRef.current.stop();
        setIsRecording(false);
      }
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
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  return (
    <div className="p-3 sm:p-4 border-t border-[var(--border-subtle)] bg-[var(--bg-primary)]">
      <div className="flex items-end gap-1.5 sm:gap-2 p-2 rounded-xl glass">
        {/* Camera Snap Button */}
        <button 
          type="button"
          onClick={() => cameraInputRef.current?.click()}
          className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          disabled={disabled || loading}
          title={t('chat.takePhoto') || 'Take photo'}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
        </button>
        <input 
          type="file" 
          ref={cameraInputRef} 
          onChange={handleFileChange} 
          className="hidden" 
          accept="image/*"
          capture="environment"
        />

        {/* Upload File Button */}
        <button 
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          disabled={disabled || loading}
          title={t('chat.uploadFile') || 'Upload file'}
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

        {/* Text Input */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('chat.placeholder') || 'Type a transaction...'}
          className="flex-1 max-h-[96px] bg-transparent border-none outline-none resize-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)] py-2 text-sm"
          rows={1}
          disabled={disabled || loading}
        />

        {loading ? (
          <div className="flex items-center gap-1 p-2">
            <div className="w-2 h-2 rounded-full bg-[var(--accent)] animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-2 h-2 rounded-full bg-[var(--accent)] animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-2 h-2 rounded-full bg-[var(--accent)] animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        ) : text.trim() ? (
          <button 
            type="button"
            onClick={handleSend}
            disabled={disabled}
            className="p-2 rounded-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        ) : (
          <button 
            type="button"
            onClick={toggleRecording}
            className={`p-2 transition-colors rounded-full ${
              isRecording 
                ? 'bg-red-500/20 text-red-400 animate-pulse border border-red-500/40' 
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
            disabled={disabled}
            title={isRecording ? (t('chat.stopRecording') || 'Stop recording') : (t('chat.startRecording') || 'Start recording')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
          </button>
        )}
      </div>
    </div>
  );
}
