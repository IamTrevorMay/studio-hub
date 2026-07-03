import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import { getDisplayName, getDisplayInitial } from '../lib/displayName';
import { useConfirm } from '../contexts/ConfirmContext';


function applyFormatMarker(textareaRef, text, marker, setter) {
  const el = textareaRef.current;
  if (!el) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const selected = text.substring(start, end);
  if (selected) {
    const newText = text.substring(0, start) + marker + selected + marker + text.substring(end);
    setter(newText);
    requestAnimationFrame(() => {
      el.selectionStart = start + marker.length;
      el.selectionEnd = end + marker.length;
      el.focus();
    });
  } else {
    const newText = text.substring(0, start) + marker + marker + text.substring(end);
    setter(newText);
    requestAnimationFrame(() => {
      el.selectionStart = start + marker.length;
      el.selectionEnd = start + marker.length;
      el.focus();
    });
  }
}

export default function Messages({ onNavigate }) {
  const { profile, refreshKey } = useAuth();
  const confirm = useConfirm();
  const { fetchUnreadDms } = useNotifications();
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
  const inputRef = useRef(null);
  const sendingRef = useRef(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loading, setLoading] = useState(true);
  const [contextMenu, setContextMenu] = useState(null); // { convo, x, y }
  const [renamingConvo, setRenamingConvo] = useState(null); // convo being renamed
  const [renameValue, setRenameValue] = useState('');

  const fetchConversations = useCallback(async () => {
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
          .select('user_id, profile:profiles(id, full_name, nickname, title)')
          .eq('conversation_id', convo.id);

        // Get last message
        const { data: lastMsg } = await supabase
          .from('direct_messages')
          .select('content, created_at, user_id')
          .eq('conversation_id', convo.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(); // empty conversations would 406/PGRST116 with .single()

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
  }, [profile?.id]);

  const fetchTeamMembers = useCallback(async () => {
    if (!profile?.id) return;
    try {
      const { data } = await supabase.from('profiles').select('id, full_name, nickname, title')
        .neq('id', profile.id);
      setTeamMembers(data || []);
    } catch (err) {
      console.error('Error fetching team:', err);
    }
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) return;
    Promise.all([fetchConversations(), fetchTeamMembers()])
      .finally(() => setLoading(false));
  }, [profile?.id, fetchConversations, fetchTeamMembers]);
  useVisibilityRefresh(useCallback(() => {
    if (profile?.id) fetchConversations();
  }, [profile?.id, fetchConversations]));

  const fetchMessages = useCallback(async (conversationId) => {
    setLoadingMessages(true);
    try {
      // Newest 100 then reverse — ascending+limit returned the OLDEST 100 and
      // hid the live conversation once a thread passed 100 messages.
      const { data, error } = await supabase
        .from('direct_messages')
        .select('*, profile:profiles(id, full_name, nickname, title)')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      setMessages((data || []).slice().reverse());
    } catch (err) {
      console.error('Error:', err);
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  const markConversationRead = useCallback(async (conversationId) => {
    if (!profile?.id || !conversationId) return;
    try {
      const { error } = await supabase
        .from('conversation_participants')
        .update({ last_read_at: new Date().toISOString() })
        .eq('conversation_id', conversationId)
        .eq('user_id', profile.id);
      if (error) throw error;
      fetchUnreadDms();
    } catch (err) {
      console.error('Error marking conversation read:', err);
    }
  }, [profile?.id, fetchUnreadDms]);

  useEffect(() => {
    if (!activeConversation) return;
    fetchMessages(activeConversation.id);
    markConversationRead(activeConversation.id);
  }, [activeConversation, fetchMessages, markConversationRead]);

  // Auto-grow the message textarea to fit its content (capped at 150px).
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 150) + 'px';
    }
  }, [newMessage]);

  useEffect(() => {
    if (!activeConversation) return;
    const channel = supabase
      .channel(`dm-${activeConversation.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'direct_messages',
        filter: `conversation_id=eq.${activeConversation.id}`,
      }, async (payload) => {
        const { data } = await supabase
          .from('direct_messages')
          .select('*, profile:profiles(id, full_name, nickname, title)')
          .eq('id', payload.new.id)
          .single();
        // Dedup by id — reconnect/resubscribe can redeliver, and the deps below
        // tear down + re-subscribe on unrelated refreshes.
        if (data) setMessages(prev => prev.some(m => m.id === data.id) ? prev : [...prev, data]);
        // Viewing this conversation — keep read cursor current so it isn't counted unread.
        if (payload.new.user_id !== profile?.id) markConversationRead(activeConversation.id);
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'direct_messages',
        filter: `conversation_id=eq.${activeConversation.id}`,
      }, (payload) => {
        setMessages(prev => prev.map(m => (m.id === payload.new.id
          ? { ...m, content: payload.new.content, edited_at: payload.new.edited_at }
          : m)));
      })
      .on('postgres_changes', {
        event: 'DELETE', schema: 'public', table: 'direct_messages',
        filter: `conversation_id=eq.${activeConversation.id}`,
      }, (payload) => {
        setMessages(prev => prev.filter(m => m.id !== payload.old.id));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeConversation, profile?.id, markConversationRead]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSendMessage(e) {
    e.preventDefault();
    if (!newMessage.trim() || !activeConversation || !profile?.id || sendingRef.current) return;
    sendingRef.current = true;
    const content = newMessage.trim();
    const { error } = await supabase.from('direct_messages').insert({
      conversation_id: activeConversation.id,
      user_id: profile.id,
      content,
    });
    if (!error) setNewMessage(''); // only clear on success — don't silently drop the message
    sendingRef.current = false;
  }

  async function handleLeaveConversation(convo) {
    setContextMenu(null);
    const isGroup = convo.is_group;
    const ok = await confirm(
      isGroup
        ? `Leave "${getConvoDisplayName(convo)}"? You'll stop receiving its messages.`
        : `Delete this conversation? It will be removed from your list.`
    );
    if (!ok) return;
    const { error } = await supabase
      .from('conversation_participants')
      .delete()
      .eq('conversation_id', convo.id)
      .eq('user_id', profile.id);
    if (error) {
      console.error('Error leaving conversation:', error);
      return;
    }
    if (activeConversation?.id === convo.id) {
      setActiveConversation(null);
      setMessages([]);
    }
    setConversations(prev => prev.filter(c => c.id !== convo.id));
  }

  function startRename(convo) {
    setContextMenu(null);
    setRenamingConvo(convo);
    setRenameValue(convo.name || '');
  }

  async function handleRenameSubmit(e) {
    e.preventDefault();
    const convo = renamingConvo;
    if (!convo) return;
    const name = renameValue.trim();
    if (!name || name === convo.name) {
      setRenamingConvo(null);
      return;
    }
    const { error } = await supabase
      .from('conversations')
      .update({ name })
      .eq('id', convo.id);
    if (error) {
      console.error('Error renaming conversation:', error);
      return;
    }
    setConversations(prev => prev.map(c => (c.id === convo.id ? { ...c, name } : c)));
    if (activeConversation?.id === convo.id) {
      setActiveConversation(prev => ({ ...prev, name }));
    }
    setRenamingConvo(null);
  }

  async function handleEditMessage(messageId, newContent) {
    const trimmed = newContent.trim();
    if (!trimmed) return;
    const editedAt = new Date().toISOString();
    const { error } = await supabase
      .from('direct_messages')
      .update({ content: trimmed, edited_at: editedAt })
      .eq('id', messageId);
    if (error) { console.error('Error editing message:', error); return; }
    setMessages(prev => prev.map(m => (m.id === messageId ? { ...m, content: trimmed, edited_at: editedAt } : m)));
  }

  async function handleDeleteMessage(messageId) {
    const ok = await confirm('Delete this message? This cannot be undone.');
    if (!ok) return;
    const { error } = await supabase.from('direct_messages').delete().eq('id', messageId);
    if (error) { console.error('Error deleting message:', error); return; }
    setMessages(prev => prev.filter(m => m.id !== messageId));
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
        // Group conversation (or named 1:1). Created via SECURITY DEFINER RPC so the
        // conversation + participant rows are inserted atomically. A direct
        // insert().select() fails RLS: RETURNING enforces the conversations SELECT
        // policy, which requires the caller to already be a participant — but the
        // creator's participant row doesn't exist yet at that point.
        const { data: convo, error } = await supabase.rpc('create_group_conversation', {
          p_participant_ids: selectedUsers,
          p_name: groupName || null,
        });

        if (error) throw error;

        await fetchConversations();
        if (convo) setActiveConversation(convo);
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
      ?.filter(p => p.user_id !== profile?.id)
      .map(p => getDisplayName(p.profile) || 'Unknown');
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
    (m.nickname || '').toLowerCase().includes(searchUsers.toLowerCase())
    || (m.full_name || '').toLowerCase().includes(searchUsers.toLowerCase())
  );

  function formatInline(text) {
    const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|[@#]\w+(?:[- ]\w+)*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} style={{ fontWeight: 700, color: '#e2e8f0' }}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
        return <em key={i} style={{ fontStyle: 'italic', color: 'rgba(255,255,255,0.85)' }}>{part.slice(1, -1)}</em>;
      }
      if (part.startsWith('@')) {
        return <span key={i} style={styles.mention}>{part}</span>;
      }
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

  function formatMessageContent(content) {
    if (!content.includes('\n') && !/^[-•] /.test(content)) {
      return formatInline(content);
    }
    const lines = content.split('\n');
    const result = [];
    let bulletItems = [];
    const flushBullets = () => {
      if (bulletItems.length > 0) {
        result.push(
          <ul key={`ul-${result.length}`} style={styles.bulletList}>
            {bulletItems.map((item, j) => (
              <li key={j} style={styles.bulletItem}>{formatInline(item)}</li>
            ))}
          </ul>
        );
        bulletItems = [];
      }
    };
    lines.forEach((line, i) => {
      const bulletMatch = line.match(/^[-•] (.*)/);
      if (bulletMatch) {
        bulletItems.push(bulletMatch[1]);
      } else {
        flushBullets();
        if (line.trim() === '') {
          result.push(<div key={`line-${i}`} style={{ height: '8px' }} />);
        } else {
          result.push(<div key={`line-${i}`}>{formatInline(line)}</div>);
        }
      }
    });
    flushBullets();
    return result;
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
                  <div style={styles.userAvatar}>{getDisplayInitial(m)}</div>
                  <div style={{ flex: 1 }}>
                    <div style={styles.userItemName}>{getDisplayName(m)}</div>
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
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ convo, x: e.clientX, y: e.clientY });
              }}
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
                  const isOwn = msg.user_id === profile?.id;
                  const showAvatar = i === 0 || messages[i - 1].user_id !== msg.user_id;
                  return (
                    <DmMessage
                      key={msg.id}
                      msg={msg}
                      isOwn={isOwn}
                      showAvatar={showAvatar}
                      formatContent={formatMessageContent}
                      formatTime={formatTime}
                      onEdit={handleEditMessage}
                      onDelete={handleDeleteMessage}
                    />
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            <div style={styles.inputWrap}>
              <form onSubmit={handleSendMessage} style={styles.inputForm}>
                <textarea
                  ref={inputRef}
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage(e);
                    }
                    if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
                      e.preventDefault();
                      applyFormatMarker(inputRef, newMessage, '**', setNewMessage);
                    }
                    if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
                      e.preventDefault();
                      applyFormatMarker(inputRef, newMessage, '*', setNewMessage);
                    }
                  }}
                  placeholder="Type a message..."
                  rows={1}
                  style={styles.messageInput}
                />
                <button type="submit" style={styles.sendBtn} disabled={!newMessage.trim()}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
                  </svg>
                </button>
              </form>
              <div style={styles.formatHint}>
                <span><strong>**bold**</strong>  <em>*italic*</em>  - bullet</span>
                <span style={{ marginLeft: '12px' }}>Shift+Enter for new line</span>
              </div>
            </div>
          </>
        ) : (
          <div style={styles.noChat}>
            <div style={styles.noChatIcon}>💬</div>
            <h3 style={styles.noChatTitle}>Your Messages</h3>
            <p style={styles.noChatSubtitle}>Select a conversation or start a new one</p>
          </div>
        )}
      </div>

      {contextMenu && (
        <>
          <div style={styles.contextOverlay} onClick={() => setContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }} />
          <div style={{ ...styles.contextMenu, top: contextMenu.y, left: contextMenu.x }}>
            {contextMenu.convo.is_group && contextMenu.convo.created_by === profile?.id && (
              <button style={styles.contextItem} onClick={() => startRename(contextMenu.convo)}>
                Rename group
              </button>
            )}
            <button
              style={{ ...styles.contextItem, color: '#f87171' }}
              onClick={() => handleLeaveConversation(contextMenu.convo)}
            >
              {contextMenu.convo.is_group ? 'Leave group' : 'Delete conversation'}
            </button>
          </div>
        </>
      )}

      {renamingConvo && (
        <div style={styles.modalOverlay} onClick={() => setRenamingConvo(null)}>
          <form style={styles.renameModal} onClick={(e) => e.stopPropagation()} onSubmit={handleRenameSubmit}>
            <h3 style={styles.renameTitle}>Rename group</h3>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="Group name"
              style={styles.searchInput}
            />
            <div style={styles.renameActions}>
              <button type="button" style={styles.renameCancel} onClick={() => setRenamingConvo(null)}>
                Cancel
              </button>
              <button type="submit" style={styles.renameSave} disabled={!renameValue.trim()}>
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function DmMessage({ msg, isOwn, showAvatar, formatContent, formatTime, onEdit, onDelete }) {
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(msg.content);
  const menuRef = useRef(null);
  const editInputRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  useEffect(() => {
    if (editing && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.selectionStart = editInputRef.current.value.length;
    }
  }, [editing]);

  useEffect(() => {
    if (editInputRef.current) {
      editInputRef.current.style.height = 'auto';
      editInputRef.current.style.height = Math.min(editInputRef.current.scrollHeight, 150) + 'px';
    }
  }, [editContent]);

  function handleStartEdit() {
    setEditContent(msg.content);
    setEditing(true);
    setMenuOpen(false);
  }
  function handleSaveEdit() {
    if (editContent.trim() && editContent.trim() !== msg.content) onEdit(msg.id, editContent);
    setEditing(false);
  }
  function handleCancelEdit() {
    setEditContent(msg.content);
    setEditing(false);
  }
  function handleCopy() {
    navigator.clipboard.writeText(msg.content).catch(() => {});
    setMenuOpen(false);
  }
  function handleEditKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
      e.preventDefault();
      applyFormatMarker(editInputRef, editContent, '**', setEditContent);
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
      e.preventDefault();
      applyFormatMarker(editInputRef, editContent, '*', setEditContent);
    }
  }

  return (
    <div
      style={{ ...styles.msgRow, justifyContent: isOwn ? 'flex-end' : 'flex-start' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {!isOwn && showAvatar && (
        <div style={styles.msgAvatar}>{getDisplayInitial(msg.profile)}</div>
      )}
      {!isOwn && !showAvatar && <div style={{ width: '32px' }} />}

      {isOwn && !editing && (
        <div style={{ position: 'relative', alignSelf: 'center', flexShrink: 0 }}>
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o); }}
            style={{ ...styles.msgMenuBtn, opacity: hovered || menuOpen ? 0.7 : 0 }}
            title="More options"
          >
            ⋯
          </button>
          {menuOpen && (
            <div ref={menuRef} style={styles.msgMenuDropdown}>
              <button onClick={handleStartEdit} style={styles.msgMenuItem}>✏️ Edit</button>
              <button onClick={handleCopy} style={styles.msgMenuItem}>📋 Copy</button>
              <button
                onClick={() => { onDelete(msg.id); setMenuOpen(false); }}
                style={{ ...styles.msgMenuItem, color: '#fca5a5' }}
              >
                🗑 Delete
              </button>
            </div>
          )}
        </div>
      )}

      <div style={{
        ...styles.msgBubble,
        background: isOwn ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.05)',
        borderColor: isOwn ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.06)',
        ...(editing ? { width: '100%', maxWidth: '80%' } : {}),
      }}>
        {showAvatar && !isOwn && (
          <div style={styles.msgSender}>{getDisplayName(msg.profile)}</div>
        )}
        {editing ? (
          <>
            <textarea
              ref={editInputRef}
              rows={1}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              onKeyDown={handleEditKeyDown}
              style={styles.msgEditInput}
            />
            <div style={styles.msgEditActions}>
              <span style={styles.msgEditHint}>Enter to save · Esc to cancel</span>
              <button onClick={handleCancelEdit} style={styles.msgEditCancel}>Cancel</button>
              <button onClick={handleSaveEdit} style={styles.msgEditSave}>Save</button>
            </div>
          </>
        ) : (
          <>
            <div style={styles.msgContent}>
              {formatContent(msg.content)}
              {msg.edited_at && <span style={styles.msgEditedTag}>(edited)</span>}
            </div>
            <div style={styles.msgTime}>{formatTime(msg.created_at)}</div>
          </>
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
  msgEditedTag: {
    fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginLeft: '6px',
    fontStyle: 'italic',
  },
  msgMenuBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: '16px', padding: '2px 6px', color: 'rgba(255,255,255,0.6)',
    transition: 'opacity 0.15s', borderRadius: '4px', lineHeight: 1,
    letterSpacing: '1px',
  },
  msgMenuDropdown: {
    position: 'absolute', top: '100%', right: 0, marginTop: '2px',
    background: '#1e1e36', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '8px', padding: '4px', zIndex: 50, minWidth: '130px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  },
  msgMenuItem: {
    display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
    padding: '7px 10px', background: 'none', border: 'none', borderRadius: '5px',
    color: 'rgba(255,255,255,0.7)', fontSize: '12px', cursor: 'pointer',
    fontFamily: 'inherit', textAlign: 'left',
  },
  msgEditInput: {
    width: '100%', padding: '8px 10px', background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(99,102,241,0.4)', borderRadius: '8px',
    color: '#fff', fontSize: '14px', fontFamily: 'inherit', outline: 'none',
    boxSizing: 'border-box', resize: 'none', lineHeight: 1.5,
    minHeight: '34px', maxHeight: '150px', overflow: 'auto',
  },
  msgEditActions: {
    display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
    gap: '8px', marginTop: '6px',
  },
  msgEditHint: {
    fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginRight: 'auto',
  },
  msgEditCancel: {
    padding: '4px 10px', background: 'rgba(255,255,255,0.08)', border: 'none',
    borderRadius: '6px', color: 'rgba(255,255,255,0.7)', fontSize: '12px',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  msgEditSave: {
    padding: '4px 10px', background: '#6366f1', border: 'none',
    borderRadius: '6px', color: '#fff', fontSize: '12px', fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  inputWrap: {
    padding: '12px 24px 16px', flexShrink: 0,
  },
  inputForm: {
    display: 'flex', gap: '8px', alignItems: 'flex-end',
  },
  messageInput: {
    flex: 1, padding: '12px 16px', background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px',
    color: '#fff', fontSize: '14px', fontFamily: 'inherit', outline: 'none',
    resize: 'none', lineHeight: 1.5, minHeight: '46px', maxHeight: '150px',
    overflow: 'auto', boxSizing: 'border-box',
  },
  formatHint: {
    fontSize: '11px', color: 'rgba(255,255,255,0.2)', marginTop: '4px',
    paddingLeft: '2px',
  },
  mention: {
    background: 'rgba(99,102,241,0.2)', color: '#a5b4fc',
    padding: '1px 4px', borderRadius: '4px', fontWeight: 600,
  },
  bulletList: {
    margin: '4px 0', paddingLeft: '20px', listStyleType: 'disc',
  },
  bulletItem: {
    fontSize: '14px', color: '#e2e8f0', lineHeight: 1.5, marginBottom: '2px',
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
  contextOverlay: {
    position: 'fixed', inset: 0, zIndex: 100,
  },
  contextMenu: {
    position: 'fixed', zIndex: 101, minWidth: '160px',
    background: '#1e1e36', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '8px', padding: '4px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  },
  contextItem: {
    display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
    padding: '8px 10px', background: 'none', border: 'none', borderRadius: '5px',
    color: 'rgba(255,255,255,0.75)', fontSize: '13px', cursor: 'pointer',
    fontFamily: 'inherit', textAlign: 'left',
  },
  modalOverlay: {
    position: 'fixed', inset: 0, zIndex: 200,
    background: 'rgba(0,0,0,0.5)', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
  },
  renameModal: {
    width: '340px', maxWidth: '90vw', background: '#16162c',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '14px',
    padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px',
  },
  renameTitle: {
    fontSize: '15px', fontWeight: 700, color: '#e2e8f0', margin: 0,
  },
  renameActions: {
    display: 'flex', justifyContent: 'flex-end', gap: '8px',
  },
  renameCancel: {
    padding: '8px 14px', background: 'rgba(255,255,255,0.06)', border: 'none',
    borderRadius: '8px', color: 'rgba(255,255,255,0.6)', fontSize: '13px',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  renameSave: {
    padding: '8px 14px', background: '#6366f1', border: 'none',
    borderRadius: '8px', color: '#fff', fontSize: '13px', fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  },
};
