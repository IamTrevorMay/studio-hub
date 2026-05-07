import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import FullScreenSheet from '../components/mobile/FullScreenSheet';
import BottomSheet from '../components/mobile/BottomSheet';
import { mobileTokens, mobileTapButton } from '../utils/mobileTokens';

export default function MessagesMobile({ onNavigate }) {
  const { profile, refreshKey } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [activeConvo, setActiveConvo] = useState(null);
  const [loading, setLoading] = useState(true);

  const [showNewConvo, setShowNewConvo] = useState(false);
  const [teamMembers, setTeamMembers] = useState([]);
  const [searchUsers, setSearchUsers] = useState('');
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [groupName, setGroupName] = useState('');

  const fetchConversations = useCallback(async () => {
    if (!profile?.id) return;
    try {
      const { data: participantData, error: pError } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', profile.id);
      if (pError) throw pError;
      if (!participantData?.length) { setConversations([]); return; }

      const convoIds = participantData.map((p) => p.conversation_id);
      const { data: convos, error: cError } = await supabase
        .from('conversations')
        .select('*')
        .in('id', convoIds)
        .order('created_at', { ascending: false });
      if (cError) throw cError;

      const enriched = await Promise.all((convos || []).map(async (convo) => {
        const { data: participants } = await supabase
          .from('conversation_participants')
          .select('user_id, profile:profiles(id, full_name, title)')
          .eq('conversation_id', convo.id);
        const { data: lastMsg } = await supabase
          .from('direct_messages')
          .select('content, created_at, user_id')
          .eq('conversation_id', convo.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        return { ...convo, participants: participants || [], lastMessage: lastMsg };
      }));
      enriched.sort((a, b) => {
        const aTime = a.lastMessage?.created_at || a.created_at;
        const bTime = b.lastMessage?.created_at || b.created_at;
        return new Date(bTime) - new Date(aTime);
      });
      setConversations(enriched);
    } catch (err) {
      console.error('Messages fetch failed:', err);
    }
  }, [profile?.id]);

  const fetchTeamMembers = useCallback(async () => {
    if (!profile?.id) return;
    const { data } = await supabase.from('profiles').select('id, full_name, title').neq('id', profile.id);
    setTeamMembers(data || []);
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) return;
    Promise.all([fetchConversations(), fetchTeamMembers()]).finally(() => setLoading(false));
  }, [profile?.id, fetchConversations, fetchTeamMembers]);

  function convoName(convo) {
    if (!convo) return '';
    if (convo.name) return convo.name;
    const others = convo.participants?.filter((p) => p.user_id !== profile.id).map((p) => p.profile?.full_name || 'Unknown');
    return others?.join(', ') || 'Conversation';
  }

  function convoInitial(convo) {
    return convoName(convo).charAt(0).toUpperCase() || '?';
  }

  async function handleStartConversation() {
    if (selectedUsers.length === 0) return;
    try {
      if (selectedUsers.length === 1 && !groupName) {
        const { data, error } = await supabase.rpc('get_or_create_dm', { other_user_id: selectedUsers[0] });
        if (error) throw error;
        await fetchConversations();
        const { data: convo } = await supabase.from('conversations').select('*').eq('id', data).single();
        if (convo) {
          // Need to enrich participants for activeConvo's display name
          const { data: parts } = await supabase
            .from('conversation_participants')
            .select('user_id, profile:profiles(id, full_name, title)')
            .eq('conversation_id', convo.id);
          setActiveConvo({ ...convo, participants: parts || [] });
        }
      } else {
        const { data: convo, error } = await supabase
          .from('conversations')
          .insert({ name: groupName || null, is_group: selectedUsers.length > 1, created_by: profile.id })
          .select()
          .single();
        if (error) throw error;
        const participants = [profile.id, ...selectedUsers].map((uid) => ({ conversation_id: convo.id, user_id: uid }));
        await supabase.from('conversation_participants').insert(participants);
        await fetchConversations();
        const { data: parts } = await supabase
          .from('conversation_participants')
          .select('user_id, profile:profiles(id, full_name, title)')
          .eq('conversation_id', convo.id);
        setActiveConvo({ ...convo, participants: parts || [] });
      }
      setShowNewConvo(false);
      setSelectedUsers([]);
      setGroupName('');
      setSearchUsers('');
    } catch (err) {
      alert('Error: ' + err.message);
    }
  }

  const filteredTeam = teamMembers.filter((m) => (m.full_name || '').toLowerCase().includes(searchUsers.toLowerCase()));

  return (
    <div style={styles.root}>
      <div style={styles.toolbar}>
        <button onClick={() => setShowNewConvo(true)} style={styles.newBtn}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M9 4v10M4 9h10" strokeLinecap="round" />
          </svg>
          <span>New message</span>
        </button>
      </div>

      {loading ? (
        <p style={styles.empty}>Loading…</p>
      ) : conversations.length === 0 ? (
        <div style={styles.emptyCard}>
          <p style={styles.emptyTitle}>No messages yet</p>
          <p style={styles.emptyHint}>Tap "New message" to start a conversation.</p>
        </div>
      ) : (
        <div style={styles.threadList}>
          {conversations.map((convo) => (
            <button key={convo.id} onClick={() => setActiveConvo(convo)} style={styles.threadRow}>
              <div style={styles.threadAvatar}>{convoInitial(convo)}</div>
              <div style={styles.threadBody}>
                <div style={styles.threadHeader}>
                  <span style={styles.threadName}>{convoName(convo)}</span>
                  <span style={styles.threadTime}>{formatTime(convo.lastMessage?.created_at || convo.created_at)}</span>
                </div>
                <div style={styles.threadPreview}>
                  {convo.lastMessage?.content || <span style={{ color: 'rgba(255,255,255,0.3)' }}>No messages yet</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <FullScreenSheet
        open={!!activeConvo}
        onClose={() => setActiveConvo(null)}
        title={activeConvo ? convoName(activeConvo) : ''}
      >
        {activeConvo && (
          <ConversationView
            conversation={activeConvo}
            profileId={profile.id}
            refreshKey={refreshKey}
            onNavigate={onNavigate}
          />
        )}
      </FullScreenSheet>

      <BottomSheet
        open={showNewConvo}
        onClose={() => { setShowNewConvo(false); setSelectedUsers([]); setSearchUsers(''); setGroupName(''); }}
        title="New message"
        maxHeight="85vh"
      >
        <div style={styles.newPanel}>
          {selectedUsers.length > 1 && (
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Group name (optional)"
              style={styles.input}
            />
          )}
          <input
            value={searchUsers}
            onChange={(e) => setSearchUsers(e.target.value)}
            placeholder="Search people…"
            style={styles.input}
          />
          <div style={styles.userList}>
            {filteredTeam.map((m) => {
              const checked = selectedUsers.includes(m.id);
              return (
                <button
                  key={m.id}
                  onClick={() => setSelectedUsers((prev) => (checked ? prev.filter((x) => x !== m.id) : [...prev, m.id]))}
                  style={{ ...styles.userRow, background: checked ? 'rgba(99,102,241,0.12)' : 'transparent' }}
                >
                  <div style={styles.userAvatar}>{(m.full_name || '?').charAt(0).toUpperCase()}</div>
                  <div style={styles.userBody}>
                    <div style={styles.userName}>{m.full_name}</div>
                    {m.title && <div style={styles.userTitle}>{m.title}</div>}
                  </div>
                  <div style={{ ...styles.checkSlot, color: checked ? '#a5b4fc' : 'transparent' }}>
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M4 9l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </button>
              );
            })}
          </div>
          <button
            onClick={handleStartConversation}
            disabled={selectedUsers.length === 0}
            style={{ ...styles.primaryBtn, opacity: selectedUsers.length === 0 ? 0.4 : 1 }}
          >
            Start conversation
          </button>
        </div>
      </BottomSheet>
    </div>
  );
}

function ConversationView({ conversation, profileId, refreshKey, onNavigate }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const endRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data } = await supabase
        .from('direct_messages')
        .select('*, profile:profiles(id, full_name, title)')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: true })
        .limit(100);
      if (!cancelled) {
        setMessages(data || []);
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [conversation.id]);

  useEffect(() => {
    const channel = supabase
      .channel(`dm-${conversation.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'direct_messages',
        filter: `conversation_id=eq.${conversation.id}`,
      }, async (payload) => {
        const { data } = await supabase
          .from('direct_messages')
          .select('*, profile:profiles(id, full_name, title)')
          .eq('id', payload.new.id)
          .single();
        if (data) setMessages((prev) => [...prev, data]);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [conversation.id, refreshKey]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function send(e) {
    e.preventDefault();
    if (!text.trim()) return;
    const content = text.trim();
    setText('');
    await supabase.from('direct_messages').insert({
      conversation_id: conversation.id,
      user_id: profileId,
      content,
    });
  }

  function renderContent(content) {
    const parts = content.split(/(#\w+(?:-\w+)*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('#')) {
        const chName = part.slice(1);
        return (
          <span key={i} style={convoStyles.channelLink} onClick={() => onNavigate && onNavigate('channels', chName)}>
            {part}
          </span>
        );
      }
      return part;
    });
  }

  return (
    <div style={convoStyles.root}>
      <div style={convoStyles.scroll}>
        {loading ? (
          <p style={styles.empty}>Loading…</p>
        ) : messages.length === 0 ? (
          <p style={styles.empty}>Say hi 👋</p>
        ) : (
          messages.map((m) => {
            const mine = m.user_id === profileId;
            return (
              <div key={m.id} style={{ ...convoStyles.bubbleRow, justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  ...convoStyles.bubble,
                  background: mine ? 'linear-gradient(135deg, #6366f1, #818cf8)' : 'rgba(255,255,255,0.06)',
                  color: mine ? '#fff' : '#e2e8f0',
                  borderBottomRightRadius: mine ? 4 : mobileTokens.radius.lg,
                  borderBottomLeftRadius: mine ? mobileTokens.radius.lg : 4,
                }}>
                  {!mine && <div style={convoStyles.bubbleSender}>{m.profile?.full_name || 'Unknown'}</div>}
                  <div>{renderContent(m.content)}</div>
                  <div style={{ ...convoStyles.bubbleTime, color: mine ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.4)' }}>
                    {formatTime(m.created_at)}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>
      <form onSubmit={send} style={{ ...convoStyles.composer, paddingBottom: `calc(${mobileTokens.space.md}px + ${mobileTokens.safeBottom})` }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message…"
          style={convoStyles.input}
        />
        <button type="submit" disabled={!text.trim()} style={{ ...convoStyles.sendBtn, opacity: text.trim() ? 1 : 0.4 }} aria-label="Send">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <path d="M2 10l16-7-7 16-2-7-7-2z" />
          </svg>
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
  root: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100%',
    background: '#0f0f1a',
    color: '#e2e8f0',
  },
  toolbar: {
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.lg}px`,
    display: 'flex',
    justifyContent: 'flex-end',
  },
  newBtn: {
    ...mobileTapButton,
    minHeight: 36,
    padding: `0 ${mobileTokens.space.md}px`,
    borderRadius: mobileTokens.radius.pill,
    background: 'rgba(99,102,241,0.14)',
    color: '#a5b4fc',
    fontSize: mobileTokens.font.sm,
    fontWeight: 600,
    gap: mobileTokens.space.sm,
    flexDirection: 'row',
  },
  threadList: {
    display: 'flex',
    flexDirection: 'column',
  },
  threadRow: {
    ...mobileTapButton,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    gap: mobileTokens.space.md,
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.lg}px`,
    background: 'transparent',
    color: '#e2e8f0',
    textAlign: 'left',
    borderTop: '1px solid rgba(255,255,255,0.04)',
  },
  threadAvatar: {
    width: 44,
    height: 44,
    borderRadius: mobileTokens.radius.md,
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: mobileTokens.font.lg,
    fontWeight: 700,
    flexShrink: 0,
  },
  threadBody: {
    flex: 1,
    minWidth: 0,
  },
  threadHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: mobileTokens.space.sm,
  },
  threadName: {
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    color: '#fff',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  threadTime: {
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.4)',
    flexShrink: 0,
  },
  threadPreview: {
    fontSize: mobileTokens.font.sm,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  empty: {
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    fontSize: mobileTokens.font.md,
    margin: 0,
    padding: mobileTokens.space.xxl,
  },
  emptyCard: {
    margin: mobileTokens.space.lg,
    padding: mobileTokens.space.xl,
    background: 'rgba(255,255,255,0.04)',
    borderRadius: mobileTokens.radius.lg,
    textAlign: 'center',
  },
  emptyTitle: {
    fontSize: mobileTokens.font.lg,
    fontWeight: 600,
    color: '#fff',
    margin: 0,
  },
  emptyHint: {
    fontSize: mobileTokens.font.sm,
    color: 'rgba(255,255,255,0.5)',
    margin: `${mobileTokens.space.sm}px 0 0`,
  },
  newPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.md,
  },
  input: {
    height: mobileTokens.tap,
    padding: `0 ${mobileTokens.space.md}px`,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: mobileTokens.radius.md,
    color: '#fff',
    fontSize: mobileTokens.font.base,
    outline: 'none',
    fontFamily: 'inherit',
  },
  userList: {
    display: 'flex',
    flexDirection: 'column',
    maxHeight: '50vh',
    overflowY: 'auto',
    gap: 2,
  },
  userRow: {
    ...mobileTapButton,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: mobileTokens.space.md,
    padding: mobileTokens.space.md,
    borderRadius: mobileTokens.radius.md,
    color: '#e2e8f0',
    textAlign: 'left',
  },
  userAvatar: {
    width: 36,
    height: 36,
    borderRadius: mobileTokens.radius.sm,
    background: 'rgba(99,102,241,0.2)',
    color: '#a5b4fc',
    fontSize: mobileTokens.font.md,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  userBody: {
    flex: 1,
    minWidth: 0,
  },
  userName: {
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    color: '#e2e8f0',
  },
  userTitle: {
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.4)',
  },
  checkSlot: {
    width: 22,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtn: {
    minHeight: mobileTokens.tap + 4,
    padding: `${mobileTokens.space.md}px`,
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    border: 'none',
    borderRadius: mobileTokens.radius.md,
    color: '#fff',
    fontSize: mobileTokens.font.base,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    marginTop: mobileTokens.space.sm,
  },
};

const convoStyles = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    margin: -mobileTokens.space.lg,
  },
  scroll: {
    flex: 1,
    overflowY: 'auto',
    padding: mobileTokens.space.lg,
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.sm,
    WebkitOverflowScrolling: 'touch',
  },
  bubbleRow: {
    display: 'flex',
    width: '100%',
  },
  bubble: {
    maxWidth: '78%',
    padding: `${mobileTokens.space.sm}px ${mobileTokens.space.md}px`,
    borderRadius: mobileTokens.radius.lg,
    fontSize: mobileTokens.font.md,
    lineHeight: 1.4,
    wordBreak: 'break-word',
    fontFamily: 'inherit',
  },
  bubbleSender: {
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.6)',
    marginBottom: 2,
    fontWeight: 600,
  },
  bubbleTime: {
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
  channelLink: {
    color: '#a5b4fc',
    fontWeight: 600,
    cursor: 'pointer',
  },
};
