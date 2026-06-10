import React, { useEffect, useRef, useState } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';
import { supabase } from '../../../supabaseClient';
import { listChat } from './api';

// Pulls the recent chat for a session + subscribes to inserts via
// Supabase Realtime. Only displays content (no twitch widget chrome).

export default function ChatReplay({ session }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef();

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await listChat(session.id);
        if (active) setMessages(res.messages || []);
      } catch { /* ignore */ }
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [session.id]);

  useEffect(() => {
    const channel = supabase
      .channel(`broadcast-chat-${session.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public',
        table: 'broadcast_chat_messages', filter: `session_id=eq.${session.id}`,
      }, (payload) => {
        if (payload && payload.new) {
          setMessages((prev) => [...prev.slice(-499), payload.new]);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session.id]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  return (
    <div style={styles.wrap}>
      <div style={styles.title}>Chat</div>
      <div ref={scrollRef} style={styles.list}>
        {loading ? <div style={styles.empty}>Loading…</div>
          : messages.length === 0 ? <div style={styles.empty}>No messages yet.</div>
          : messages.map((m) => (
            <div key={m.id} style={styles.row}>
              {m.profile_image_url && <img alt="" src={m.profile_image_url} width={20} height={20} style={styles.avatar} />}
              <span style={{ ...styles.user, color: m.color || colors.accentFg }}>{m.display_name || '(anon)'}</span>
              <span style={styles.content}>{m.content}</span>
              {m.message_type && m.message_type !== 'chat' && (
                <span style={styles.tag}>{m.message_type}</span>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}

const styles = {
  wrap: { display: 'flex', flexDirection: 'column', gap: spacing.xs, padding: spacing.md, overflow: 'hidden', flex: 1, minHeight: 0 },
  title: { fontSize: fontSizes.sm, fontWeight: fontWeights.semibold, color: colors.text },
  list: { flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 },
  empty: { padding: spacing.md, textAlign: 'center', color: colors.textSubtle, fontSize: fontSizes.xs },
  row: { display: 'flex', alignItems: 'center', gap: spacing.xs, padding: 4, background: colors.bgInput, borderRadius: radii.sm, fontSize: fontSizes.xs },
  avatar: { borderRadius: '50%' },
  user: { fontWeight: fontWeights.semibold, whiteSpace: 'nowrap' },
  content: { flex: 1, color: colors.text, wordBreak: 'break-word' },
  tag: { padding: '1px 6px', fontSize: fontSizes.xxs, color: colors.warning.fg, background: colors.warning.bg, border: `1px solid ${colors.warning.border}`, borderRadius: radii.pill, textTransform: 'uppercase', letterSpacing: '0.06em' },
};
