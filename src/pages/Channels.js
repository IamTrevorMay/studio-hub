import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationContext';
import { useConfirm } from '../contexts/ConfirmContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import { getDisplayName, getDisplayInitial } from '../lib/displayName';

// Roles that can be individually granted channel access via the admin
// "Set Permissions" menu. Admin-tier roles (admin, director_creative,
// director_comms) always have access and are intentionally not listed.
const CHANNEL_ROLE_OPTIONS = [
  { value: 'assistant', label: 'Assistant' },
  { value: 'member', label: 'Member' },
  { value: 'partner', label: 'Partner' },
  { value: 'producer', label: 'Producer' },
  { value: 'freelancer', label: 'Contractor' },
];

// A channel with no allowed_roles (null/empty) is open to everyone. Otherwise
// only the listed roles — plus admin-tier, who always see every channel.
function channelVisibleToRole(channel, role) {
  const allowed = channel.allowed_roles;
  if (!allowed || allowed.length === 0) return true;
  return allowed.includes(role);
}


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

export default function Channels({ initialChannelName, onChannelOpened }) {
  const { profile, isAdmin, refreshKey } = useAuth();
  const { unreadMentionChannelIds, markChannelSeen, refreshNotifications } = useNotifications();
  const confirm = useConfirm();
  const [channels, setChannels] = useState([]);
  const [draggedChannelId, setDraggedChannelId] = useState(null);
  const [dragOverChannelId, setDragOverChannelId] = useState(null);
  const [contextMenu, setContextMenu] = useState(null); // { channelId, x, y }
  const [renamingChannelId, setRenamingChannelId] = useState(null);
  const [permsChannel, setPermsChannel] = useState(null); // channel being edited in the Set Permissions modal
  const [permsSelected, setPermsSelected] = useState(() => new Set());
  const [activeChannel, setActiveChannel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [showPinned, setShowPinned] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [channelName, setChannelName] = useState('');
  const [channelDesc, setChannelDesc] = useState('');
  const [teamMembers, setTeamMembers] = useState([]);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loading, setLoading] = useState(true);

  // Admins manage every channel; everyone else only sees channels their role
  // is permitted to access.
  const visibleChannels = useMemo(
    () => channels.filter(ch => isAdmin || channelVisibleToRole(ch, profile?.role)),
    [channels, isAdmin, profile?.role],
  );

  const fetchChannels = useCallback(async () => {
    try {
      const { data } = await supabase.from('channels')
        .select('*').order('sort_order', { ascending: true }).order('is_default', { ascending: false }).order('name');
      setChannels(data || []);
      if (data?.length > 0) setActiveChannel(prev => prev || data[0]);
    } catch (err) {
      console.error('Error fetching channels:', err);
    }
  }, []);

  const fetchTeamMembers = useCallback(async () => {
    try {
      const { data } = await supabase.from('profiles').select('id, full_name, nickname, title');
      setTeamMembers(data || []);
    } catch (err) {
      console.error('Error fetching team:', err);
    }
  }, []);

  useEffect(() => {
    if (!profile?.id) return;
    Promise.all([fetchChannels(), fetchTeamMembers()])
      .finally(() => setLoading(false));
  }, [profile?.id, fetchChannels, fetchTeamMembers]);
  useVisibilityRefresh(useCallback(() => {
    if (profile?.id) fetchChannels();
  }, [profile?.id, fetchChannels]));

  useEffect(() => {
    if (!contextMenu) return;
    function close(e) {
      if (e.type === 'keydown' && e.key !== 'Escape') return;
      setContextMenu(null);
    }
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [contextMenu]);

  // Keep the active channel within what this user is allowed to see (e.g. after
  // an admin restricts the currently-open channel).
  useEffect(() => {
    if (loading) return;
    if (activeChannel && !visibleChannels.some(c => c.id === activeChannel.id)) {
      setActiveChannel(visibleChannels[0] || null);
    } else if (!activeChannel && visibleChannels.length > 0) {
      setActiveChannel(visibleChannels[0]);
    }
  }, [visibleChannels, activeChannel, loading]);

  useEffect(() => {
    if (!initialChannelName || channels.length === 0) return;
    const match = channels.find(c => c.name.toLowerCase() === initialChannelName.toLowerCase());
    if (match) {
      setActiveChannel(match);
      markChannelSeen(match.id);
    }
    if (onChannelOpened) onChannelOpened();
  }, [initialChannelName, channels]);

  const fetchMessages = useCallback(async (channelId) => {
    setLoadingMessages(true);
    try {
      const { data, error } = await supabase
        .from('channel_messages')
        .select('*, profile:profiles(id, full_name, nickname, title, avatar_url)')
        .eq('channel_id', channelId)
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

  const fetchPinnedMessages = useCallback(async (channelId) => {
    try {
      const { data } = await supabase
        .from('channel_messages')
        .select('*, profile:profiles(id, full_name, nickname, title)')
        .eq('channel_id', channelId)
        .eq('is_pinned', true)
        .order('created_at', { ascending: false });
      setPinnedMessages(data || []);
    } catch (err) {
      console.error('Error fetching pinned:', err);
    }
  }, []);

  useEffect(() => {
    if (!activeChannel) return;
    fetchMessages(activeChannel.id);
    fetchPinnedMessages(activeChannel.id);
  }, [activeChannel, fetchMessages, fetchPinnedMessages]);

  useEffect(() => {
    if (!activeChannel) return;
    let mounted = true;
    const channel = supabase
      .channel(`channel-${activeChannel.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'channel_messages',
        filter: `channel_id=eq.${activeChannel.id}`,
      }, async (payload) => {
        const { data } = await supabase
          .from('channel_messages')
          .select('*, profile:profiles(id, full_name, nickname, title, avatar_url)')
          .eq('id', payload.new.id)
          .single();
        if (data && mounted) setMessages(prev => [...prev, data]);
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'channel_messages',
        filter: `channel_id=eq.${activeChannel.id}`,
      }, (payload) => {
        if (!mounted) return;
        setMessages(prev => prev.map(m => m.id === payload.new.id
          ? { ...m, content: payload.new.content, edited_at: payload.new.edited_at, is_pinned: payload.new.is_pinned }
          : m
        ));
        fetchPinnedMessages(activeChannel.id);
      })
      .on('postgres_changes', {
        // No channel_id filter: DELETE payloads only carry the PK (default
        // replica identity), so a channel_id filter would never match. Filter
        // by id presence instead — removing an id not in this channel is a no-op.
        event: 'DELETE', schema: 'public', table: 'channel_messages',
      }, (payload) => {
        if (!mounted) return;
        setMessages(prev => prev.filter(m => m.id !== payload.old.id));
        fetchPinnedMessages(activeChannel.id);
      })
      .subscribe();
    return () => { mounted = false; supabase.removeChannel(channel); };
  }, [activeChannel, fetchMessages, fetchPinnedMessages, refreshKey]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 150) + 'px';
    }
  }, [newMessage]);

  async function handlePinMessage(messageId, isPinned) {
    await supabase.from('channel_messages').update({ is_pinned: !isPinned }).eq('id', messageId);
    if (activeChannel) fetchPinnedMessages(activeChannel.id);
  }

  async function handleEditMessage(messageId, newContent) {
    if (!newContent.trim()) return;
    await supabase.from('channel_messages').update({
      content: newContent.trim(),
      edited_at: new Date().toISOString(),
    }).eq('id', messageId);
    setMessages(prev => prev.map(m => m.id === messageId
      ? { ...m, content: newContent.trim(), edited_at: new Date().toISOString() }
      : m
    ));
  }

  async function handleDeleteMessage(messageId) {
    await supabase.from('channel_messages').delete().eq('id', messageId);
    setMessages(prev => prev.filter(m => m.id !== messageId));
    if (activeChannel) fetchPinnedMessages(activeChannel.id);
  }

  async function handleReorderChannels(draggedId, targetId) {
    if (!draggedId || draggedId === targetId) return;
    const fromIdx = channels.findIndex(c => c.id === draggedId);
    const toIdx = channels.findIndex(c => c.id === targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const reordered = [...channels];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    // Renumber every channel to a contiguous 0..n-1 sequence so ordering is
    // never corrupted by gaps in the stored sort_order values.
    const withOrder = reordered.map((c, i) => ({ ...c, sort_order: i }));
    setChannels(withOrder); // optimistic
    // Only write rows whose stored sort_order actually changed.
    await Promise.all(
      withOrder
        .filter(c => c.sort_order !== (channels.find(o => o.id === c.id)?.sort_order))
        .map(c => supabase.from('channels').update({ sort_order: c.sort_order }).eq('id', c.id))
    );
    fetchChannels();
  }

  async function handleRenameChannel(channelId, rawName) {
    const name = rawName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    setRenamingChannelId(null);
    const ch = channels.find(c => c.id === channelId);
    if (!name || !ch || name === ch.name) return;
    const { error } = await supabase.from('channels').update({ name }).eq('id', channelId);
    if (error) { alert('Error: ' + error.message); return; }
    setChannels(prev => prev.map(c => c.id === channelId ? { ...c, name } : c));
    setActiveChannel(prev => (prev?.id === channelId ? { ...prev, name } : prev));
  }

  async function handleDeleteChannel(channelId) {
    const ch = channels.find(c => c.id === channelId);
    if (!(await confirm(`Delete #${ch?.name || 'channel'} and all its messages?`))) return;
    await supabase.from('channels').delete().eq('id', channelId);
    if (activeChannel?.id === channelId) setActiveChannel(null);
    fetchChannels();
  }

  function openPermsModal(ch) {
    // null/empty allowed_roles means "open to everyone" → start with all on.
    const current = (!ch.allowed_roles || ch.allowed_roles.length === 0)
      ? CHANNEL_ROLE_OPTIONS.map(r => r.value)
      : ch.allowed_roles;
    setPermsChannel(ch);
    setPermsSelected(new Set(current));
  }

  function togglePermRole(role) {
    setPermsSelected(prev => {
      const next = new Set(prev);
      next.has(role) ? next.delete(role) : next.add(role);
      return next;
    });
  }

  async function handleSavePermissions() {
    if (!permsChannel) return;
    const all = CHANNEL_ROLE_OPTIONS.map(r => r.value);
    const selected = all.filter(r => permsSelected.has(r));
    // Everyone selected → store null ("open"); keeps semantics simple & backward compatible.
    const allowed_roles = selected.length === all.length ? null : selected;
    const { error } = await supabase.from('channels').update({ allowed_roles }).eq('id', permsChannel.id);
    if (error) { alert('Error: ' + error.message); return; }
    setChannels(prev => prev.map(c => c.id === permsChannel.id ? { ...c, allowed_roles } : c));
    setActiveChannel(prev => (prev?.id === permsChannel.id ? { ...prev, allowed_roles } : prev));
    setPermsChannel(null);
  }

  async function handleSendMessage(e) {
    e.preventDefault();
    if (!newMessage.trim() || !activeChannel || !profile?.id) return;

    const mentionRegex = /@(\w+(?:\s\w+)?)/g;
    const mentions = [];
    let match;
    while ((match = mentionRegex.exec(newMessage)) !== null) {
      const needle = match[1].toLowerCase();
      const mentioned = teamMembers.find(m =>
        (m.nickname || '').toLowerCase().includes(needle)
        || (m.full_name || '').toLowerCase().includes(needle)
      );
      if (mentioned) mentions.push(mentioned.id);
    }

    await supabase.from('channel_messages').insert({
      channel_id: activeChannel.id,
      user_id: profile.id,
      content: newMessage.trim(),
      mentions,
    });
    // Notify mentioned users
    if (mentions.length > 0) {
      const notifs = mentions
        .filter(uid => uid !== profile.id)
        .map(uid => ({
          user_id: uid,
          type: 'mention',
          title: `${getDisplayName(profile)} mentioned you in #${activeChannel.name}`,
          body: newMessage.trim().substring(0, 100),
          link_tab: 'channels',
          link_target: activeChannel.name,
        }));
      if (notifs.length > 0) {
        await supabase.from('notifications').insert(notifs);
      }
    }
    setNewMessage('');
    setShowMentions(false);
  }

  async function handleCreateChannel(e) {
    e.preventDefault();
    const name = channelName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const { error } = await supabase.from('channels').insert({
      name, description: channelDesc, created_by: profile.id,
    });
    if (error) { alert('Error: ' + error.message); return; }
    setChannelName('');
    setChannelDesc('');
    setShowCreateChannel(false);
    fetchChannels();
  }

  function handleInputChange(e) {
    const value = e.target.value;
    setNewMessage(value);
    const lastAtIndex = value.lastIndexOf('@');
    if (lastAtIndex >= 0) {
      const afterAt = value.substring(lastAtIndex + 1);
      if ((!afterAt.includes(' ') || afterAt.split(' ').length <= 2) && !afterAt.includes('\n')) {
        setShowMentions(true);
        setMentionFilter(afterAt.toLowerCase());
      } else {
        setShowMentions(false);
      }
    } else {
      setShowMentions(false);
    }
  }

  function handleMentionSelect(member) {
    const lastAtIndex = newMessage.lastIndexOf('@');
    const before = newMessage.substring(0, lastAtIndex);
    setNewMessage(`${before}@${getDisplayName(member)} `);
    setShowMentions(false);
    inputRef.current?.focus();
  }

  function handleKeyDown(e) {
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
  }

  const filteredMentions = teamMembers.filter(m =>
    (m.nickname || '').toLowerCase().includes(mentionFilter)
    || (m.full_name || '').toLowerCase().includes(mentionFilter)
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
        return <span key={i} style={msgStyles.mention}>{part}</span>;
      }
      if (part.startsWith('#')) {
        const chName = part.slice(1).toLowerCase();
        const matched = channels.find(c => c.name.toLowerCase() === chName);
        if (matched) {
          return (
            <span
              key={i}
              style={msgStyles.channelLink}
              onClick={() => setActiveChannel(matched)}
            >
              {part}
            </span>
          );
        }
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
          <ul key={`ul-${result.length}`} style={msgStyles.bulletList}>
            {bulletItems.map((item, j) => (
              <li key={j} style={msgStyles.bulletItem}>{formatInline(item)}</li>
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

  function formatTime(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function groupMessages(msgs) {
    const groups = [];
    msgs.forEach((msg, i) => {
      const prev = i > 0 ? msgs[i - 1] : null;
      const sameUser = prev && prev.user_id === msg.user_id;
      const withinTime = prev && (new Date(msg.created_at) - new Date(prev.created_at)) < 300000;
      if (sameUser && withinTime) {
        groups[groups.length - 1].messages.push(msg);
      } else {
        groups.push({ user: msg.profile, messages: [msg] });
      }
    });
    return groups;
  }

  const messageGroups = groupMessages(messages);

  return (
    <div style={styles.page}>
      {/* Channel Sidebar */}
      <div style={styles.channelSidebar}>
        <div style={styles.channelHeader}>
          <h3 style={styles.channelHeaderTitle}>Channels</h3>
          <button onClick={() => setShowCreateChannel(!showCreateChannel)} style={styles.addChannelBtn} title="Create channel">+</button>
        </div>

        {showCreateChannel && (
          <form onSubmit={handleCreateChannel} style={styles.createForm}>
            <input value={channelName} onChange={(e) => setChannelName(e.target.value)} placeholder="channel-name" required style={styles.formInput} />
            <input value={channelDesc} onChange={(e) => setChannelDesc(e.target.value)} placeholder="Description (optional)" style={styles.formInput} />
            <button type="submit" style={styles.createBtn}>Create</button>
          </form>
        )}

        <div style={styles.channelList}>
          {visibleChannels.map((ch) => (
            <ChannelItem
              key={ch.id}
              channel={ch}
              isActive={activeChannel?.id === ch.id}
              isAdmin={isAdmin}
              hasUnreadMention={unreadMentionChannelIds.includes(ch.id)}
              isDragging={draggedChannelId === ch.id}
              isDragOver={dragOverChannelId === ch.id && draggedChannelId !== ch.id}
              isRenaming={renamingChannelId === ch.id}
              onSelect={() => {
                setActiveChannel(ch);
                markChannelSeen(ch.id);
                refreshNotifications();
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ channelId: ch.id, x: e.clientX, y: e.clientY });
              }}
              onDragStart={() => setDraggedChannelId(ch.id)}
              onDragEnterItem={() => setDragOverChannelId(ch.id)}
              onDropItem={() => {
                handleReorderChannels(draggedChannelId, ch.id);
                setDraggedChannelId(null);
                setDragOverChannelId(null);
              }}
              onDragEnd={() => {
                setDraggedChannelId(null);
                setDragOverChannelId(null);
              }}
              onRenameSubmit={(name) => handleRenameChannel(ch.id, name)}
              onRenameCancel={() => setRenamingChannelId(null)}
            />
          ))}
        </div>
      </div>

      {contextMenu && (() => {
        const ch = channels.find(c => c.id === contextMenu.channelId);
        if (!ch) return null;
        return (
          <div
            style={{ ...styles.contextMenu, top: contextMenu.y, left: contextMenu.x }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              style={styles.contextMenuItem}
              onClick={() => { setRenamingChannelId(ch.id); setContextMenu(null); }}
            >Rename</button>
            <button
              style={styles.contextMenuItem}
              onClick={() => { openPermsModal(ch); setContextMenu(null); }}
            >Set Permissions</button>
            {!ch.is_default && (
              <button
                style={{ ...styles.contextMenuItem, ...styles.contextMenuItemDanger }}
                onClick={() => { setContextMenu(null); handleDeleteChannel(ch.id); }}
              >Delete</button>
            )}
          </div>
        );
      })()}

      {permsChannel && (
        <div style={styles.modalOverlay} onMouseDown={() => setPermsChannel(null)}>
          <div style={styles.modalCard} onMouseDown={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>Permissions · #{permsChannel.name}</h3>
            <p style={styles.modalHint}>
              Choose which roles can access this channel. Admins always have access.
            </p>
            <div style={styles.roleList}>
              {CHANNEL_ROLE_OPTIONS.map(({ value, label }) => {
                const on = permsSelected.has(value);
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => togglePermRole(value)}
                    style={styles.roleRow}
                  >
                    <span>{label}</span>
                    <span style={{ ...styles.roleToggle, ...(on ? styles.roleToggleOn : {}) }}>
                      <span style={{ ...styles.roleToggleKnob, ...(on ? styles.roleToggleKnobOn : {}) }} />
                    </span>
                  </button>
                );
              })}
            </div>
            {permsSelected.size === 0 && (
              <p style={styles.modalWarn}>No roles selected — only admins will see this channel.</p>
            )}
            <div style={styles.modalActions}>
              <button style={styles.modalCancelBtn} onClick={() => setPermsChannel(null)}>Cancel</button>
              <button style={styles.modalSaveBtn} onClick={handleSavePermissions}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Chat Area */}
      <div style={styles.chatArea}>
        {activeChannel ? (
          <>
            {/* Chat Header */}
            <div style={styles.chatHeader}>
              <span style={styles.chatHeaderHash}>#</span>
              <div style={{ flex: 1 }}>
                <h2 style={styles.chatHeaderName}>{activeChannel.name}</h2>
                {activeChannel.description && (
                  <p style={styles.chatHeaderDesc}>{activeChannel.description}</p>
                )}
              </div>
            </div>

            {/* Pinned Messages - Always visible */}
            {pinnedMessages.length > 0 && (
              <div style={styles.pinnedPanel}>
                <div style={styles.pinnedPanelHeader}>
                  <span style={styles.pinnedPanelTitle}>📌 Pinned ({pinnedMessages.length})</span>
                </div>
                {pinnedMessages.map(msg => (
                  <div key={msg.id} style={styles.pinnedItem}>
                    <div style={styles.pinnedItemHeader}>
                      <span style={styles.pinnedItemAuthor}>{getDisplayName(msg.profile)}</span>
                      <span style={styles.pinnedItemTime}>
                        {new Date(msg.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        {' '}
                        {new Date(msg.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      </span>
                    </div>
                    <div style={styles.pinnedItemText}>{formatMessageContent(msg.content)}</div>
                    <button
                      onClick={() => handlePinMessage(msg.id, true)}
                      style={styles.unpinBtn}
                    >Unpin</button>
                  </div>
                ))}
              </div>
            )}

            {/* Messages */}
            <div style={styles.messagesContainer}>
              {loadingMessages ? (
                <p style={styles.emptyText}>Loading messages...</p>
              ) : messages.length === 0 ? (
                <div style={styles.emptyMessages}>
                  <div style={styles.emptyIcon}>#</div>
                  <h3 style={styles.emptyTitle}>Welcome to #{activeChannel.name}</h3>
                  <p style={styles.emptySubtitle}>This is the beginning of the channel. Start the conversation!</p>
                </div>
              ) : (
                messageGroups.map((group, gi) => (
                  <div key={group.messages[0]?.id || gi} style={msgStyles.group}>
                    <div style={msgStyles.avatar}>
                      {getDisplayInitial(group.user)}
                    </div>
                    <div style={msgStyles.content}>
                      <div style={msgStyles.header}>
                        <span style={msgStyles.userName}>{getDisplayName(group.user) || 'Unknown'}</span>
                        <span style={msgStyles.time}>{formatTime(group.messages[0].created_at)}</span>
                      </div>
                      {group.messages.map(msg => (
                        <MessageRow
                          key={msg.id}
                          msg={msg}
                          isAdmin={isAdmin}
                          profileId={profile?.id}
                          onPin={handlePinMessage}
                          onEdit={handleEditMessage}
                          onDelete={handleDeleteMessage}
                          formatContent={formatMessageContent}
                        />
                      ))}
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div style={styles.inputArea}>
              {showMentions && filteredMentions.length > 0 && (
                <div style={styles.mentionPopup}>
                  {filteredMentions.slice(0, 6).map(m => (
                    <button
                      key={m.id}
                      onClick={() => handleMentionSelect(m)}
                      style={styles.mentionItem}
                    >
                      <div style={styles.mentionAvatar}>{getDisplayInitial(m)}</div>
                      <div>
                        <div style={styles.mentionName}>{getDisplayName(m)}</div>
                        <div style={styles.mentionTitle}>{m.title || 'Team Member'}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <form onSubmit={handleSendMessage} style={styles.inputForm}>
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={newMessage}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  placeholder={`Message #${activeChannel.name}... (type @ to mention)`}
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
          <div style={styles.noChannel}>
            <p>Select a channel to start chatting</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ChannelItem({
  channel, isActive, isAdmin, hasUnreadMention,
  isDragging, isDragOver, isRenaming,
  onSelect, onContextMenu,
  onDragStart, onDragEnterItem, onDropItem, onDragEnd,
  onRenameSubmit, onRenameCancel,
}) {
  const [renameValue, setRenameValue] = useState(channel.name);
  const renameInputRef = useRef(null);

  useEffect(() => {
    if (isRenaming) {
      setRenameValue(channel.name);
      requestAnimationFrame(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      });
    }
  }, [isRenaming, channel.name]);

  if (isRenaming) {
    return (
      <div style={styles.channelItemRow}>
        <div style={{ ...styles.channelItem, gap: '6px' }}>
          <span style={styles.hashIcon}>#</span>
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => onRenameSubmit(renameValue)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); onRenameSubmit(renameValue); }
              else if (e.key === 'Escape') { e.preventDefault(); onRenameCancel(); }
            }}
            style={styles.channelRenameInput}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        ...styles.channelItemRow,
        ...(isDragging ? styles.channelItemDragging : {}),
        ...(isDragOver ? styles.channelItemDragOver : {}),
      }}
      draggable={isAdmin}
      onDragStart={isAdmin ? onDragStart : undefined}
      onDragOver={isAdmin ? (e) => { e.preventDefault(); onDragEnterItem(); } : undefined}
      onDrop={isAdmin ? (e) => { e.preventDefault(); onDropItem(); } : undefined}
      onDragEnd={isAdmin ? onDragEnd : undefined}
      onContextMenu={isAdmin ? onContextMenu : undefined}
    >
      <button
        onClick={onSelect}
        style={{
          ...styles.channelItem,
          ...(isActive ? styles.channelItemActive : {}),
          ...(isAdmin ? { cursor: 'grab' } : {}),
        }}
      >
        <span style={styles.hashIcon}>#</span>
        <span style={styles.channelItemName}>{channel.name}</span>
        {isAdmin && channel.allowed_roles && channel.allowed_roles.length > 0 && (
          <span title="Restricted to certain roles" style={styles.channelLock}>🔒</span>
        )}
        {hasUnreadMention && <span style={styles.channelUnreadDot} />}
      </button>
    </div>
  );
}

function MessageRow({ msg, isAdmin, profileId, onPin, onEdit, onDelete, formatContent }) {
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(msg.content);
  const menuRef = useRef(null);
  const editInputRef = useRef(null);

  const isOwner = msg.user_id === profileId;
  const canEdit = isOwner;
  const canDelete = isAdmin || isOwner;
  const canPin = isAdmin;

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

  function handleCopy() {
    navigator.clipboard.writeText(msg.content).catch(() => {});
    setMenuOpen(false);
  }

  function handleStartEdit() {
    setEditContent(msg.content);
    setEditing(true);
    setMenuOpen(false);
  }

  function handleSaveEdit() {
    if (editContent.trim() && editContent.trim() !== msg.content) {
      onEdit(msg.id, editContent);
    }
    setEditing(false);
  }

  function handleCancelEdit() {
    setEditContent(msg.content);
    setEditing(false);
  }

  useEffect(() => {
    if (editInputRef.current) {
      editInputRef.current.style.height = 'auto';
      editInputRef.current.style.height = Math.min(editInputRef.current.scrollHeight, 150) + 'px';
    }
  }, [editContent]);

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
      style={{
        ...msgStyles.messageRow,
        background: hovered || menuOpen ? 'rgba(255,255,255,0.02)' : 'transparent',
        borderRadius: '6px',
        margin: '0 -4px',
        padding: '2px 4px',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); }}
    >
      {editing ? (
        <div style={{ flex: 1 }}>
          <textarea
            ref={editInputRef}
            rows={1}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            onKeyDown={handleEditKeyDown}
            style={msgStyles.editInput}
          />
          <div style={msgStyles.editActions}>
            <span style={msgStyles.editHint}>Shift+Enter for new line. Enter to save, Esc to cancel</span>
            <button onClick={handleCancelEdit} style={msgStyles.editCancelBtn}>Cancel</button>
            <button onClick={handleSaveEdit} style={msgStyles.editSaveBtn}>Save</button>
          </div>
        </div>
      ) : (
        <>
          <div style={msgStyles.text}>
            {msg.is_pinned && <span style={msgStyles.pinBadge}>📌</span>}
            {formatContent(msg.content)}
            {msg.edited_at && <span style={msgStyles.editedTag}>(edited)</span>}
          </div>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
              style={{
                ...msgStyles.menuBtn,
                opacity: hovered || menuOpen ? 0.7 : 0,
              }}
              title="More options"
            >
              ⋯
            </button>
            {menuOpen && (
              <div ref={menuRef} style={msgStyles.menuDropdown}>
                {canEdit && (
                  <button onClick={handleStartEdit} style={msgStyles.menuItem}>
                    ✏️ Edit
                  </button>
                )}
                {canPin && (
                  <button
                    onClick={() => { onPin(msg.id, msg.is_pinned); setMenuOpen(false); }}
                    style={msgStyles.menuItem}
                  >
                    📌 {msg.is_pinned ? 'Unpin' : 'Pin'}
                  </button>
                )}
                <button onClick={handleCopy} style={msgStyles.menuItem}>
                  📋 Copy
                </button>
                {canDelete && (
                  <button
                    onClick={() => { onDelete(msg.id); setMenuOpen(false); }}
                    style={{ ...msgStyles.menuItem, color: '#fca5a5' }}
                  >
                    🗑 Delete
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const styles = {
  page: { display: 'flex', height: '100%' },
  channelSidebar: {
    width: '240px', minWidth: '240px',
    borderRight: '1px solid rgba(255,255,255,0.06)',
    display: 'flex', flexDirection: 'column',
    background: 'rgba(255,255,255,0.01)',
  },
  channelHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 16px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  channelHeaderTitle: {
    fontSize: '13px', fontWeight: 700, color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase', letterSpacing: '0.5px', margin: 0,
  },
  addChannelBtn: {
    width: '24px', height: '24px', display: 'flex', alignItems: 'center',
    justifyContent: 'center', border: 'none', borderRadius: '6px',
    background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)',
    fontSize: '16px', cursor: 'pointer',
  },
  createForm: {
    padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  formInput: {
    padding: '8px 10px', background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
    color: '#fff', fontSize: '13px', fontFamily: 'inherit', outline: 'none',
  },
  createBtn: {
    padding: '7px', background: '#6366f1', border: 'none', borderRadius: '6px',
    color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
    fontFamily: 'inherit',
  },
  channelList: {
    flex: 1, overflow: 'auto', padding: '8px',
  },
  channelItemRow: {
    display: 'flex', alignItems: 'center', gap: '2px', position: 'relative',
    borderRadius: '8px', transition: 'background 0.1s, opacity 0.1s',
  },
  channelItemDragging: {
    opacity: 0.4,
  },
  channelItemDragOver: {
    background: 'rgba(99,102,241,0.18)',
    boxShadow: 'inset 0 2px 0 #6366f1',
  },
  channelRenameInput: {
    flex: 1, padding: '2px 4px', background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(99,102,241,0.5)', borderRadius: '5px',
    color: '#fff', fontSize: '14px', fontFamily: 'inherit', outline: 'none',
    minWidth: 0,
  },
  contextMenu: {
    position: 'fixed', zIndex: 1000, minWidth: '140px',
    background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px', padding: '4px', display: 'flex', flexDirection: 'column',
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  },
  contextMenuItem: {
    padding: '8px 10px', background: 'none', border: 'none', textAlign: 'left',
    color: 'rgba(255,255,255,0.8)', fontSize: '13px', fontFamily: 'inherit',
    cursor: 'pointer', borderRadius: '6px', width: '100%',
  },
  contextMenuItemDanger: {
    color: '#ef4444',
  },
  channelLock: {
    fontSize: '10px', opacity: 0.55, marginLeft: '2px', flexShrink: 0,
  },
  modalOverlay: {
    position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
  },
  modalCard: {
    width: '340px', maxWidth: '100%', background: '#1a1a2e',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px',
    padding: '18px', boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
  },
  modalTitle: {
    margin: '0 0 4px', color: '#fff', fontSize: '15px', fontWeight: 700,
  },
  modalHint: {
    margin: '0 0 14px', color: 'rgba(255,255,255,0.45)', fontSize: '12px', lineHeight: 1.4,
  },
  roleList: {
    display: 'flex', flexDirection: 'column', gap: '4px',
  },
  roleRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '9px 10px', background: 'rgba(255,255,255,0.04)', border: 'none',
    borderRadius: '8px', color: 'rgba(255,255,255,0.85)', fontSize: '13px',
    fontFamily: 'inherit', cursor: 'pointer', width: '100%',
  },
  roleToggle: {
    width: '34px', height: '20px', borderRadius: '10px', background: 'rgba(255,255,255,0.15)',
    position: 'relative', transition: 'background 0.15s', flexShrink: 0,
  },
  roleToggleOn: {
    background: '#6366f1',
  },
  roleToggleKnob: {
    position: 'absolute', top: '2px', left: '2px', width: '16px', height: '16px',
    borderRadius: '50%', background: '#fff', transition: 'left 0.15s',
  },
  roleToggleKnobOn: {
    left: '16px',
  },
  modalWarn: {
    margin: '12px 0 0', color: '#f59e0b', fontSize: '11.5px', lineHeight: 1.4,
  },
  modalActions: {
    display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px',
  },
  modalCancelBtn: {
    padding: '8px 14px', background: 'rgba(255,255,255,0.06)', border: 'none',
    borderRadius: '7px', color: 'rgba(255,255,255,0.7)', fontSize: '13px',
    fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  },
  modalSaveBtn: {
    padding: '8px 16px', background: '#6366f1', border: 'none', borderRadius: '7px',
    color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  },
  channelItem: {
    display: 'flex', alignItems: 'center', gap: '8px',
    flex: 1, padding: '8px 10px', border: 'none', borderRadius: '8px',
    background: 'transparent', color: 'rgba(255,255,255,0.45)',
    fontSize: '14px', cursor: 'pointer', fontFamily: 'inherit',
    textAlign: 'left', transition: 'all 0.1s',
  },
  channelItemActive: {
    background: 'rgba(99,102,241,0.12)', color: '#e2e8f0',
  },
  hashIcon: {
    fontSize: '16px', fontWeight: 700, opacity: 0.5,
  },
  channelItemName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  channelUnreadDot: {
    width: '8px', height: '8px', borderRadius: '50%',
    background: '#ef4444', flexShrink: 0, marginLeft: 'auto',
  },
  pinHeaderBtn: {
    padding: '5px 10px', background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px',
    color: 'rgba(255,255,255,0.4)', fontSize: '11px', fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
    whiteSpace: 'nowrap',
  },
  pinHeaderBtnActive: {
    background: 'rgba(251,191,36,0.1)', borderColor: 'rgba(251,191,36,0.3)',
    color: '#fbbf24',
  },
  pinnedPanel: {
    background: 'rgba(251,191,36,0.04)',
    borderBottom: '1px solid rgba(251,191,36,0.12)',
    padding: '12px 16px', maxHeight: '200px', overflow: 'auto',
  },
  pinnedPanelHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: '8px',
  },
  pinnedPanelTitle: {
    fontSize: '12px', fontWeight: 700, color: '#fbbf24',
  },
  pinnedCloseBtn: {
    background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)',
    cursor: 'pointer', fontSize: '14px',
  },
  pinnedItem: {
    padding: '8px 10px', background: 'rgba(255,255,255,0.03)',
    borderRadius: '8px', marginBottom: '6px',
    border: '1px solid rgba(251,191,36,0.08)',
  },
  pinnedItemHeader: {
    display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '3px',
  },
  pinnedItemAuthor: {
    fontSize: '12px', fontWeight: 600, color: '#e2e8f0',
  },
  pinnedItemTime: {
    fontSize: '10px', color: 'rgba(255,255,255,0.25)',
  },
  pinnedItemText: {
    fontSize: '13px', color: 'rgba(255,255,255,0.6)', margin: '0 0 4px 0',
    lineHeight: 1.4,
  },
  unpinBtn: {
    background: 'none', border: 'none', color: 'rgba(255,255,255,0.25)',
    fontSize: '10px', cursor: 'pointer', padding: 0, fontFamily: 'inherit',
  },
  chatArea: {
    flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0,
  },
  chatHeader: {
    display: 'flex', alignItems: 'center', gap: '10px',
    padding: '14px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  chatHeaderHash: {
    fontSize: '22px', fontWeight: 700, color: 'rgba(255,255,255,0.2)',
  },
  chatHeaderName: {
    fontSize: '16px', fontWeight: 600, color: '#e2e8f0', margin: 0,
  },
  chatHeaderDesc: {
    fontSize: '12px', color: 'rgba(255,255,255,0.35)', margin: 0,
  },
  messagesContainer: {
    flex: 1, overflow: 'auto', padding: '16px 24px',
  },
  emptyMessages: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', height: '100%', textAlign: 'center',
  },
  emptyIcon: {
    fontSize: '48px', fontWeight: 700, color: 'rgba(99,102,241,0.3)',
    background: 'rgba(99,102,241,0.08)', width: '80px', height: '80px',
    borderRadius: '20px', display: 'flex', alignItems: 'center',
    justifyContent: 'center', marginBottom: '16px',
  },
  emptyTitle: {
    fontSize: '18px', fontWeight: 600, color: '#e2e8f0', margin: '0 0 6px 0',
  },
  emptySubtitle: {
    fontSize: '14px', color: 'rgba(255,255,255,0.35)', margin: 0,
  },
  emptyText: {
    color: 'rgba(255,255,255,0.35)', fontSize: '14px', textAlign: 'center',
    paddingTop: '40px',
  },
  inputArea: {
    padding: '12px 24px 16px', position: 'relative', flexShrink: 0,
  },
  mentionPopup: {
    position: 'absolute', bottom: '100%', left: '24px', right: '24px',
    background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '10px', padding: '6px', marginBottom: '4px',
    boxShadow: '0 -8px 24px rgba(0,0,0,0.4)', maxHeight: '200px', overflow: 'auto',
  },
  mentionItem: {
    display: 'flex', alignItems: 'center', gap: '10px',
    width: '100%', padding: '8px 10px', border: 'none', borderRadius: '6px',
    background: 'transparent', color: '#e2e8f0', cursor: 'pointer',
    fontFamily: 'inherit', textAlign: 'left', transition: 'background 0.1s',
  },
  mentionAvatar: {
    width: '28px', height: '28px', borderRadius: '8px',
    background: 'rgba(99,102,241,0.25)', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    fontSize: '12px', fontWeight: 600, color: '#a5b4fc',
  },
  mentionName: { fontSize: '13px', fontWeight: 600 },
  mentionTitle: { fontSize: '11px', color: 'rgba(255,255,255,0.35)' },
  inputForm: {
    display: 'flex', gap: '8px',
  },
  messageInput: {
    flex: 1, padding: '12px 16px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px',
    color: '#fff', fontSize: '14px', fontFamily: 'inherit', outline: 'none',
    resize: 'none', lineHeight: 1.5, minHeight: '42px', maxHeight: '150px',
    overflow: 'auto',
  },
  formatHint: {
    fontSize: '11px', color: 'rgba(255,255,255,0.2)', marginTop: '4px',
    paddingLeft: '2px',
  },
  sendBtn: {
    width: '42px', height: '42px', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    background: '#6366f1', border: 'none', borderRadius: '10px',
    color: '#fff', cursor: 'pointer', transition: 'opacity 0.15s',
  },
  noChannel: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: '100%', color: 'rgba(255,255,255,0.35)',
  },
};

const msgStyles = {
  group: {
    display: 'flex', gap: '12px', marginBottom: '16px',
  },
  avatar: {
    width: '36px', height: '36px', borderRadius: '10px',
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '14px', fontWeight: 700, color: '#fff', flexShrink: 0,
  },
  content: { flex: 1, minWidth: 0 },
  header: {
    display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '2px',
  },
  userName: { fontSize: '14px', fontWeight: 600, color: '#e2e8f0' },
  time: { fontSize: '11px', color: 'rgba(255,255,255,0.25)' },
  text: {
    fontSize: '14px', color: 'rgba(255,255,255,0.75)',
    margin: '2px 0', lineHeight: 1.5, wordBreak: 'break-word', flex: 1,
  },
  messageRow: {
    display: 'flex', alignItems: 'flex-start', gap: '6px',
  },
  menuBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: '16px', padding: '2px 6px', color: 'rgba(255,255,255,0.5)',
    transition: 'opacity 0.15s', flexShrink: 0, marginTop: '1px',
    letterSpacing: '1px', lineHeight: 1, borderRadius: '4px',
  },
  menuDropdown: {
    position: 'absolute', top: '100%', right: 0, marginTop: '4px',
    background: '#1e1e36', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '8px', padding: '4px', zIndex: 50, minWidth: '130px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  },
  menuItem: {
    display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
    padding: '7px 10px', background: 'none', border: 'none', borderRadius: '5px',
    color: 'rgba(255,255,255,0.65)', fontSize: '12px', cursor: 'pointer',
    fontFamily: 'inherit', textAlign: 'left', transition: 'background 0.1s',
  },
  pinBadge: {
    marginRight: '4px', fontSize: '11px',
  },
  mention: {
    background: 'rgba(99,102,241,0.2)', color: '#a5b4fc',
    padding: '1px 4px', borderRadius: '4px', fontWeight: 600,
  },
  channelLink: {
    background: 'rgba(99,102,241,0.15)', color: '#a5b4fc',
    padding: '1px 4px', borderRadius: '4px', fontWeight: 600,
    cursor: 'pointer', textDecoration: 'none',
  },
  editedTag: {
    fontSize: '11px', color: 'rgba(255,255,255,0.25)', marginLeft: '6px',
    fontStyle: 'italic',
  },
  editInput: {
    width: '100%', padding: '8px 12px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(99,102,241,0.4)', borderRadius: '8px',
    color: '#fff', fontSize: '14px', fontFamily: 'inherit', outline: 'none',
    boxSizing: 'border-box',
    resize: 'none', lineHeight: 1.5, minHeight: '36px', maxHeight: '150px',
    overflow: 'auto',
  },
  bulletList: {
    margin: '4px 0', paddingLeft: '20px', listStyleType: 'disc',
  },
  bulletItem: {
    fontSize: '14px', color: 'rgba(255,255,255,0.75)', lineHeight: 1.5,
    marginBottom: '2px',
  },
  editActions: {
    display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px',
  },
  editHint: {
    fontSize: '11px', color: 'rgba(255,255,255,0.25)', flex: 1,
  },
  editCancelBtn: {
    padding: '4px 10px', background: 'none',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
    color: 'rgba(255,255,255,0.5)', fontSize: '12px', cursor: 'pointer',
    fontFamily: 'inherit',
  },
  editSaveBtn: {
    padding: '4px 10px', background: '#6366f1',
    border: 'none', borderRadius: '6px',
    color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
    fontFamily: 'inherit',
  },
};
