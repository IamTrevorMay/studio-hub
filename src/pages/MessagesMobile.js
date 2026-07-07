import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import FullScreenSheet from '../components/mobile/FullScreenSheet';
import BottomSheet from '../components/mobile/BottomSheet';
import { mobileTokens, mobileTapButton } from '../utils/mobileTokens';
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

export default function MessagesMobile({ onNavigate }) {
  const { profile, refreshKey } = useAuth();
  const confirm = useConfirm();
  const [conversations, setConversations] = useState([]);
  const [activeConvo, setActiveConvo] = useState(null);
  const [loading, setLoading] = useState(true);

  const [showNewConvo, setShowNewConvo] = useState(false);
  const [teamMembers, setTeamMembers] = useState([]);
  const [searchUsers, setSearchUsers] = useState('');
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [groupName, setGroupName] = useState('');
  const [actionConvo, setActionConvo] = useState(null); // convo whose action sheet is open
  const [renamingConvo, setRenamingConvo] = useState(null); // convo being renamed
  const [renameValue, setRenameValue] = useState('');
  const longPressTimer = useRef(null);
  const longPressFired = useRef(false);

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
          .select('user_id, profile:profiles(id, full_name, nickname, title)')
          .eq('conversation_id', convo.id);
        const { data: lastMsg } = await supabase
          .from('direct_messages')
          .select('content, created_at, user_id')
          .eq('conversation_id', convo.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(); // empty conversations would 406/PGRST116 with .single()
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
    const { data } = await supabase.from('profiles').select('id, full_name, nickname, title').neq('id', profile.id);
    setTeamMembers(data || []);
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) return;
    Promise.all([fetchConversations(), fetchTeamMembers()]).finally(() => setLoading(false));
  }, [profile?.id, fetchConversations, fetchTeamMembers]);

  function convoName(convo) {
    if (!convo) return '';
    if (convo.name) return convo.name;
    const others = convo.participants?.filter((p) => p.user_id !== profile.id).map((p) => getDisplayName(p.profile) || 'Unknown');
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
            .select('user_id, profile:profiles(id, full_name, nickname, title)')
            .eq('conversation_id', convo.id);
          setActiveConvo({ ...convo, participants: parts || [] });
        }
      } else {
        // Group conversation via SECURITY DEFINER RPC (atomic insert of the
        // conversation + participants; avoids the INSERT ... RETURNING RLS failure
        // where the creator isn't a participant yet). See create_group_conversation.
        const { data: convo, error } = await supabase.rpc('create_group_conversation', {
          p_participant_ids: selectedUsers,
          p_name: groupName || null,
        });
        if (error) throw error;
        await fetchConversations();
        const { data: parts } = await supabase
          .from('conversation_participants')
          .select('user_id, profile:profiles(id, full_name, nickname, title)')
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

  const filteredTeam = teamMembers.filter((m) => {
    const needle = searchUsers.toLowerCase();
    return (m.nickname || '').toLowerCase().includes(needle) || (m.full_name || '').toLowerCase().includes(needle);
  });

  // While a conversation is open, one history entry sits on the stack so the
  // phone's back button/gesture returns to the thread list instead of leaving
  // the Messages tab. The sheet's chevron goes through history.back() too, so
  // popstate is the single close path and the stack never accumulates entries.
  useEffect(() => {
    if (!activeConvo) return undefined;
    window.history.pushState({ maydayConvo: activeConvo.id }, '');
    const onPop = () => setActiveConvo(null);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [activeConvo?.id]);

  function closeActiveConvo() {
    if (window.history.state?.maydayConvo) {
      window.history.back();
    } else {
      setActiveConvo(null);
    }
  }

  // Long-press a thread to open its action sheet (mobile equivalent of right-click).
  function startPress(convo) {
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      setActionConvo(convo);
    }, 500);
  }
  function cancelPress() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }
  function handleThreadClick(convo) {
    if (longPressFired.current) { longPressFired.current = false; return; } // long-press already handled
    setActiveConvo(convo);
  }

  async function handleLeaveConversation(convo) {
    setActionConvo(null);
    const ok = await confirm(
      convo.is_group
        ? `Leave "${convoName(convo)}"? You'll stop receiving its messages.`
        : `Delete this conversation? It will be removed from your list.`
    );
    if (!ok) return;
    const { error } = await supabase
      .from('conversation_participants')
      .delete()
      .eq('conversation_id', convo.id)
      .eq('user_id', profile.id);
    if (error) { console.error('Error leaving conversation:', error); return; }
    if (activeConvo?.id === convo.id) closeActiveConvo();
    setConversations((prev) => prev.filter((c) => c.id !== convo.id));
  }

  async function handleRenameSubmit() {
    const convo = renamingConvo;
    if (!convo) return;
    const name = renameValue.trim();
    if (!name || name === convo.name) { setRenamingConvo(null); return; }
    const { error } = await supabase.from('conversations').update({ name }).eq('id', convo.id);
    if (error) { console.error('Error renaming conversation:', error); return; }
    setConversations((prev) => prev.map((c) => (c.id === convo.id ? { ...c, name } : c)));
    if (activeConvo?.id === convo.id) setActiveConvo((prev) => ({ ...prev, name }));
    setRenamingConvo(null);
  }

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
            <button
              key={convo.id}
              onClick={() => handleThreadClick(convo)}
              onTouchStart={() => startPress(convo)}
              onTouchEnd={cancelPress}
              onTouchMove={cancelPress}
              onContextMenu={(e) => { e.preventDefault(); setActionConvo(convo); }}
              style={styles.threadRow}
            >
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
        onClose={closeActiveConvo}
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
                  <div style={styles.userAvatar}>{getDisplayInitial(m)}</div>
                  <div style={styles.userBody}>
                    <div style={styles.userName}>{getDisplayName(m)}</div>
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

      <BottomSheet
        open={!!actionConvo}
        onClose={() => setActionConvo(null)}
        title={actionConvo ? convoName(actionConvo) : ''}
      >
        {actionConvo && (
          <div style={styles.newPanel}>
            {actionConvo.is_group && actionConvo.created_by === profile.id && (
              <button
                style={styles.actionRow}
                onClick={() => { setRenameValue(actionConvo.name || ''); setRenamingConvo(actionConvo); setActionConvo(null); }}
              >
                Rename group
              </button>
            )}
            <button
              style={{ ...styles.actionRow, color: '#f87171' }}
              onClick={() => handleLeaveConversation(actionConvo)}
            >
              {actionConvo.is_group ? 'Leave group' : 'Delete conversation'}
            </button>
          </div>
        )}
      </BottomSheet>

      <BottomSheet
        open={!!renamingConvo}
        onClose={() => setRenamingConvo(null)}
        title="Rename group"
      >
        {renamingConvo && (
          <div style={styles.newPanel}>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="Group name"
              style={styles.input}
            />
            <button
              onClick={handleRenameSubmit}
              disabled={!renameValue.trim()}
              style={{ ...styles.primaryBtn, opacity: renameValue.trim() ? 1 : 0.4 }}
            >
              Save
            </button>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}

function ConversationView({ conversation, profileId, refreshKey, onNavigate }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [actionMsg, setActionMsg] = useState(null); // own message whose action sheet is open
  const [editingId, setEditingId] = useState(null);
  const [editContent, setEditContent] = useState('');
  const sendingRef = useRef(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const editRef = useRef(null);
  const pressTimer = useRef(null);
  const pressFired = useRef(false);
  const confirm = useConfirm();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      // Newest 100 then reverse — ascending+limit showed the oldest 100.
      const { data } = await supabase
        .from('direct_messages')
        .select('*, profile:profiles(id, full_name, nickname, title)')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: false })
        .limit(100);
      if (!cancelled) {
        setMessages((data || []).slice().reverse());
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
          .select('*, profile:profiles(id, full_name, nickname, title)')
          .eq('id', payload.new.id)
          .single();
        // Dedup by id — reconnect can redeliver the same row.
        if (data) setMessages((prev) => prev.some((m) => m.id === data.id) ? prev : [...prev, data]);
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'direct_messages',
        filter: `conversation_id=eq.${conversation.id}`,
      }, (payload) => {
        setMessages((prev) => prev.map((m) => (m.id === payload.new.id
          ? { ...m, content: payload.new.content, edited_at: payload.new.edited_at }
          : m)));
      })
      .on('postgres_changes', {
        event: 'DELETE', schema: 'public', table: 'direct_messages',
        filter: `conversation_id=eq.${conversation.id}`,
      }, (payload) => {
        setMessages((prev) => prev.filter((m) => m.id !== payload.old.id));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [conversation.id, refreshKey]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Auto-grow the composer to fit its content (capped at 120px).
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + 'px';
    }
  }, [text]);

  async function send(e) {
    e.preventDefault();
    if (!text.trim() || sendingRef.current) return; // guard double-submit
    sendingRef.current = true;
    const content = text.trim();
    setText('');
    const { error } = await supabase.from('direct_messages').insert({
      conversation_id: conversation.id,
      user_id: profileId,
      content,
    });
    if (error) setText(content); // restore the typed message on failure instead of silently losing it
    sendingRef.current = false;
  }

  // Focus + size the edit box when editing begins / content changes.
  useEffect(() => {
    if (editingId && editRef.current) {
      editRef.current.focus();
      editRef.current.selectionStart = editRef.current.value.length;
    }
  }, [editingId]);
  useEffect(() => {
    if (editRef.current) {
      editRef.current.style.height = 'auto';
      editRef.current.style.height = Math.min(editRef.current.scrollHeight, 120) + 'px';
    }
  }, [editContent]);

  // Long-press an own message to open its action sheet.
  function startPress(m) {
    pressFired.current = false;
    pressTimer.current = setTimeout(() => { pressFired.current = true; setActionMsg(m); }, 500);
  }
  function cancelPress() {
    if (pressTimer.current) clearTimeout(pressTimer.current);
  }

  function startEdit(m) {
    setActionMsg(null);
    setEditContent(m.content);
    setEditingId(m.id);
  }
  function cancelEdit() {
    setEditingId(null);
    setEditContent('');
  }
  async function saveEdit() {
    const trimmed = editContent.trim();
    const target = editingId;
    if (!trimmed) { cancelEdit(); return; }
    const editedAt = new Date().toISOString();
    const { error } = await supabase
      .from('direct_messages')
      .update({ content: trimmed, edited_at: editedAt })
      .eq('id', target);
    if (error) { console.error('Error editing message:', error); return; }
    setMessages((prev) => prev.map((m) => (m.id === target ? { ...m, content: trimmed, edited_at: editedAt } : m)));
    setEditingId(null);
    setEditContent('');
  }
  async function deleteMsg(id) {
    setActionMsg(null);
    const ok = await confirm('Delete this message? This cannot be undone.');
    if (!ok) return;
    const { error } = await supabase.from('direct_messages').delete().eq('id', id);
    if (error) { console.error('Error deleting message:', error); return; }
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }

  function formatInline(text) {
    const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|[@#]\w+(?:[- ]\w+)*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} style={{ fontWeight: 700 }}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
        return <em key={i} style={{ fontStyle: 'italic' }}>{part.slice(1, -1)}</em>;
      }
      if (part.startsWith('@')) {
        return <span key={i} style={convoStyles.mention}>{part}</span>;
      }
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

  function renderContent(content) {
    if (!content.includes('\n') && !/^[-•] /.test(content)) {
      return formatInline(content);
    }
    const lines = content.split('\n');
    const result = [];
    let bulletItems = [];
    const flushBullets = () => {
      if (bulletItems.length > 0) {
        result.push(
          <ul key={`ul-${result.length}`} style={convoStyles.bulletList}>
            {bulletItems.map((item, j) => (
              <li key={j} style={convoStyles.bulletItem}>{formatInline(item)}</li>
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
          result.push(<div key={`line-${i}`} style={{ height: 6 }} />);
        } else {
          result.push(<div key={`line-${i}`}>{formatInline(line)}</div>);
        }
      }
    });
    flushBullets();
    return result;
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
            const isEditing = editingId === m.id;
            return (
              <div key={m.id} style={{ ...convoStyles.bubbleRow, justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                <div
                  onTouchStart={mine && !isEditing ? () => startPress(m) : undefined}
                  onTouchEnd={mine ? cancelPress : undefined}
                  onTouchMove={mine ? cancelPress : undefined}
                  onContextMenu={mine && !isEditing ? (e) => { e.preventDefault(); setActionMsg(m); } : undefined}
                  style={{
                    ...convoStyles.bubble,
                    background: mine ? 'linear-gradient(135deg, #6366f1, #818cf8)' : 'rgba(255,255,255,0.06)',
                    color: mine ? '#fff' : '#e2e8f0',
                    borderBottomRightRadius: mine ? 4 : mobileTokens.radius.lg,
                    borderBottomLeftRadius: mine ? mobileTokens.radius.lg : 4,
                    ...(isEditing ? { width: '100%' } : {}),
                  }}
                >
                  {!mine && <div style={convoStyles.bubbleSender}>{getDisplayName(m.profile) || 'Unknown'}</div>}
                  {isEditing ? (
                    <div>
                      <textarea
                        ref={editRef}
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={1}
                        style={convoStyles.editInput}
                      />
                      <div style={convoStyles.editActions}>
                        <button onClick={cancelEdit} style={convoStyles.editCancel}>Cancel</button>
                        <button onClick={saveEdit} style={convoStyles.editSave}>Save</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div>
                        {renderContent(m.content)}
                        {m.edited_at && <span style={convoStyles.editedTag}> (edited)</span>}
                      </div>
                      <div style={{ ...convoStyles.bubbleTime, color: mine ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.4)' }}>
                        {formatTime(m.created_at)}
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>
      <form onSubmit={send} style={{ ...convoStyles.composer, paddingBottom: `calc(${mobileTokens.space.md}px + ${mobileTokens.safeBottom})` }}>
        <div style={convoStyles.composerRow}>
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(e);
              }
              if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
                e.preventDefault();
                applyFormatMarker(inputRef, text, '**', setText);
              }
              if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
                e.preventDefault();
                applyFormatMarker(inputRef, text, '*', setText);
              }
            }}
            placeholder="Message…"
            rows={1}
            style={convoStyles.input}
          />
          <button type="submit" disabled={!text.trim()} style={{ ...convoStyles.sendBtn, opacity: text.trim() ? 1 : 0.4 }} aria-label="Send">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M2 10l16-7-7 16-2-7-7-2z" />
            </svg>
          </button>
        </div>
        <div style={convoStyles.formatHint}>
          <strong>**bold**</strong>  <em>*italic*</em>  - bullet
        </div>
      </form>

      <BottomSheet open={!!actionMsg} onClose={() => setActionMsg(null)} title="Message">
        {actionMsg && (
          <div style={styles.newPanel}>
            <button style={styles.actionRow} onClick={() => startEdit(actionMsg)}>Edit</button>
            <button
              style={styles.actionRow}
              onClick={() => { navigator.clipboard.writeText(actionMsg.content).catch(() => {}); setActionMsg(null); }}
            >
              Copy
            </button>
            <button style={{ ...styles.actionRow, color: '#f87171' }} onClick={() => deleteMsg(actionMsg.id)}>
              Delete
            </button>
          </div>
        )}
      </BottomSheet>
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
  actionRow: {
    ...mobileTapButton,
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'flex-start',
    minHeight: mobileTokens.tap + 4,
    padding: mobileTokens.space.md,
    borderRadius: mobileTokens.radius.md,
    background: 'rgba(255,255,255,0.04)',
    color: '#e2e8f0',
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    textAlign: 'left',
    fontFamily: 'inherit',
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
    flexDirection: 'column',
    gap: 4,
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.lg}px`,
    background: 'rgba(15,15,30,0.96)',
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  composerRow: {
    display: 'flex',
    gap: mobileTokens.space.sm,
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    minHeight: mobileTokens.tap,
    maxHeight: 120,
    padding: `${mobileTokens.space.sm}px ${mobileTokens.space.md}px`,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: mobileTokens.radius.lg,
    color: '#fff',
    fontSize: mobileTokens.font.base,
    outline: 'none',
    fontFamily: 'inherit',
    resize: 'none',
    lineHeight: 1.4,
    overflow: 'auto',
    boxSizing: 'border-box',
  },
  formatHint: {
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.25)',
    paddingLeft: 2,
  },
  mention: {
    background: 'rgba(99,102,241,0.2)',
    color: '#a5b4fc',
    padding: '1px 4px',
    borderRadius: 4,
    fontWeight: 600,
  },
  bulletList: {
    margin: '4px 0',
    paddingLeft: 18,
    listStyleType: 'disc',
  },
  bulletItem: {
    lineHeight: 1.4,
    marginBottom: 2,
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
  editedTag: {
    fontSize: mobileTokens.font.xs,
    opacity: 0.6,
    fontStyle: 'italic',
  },
  editInput: {
    width: '100%',
    minHeight: 36,
    maxHeight: 120,
    padding: `${mobileTokens.space.sm}px ${mobileTokens.space.md}px`,
    background: 'rgba(255,255,255,0.12)',
    border: '1px solid rgba(255,255,255,0.25)',
    borderRadius: mobileTokens.radius.md,
    color: '#fff',
    fontSize: mobileTokens.font.base,
    outline: 'none',
    fontFamily: 'inherit',
    resize: 'none',
    lineHeight: 1.4,
    overflow: 'auto',
    boxSizing: 'border-box',
  },
  editActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: mobileTokens.space.sm,
    marginTop: mobileTokens.space.sm,
  },
  editCancel: {
    padding: `4px ${mobileTokens.space.md}px`,
    background: 'rgba(255,255,255,0.15)',
    border: 'none',
    borderRadius: mobileTokens.radius.sm,
    color: '#fff',
    fontSize: mobileTokens.font.sm,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  editSave: {
    padding: `4px ${mobileTokens.space.md}px`,
    background: '#fff',
    border: 'none',
    borderRadius: mobileTokens.radius.sm,
    color: '#4f46e5',
    fontSize: mobileTokens.font.sm,
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
};
