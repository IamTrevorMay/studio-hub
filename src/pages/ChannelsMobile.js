import React, { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationContext';
import FullScreenSheet from '../components/mobile/FullScreenSheet';
import { mobileTokens, mobileTapButton } from '../utils/mobileTokens';
import { getDisplayName } from '../lib/displayName';

// Note: "Channels" here is the Slack-style team-chat channel list, not platform
// analytics channels. Mobile mirrors the desktop chat UX, slimmed: list of channels
// with last-message preview, tap to enter, sticky composer, realtime new messages.
// Pin / edit / delete / channel-management stays desktop-only.

export default function ChannelsMobile({ initialChannelName, onChannelOpened }) {
  const { profile, refreshKey } = useAuth();
  const { unreadMentionChannelIds, markChannelSeen } = useNotifications();
  const [channels, setChannels] = useState([]);
  const [activeChannel, setActiveChannel] = useState(null);
  const [lastMessages, setLastMessages] = useState({}); // channelId -> { content, created_at }
  const [loading, setLoading] = useState(true);
  const [teamMembers, setTeamMembers] = useState([]);

  const fetchChannels = useCallback(async () => {
    const { data } = await supabase.from('channels')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('is_default', { ascending: false })
      .order('name');
    setChannels(data || []);

    if (data?.length) {
      const ids = data.map((c) => c.id);
      // last messages — fetch individually (small overhead, simpler than RPC)
      const last = {};
      await Promise.all(ids.map(async (id) => {
        const { data: msg } = await supabase
          .from('channel_messages')
          .select('content, created_at')
          .eq('channel_id', id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (msg) last[id] = msg;
      }));
      setLastMessages(last);
    }
  }, []);

  const fetchTeam = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('id, full_name, nickname, title');
    setTeamMembers(data || []);
  }, []);

  useEffect(() => {
    if (!profile?.id) return;
    Promise.all([fetchChannels(), fetchTeam()]).finally(() => setLoading(false));
  }, [profile?.id, fetchChannels, fetchTeam]);

  useEffect(() => {
    if (!initialChannelName || channels.length === 0) return;
    const match = channels.find((c) => c.name.toLowerCase() === initialChannelName.toLowerCase());
    if (match) {
      setActiveChannel(match);
      markChannelSeen(match.id);
    }
    if (onChannelOpened) onChannelOpened();
  }, [initialChannelName, channels, markChannelSeen, onChannelOpened]);

  function openChannel(ch) {
    setActiveChannel(ch);
    markChannelSeen(ch.id);
  }

  if (loading) return <p style={styles.empty}>Loading…</p>;
  if (channels.length === 0) return <p style={styles.empty}>No channels yet.</p>;

  return (
    <div style={styles.root}>
      <ul style={styles.list}>
        {channels.map((ch) => {
          const last = lastMessages[ch.id];
          const hasMention = unreadMentionChannelIds.includes(ch.id);
          return (
            <li key={ch.id}>
              <button onClick={() => openChannel(ch)} style={styles.row}>
                <div style={{ ...styles.icon, color: hasMention ? '#fcd34d' : '#a5b4fc' }}>#</div>
                <div style={styles.body}>
                  <div style={styles.header}>
                    <span style={styles.name}>{ch.name}</span>
                    {last?.created_at && (
                      <span style={styles.time}>{formatTime(last.created_at)}</span>
                    )}
                  </div>
                  <div style={styles.preview}>
                    {last?.content || ch.description || (
                      <span style={{ color: 'rgba(255,255,255,0.3)' }}>No messages yet</span>
                    )}
                  </div>
                </div>
                {hasMention && <div style={styles.mentionDot} />}
              </button>
            </li>
          );
        })}
      </ul>

      <FullScreenSheet
        open={!!activeChannel}
        onClose={() => setActiveChannel(null)}
        title={activeChannel ? `# ${activeChannel.name}` : ''}
      >
        {activeChannel && (
          <ChannelView
            channel={activeChannel}
            profileId={profile.id}
            teamMembers={teamMembers}
            refreshKey={refreshKey}
          />
        )}
      </FullScreenSheet>
    </div>
  );
}

function ChannelView({ channel, profileId, teamMembers, refreshKey }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const sendingRef = useRef(false);
  const endRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data } = await supabase
        .from('channel_messages')
        .select('*, profile:profiles(id, full_name, nickname, title)')
        .eq('channel_id', channel.id)
        .order('created_at', { ascending: true })
        .limit(100);
      if (!cancelled) {
        setMessages(data || []);
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [channel.id]);

  useEffect(() => {
    const sub = supabase
      .channel(`channel-${channel.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'channel_messages',
        filter: `channel_id=eq.${channel.id}`,
      }, async (payload) => {
        const { data } = await supabase
          .from('channel_messages')
          .select('*, profile:profiles(id, full_name, nickname, title)')
          .eq('id', payload.new.id)
          .single();
        // Dedup by id — a reconnect/resubscribe can redeliver the same row.
        if (data) setMessages((prev) => prev.some((m) => m.id === data.id) ? prev : [...prev, data]);
      })
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [channel.id, refreshKey]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function send(e) {
    e.preventDefault();
    if (!text.trim() || sendingRef.current) return; // guard double-submit (Enter + tap)
    sendingRef.current = true;
    const content = text.trim();
    setText('');
    // Detect @mentions in the message
    const mentionRegex = /@(\w+(?:\s\w+)?)/g;
    const mentions = [];
    let match;
    while ((match = mentionRegex.exec(content)) !== null) {
      const needle = match[1].toLowerCase();
      const member = teamMembers.find((m) =>
        (m.nickname || '').toLowerCase().includes(needle) || (m.full_name || '').toLowerCase().includes(needle)
      );
      if (member) mentions.push(member.id);
    }
    try {
      await supabase.from('channel_messages').insert({
        channel_id: channel.id,
        user_id: profileId,
        content,
        mentions,
      });
    } finally {
      sendingRef.current = false;
    }
  }

  return (
    <div style={chatStyles.root}>
      <div style={chatStyles.scroll}>
        {loading ? (
          <p style={styles.empty}>Loading…</p>
        ) : messages.length === 0 ? (
          <p style={styles.empty}>No messages yet — say hi!</p>
        ) : (
          messages.map((m) => {
            const mine = m.user_id === profileId;
            return (
              <div key={m.id} style={{ ...chatStyles.bubbleRow, justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  ...chatStyles.bubble,
                  background: mine ? 'linear-gradient(135deg, #6366f1, #818cf8)' : 'rgba(255,255,255,0.06)',
                  color: mine ? '#fff' : '#e2e8f0',
                  borderBottomRightRadius: mine ? 4 : mobileTokens.radius.lg,
                  borderBottomLeftRadius: mine ? mobileTokens.radius.lg : 4,
                }}>
                  {!mine && <div style={chatStyles.sender}>{getDisplayName(m.profile) || 'Unknown'}</div>}
                  <div>{m.content}</div>
                  <div style={{ ...chatStyles.time, color: mine ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.4)' }}>
                    {formatTime(m.created_at)}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>
      <form onSubmit={send} style={{ ...chatStyles.composer, paddingBottom: `calc(${mobileTokens.space.md}px + ${mobileTokens.safeBottom})` }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Message #${channel.name}`} style={chatStyles.input} />
        <button type="submit" disabled={!text.trim()} style={{ ...chatStyles.sendBtn, opacity: text.trim() ? 1 : 0.4 }} aria-label="Send">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M2 10l16-7-7 16-2-7-7-2z" /></svg>
        </button>
      </form>
    </div>
  );
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const styles = {
  root: { minHeight: '100%', background: '#0f0f1a', color: '#e2e8f0' },
  list: { listStyle: 'none', margin: 0, padding: 0 },
  row: {
    ...mobileTapButton,
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    gap: mobileTokens.space.md,
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.lg}px`,
    background: 'transparent',
    color: '#e2e8f0',
    textAlign: 'left',
    borderTop: '1px solid rgba(255,255,255,0.04)',
    minHeight: mobileTokens.tap + 16,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: mobileTokens.radius.sm,
    background: 'rgba(99,102,241,0.12)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: mobileTokens.font.lg,
    fontWeight: 700,
    flexShrink: 0,
  },
  body: { flex: 1, minWidth: 0 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: mobileTokens.space.sm },
  name: { fontSize: mobileTokens.font.md, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  time: { fontSize: mobileTokens.font.xs, color: 'rgba(255,255,255,0.4)', flexShrink: 0 },
  preview: {
    fontSize: mobileTokens.font.sm,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  mentionDot: {
    width: 8, height: 8, borderRadius: '50%', background: '#fcd34d', flexShrink: 0,
  },
  empty: {
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    fontSize: mobileTokens.font.md,
    padding: mobileTokens.space.xxl,
    margin: 0,
  },
};

const chatStyles = {
  root: { display: 'flex', flexDirection: 'column', height: '100%', margin: -mobileTokens.space.lg },
  scroll: {
    flex: 1,
    overflowY: 'auto',
    padding: mobileTokens.space.lg,
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.sm,
    WebkitOverflowScrolling: 'touch',
  },
  bubbleRow: { display: 'flex', width: '100%' },
  bubble: {
    maxWidth: '78%',
    padding: `${mobileTokens.space.sm}px ${mobileTokens.space.md}px`,
    borderRadius: mobileTokens.radius.lg,
    fontSize: mobileTokens.font.md,
    lineHeight: 1.4,
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
  },
  sender: {
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: 600,
    marginBottom: 2,
  },
  time: {
    fontSize: mobileTokens.font.xs,
    marginTop: 4,
  },
  composer: {
    display: 'flex',
    gap: mobileTokens.space.sm,
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.lg}px`,
    background: 'rgba(15,15,30,0.96)',
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  input: {
    flex: 1,
    minHeight: mobileTokens.tap,
    padding: `${mobileTokens.space.sm}px ${mobileTokens.space.md}px`,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: mobileTokens.radius.pill,
    color: '#fff',
    fontSize: mobileTokens.font.base,
    outline: 'none',
    fontFamily: 'inherit',
  },
  sendBtn: {
    width: mobileTokens.tap,
    height: mobileTokens.tap,
    border: 'none',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    color: '#fff',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'inherit',
    flexShrink: 0,
  },
};
