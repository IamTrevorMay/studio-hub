import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
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

// A null/empty allowed_roles list is open to everyone. Otherwise only the
// listed roles — plus admin-tier, who always see everything.
function rolesAllow(allowed, role) {
  if (!allowed || allowed.length === 0) return true;
  return allowed.includes(role);
}

// A grouped channel's visibility is governed by its group's permissions (the
// group overrides the channel's own); an ungrouped channel uses its own.
function effectiveChannelVisible(channel, group, role) {
  if (group) return rolesAllow(group.allowed_roles, role);
  return rolesAllow(channel.allowed_roles, role);
}


// Highlighter palette. The wire syntax is ==N:text== where N is a 1-based index
// into this array; formatInline renders each with the matching background.
const HIGHLIGHT_COLORS = [
  { name: 'Yellow', bg: '#fde047' },
  { name: 'Green', bg: '#86efac' },
  { name: 'Blue', bg: '#93c5fd' },
  { name: 'Pink', bg: '#f9a8d4' },
  { name: 'Purple', bg: '#c4b5fd' },
  { name: 'Orange', bg: '#fdba74' },
  { name: 'Red', bg: '#fca5a5' },
  { name: 'Teal', bg: '#5eead4' },
];

// Wrap the current selection (or insert at the cursor) with the given before/
// after markers, keeping any selected text selected afterwards.
function applyFormatWrap(textareaRef, text, before, after, setter) {
  const el = textareaRef.current;
  if (!el) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const selected = text.substring(start, end);
  const newText = text.substring(0, start) + before + selected + after + text.substring(end);
  setter(newText);
  requestAnimationFrame(() => {
    el.selectionStart = start + before.length;
    el.selectionEnd = end + before.length;
    el.focus();
  });
}

// Insert a snippet at the cursor (used for block-level inserts like dividers).
function insertAtCursor(textareaRef, text, snippet, setter) {
  const el = textareaRef.current;
  if (!el) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const newText = text.substring(0, start) + snippet + text.substring(end);
  setter(newText);
  requestAnimationFrame(() => {
    const pos = start + snippet.length;
    el.selectionStart = pos;
    el.selectionEnd = pos;
    el.focus();
  });
}

function applyFormatMarker(textareaRef, text, marker, setter) {
  applyFormatWrap(textareaRef, text, marker, marker, setter);
}

export default function Channels({ initialChannelName, onChannelOpened }) {
  const { profile, isAdmin, refreshKey } = useAuth();
  const { unreadMentionChannelIds, markChannelSeen, refreshNotifications } = useNotifications();
  const confirm = useConfirm();
  const [channels, setChannels] = useState([]);
  const [groups, setGroups] = useState([]);
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [renamingGroupId, setRenamingGroupId] = useState(null);
  const [contextMenu, setContextMenu] = useState(null); // { kind: 'channel'|'group', id, x, y }
  const [renamingChannelId, setRenamingChannelId] = useState(null);
  const [permsTarget, setPermsTarget] = useState(null); // { kind: 'channel'|'group', row } being edited
  const [permsSelected, setPermsSelected] = useState(() => new Set());
  const [activeChannel, setActiveChannel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [showPinned, setShowPinned] = useState(true);
  const [highlightedMsgId, setHighlightedMsgId] = useState(null);
  const [newMessage, setNewMessage] = useState('');
  const [showHighlightPicker, setShowHighlightPicker] = useState(false);
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

  const groupById = useMemo(() => {
    const m = {};
    groups.forEach(g => { m[g.id] = g; });
    return m;
  }, [groups]);

  // Admins manage everything; everyone else only sees channels their role is
  // permitted to access — via the channel's group when it has one, else its own.
  const visibleChannels = useMemo(
    () => channels.filter(ch => isAdmin || effectiveChannelVisible(ch, ch.group_id ? groupById[ch.group_id] : null, profile?.role)),
    [channels, groupById, isAdmin, profile?.role],
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

  const fetchGroups = useCallback(async () => {
    try {
      const { data } = await supabase.from('channel_groups')
        .select('*').order('sort_order', { ascending: true }).order('name');
      setGroups(data || []);
    } catch (err) {
      console.error('Error fetching channel groups:', err);
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
    Promise.all([fetchChannels(), fetchGroups(), fetchTeamMembers()])
      .finally(() => setLoading(false));
  }, [profile?.id, fetchChannels, fetchGroups, fetchTeamMembers]);
  useVisibilityRefresh(useCallback(() => {
    if (profile?.id) { fetchChannels(); fetchGroups(); }
  }, [profile?.id, fetchChannels, fetchGroups]));

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

  // Close the highlight color picker on outside click or Escape. The picker
  // itself stops mousedown propagation so selecting a swatch doesn't close it early.
  useEffect(() => {
    if (!showHighlightPicker) return;
    function close(e) {
      if (e.type === 'keydown' && e.key !== 'Escape') return;
      setShowHighlightPicker(false);
    }
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [showHighlightPicker]);

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
      // Fetch the NEWEST 100 (desc + limit), then reverse to chronological order.
      // Ordering ascending with a limit returned the OLDEST 100 and hid the live
      // conversation in any channel with >100 messages.
      const { data, error } = await supabase
        .from('channel_messages')
        .select('*, profile:profiles(id, full_name, nickname, title, avatar_url)')
        .eq('channel_id', channelId)
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
        // Dedup by id — a realtime reconnect/redelivery can re-fire INSERT.
        if (data && mounted) setMessages(prev => prev.some(m => m.id === data.id) ? prev : [...prev, data]);
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

  // Drag-and-drop reorder AND move channels between groups. Droppable ids are
  // 'ungrouped' or `group:<id>`; a null group_id means the channel is ungrouped.
  const dropIdToGroupId = (dropId) => (dropId === 'ungrouped' ? null : dropId.slice('group:'.length));

  async function onChannelDragEnd(result) {
    const { source, destination } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    // Snapshot each section's channels in their current display order.
    const sectionOf = (dropId) => {
      const gid = dropIdToGroupId(dropId);
      return channels.filter(c => (c.group_id || null) === gid);
    };
    const srcArr = Array.from(sectionOf(source.droppableId));
    const sameSection = source.droppableId === destination.droppableId;
    const dstArr = sameSection ? srcArr : Array.from(sectionOf(destination.droppableId));

    const [moved] = srcArr.splice(source.index, 1);
    if (!moved) return;
    const newGroupId = dropIdToGroupId(destination.droppableId);
    dstArr.splice(destination.index, 0, { ...moved, group_id: newGroupId });

    // Rebuild the full channel list in display order (ungrouped, then each group
    // in group order) and renumber to a contiguous 0..n-1 sequence so within-
    // section ordering is preserved despite a single shared sort_order column.
    const sectionArrs = new Map();
    sectionArrs.set('ungrouped', source.droppableId === 'ungrouped' ? srcArr
      : destination.droppableId === 'ungrouped' ? dstArr
      : sectionOf('ungrouped'));
    groups.forEach(g => {
      const key = `group:${g.id}`;
      sectionArrs.set(key, source.droppableId === key ? srcArr
        : destination.droppableId === key ? dstArr
        : sectionOf(key));
    });
    const flat = [
      ...sectionArrs.get('ungrouped'),
      ...groups.flatMap(g => sectionArrs.get(`group:${g.id}`)),
    ];
    const withOrder = flat.map((c, i) => ({ ...c, sort_order: i }));
    setChannels(withOrder); // optimistic

    // Only write rows whose sort_order or group_id actually changed.
    const prevById = new Map(channels.map(c => [c.id, c]));
    await Promise.all(
      withOrder
        .filter(c => {
          const p = prevById.get(c.id);
          return !p || p.sort_order !== c.sort_order || (p.group_id || null) !== (c.group_id || null);
        })
        .map(c => supabase.from('channels')
          .update({ sort_order: c.sort_order, group_id: c.group_id }).eq('id', c.id))
    );
    fetchChannels();
  }

  async function handleRenameChannel(channelId, rawName) {
    const name = rawName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    setRenamingChannelId(null);
    const ch = channels.find(c => c.id === channelId);
    if (!name || !ch || name === ch.name) return;
    // Channel names are unique — catch a collision up front so the user gets a
    // clear message instead of a raw "channels_name_key" constraint error.
    if (channels.some(c => c.id !== channelId && c.name === name)) {
      alert(`A channel named #${name} already exists. Please choose a different name.`);
      return;
    }
    const { error } = await supabase.from('channels').update({ name }).eq('id', channelId);
    if (error) {
      alert(error.code === '23505'
        ? `A channel named #${name} already exists. Please choose a different name.`
        : 'Error: ' + error.message);
      return;
    }
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

  // Works for both channels and groups (kind = 'channel' | 'group').
  function openPermsModal(kind, row) {
    // null/empty allowed_roles means "open to everyone" → start with all on.
    const current = (!row.allowed_roles || row.allowed_roles.length === 0)
      ? CHANNEL_ROLE_OPTIONS.map(r => r.value)
      : row.allowed_roles;
    setPermsTarget({ kind, row });
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
    if (!permsTarget) return;
    const all = CHANNEL_ROLE_OPTIONS.map(r => r.value);
    const selected = all.filter(r => permsSelected.has(r));
    // Everyone selected → store null ("open"); keeps semantics simple & backward compatible.
    const allowed_roles = selected.length === all.length ? null : selected;
    const table = permsTarget.kind === 'group' ? 'channel_groups' : 'channels';
    const { error } = await supabase.from(table).update({ allowed_roles }).eq('id', permsTarget.row.id);
    if (error) { alert('Error: ' + error.message); return; }
    if (permsTarget.kind === 'group') {
      setGroups(prev => prev.map(g => g.id === permsTarget.row.id ? { ...g, allowed_roles } : g));
    } else {
      setChannels(prev => prev.map(c => c.id === permsTarget.row.id ? { ...c, allowed_roles } : c));
      setActiveChannel(prev => (prev?.id === permsTarget.row.id ? { ...prev, allowed_roles } : prev));
    }
    setPermsTarget(null);
  }

  // ── Group management (admin) ──
  async function handleCreateGroup(e) {
    e.preventDefault();
    const name = groupName.trim();
    if (!name) { alert('Please enter a group name.'); return; }
    const maxOrder = groups.reduce((m, g) => Math.max(m, g.sort_order ?? 0), -1);
    const { error } = await supabase.from('channel_groups')
      .insert({ name, created_by: profile.id, sort_order: maxOrder + 1 });
    if (error) { alert('Error: ' + error.message); return; }
    setGroupName('');
    setShowCreateGroup(false);
    fetchGroups();
  }

  async function handleRenameGroup(groupId, rawName) {
    setRenamingGroupId(null);
    const name = rawName.trim();
    const g = groups.find(x => x.id === groupId);
    if (!name || !g || name === g.name) return;
    const { error } = await supabase.from('channel_groups').update({ name }).eq('id', groupId);
    if (error) { alert('Error: ' + error.message); return; }
    setGroups(prev => prev.map(x => x.id === groupId ? { ...x, name } : x));
  }

  async function handleDeleteGroup(groupId) {
    const g = groups.find(x => x.id === groupId);
    if (!(await confirm(`Delete the group "${g?.name || ''}"? Its channels will be ungrouped (not deleted).`))) return;
    const { error } = await supabase.from('channel_groups').delete().eq('id', groupId);
    if (error) { alert('Error: ' + error.message); return; }
    await Promise.all([fetchGroups(), fetchChannels()]);
  }

  async function handleMoveChannelToGroup(channelId, groupId) {
    setContextMenu(null);
    const { error } = await supabase.from('channels').update({ group_id: groupId }).eq('id', channelId);
    if (error) { alert('Error: ' + error.message); return; }
    setChannels(prev => prev.map(c => c.id === channelId ? { ...c, group_id: groupId } : c));
  }

  function toggleGroupCollapse(groupId) {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      next.has(groupId) ? next.delete(groupId) : next.add(groupId);
      return next;
    });
  }

  // ── Pinned "table of contents" → jump to the message in the thread ──
  function pinnedSnippet(content) {
    const firstLine = (content || '').split('\n').find(l => l.trim()) || content || '';
    const plain = firstLine.replace(/\*\*/g, '').replace(/\*/g, '').replace(/^[-•]\s*/, '').trim();
    return plain.length > 60 ? plain.slice(0, 60) + '…' : plain;
  }

  function scrollToMessage(id) {
    const el = document.getElementById(`chan-msg-${id}`);
    if (!el) return; // older than the loaded window — nothing to scroll to
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedMsgId(id);
    setTimeout(() => setHighlightedMsgId(h => (h === id ? null : h)), 1800);
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
    if (!name) { alert('Please enter a channel name.'); return; }
    // Channel names are unique — catch a collision up front so the user gets a
    // clear message instead of a raw "channels_name_key" constraint error.
    if (channels.some(c => c.name === name)) {
      alert(`A channel named #${name} already exists. Please choose a different name.`);
      return;
    }
    const { error } = await supabase.from('channels').insert({
      name, description: channelDesc, created_by: profile.id,
    });
    if (error) {
      alert(error.code === '23505'
        ? `A channel named #${name} already exists. Please choose a different name.`
        : 'Error: ' + error.message);
      return;
    }
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
    const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|__[^_]+__|==\d:[^=]+==|[@#]\w+(?:[- ]\w+)*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} style={{ fontWeight: 700, color: '#e2e8f0' }}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('__') && part.endsWith('__') && part.length > 4) {
        return <u key={i} style={{ textDecoration: 'underline' }}>{part.slice(2, -2)}</u>;
      }
      if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
        return <em key={i} style={{ fontStyle: 'italic', color: 'rgba(255,255,255,0.85)' }}>{part.slice(1, -1)}</em>;
      }
      const hl = part.match(/^==(\d):([^=]+)==$/);
      if (hl) {
        const color = HIGHLIGHT_COLORS[Number(hl[1]) - 1] || HIGHLIGHT_COLORS[0];
        return (
          <mark key={i} style={{ background: color.bg, color: '#1a1a2e', borderRadius: '3px', padding: '0 3px' }}>
            {hl[2]}
          </mark>
        );
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
    if (!content.includes('\n') && !/^[-•] /.test(content) && content.trim() !== '---') {
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
      if (line.trim() === '---') {
        flushBullets();
        result.push(<hr key={`hr-${i}`} style={msgStyles.divider} />);
        return;
      }
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

  const renderChannelItem = (ch, index) => (
    <Draggable
      key={ch.id}
      draggableId={ch.id}
      index={index}
      isDragDisabled={!isAdmin || renamingChannelId === ch.id}
    >
      {(provided, snapshot) => (
        <ChannelItem
          channel={ch}
          isActive={activeChannel?.id === ch.id}
          isAdmin={isAdmin}
          hasUnreadMention={unreadMentionChannelIds.includes(ch.id)}
          isRenaming={renamingChannelId === ch.id}
          dragProvided={provided}
          isDragging={snapshot.isDragging}
          onSelect={() => {
            setActiveChannel(ch);
            markChannelSeen(ch.id);
            refreshNotifications();
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenu({ kind: 'channel', id: ch.id, x: e.clientX, y: e.clientY });
          }}
          onRenameSubmit={(name) => handleRenameChannel(ch.id, name)}
          onRenameCancel={() => setRenamingChannelId(null)}
        />
      )}
    </Draggable>
  );

  // Ungrouped channels render at the top; each group renders as a collapsible
  // section below. Non-admins only see groups that contain a channel visible
  // to them (group perms already filtered those out of visibleChannels).
  const ungroupedChannels = visibleChannels.filter(c => !c.group_id);
  const visibleGroups = isAdmin
    ? groups
    : groups.filter(g => visibleChannels.some(c => c.group_id === g.id));

  return (
    <div style={styles.page}>
      {/* Channel Sidebar */}
      <div style={styles.channelSidebar}>
        <div style={styles.channelHeader}>
          <h3 style={styles.channelHeaderTitle}>Channels</h3>
          <div style={{ display: 'flex', gap: '4px' }}>
            {isAdmin && (
              <button
                onClick={() => { setShowCreateGroup(v => !v); setShowCreateChannel(false); }}
                style={styles.addChannelBtn}
                title="Create group"
              >📁</button>
            )}
            <button
              onClick={() => { setShowCreateChannel(v => !v); setShowCreateGroup(false); }}
              style={styles.addChannelBtn}
              title="Create channel"
            >+</button>
          </div>
        </div>

        {showCreateChannel && (
          <form onSubmit={handleCreateChannel} style={styles.createForm}>
            <input value={channelName} onChange={(e) => setChannelName(e.target.value)} placeholder="channel-name" required style={styles.formInput} />
            <input value={channelDesc} onChange={(e) => setChannelDesc(e.target.value)} placeholder="Description (optional)" style={styles.formInput} />
            <button type="submit" style={styles.createBtn}>Create</button>
          </form>
        )}

        {showCreateGroup && (
          <form onSubmit={handleCreateGroup} style={styles.createForm}>
            <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Group name" required style={styles.formInput} />
            <button type="submit" style={styles.createBtn}>Create group</button>
          </form>
        )}

        <DragDropContext onDragEnd={onChannelDragEnd}>
          <div style={styles.channelList}>
            <Droppable droppableId="ungrouped">
              {(provided) => (
                <div ref={provided.innerRef} {...provided.droppableProps}>
                  {ungroupedChannels.map((ch, i) => renderChannelItem(ch, i))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>

            {visibleGroups.map((g) => {
              const collapsed = collapsedGroups.has(g.id);
              const groupChannels = visibleChannels.filter(c => c.group_id === g.id);
              return (
                <div key={g.id} style={styles.groupBlock}>
                  <GroupHeader
                    group={g}
                    isAdmin={isAdmin}
                    collapsed={collapsed}
                    isRenaming={renamingGroupId === g.id}
                    onToggle={() => toggleGroupCollapse(g.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ kind: 'group', id: g.id, x: e.clientX, y: e.clientY });
                    }}
                    onRenameSubmit={(name) => handleRenameGroup(g.id, name)}
                    onRenameCancel={() => setRenamingGroupId(null)}
                  />
                  {!collapsed && (
                    <Droppable droppableId={`group:${g.id}`}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          style={{
                            ...styles.groupChannels,
                            ...(snapshot.isDraggingOver ? styles.groupChannelsDragOver : {}),
                          }}
                        >
                          {groupChannels.length === 0 && !snapshot.isDraggingOver
                            ? <div style={styles.groupEmpty}>No channels yet</div>
                            : groupChannels.map((ch, i) => renderChannelItem(ch, i))}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  )}
                </div>
              );
            })}
          </div>
        </DragDropContext>
      </div>

      {contextMenu && contextMenu.kind === 'group' && (() => {
        const g = groups.find(x => x.id === contextMenu.id);
        if (!g) return null;
        return (
          <div
            style={{ ...styles.contextMenu, top: contextMenu.y, left: contextMenu.x }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              style={styles.contextMenuItem}
              onClick={() => { setRenamingGroupId(g.id); setContextMenu(null); }}
            >Rename</button>
            <button
              style={styles.contextMenuItem}
              onClick={() => { openPermsModal('group', g); setContextMenu(null); }}
            >Set Permissions</button>
            <button
              style={{ ...styles.contextMenuItem, ...styles.contextMenuItemDanger }}
              onClick={() => { setContextMenu(null); handleDeleteGroup(g.id); }}
            >Delete group</button>
          </div>
        );
      })()}

      {contextMenu && contextMenu.kind === 'channel' && (() => {
        const ch = channels.find(c => c.id === contextMenu.id);
        if (!ch) return null;
        const otherGroups = groups.filter(g => g.id !== ch.group_id);
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
              onClick={() => { openPermsModal('channel', ch); setContextMenu(null); }}
            >Set Permissions</button>
            {(ch.group_id || otherGroups.length > 0) && (
              <>
                <div style={styles.contextMenuLabel}>Move to</div>
                {ch.group_id && (
                  <button
                    style={styles.contextMenuItem}
                    onClick={() => handleMoveChannelToGroup(ch.id, null)}
                  >Ungrouped</button>
                )}
                {otherGroups.map(g => (
                  <button
                    key={g.id}
                    style={styles.contextMenuItem}
                    onClick={() => handleMoveChannelToGroup(ch.id, g.id)}
                  >{g.name}</button>
                ))}
              </>
            )}
            {!ch.is_default && (
              <button
                style={{ ...styles.contextMenuItem, ...styles.contextMenuItemDanger }}
                onClick={() => { setContextMenu(null); handleDeleteChannel(ch.id); }}
              >Delete</button>
            )}
          </div>
        );
      })()}

      {permsTarget && (
        <div style={styles.modalOverlay} onMouseDown={() => setPermsTarget(null)}>
          <div style={styles.modalCard} onMouseDown={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>
              {permsTarget.kind === 'group'
                ? `Permissions · Group: ${permsTarget.row.name}`
                : `Permissions · #${permsTarget.row.name}`}
            </h3>
            <p style={styles.modalHint}>
              {permsTarget.kind === 'group'
                ? 'Choose which roles can access channels in this group. This overrides each channel’s own permissions. Admins always have access.'
                : 'Choose which roles can access this channel. Admins always have access.'}
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
              <p style={styles.modalWarn}>
                No roles selected — only admins will see {permsTarget.kind === 'group' ? 'this group' : 'this channel'}.
              </p>
            )}
            <div style={styles.modalActions}>
              <button style={styles.modalCancelBtn} onClick={() => setPermsTarget(null)}>Cancel</button>
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

            {/* Pinned messages — a clickable table of contents. Each row jumps
                to the message in the thread. */}
            {pinnedMessages.length > 0 && (
              <div style={styles.pinnedPanel}>
                <button style={styles.pinnedPanelHeader} onClick={() => setShowPinned(s => !s)}>
                  <span style={styles.pinnedPanelTitle}>📌 Pinned ({pinnedMessages.length})</span>
                  <span style={styles.pinnedChevron}>{showPinned ? '▾' : '▸'}</span>
                </button>
                {showPinned && (
                  <div style={styles.pinnedList}>
                    {pinnedMessages.map(msg => (
                      <div key={msg.id} style={styles.pinnedTocItem}>
                        <button
                          style={styles.pinnedTocMain}
                          onClick={() => scrollToMessage(msg.id)}
                          title="Jump to message"
                        >
                          <span style={styles.pinnedTocAuthor}>{getDisplayName(msg.profile)}:</span>
                          <span style={styles.pinnedTocSnippet}>{pinnedSnippet(msg.content)}</span>
                        </button>
                        <button
                          onClick={() => handlePinMessage(msg.id, true)}
                          style={styles.pinnedTocUnpin}
                          title="Unpin"
                        >✕</button>
                      </div>
                    ))}
                  </div>
                )}
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
                          rowId={`chan-msg-${msg.id}`}
                          isHighlighted={highlightedMsgId === msg.id}
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
              <div style={styles.formatToolbar}>
                <button
                  type="button" title="Bold" style={styles.fmtBtn}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applyFormatMarker(inputRef, newMessage, '**', setNewMessage)}
                ><strong>B</strong></button>
                <button
                  type="button" title="Italic" style={styles.fmtBtn}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applyFormatMarker(inputRef, newMessage, '*', setNewMessage)}
                ><em>I</em></button>
                <button
                  type="button" title="Underline" style={styles.fmtBtn}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applyFormatWrap(inputRef, newMessage, '__', '__', setNewMessage)}
                ><span style={{ textDecoration: 'underline' }}>U</span></button>
                <button
                  type="button" title="Divider line" style={styles.fmtBtn}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertAtCursor(inputRef, newMessage, '\n---\n', setNewMessage)}
                >―</button>
                <div style={{ position: 'relative' }}>
                  <button
                    type="button" title="Highlight" style={styles.fmtBtn}
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onClick={() => setShowHighlightPicker(v => !v)}
                  >🖍</button>
                  {showHighlightPicker && (
                    <div
                      style={styles.highlightPicker}
                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    >
                      {HIGHLIGHT_COLORS.map((c, idx) => (
                        <button
                          key={c.name}
                          type="button"
                          title={c.name}
                          style={{ ...styles.swatch, background: c.bg }}
                          onClick={() => {
                            applyFormatWrap(inputRef, newMessage, `==${idx + 1}:`, '==', setNewMessage);
                            setShowHighlightPicker(false);
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
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
  isDragging, isRenaming, dragProvided,
  onSelect, onContextMenu,
  onRenameSubmit, onRenameCancel,
}) {
  const [renameValue, setRenameValue] = useState(channel.name);
  const renameInputRef = useRef(null);
  // Enter/Escape unmount this input, which fires onBlur — this guards against
  // that blur re-submitting (or submitting a name the user just canceled).
  const finalizedRef = useRef(false);

  useEffect(() => {
    if (isRenaming) {
      finalizedRef.current = false;
      setRenameValue(channel.name);
      requestAnimationFrame(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      });
    }
  }, [isRenaming, channel.name]);

  if (isRenaming) {
    return (
      <div
        ref={dragProvided?.innerRef}
        {...(dragProvided?.draggableProps || {})}
        style={{ ...styles.channelItemRow, ...(dragProvided?.draggableProps?.style || {}) }}
      >
        <div style={{ ...styles.channelItem, gap: '6px' }}>
          <span style={styles.hashIcon}>#</span>
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => { if (!finalizedRef.current) { finalizedRef.current = true; onRenameSubmit(renameValue); } }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); finalizedRef.current = true; onRenameSubmit(renameValue); }
              else if (e.key === 'Escape') { e.preventDefault(); finalizedRef.current = true; onRenameCancel(); }
            }}
            style={styles.channelRenameInput}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      ref={dragProvided?.innerRef}
      {...(dragProvided?.draggableProps || {})}
      {...(dragProvided?.dragHandleProps || {})}
      style={{
        ...styles.channelItemRow,
        ...(isDragging ? styles.channelItemDragging : {}),
        ...(dragProvided?.draggableProps?.style || {}),
      }}
      onContextMenu={isAdmin ? onContextMenu : undefined}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
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
      </div>
    </div>
  );
}

function GroupHeader({
  group, isAdmin, collapsed, isRenaming,
  onToggle, onContextMenu, onRenameSubmit, onRenameCancel,
}) {
  const [renameValue, setRenameValue] = useState(group.name);
  const renameInputRef = useRef(null);
  // See ChannelItem: guards the Enter/Escape unmount blur from re-submitting.
  const finalizedRef = useRef(false);

  useEffect(() => {
    if (isRenaming) {
      finalizedRef.current = false;
      setRenameValue(group.name);
      requestAnimationFrame(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      });
    }
  }, [isRenaming, group.name]);

  if (isRenaming) {
    return (
      <div style={styles.groupHeader}>
        <span style={styles.groupChevron}>{collapsed ? '▸' : '▾'}</span>
        <input
          ref={renameInputRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={() => { if (!finalizedRef.current) { finalizedRef.current = true; onRenameSubmit(renameValue); } }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); finalizedRef.current = true; onRenameSubmit(renameValue); }
            else if (e.key === 'Escape') { e.preventDefault(); finalizedRef.current = true; onRenameCancel(); }
          }}
          style={styles.channelRenameInput}
        />
      </div>
    );
  }

  const restricted = group.allowed_roles && group.allowed_roles.length > 0;
  return (
    <button
      style={styles.groupHeader}
      onClick={onToggle}
      onContextMenu={isAdmin ? onContextMenu : undefined}
    >
      <span style={styles.groupChevron}>{collapsed ? '▸' : '▾'}</span>
      <span style={styles.groupName}>{group.name}</span>
      {isAdmin && restricted && (
        <span title="Restricted to certain roles" style={styles.channelLock}>🔒</span>
      )}
    </button>
  );
}

function MessageRow({ msg, isAdmin, profileId, onPin, onEdit, onDelete, formatContent, rowId, isHighlighted }) {
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(msg.content);
  const [editHighlightOpen, setEditHighlightOpen] = useState(false);
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

  // Close the edit highlight picker on outside click or Escape.
  useEffect(() => {
    if (!editHighlightOpen) return;
    function close(e) {
      if (e.type === 'keydown' && e.key !== 'Escape') return;
      setEditHighlightOpen(false);
    }
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [editHighlightOpen]);

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
      id={rowId}
      style={{
        ...msgStyles.messageRow,
        background: isHighlighted
          ? 'rgba(251,191,36,0.14)'
          : (hovered || menuOpen ? 'rgba(255,255,255,0.02)' : 'transparent'),
        boxShadow: isHighlighted ? 'inset 0 0 0 1px rgba(251,191,36,0.4)' : 'none',
        borderRadius: '6px',
        margin: '0 -4px',
        padding: '2px 4px',
        transition: 'background 0.4s, box-shadow 0.4s',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); }}
    >
      {editing ? (
        <div style={{ flex: 1 }}>
          <div style={styles.formatToolbar}>
            <button
              type="button" title="Bold" style={styles.fmtBtn}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyFormatMarker(editInputRef, editContent, '**', setEditContent)}
            ><strong>B</strong></button>
            <button
              type="button" title="Italic" style={styles.fmtBtn}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyFormatMarker(editInputRef, editContent, '*', setEditContent)}
            ><em>I</em></button>
            <button
              type="button" title="Underline" style={styles.fmtBtn}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyFormatWrap(editInputRef, editContent, '__', '__', setEditContent)}
            ><span style={{ textDecoration: 'underline' }}>U</span></button>
            <button
              type="button" title="Divider line" style={styles.fmtBtn}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertAtCursor(editInputRef, editContent, '\n---\n', setEditContent)}
            >―</button>
            <div style={{ position: 'relative' }}>
              <button
                type="button" title="Highlight" style={styles.fmtBtn}
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onClick={() => setEditHighlightOpen(v => !v)}
              >🖍</button>
              {editHighlightOpen && (
                <div
                  style={styles.highlightPicker}
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                >
                  {HIGHLIGHT_COLORS.map((c, idx) => (
                    <button
                      key={c.name}
                      type="button"
                      title={c.name}
                      style={{ ...styles.swatch, background: c.bg }}
                      onClick={() => {
                        applyFormatWrap(editInputRef, editContent, `==${idx + 1}:`, '==', setEditContent);
                        setEditHighlightOpen(false);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
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
    background: 'rgba(99,102,241,0.22)',
    boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
  },
  channelRenameInput: {
    flex: 1, padding: '2px 4px', background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(99,102,241,0.5)', borderRadius: '5px',
    color: '#fff', fontSize: '14px', fontFamily: 'inherit', outline: 'none',
    minWidth: 0,
  },
  groupBlock: {
    marginTop: '6px',
  },
  groupHeader: {
    display: 'flex', alignItems: 'center', gap: '6px', width: '100%',
    padding: '6px 8px', border: 'none', background: 'transparent',
    color: 'rgba(255,255,255,0.5)', fontSize: '11px', fontWeight: 700,
    letterSpacing: '0.03em', textTransform: 'uppercase', cursor: 'pointer',
    fontFamily: 'inherit', textAlign: 'left', borderRadius: '6px',
  },
  groupChevron: {
    fontSize: '9px', opacity: 0.6, flexShrink: 0,
  },
  groupName: {
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
  },
  groupChannels: {
    paddingLeft: '8px', minHeight: '10px',
    borderRadius: '8px', transition: 'background 0.1s',
  },
  groupChannelsDragOver: {
    background: 'rgba(99,102,241,0.12)',
    boxShadow: 'inset 0 0 0 1px rgba(99,102,241,0.4)',
  },
  groupEmpty: {
    padding: '6px 10px', fontSize: '12px', color: 'rgba(255,255,255,0.3)',
    fontStyle: 'italic',
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
  contextMenuLabel: {
    padding: '6px 10px 3px', fontSize: '10px', fontWeight: 700,
    letterSpacing: '0.04em', textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.3)',
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
  channelItemName: { flex: 1, minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'break-word', lineHeight: 1.3 },
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
    width: '100%', padding: 0, background: 'none', border: 'none',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  pinnedPanelTitle: {
    fontSize: '12px', fontWeight: 700, color: '#fbbf24',
  },
  pinnedChevron: {
    fontSize: '11px', color: '#fbbf24', opacity: 0.7,
  },
  pinnedList: {
    display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '8px',
  },
  pinnedTocItem: {
    display: 'flex', alignItems: 'center', gap: '6px', borderRadius: '6px',
  },
  pinnedTocMain: {
    display: 'flex', alignItems: 'baseline', gap: '6px', flex: 1, minWidth: 0,
    padding: '5px 8px', background: 'none', border: 'none', textAlign: 'left',
    cursor: 'pointer', fontFamily: 'inherit', borderRadius: '6px',
  },
  pinnedTocAuthor: {
    fontSize: '12px', fontWeight: 600, color: '#e2e8f0', flexShrink: 0,
  },
  pinnedTocSnippet: {
    fontSize: '12px', color: 'rgba(255,255,255,0.55)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  pinnedTocUnpin: {
    background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)',
    cursor: 'pointer', fontSize: '12px', padding: '4px 6px', flexShrink: 0,
    borderRadius: '5px',
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
  formatToolbar: {
    display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '6px',
  },
  fmtBtn: {
    minWidth: '30px', height: '28px', padding: '0 7px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px', color: 'rgba(255,255,255,0.75)', cursor: 'pointer',
    fontSize: '13px', fontFamily: 'inherit', lineHeight: 1,
  },
  highlightPicker: {
    position: 'absolute', bottom: '36px', left: 0, zIndex: 50,
    display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px',
    padding: '8px', background: '#1a1a2e',
    border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  },
  swatch: {
    width: '22px', height: '22px', borderRadius: '5px',
    border: '1px solid rgba(255,255,255,0.2)', cursor: 'pointer', padding: 0,
  },
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
    // Fixed 8-row height (14px × 1.5 line-height × 8 + 16px padding + 2px
    // border ≈ 186px) shown by default; scrolls internally past 8 rows.
    resize: 'none', lineHeight: 1.5, height: '186px',
    overflow: 'auto',
  },
  divider: {
    border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', margin: '8px 0',
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
