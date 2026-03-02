import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';

export default function Messages({ onNavigate }) {
  const { profile } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [activeConversation, setActiveConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [teamMembers, setTeamMembers] = useState([]);
  const [showNewConvo, setShowNewConvo] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [groupName, setGroupName] = useState('');
  const [searchUsers, setSearchUsers] = useState('');
  const messagesEndRef = useRef(null);
  const [loadingMessages, setLoadingMessages] = useState(false);

  useEffect(() => {
    if (!profile?.id) return;
    fetchConversations();
    fetchTeamMembers();
  }, [profile?.id]);

  const fetchMessages = useCallback(async (conversationId) => {
    setLoadingMessages(true);
    try {
      const { data, error } = await supabase
        .from('direct_messages')
        .select('*, profile:profiles(id, full_name, title)')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(100);
      if (error) throw error;
      setMessages(data || []);
    } catch (err) {
      console.error('Error:', err);
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    if (!activeConversation) return;
    fetchMessages(activeConversation.id);

    const channel = supabase
      .channel(`dm-${activeConversation.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'direct_messages',
        filter: `conversation_id=eq.${activeConversation.id}`,
      }, async (payload) => {
        const { data } = await supabase
          .from('direct_messages')
          .select('*, profile:profiles(id, full_name, title)')
          .eq('id', payload.new.id)
          .single();
        if (data) setMessages(prev => [...prev, data]);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [activeConversation, fetchMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function fetchConversations() {
    if (!profile?.id) return;
    try {
      // Get conversations the user is part of
      const { data: participantData, error: pError } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', profile.id);

      if (pError) throw pError;
      if (!participantData?.length) return;

      const convoIds = participantData.map(p => p.conversation_id);

      const { data: convos, error: cError } = await supabase
        .from('conversations')
        .select('*')
        .in('id', convoIds)
        .order('created_at', { ascending: false });

      if (cError) throw cError;

      // Fetch participants for each conversation
      const enriched = await Promise.all((convos || []).map(async (convo) => {
        const { data: participants } = await supabase
          .from('conversation_participants')
          .select('user_id, profile:profiles(id, full_name, title)')
          .eq('conversation_id', convo.id);

        // Get last message
        const { data: lastMsg } = await supabase
          .from('direct_messages')
          .select('content, created_at, user_id')
          .eq('conversation_id', convo.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        return {
          ...convo,
          participants: participants || [],
          lastMessage: lastMsg,
        };
      }));

      // Sort by last message time
      enriched.sort((a, b) => {
        const aTime = a.lastMessage?.created_at || a.created_at;
        const bTime = b.lastMessage?.created_at || b.created_at;
        return new Date(bTime) - new Date(aTime);
      });

      setConversations(enriched);
    } catch (err) {
      console.error('Error:', err);
    }
  }

  async function fetchTeamMembers() {
    if (!profile?.id) return;
    try {
      const { data } = await supabase.from('profiles').select('id, full_name, title')
        .neq('id', profile.id);
      setTeamMembers(data || []);
    } catch (err) {
      console.error('Error fetching team:', err);
    }
  }

  async function handleSendMessage(e) {
    e.preventDefault();
    if (!newMessage.trim() || !activeConversation || !profile?.id) return;

    await supabase.from('direct_messages').insert({
      conversation_id: activeConversation.id,
      user_id: profile.id,
      content: newMessage.trim(),
    });
    setNewMessage('');
  }

  async function handleStartConversation() {
    if (selectedUsers.length === 0) return;

    try {
      if (selectedUsers.length === 1 && !groupName) {
        // DM: use get_or_create_dm function
        const { data, error } = await supabase.rpc('get_or_create_dm', {
          other_user_id: selectedUsers[0],
        });
        if (error) throw error;

        // Find or fetch the conversation
        await fetchConversations();
        const { data: convo } = await supabase.from('conversations')
          .select('*').eq('id', data).single();
        if (convo) setActiveConversation(convo);
      } else {
        // Group conversation
        const { data: convo, error } = await supabase
          .from('conversations')
          .insert({
            name: groupName || null,
            is_group: selectedUsers.length > 1,
            created_by: profile.id,
          })
          .select()
          .single();

        if (error) throw error;

        // Add all participants
        const participants = [profile.id, ...selectedUsers].map(uid => ({
          conversation_id: convo.id,
          user_id: uid,
        }));
        await supabase.from('conversation_participants').insert(participants);

        await fetchConversations();
        setActiveConversation(convo);
      }

      setShowNewConvo(false);
      setSelectedUsers([]);
      setGroupName('');
    } catch (err) {
      console.error('Error creating conversation:', err);
      alert('Error: ' + err.message);
    }
  }

  function getConvoDisplayName(convo) {
    if (convo.name) return convo.name;
    const others = convo.participants
      ?.filter(p => p.user_id !== profile.id)
      .map(p => p.profile?.full_name || 'Unknown');
    return others?.join(', ') || 'Conversation';
  }

  function getConvoInitial(convo) {
    const name = getConvoDisplayName(convo);
    return name.charAt(0).toUpperCase();
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

  function toggleUserSelection(userId) {
    setSelectedUsers(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  }

  const filteredTeam = teamMembers.filter(m =>
    m.full_name.toLowerCase().includes(searchUsers.toLowerCase())
  );

  function formatMessageContent(content) {
    const parts = content.split(/(#\w+(?:-\w+)*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('#')) {
        const chName = part.slice(1);
        return (
          <span
            key={i}
            style={styles.channelLink}
            onClick={() => onNavigate && onNavigate('channels', chName)}
          >
            {part}
          </span>
        );
      }
      return part;
    });
  }

  return (
    <div style={styles.page}>
      {/* Conversations Sidebar */}
      <div style={styles.sidebar}>
        <div style={styles.sidebarHeader}>
          <h3 style={styles.sidebarTitle}>Messages</h3>
          <button onClick={() => setShowNewConvo(!showNewConvo)} style={styles.newBtn}>
            {showNewConvo ? '✕' : '+'}
          </button>
        </div>

        {showNewConvo && (
          <div style={styles.newConvoPanel}>
            <input
              value={searchUsers}
              onChange={(e) => setSearchUsers(e.target.value)}
              placeholder="Search people..."
              style={styles.searchInput}
            />
            {selectedUsers.length > 1 && (
              <input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Group name (optional)"
                style={styles.searchInput}
              />
            )}
            <div style={styles.userList}>
              {filteredTeam.map(m => (
                <button
                  key={m.id}
                  onClick={() => toggleUserSelection(m.id)}
                  style={{
                    ...styles.userItem,
                    ...(selectedUsers.includes(m.id) ? styles.userItemSelected : {}),
                  }}
                >
                  <div style={styles.userAvatar}>{m.full_name.charAt(0)}</div>
                  <div style={{ flex: 1 }}>
                    <div style={styles.userItemName}>{m.full_name}</div>
                    <div style={styles.userItemTitle}>{m.title || 'Team Member'}</div>
                  </div>
                  {selectedUsers.includes(m.id) && <span style={styles.checkMark}>✓</span>}
                </button>
              ))}
            </div>
            {selectedUsers.length > 0 && (
              <button onClick={handleStartConversation} style={styles.startBtn}>
                {selectedUsers.length === 1 ? 'Start DM' : `Start Group (${selectedUsers.length})`}
              </button>
            )}
          </div>
        )}

        <div style={styles.convoList}>
          {conversations.map(convo => (
            <button
              key={convo.id}
              onClick={() => setActiveConversation(convo)}
              style={{
                ...styles.convoItem,
                ...(activeConversation?.id === convo.id ? styles.convoItemActive : {}),
              }}
            >
              <div style={styles.convoAvatar}>
                {convo.is_group ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
                  </svg>
                ) : getConvoInitial(convo)
                }
              </div>
              <div style={styles.convoInfo}>
                <div style={styles.convoName}>{getConvoDisplayName(convo)}</div>
                {convo.lastMessage && (
                  <div style={styles.convoLastMsg}>
                    {convo.lastMessage.content.substring(0, 40)}
                    {convo.lastMessage.content.length > 40 ? '...' : ''}
                  </div>
                )}
              </div>
              {convo.lastMessage && (
                <span style={styles.convoTime}>{formatTime(convo.lastMessage.created_at)}</span>
              )}
            </button>
          ))}

          {conversations.length === 0 && !showNewConvo && (
            <div style={styles.emptyConvos}>
              <p style={styles.emptyText}>No conversations yet.</p>
              <p style={styles.emptySubtext}>Click + to start a conversation</p>
            </div>
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div style={styles.chatArea}>
        {activeConversation ? (
          <>
            <div style={styles.chatHeader}>
              <div style={styles.chatHeaderAvatar}>
                {activeConversation.is_group ? '👥' : getConvoInitial(activeConversation)}
              </div>
              <h2 style={styles.chatHeaderName}>{getConvoDisplayName(activeConversation)}</h2>
            </div>

            <div style={styles.messagesArea}>
              {loadingMessages ? (
                <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.35)', paddingTop: '40px' }}>Loading...</p>
              ) : messages.length === 0 ? (
                <div style={styles.emptyChat}>
                  <p>Start the conversation!</p>
                </div>
              ) : (
                messages.map((msg, i) => {
                  const isOwn = msg.user_id === profile.id;
                  const showAvatar = i === 0 || messages[i - 1].user_id !== msg.user_id;
                  return (
                    <div key={msg.id} style={{
                      ...styles.msgRow,
                      justifyContent: isOwn ? 'flex-end' : 'flex-start',
                    }}>
                      {!isOwn && showAvatar && (
                        <div style={styles.msgAvatar}>{msg.profile?.full_name?.charAt(0)}</div>
                      )}
                      {!isOwn && !showAvatar && <div style={{ width: '32px' }} />}
                      <div style={{
                        ...styles.msgBubble,
                        background: isOwn ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.05)',
                        borderColor: isOwn ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.06)',
                      }}>
                        {showAvatar && !isOwn && (
                          <div style={styles.msgSender}>{msg.profile?.full_name}</div>
                        )}
                        <div style={styles.msgContent}>{formatMessageContent(msg.content)}</div>
                        <div style={styles.msgTime}>{formatTime(msg.created_at)}</div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSendMessage} style={styles.inputForm}>
              <input
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Type a message..."
                style={styles.messageInput}
              />
              <button type="submit" style={styles.sendBtn} disabled={!newMessage.trim()}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
                </svg>
              </button>
            </form>
          </>
        ) : (
          <div style={styles.noChat}>
            <div style={styles.noChatIcon}>💬</div>
            <h3 style={styles.noChatTitle}>Your Messages</h3>
            <p style={styles.noChatSubtitle}>Select a conversation or start a new one</p>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  page: { display: 'flex', height: '100%' },
  sidebar: {
    width: '320px', minWidth: '320px',
    borderRight: '1px solid rgba(255,255,255,0.06)',
    display: 'flex', flexDirection: 'column',
    background: 'rgba(255,255,255,0.01)',
  },
  sidebarHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 16px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  sidebarTitle: {
    fontSize: '16px', fontWeight: 700, color: '#e2e8f0', margin: 0,
  },
  newBtn: {
    width: '28px', height: '28px', display: 'flex', alignItems: 'center',
    justifyContent: 'center', border: 'none', borderRadius: '8px',
    background: 'rgba(99,102,241,0.15)', color: '#a5b4fc',
    fontSize: '16px', cursor: 'pointer',
  },
  newConvoPanel: {
    padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.06)',
    display: 'flex', flexDirection: 'column', gap: '8px',
  },
  searchInput: {
    padding: '8px 12px', background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px',
    color: '#fff', fontSize: '13px', fontFamily: 'inherit', outline: 'none',
  },
  userList: { maxHeight: '200px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' },
  userItem: {
    display: 'flex', alignItems: 'center', gap: '10px',
    width: '100%', padding: '8px', border: 'none', borderRadius: '8px',
    background: 'transparent', color: '#e2e8f0', cursor: 'pointer',
    fontFamily: 'inherit', textAlign: 'left', transition: 'background 0.1s',
  },
  userItemSelected: { background: 'rgba(99,102,241,0.12)' },
  userAvatar: {
    width: '32px', height: '32px', borderRadius: '8px',
    background: 'rgba(99,102,241,0.2)', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    fontSize: '13px', fontWeight: 600, color: '#a5b4fc', flexShrink: 0,
  },
  userItemName: { fontSize: '13px', fontWeight: 600 },
  userItemTitle: { fontSize: '11px', color: 'rgba(255,255,255,0.35)' },
  checkMark: { color: '#6366f1', fontWeight: 700, fontSize: '14px' },
  startBtn: {
    padding: '9px', background: '#6366f1', border: 'none', borderRadius: '8px',
    color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  },
  convoList: { flex: 1, overflow: 'auto', padding: '6px' },
  convoItem: {
    display: 'flex', alignItems: 'center', gap: '12px',
    width: '100%', padding: '10px 12px', border: 'none', borderRadius: '10px',
    background: 'transparent', color: '#e2e8f0', cursor: 'pointer',
    fontFamily: 'inherit', textAlign: 'left', transition: 'background 0.1s',
    marginBottom: '2px',
  },
  convoItemActive: { background: 'rgba(99,102,241,0.1)' },
  convoAvatar: {
    width: '40px', height: '40px', borderRadius: '10px',
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '16px', fontWeight: 700, color: '#fff', flexShrink: 0,
  },
  convoInfo: { flex: 1, minWidth: 0 },
  convoName: {
    fontSize: '14px', fontWeight: 600, color: '#e2e8f0',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  convoLastMsg: {
    fontSize: '12px', color: 'rgba(255,255,255,0.35)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    marginTop: '2px',
  },
  convoTime: { fontSize: '11px', color: 'rgba(255,255,255,0.25)', flexShrink: 0 },
  emptyConvos: { textAlign: 'center', padding: '40px 20px' },
  emptyText: { color: 'rgba(255,255,255,0.4)', fontSize: '14px', margin: '0 0 4px 0' },
  emptySubtext: { color: 'rgba(255,255,255,0.25)', fontSize: '12px', margin: 0 },
  chatArea: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 },
  chatHeader: {
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '14px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0,
  },
  chatHeaderAvatar: {
    width: '36px', height: '36px', borderRadius: '10px',
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '16px', fontWeight: 700, color: '#fff',
  },
  chatHeaderName: { fontSize: '16px', fontWeight: 600, color: '#e2e8f0', margin: 0 },
  messagesArea: { flex: 1, overflow: 'auto', padding: '16px 24px' },
  emptyChat: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: '100%', color: 'rgba(255,255,255,0.35)',
  },
  msgRow: {
    display: 'flex', gap: '8px', marginBottom: '6px', alignItems: 'flex-end',
  },
  msgAvatar: {
    width: '32px', height: '32px', borderRadius: '8px',
    background: 'rgba(99,102,241,0.2)', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    fontSize: '12px', fontWeight: 600, color: '#a5b4fc', flexShrink: 0,
  },
  msgBubble: {
    maxWidth: '65%', padding: '10px 14px',
    borderRadius: '12px', border: '1px solid',
  },
  msgSender: {
    fontSize: '12px', fontWeight: 600, color: '#a5b4fc', marginBottom: '2px',
  },
  msgContent: {
    fontSize: '14px', color: '#e2e8f0', lineHeight: 1.5, wordBreak: 'break-word',
  },
  msgTime: {
    fontSize: '10px', color: 'rgba(255,255,255,0.2)', marginTop: '4px',
  },
  inputForm: {
    display: 'flex', gap: '8px', padding: '12px 24px 16px', flexShrink: 0,
  },
  messageInput: {
    flex: 1, padding: '12px 16px', background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px',
    color: '#fff', fontSize: '14px', fontFamily: 'inherit', outline: 'none',
  },
  sendBtn: {
    width: '42px', height: '42px', display: 'flex', alignItems: 'center',
    justifyContent: 'center', background: '#6366f1', border: 'none',
    borderRadius: '10px', color: '#fff', cursor: 'pointer',
  },
  noChat: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', height: '100%', textAlign: 'center',
  },
  noChatIcon: { fontSize: '48px', marginBottom: '12px' },
  noChatTitle: { fontSize: '18px', fontWeight: 600, color: '#e2e8f0', margin: '0 0 6px 0' },
  noChatSubtitle: { fontSize: '14px', color: 'rgba(255,255,255,0.35)', margin: 0 },
  channelLink: {
    background: 'rgba(99,102,241,0.15)', color: '#a5b4fc',
    padding: '1px 4px', borderRadius: '4px', fontWeight: 600,
    cursor: 'pointer',
  },
};
