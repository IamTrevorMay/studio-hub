import React, { useState, useRef, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { colors, spacing, radii, fontSizes, fontWeights, zIndex } from '../lib/styleTokens';

// Morty Chat — collapsible assistant drawer (bottom right). Answers "how do I"
// questions about the app via the morty-assistant edge function. Server-side
// role gating decides what Morty is allowed to talk about.

const GREETING = {
  role: 'assistant',
  content: "Hey slugger! I'm Morty. Ask me anything about how to use the app — where things live, how a feature works, that kind of thing.",
};

const SUGGESTIONS = [
  'What does the Research page do?',
  'How do I request time off?',
  'Where do I track my tasks?',
];

export default function MortyChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading, open]);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const send = useCallback(async (text) => {
    const trimmed = (text || '').trim();
    if (!trimmed || loading) return;

    const next = [...messages, { role: 'user', content: trimmed }];
    setMessages(next);
    setInput('');
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('morty-assistant', {
        body: { messages: next.filter(m => m !== GREETING) },
      });
      if (error || !data?.reply) throw error || new Error('empty reply');
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (e) {
      console.error('Morty chat error:', e);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "Rain delay on my end — I couldn't get an answer just now. Try again in a moment.",
        isError: true,
      }]);
    } finally {
      setLoading(false);
    }
  }, [messages, loading]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={styles.launcher}
        title="Ask Morty"
        aria-label="Open Morty chat"
      >
        <span style={{ fontSize: fontSizes.display, lineHeight: 1 }}>⚾</span>
      </button>
    );
  }

  const showSuggestions = messages.length === 1 && !loading;

  return (
    <div style={styles.panel}>
      {/* Header */}
      <div style={styles.header}>
        <span style={{ fontSize: 18 }}>⚾</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={styles.headerTitle}>Morty</div>
          <div style={styles.headerSub}>App questions, answered</div>
        </div>
        <button onClick={() => setOpen(false)} style={styles.headerBtn} title="Minimize" aria-label="Minimize Morty chat">
          —
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={styles.messages}>
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              ...styles.bubble,
              ...(m.role === 'user' ? styles.bubbleUser : styles.bubbleMorty),
              ...(m.isError ? styles.bubbleError : null),
            }}
          >
            {m.content}
          </div>
        ))}
        {loading && (
          <div style={{ ...styles.bubble, ...styles.bubbleMorty, color: colors.textSubtle }}>
            Morty is thinking…
          </div>
        )}
        {showSuggestions && (
          <div style={styles.suggestions}>
            {SUGGESTIONS.map(s => (
              <button key={s} onClick={() => send(s)} style={styles.suggestionChip}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <div style={styles.inputRow}>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send(input); }}
          placeholder="Ask Morty…"
          style={styles.input}
          disabled={loading}
        />
        <button
          onClick={() => send(input)}
          disabled={loading || !input.trim()}
          style={{
            ...styles.sendBtn,
            opacity: loading || !input.trim() ? 0.4 : 1,
            cursor: loading || !input.trim() ? 'default' : 'pointer',
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}

const styles = {
  launcher: {
    position: 'fixed',
    bottom: 24,
    right: 24,
    width: 52,
    height: 52,
    borderRadius: '50%',
    border: `1px solid ${colors.accentBorder}`,
    background: `linear-gradient(135deg, ${colors.accentDeep}, ${colors.accent})`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    zIndex: zIndex.toast,
  },
  panel: {
    position: 'fixed',
    bottom: 24,
    right: 24,
    width: 360,
    maxWidth: 'calc(100vw - 48px)',
    height: 480,
    maxHeight: 'calc(100vh - 48px)',
    display: 'flex',
    flexDirection: 'column',
    background: colors.bgRaised,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.xl,
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    zIndex: zIndex.toast,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
    padding: `${spacing.md}px ${spacing.lg}px`,
    borderBottom: `1px solid ${colors.border}`,
    background: colors.accentA08,
  },
  headerTitle: {
    fontSize: fontSizes.md,
    fontWeight: fontWeights.bold,
    color: colors.text,
  },
  headerSub: {
    fontSize: fontSizes.xs,
    color: colors.textSubtle,
  },
  headerBtn: {
    background: 'none',
    border: 'none',
    color: colors.textMuted,
    fontSize: fontSizes.md,
    cursor: 'pointer',
    padding: `0 ${spacing.sm}px`,
    lineHeight: 1,
  },
  messages: {
    flex: 1,
    overflowY: 'auto',
    padding: spacing.lg,
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.md,
  },
  bubble: {
    maxWidth: '85%',
    padding: `${spacing.sm}px ${spacing.md}px`,
    borderRadius: radii.lg,
    fontSize: fontSizes.sm,
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    background: colors.accentSoft,
    border: `1px solid ${colors.accentBorder}`,
    color: colors.text,
  },
  bubbleMorty: {
    alignSelf: 'flex-start',
    background: colors.bgHover,
    border: `1px solid ${colors.border}`,
    color: colors.text,
  },
  bubbleError: {
    borderColor: colors.warning.border,
    color: colors.warning.fgSoft,
  },
  suggestions: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  suggestionChip: {
    background: colors.accentA06,
    border: `1px solid ${colors.accentBorder}`,
    borderRadius: 999,
    padding: `${spacing.xs}px ${spacing.md}px`,
    color: colors.accentFg,
    fontSize: fontSizes.xs,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  inputRow: {
    display: 'flex',
    gap: spacing.sm,
    padding: spacing.md,
    borderTop: `1px solid ${colors.border}`,
  },
  input: {
    flex: 1,
    padding: `${spacing.sm}px ${spacing.md}px`,
    borderRadius: 8,
    border: `1px solid ${colors.border}`,
    background: colors.bgInput,
    color: colors.text,
    fontSize: fontSizes.sm,
    outline: 'none',
    fontFamily: 'inherit',
  },
  sendBtn: {
    padding: `${spacing.sm}px ${spacing.lg}px`,
    borderRadius: 8,
    border: `1px solid ${colors.accentBorder}`,
    background: colors.accentSoft,
    color: colors.accentFg,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    fontFamily: 'inherit',
  },
};
