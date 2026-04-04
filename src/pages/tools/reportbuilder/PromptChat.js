import React, { useState, useRef, useEffect } from 'react';

export default function PromptChat({ messages, loading, onSend }) {
  const [input, setInput] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    onSend(text);
  };

  return (
    <div style={styles.container}>
      {/* Messages */}
      <div ref={scrollRef} style={styles.messages}>
        {messages.length === 0 && !loading && (
          <div style={styles.emptyState}>
            <div style={styles.emptyTitle}>Describe your report</div>
            <div style={styles.emptyText}>
              Tell me what you'd like this report to cover. I'll generate a preview using your real data. You can iterate until it's right.
            </div>
            <div style={styles.examples}>
              <div style={styles.exampleLabel}>Try something like:</div>
              <div style={styles.exampleItem}>"Write a daily MLB news roundup focused on pitching"</div>
              <div style={styles.exampleItem}>"Summarize the top 5 stories with bullet points"</div>
              <div style={styles.exampleItem}>"Create a weekly digest with sections for trades, injuries, and prospects"</div>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} style={msg.role === 'user' ? styles.userMsg : styles.assistantMsg}>
            <div style={msg.role === 'user' ? styles.userBubble : styles.assistantBubble}>
              {msg.role === 'user' ? msg.content : (
                <div style={styles.assistantText}>
                  {msg.error ? (
                    <span style={styles.errorText}>{msg.error}</span>
                  ) : (
                    'Preview generated — check the right panel.'
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div style={styles.assistantMsg}>
            <div style={styles.assistantBubble}>
              <div style={styles.loadingDots}>
                <span style={styles.dot} />
                <span style={{ ...styles.dot, animationDelay: '0.2s' }} />
                <span style={{ ...styles.dot, animationDelay: '0.4s' }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} style={styles.inputRow}>
        <input
          style={styles.input}
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={messages.length === 0 ? 'Describe your report...' : 'Refine your report...'}
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          style={{
            ...styles.sendBtn,
            ...(loading || !input.trim() ? styles.sendBtnDisabled : {}),
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </form>

      <style>{`
        @keyframes dotPulse {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
  },
  messages: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px 0',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  emptyState: {
    padding: '20px 0',
  },
  emptyTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.6)',
    marginBottom: '8px',
  },
  emptyText: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.35)',
    lineHeight: 1.5,
    marginBottom: '16px',
  },
  examples: {
    background: 'rgba(255,255,255,0.02)',
    borderRadius: '8px',
    padding: '12px',
    border: '1px solid rgba(255,255,255,0.04)',
  },
  exampleLabel: {
    fontSize: '11px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.3)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '8px',
  },
  exampleItem: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.45)',
    padding: '4px 0',
    fontStyle: 'italic',
  },
  userMsg: {
    display: 'flex',
    justifyContent: 'flex-end',
  },
  assistantMsg: {
    display: 'flex',
    justifyContent: 'flex-start',
  },
  userBubble: {
    background: '#6366f1',
    borderRadius: '12px 12px 2px 12px',
    padding: '10px 14px',
    maxWidth: '85%',
    fontSize: '13px',
    color: '#ffffff',
    lineHeight: 1.4,
  },
  assistantBubble: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '12px 12px 12px 2px',
    padding: '10px 14px',
    maxWidth: '85%',
    fontSize: '13px',
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 1.4,
  },
  assistantText: {},
  errorText: {
    color: '#fca5a5',
  },
  loadingDots: {
    display: 'flex',
    gap: '4px',
    padding: '4px 0',
  },
  dot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.4)',
    animation: 'dotPulse 1.4s infinite ease-in-out',
  },
  inputRow: {
    display: 'flex',
    gap: '8px',
    paddingTop: '10px',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  input: {
    flex: 1,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#ffffff',
    fontSize: '13px',
    padding: '10px 14px',
    fontFamily: 'inherit',
    outline: 'none',
  },
  sendBtn: {
    background: '#6366f1',
    border: 'none',
    borderRadius: '8px',
    color: '#ffffff',
    cursor: 'pointer',
    padding: '10px 12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'opacity 0.12s',
  },
  sendBtnDisabled: {
    opacity: 0.35,
    cursor: 'not-allowed',
  },
};
