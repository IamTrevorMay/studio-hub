import React, { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationContext';
import FullScreenSheet from '../components/mobile/FullScreenSheet';
import { mobileTokens, mobileTapButton } from '../utils/mobileTokens';
import { getDisplayName, getDisplayInitial } from '../lib/displayName';

// Note: "Channels" here is the Slack-style team-chat channel list, not platform
// analytics channels. Mobile mirrors the desktop chat UX, slimmed: grouped channel
// list with last-message preview, tap to enter, formatted messages with avatars,
// read-only pinned bar, composer with formatting toolbar. Channel management,
// pin management and drag-reorder stay desktop-only.

// A null/empty allowed_roles list is open to everyone. Otherwise only the
// listed roles — plus admins, who always see everything.
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

// Accept only http(s)/mailto links; otherwise assume a bare domain and prepend
// https://. Returns null for anything unsafe (e.g. javascript:) so it renders as text.
function normalizeUrl(raw) {
  const url = (raw || '').trim();
  if (!url) return null;
  if (/^(https?:\/\/|mailto:)/i.test(url)) return url;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return null; // some other scheme — reject
  return 'https://' + url;
}

// Wrap the current selection (or insert at the cursor) with the given before/
// after markers, keeping any selected text selected afterwards. Pass selOverride
// ({ start, end }) when the live selection was lost (e.g. focus moved to an input).
function applyFormatWrap(textareaRef, text, before, after, setter, selOverride) {
  const el = textareaRef.current;
  if (!el) return;
  const start = selOverride ? selOverride.start : el.selectionStart;
  const end = selOverride ? selOverride.end : el.selectionEnd;
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

// Replace a range of the text with a replacement string, placing the cursor
// right after it. Used for the link inserter, which swaps the selection for a
// composed [label](url) snippet.
function replaceSelection(textareaRef, text, replacement, setter, sel) {
  const el = textareaRef.current;
  const start = sel ? sel.start : (el ? el.selectionStart : text.length);
  const end = sel ? sel.end : (el ? el.selectionEnd : text.length);
  const newText = text.substring(0, start) + replacement + text.substring(end);
  setter(newText);
  requestAnimationFrame(() => {
    if (!el) return;
    const pos = start + replacement.length;
    el.selectionStart = pos;
    el.selectionEnd = pos;
    el.focus();
  });
}

// Recursive so nested markers render — e.g. a highlight can wrap bold text,
// a font-size span can wrap a highlight, etc. keyPrefix keeps React keys unique
// across recursion depth. Mirrors the desktop Channels renderer.
function formatInline(text, channels, onChannelLink, keyPrefix = '') {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s]+|\*\*[^*]+\*\*|\*[^*]+\*|__[^_]+__|==\d:[^=]+==|%%\d{1,2}:[^%]+%%|[@#]\w+(?:[- ]\w+)*)/g);
  return parts.map((part, i) => {
    const key = `${keyPrefix}${i}`;
    const inner = (t) => formatInline(t, channels, onChannelLink, `${key}.`);
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const url = normalizeUrl(link[2]);
      if (url) {
        return (
          <a key={key} href={url} target="_blank" rel="noopener noreferrer" style={fmtStyles.link} onClick={(e) => e.stopPropagation()}>
            {inner(link[1])}
          </a>
        );
      }
    }
    if (/^https?:\/\/[^\s]+$/.test(part)) {
      return (
        <a key={key} href={part} target="_blank" rel="noopener noreferrer" style={fmtStyles.link} onClick={(e) => e.stopPropagation()}>
          {part}
        </a>
      );
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={key} style={{ fontWeight: 700, color: '#e2e8f0' }}>{inner(part.slice(2, -2))}</strong>;
    }
    if (part.startsWith('__') && part.endsWith('__') && part.length > 4) {
      return <u key={key} style={{ textDecoration: 'underline' }}>{inner(part.slice(2, -2))}</u>;
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={key} style={{ fontStyle: 'italic', color: 'rgba(255,255,255,0.85)' }}>{inner(part.slice(1, -1))}</em>;
    }
    const hl = part.match(/^==(\d):([^=]+)==$/);
    if (hl) {
      const color = HIGHLIGHT_COLORS[Number(hl[1]) - 1] || HIGHLIGHT_COLORS[0];
      return (
        <mark key={key} style={{ background: color.bg, color: '#1a1a2e', borderRadius: 3, padding: '0 3px' }}>
          {inner(hl[2])}
        </mark>
      );
    }
    const fs = part.match(/^%%(\d{1,2}):([^%]+)%%$/);
    if (fs) {
      const size = Math.max(8, Math.min(64, Number(fs[1])));
      return <span key={key} style={{ fontSize: `${size}px`, lineHeight: 1.2 }}>{inner(fs[2])}</span>;
    }
    if (part.startsWith('@')) {
      return <span key={key} style={fmtStyles.mention}>{part}</span>;
    }
    if (part.startsWith('#')) {
      const chName = part.slice(1).toLowerCase();
      const matched = (channels || []).find(c => c.name.toLowerCase() === chName);
      if (matched && onChannelLink) {
        return (
          <span key={key} style={fmtStyles.channelLink} onClick={() => onChannelLink(matched)}>
            {part}
          </span>
        );
      }
    }
    return part;
  });
}

// Block-level pass: dividers (---), bullet lists (- / •), blank-line spacing;
// everything else goes through formatInline.
function formatMessageContent(content, channels, onChannelLink) {
  if (!content.includes('\n') && !/^[-•] /.test(content) && content.trim() !== '---') {
    return formatInline(content, channels, onChannelLink);
  }
  const lines = content.split('\n');
  const result = [];
  let bulletItems = [];
  const flushBullets = () => {
    if (bulletItems.length > 0) {
      result.push(
        <ul key={`ul-${result.length}`} style={fmtStyles.bulletList}>
          {bulletItems.map((item, j) => (
            <li key={j} style={fmtStyles.bulletItem}>{formatInline(item, channels, onChannelLink)}</li>
          ))}
        </ul>
      );
      bulletItems = [];
    }
  };
  lines.forEach((line, i) => {
    if (line.trim() === '---') {
      flushBullets();
      result.push(<hr key={`hr-${i}`} style={fmtStyles.divider} />);
      return;
    }
    const bulletMatch = line.match(/^[-•] (.*)/);
    if (bulletMatch) {
      bulletItems.push(bulletMatch[1]);
    } else {
      flushBullets();
      if (line.trim() === '') {
        result.push(<div key={`line-${i}`} style={{ height: 8 }} />);
      } else {
        result.push(<div key={`line-${i}`}>{formatInline(line, channels, onChannelLink)}</div>);
      }
    }
  });
  flushBullets();
  return result;
}

// First link found in a message — a markdown link's URL, else a bare URL.
function firstUrl(content) {
  const md = (content || '').match(/\[[^\]]+\]\(([^)]+)\)/);
  if (md) return normalizeUrl(md[1]);
  const bare = (content || '').match(/https?:\/\/[^\s]+/);
  return bare ? bare[0] : null;
}

// The message's first non-empty line (leading bullet stripped), kept whole so
// markdown links render as their label — never cut raw markdown mid-syntax.
function firstContentLine(content) {
  const line = (content || '').split('\n').find(l => l.trim()) || content || '';
  return line.replace(/^[-•]\s*/, '').trim();
}

export default function ChannelsMobile({ initialChannelName, onChannelOpened }) {
  const { profile, isAdmin, refreshKey } = useAuth();
  const { unreadMentionChannelIds, markChannelSeen } = useNotifications();
  const [channels, setChannels] = useState([]);
  const [groups, setGroups] = useState([]);
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
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

  const fetchGroups = useCallback(async () => {
    const { data } = await supabase.from('channel_groups')
      .select('*').order('sort_order', { ascending: true }).order('name');
    setGroups(data || []);
  }, []);

  const fetchTeam = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('id, full_name, nickname, title');
    setTeamMembers(data || []);
  }, []);

  useEffect(() => {
    if (!profile?.id) return;
    Promise.all([fetchChannels(), fetchGroups(), fetchTeam()]).finally(() => setLoading(false));
  }, [profile?.id, fetchChannels, fetchGroups, fetchTeam]);

  const groupById = {};
  groups.forEach((g) => { groupById[g.id] = g; });

  // Admins see every channel; others only channels their role can access —
  // via the channel's group when it has one, else the channel's own roles.
  const visibleChannels = channels.filter(
    (ch) => isAdmin || effectiveChannelVisible(ch, ch.group_id ? groupById[ch.group_id] : null, profile?.role),
  );

  useEffect(() => {
    if (!initialChannelName || channels.length === 0) return;
    const match = channels.find((c) => c.name.toLowerCase() === initialChannelName.toLowerCase());
    const grp = match?.group_id ? groups.find((g) => g.id === match.group_id) : null;
    const canView = match && (isAdmin || effectiveChannelVisible(match, grp, profile?.role));
    if (canView) {
      setActiveChannel(match);
      markChannelSeen(match.id);
    }
    if (onChannelOpened) onChannelOpened();
  }, [initialChannelName, channels, groups, markChannelSeen, onChannelOpened, isAdmin, profile?.role]);

  function openChannel(ch) {
    setActiveChannel(ch);
    markChannelSeen(ch.id);
  }

  function toggleGroup(groupId) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  // Ungrouped channels render at the top; each group renders as a collapsible
  // section below. Non-admins only see groups containing a channel visible to them.
  const ungrouped = visibleChannels.filter((c) => !c.group_id);
  const visibleGroups = isAdmin
    ? groups
    : groups.filter((g) => visibleChannels.some((c) => c.group_id === g.id));

  if (loading) return <p style={styles.empty}>Loading…</p>;
  if (visibleChannels.length === 0) return <p style={styles.empty}>No channels yet.</p>;

  const renderRow = (ch) => {
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
  };

  return (
    <div style={styles.root}>
      <ul style={styles.list}>
        {ungrouped.map(renderRow)}
        {visibleGroups.map((g) => {
          const groupChannels = visibleChannels.filter((c) => c.group_id === g.id);
          if (groupChannels.length === 0) return null;
          const collapsed = collapsedGroups.has(g.id);
          return (
            <li key={g.id}>
              <button onClick={() => toggleGroup(g.id)} style={styles.groupHeader}>
                <span style={{ ...styles.groupChevron, transform: collapsed ? 'rotate(-90deg)' : 'none' }}>▾</span>
                <span style={styles.groupName}>{g.name}</span>
                <span style={styles.groupCount}>{groupChannels.length}</span>
              </button>
              {!collapsed && <ul style={styles.list}>{groupChannels.map(renderRow)}</ul>}
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
            channels={visibleChannels}
            profileId={profile.id}
            teamMembers={teamMembers}
            refreshKey={refreshKey}
            onSwitchChannel={openChannel}
          />
        )}
      </FullScreenSheet>
    </div>
  );
}

// Mobile formatting toolbar — same wire syntax as desktop (B/I/U, divider,
// highlight, font size, link), sized for touch.
function MobileFormatToolbar({ targetRef, value, setValue }) {
  const [hlOpen, setHlOpen] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const [sizeValue, setSizeValue] = useState(24);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkText, setLinkText] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  // Captured when a popover with a text input opens — those inputs steal focus,
  // which clears the textarea's live selection, so we apply against this snapshot.
  const sizeSelRef = useRef(null);
  const linkSelRef = useRef(null);

  const preserveFocus = (e) => { e.preventDefault(); e.stopPropagation(); };

  function closeAll() {
    setHlOpen(false);
    setSizeOpen(false);
    setLinkOpen(false);
  }

  function applySize() {
    const n = Math.max(8, Math.min(64, Math.round(Number(sizeValue) || 0)));
    applyFormatWrap(targetRef, value, `%%${n}:`, '%%', setValue, sizeSelRef.current);
    setSizeOpen(false);
  }

  function openLink() {
    const el = targetRef.current;
    const sel = el ? { start: el.selectionStart, end: el.selectionEnd } : null;
    linkSelRef.current = sel;
    const selected = sel ? value.substring(sel.start, sel.end) : '';
    const looksLikeUrl = /^(https?:\/\/|www\.|mailto:)/i.test(selected.trim());
    setLinkText(looksLikeUrl ? '' : selected);
    setLinkUrl(looksLikeUrl ? selected.trim() : '');
    setHlOpen(false);
    setSizeOpen(false);
    setLinkOpen(true);
  }

  function insertLink() {
    const url = normalizeUrl(linkUrl);
    if (!url) return;
    const label = linkText.trim() || url;
    replaceSelection(targetRef, value, `[${label}](${url})`, setValue, linkSelRef.current);
    setLinkOpen(false);
    setLinkText('');
    setLinkUrl('');
  }

  return (
    <div>
      <div style={chatStyles.toolbar}>
        <button
          type="button" style={chatStyles.fmtBtn}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { closeAll(); applyFormatMarker(targetRef, value, '**', setValue); }}
        ><strong>B</strong></button>
        <button
          type="button" style={chatStyles.fmtBtn}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { closeAll(); applyFormatMarker(targetRef, value, '*', setValue); }}
        ><em>I</em></button>
        <button
          type="button" style={chatStyles.fmtBtn}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { closeAll(); applyFormatWrap(targetRef, value, '__', '__', setValue); }}
        ><span style={{ textDecoration: 'underline' }}>U</span></button>
        <button
          type="button" style={chatStyles.fmtBtn}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { closeAll(); insertAtCursor(targetRef, value, '\n---\n', setValue); }}
        >―</button>
        <button
          type="button" style={{ ...chatStyles.fmtBtn, ...(hlOpen ? chatStyles.fmtBtnActive : {}) }}
          onMouseDown={preserveFocus}
          onClick={() => { setSizeOpen(false); setLinkOpen(false); setHlOpen((v) => !v); }}
        >🖍</button>
        <button
          type="button" style={{ ...chatStyles.fmtBtn, ...(sizeOpen ? chatStyles.fmtBtnActive : {}) }}
          onMouseDown={preserveFocus}
          onClick={() => {
            const el = targetRef.current;
            sizeSelRef.current = el ? { start: el.selectionStart, end: el.selectionEnd } : null;
            setHlOpen(false);
            setLinkOpen(false);
            setSizeOpen((v) => !v);
          }}
        >A↕</button>
        <button
          type="button" style={{ ...chatStyles.fmtBtn, ...(linkOpen ? chatStyles.fmtBtnActive : {}) }}
          onMouseDown={preserveFocus}
          onClick={() => (linkOpen ? setLinkOpen(false) : openLink())}
        >🔗</button>
      </div>

      {hlOpen && (
        <div style={chatStyles.toolbarTray} onMouseDown={preserveFocus}>
          {HIGHLIGHT_COLORS.map((c, idx) => (
            <button
              key={c.name}
              type="button"
              title={c.name}
              style={{ ...chatStyles.swatch, background: c.bg }}
              onClick={() => {
                applyFormatWrap(targetRef, value, `==${idx + 1}:`, '==', setValue);
                setHlOpen(false);
              }}
            />
          ))}
        </div>
      )}

      {sizeOpen && (
        <div style={chatStyles.toolbarTray} onMouseDown={(e) => e.stopPropagation()}>
          <input
            type="number" min={8} max={64} value={sizeValue}
            onChange={(e) => setSizeValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applySize(); } }}
            style={chatStyles.trayInput}
          />
          <button
            type="button" style={chatStyles.trayApplyBtn}
            onMouseDown={(e) => e.preventDefault()}
            onClick={applySize}
          >Apply</button>
        </div>
      )}

      {linkOpen && (
        <div style={{ ...chatStyles.toolbarTray, flexWrap: 'wrap' }} onMouseDown={(e) => e.stopPropagation()}>
          <input
            type="text" value={linkText} placeholder="Text to display"
            onChange={(e) => setLinkText(e.target.value)}
            style={{ ...chatStyles.trayInput, flex: 1, minWidth: 110 }}
          />
          <input
            type="text" value={linkUrl} placeholder="Link (https://…)"
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); insertLink(); } }}
            style={{ ...chatStyles.trayInput, flex: 1, minWidth: 110 }}
          />
          <button
            type="button" style={chatStyles.trayApplyBtn}
            onMouseDown={(e) => e.preventDefault()}
            onClick={insertLink}
          >Apply</button>
        </div>
      )}
    </div>
  );
}

function ChannelView({ channel, channels, profileId, teamMembers, refreshKey, onSwitchChannel }) {
  const [messages, setMessages] = useState([]);
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [showPinned, setShowPinned] = useState(false);
  const [highlightedMsgId, setHighlightedMsgId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const sendingRef = useRef(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  const fetchPinned = useCallback(async () => {
    const { data } = await supabase
      .from('channel_messages')
      .select('*, profile:profiles(id, full_name, nickname, title)')
      .eq('channel_id', channel.id)
      .eq('is_pinned', true)
      .order('pin_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });
    setPinnedMessages(data || []);
  }, [channel.id]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      // Newest 100 then reverse — ascending+limit showed the oldest 100.
      const { data } = await supabase
        .from('channel_messages')
        .select('*, profile:profiles(id, full_name, nickname, title, avatar_url)')
        .eq('channel_id', channel.id)
        .order('created_at', { ascending: false })
        .limit(100);
      if (!cancelled) {
        setMessages((data || []).slice().reverse());
        setLoading(false);
      }
    }
    load();
    fetchPinned();
    return () => { cancelled = true; };
  }, [channel.id, fetchPinned]);

  useEffect(() => {
    const sub = supabase
      .channel(`channel-${channel.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'channel_messages',
        filter: `channel_id=eq.${channel.id}`,
      }, async (payload) => {
        const { data } = await supabase
          .from('channel_messages')
          .select('*, profile:profiles(id, full_name, nickname, title, avatar_url)')
          .eq('id', payload.new.id)
          .single();
        // Dedup by id — a reconnect/resubscribe can redeliver the same row.
        if (data) setMessages((prev) => prev.some((m) => m.id === data.id) ? prev : [...prev, data]);
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'channel_messages',
        filter: `channel_id=eq.${channel.id}`,
      }, (payload) => {
        setMessages((prev) => prev.map((m) => m.id === payload.new.id
          ? { ...m, content: payload.new.content, edited_at: payload.new.edited_at, is_pinned: payload.new.is_pinned }
          : m
        ));
        fetchPinned();
      })
      .on('postgres_changes', {
        // No channel_id filter: DELETE payloads only carry the PK (default
        // replica identity), so a channel_id filter would never match.
        event: 'DELETE', schema: 'public', table: 'channel_messages',
      }, (payload) => {
        setMessages((prev) => prev.filter((m) => m.id !== payload.old.id));
        fetchPinned();
      })
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [channel.id, refreshKey, fetchPinned]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Auto-grow the composer textarea to fit its content (capped at 120px).
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + 'px';
    }
  }, [text]);

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
      // Notify mentioned users (mirrors desktop Channels.js)
      const me = teamMembers.find((m) => m.id === profileId);
      const notifs = mentions
        .filter((uid) => uid !== profileId)
        .map((uid) => ({
          user_id: uid,
          type: 'mention',
          title: `${getDisplayName(me) || 'Someone'} mentioned you in #${channel.name}`,
          body: content.substring(0, 100),
          link_tab: 'channels',
          link_target: channel.name,
        }));
      if (notifs.length > 0) {
        await supabase.from('notifications').insert(notifs);
      }
    } finally {
      sendingRef.current = false;
    }
  }

  function scrollToMessage(id) {
    const el = document.getElementById(`chanm-${id}`);
    if (!el) return; // older than the loaded window — nothing to scroll to
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedMsgId(id);
    setTimeout(() => setHighlightedMsgId((h) => (h === id ? null : h)), 1800);
  }

  // "last updated" date shown after a pinned title — the last edit, else posted.
  function pinnedUpdatedLabel(msg) {
    const d = new Date(msg.edited_at || msg.created_at);
    const now = new Date();
    const opts = d.getFullYear() === now.getFullYear()
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' };
    return d.toLocaleDateString('en-US', opts);
  }

  // Render a pinned row's title. A custom name always displays as the name
  // (never the raw URL): if the message has a link, the name becomes the link;
  // if the name itself carries a link, that renders; otherwise plain text. With
  // no custom name we render the full first line formatted (links → labels).
  function renderPinTitle(msg) {
    const custom = (msg.pin_title || '').trim();
    if (!custom) return formatInline(firstContentLine(msg.content), channels, onSwitchChannel);
    if (/\[[^\]]+\]\([^)]+\)|https?:\/\//.test(custom)) return formatInline(custom, channels, onSwitchChannel);
    const url = firstUrl(msg.content);
    if (url) {
      return (
        <a href={url} target="_blank" rel="noopener noreferrer" style={fmtStyles.link} onClick={(e) => e.stopPropagation()}>
          {custom}
        </a>
      );
    }
    return custom;
  }

  // Group consecutive messages from the same sender within 5 minutes under one
  // avatar/name header (mirrors desktop).
  const messageGroups = [];
  messages.forEach((msg, i) => {
    const prev = i > 0 ? messages[i - 1] : null;
    const sameUser = prev && prev.user_id === msg.user_id;
    const withinTime = prev && (new Date(msg.created_at) - new Date(prev.created_at)) < 300000;
    if (sameUser && withinTime) {
      messageGroups[messageGroups.length - 1].messages.push(msg);
    } else {
      messageGroups.push({ user: msg.profile, messages: [msg] });
    }
  });

  return (
    <div style={chatStyles.root}>
      {pinnedMessages.length > 0 && (
        <div style={chatStyles.pinnedPanel}>
          <button style={chatStyles.pinnedHeader} onClick={() => setShowPinned((s) => !s)}>
            <span style={chatStyles.pinnedTitle}>📌 Pinned ({pinnedMessages.length})</span>
            <span style={chatStyles.pinnedChevron}>{showPinned ? '▾' : '▸'}</span>
          </button>
          {showPinned && (
            <div style={chatStyles.pinnedList}>
              {pinnedMessages.map((msg) => (
                <div
                  key={msg.id}
                  role="button"
                  tabIndex={0}
                  style={chatStyles.pinnedItem}
                  onClick={() => scrollToMessage(msg.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); scrollToMessage(msg.id); } }}
                >
                  <span style={chatStyles.pinnedItemTitle}>{renderPinTitle(msg)}</span>
                  <span style={chatStyles.pinnedItemUpdated}>{pinnedUpdatedLabel(msg)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={chatStyles.scroll}>
        {loading ? (
          <p style={styles.empty}>Loading…</p>
        ) : messages.length === 0 ? (
          <p style={styles.empty}>No messages yet — say hi!</p>
        ) : (
          messageGroups.map((group, gi) => (
            <div key={group.messages[0]?.id || gi} style={chatStyles.msgGroup}>
              <div style={chatStyles.avatar}>
                {group.user?.avatar_url ? (
                  <img src={group.user.avatar_url} alt="" style={chatStyles.avatarImg} />
                ) : getDisplayInitial(group.user)}
              </div>
              <div style={chatStyles.msgContent}>
                <div style={chatStyles.msgHeader}>
                  <span style={chatStyles.userName}>{getDisplayName(group.user) || 'Unknown'}</span>
                  <span style={chatStyles.time}>{formatTime(group.messages[0].created_at)}</span>
                </div>
                {group.messages.map((m) => (
                  <div
                    key={m.id}
                    id={`chanm-${m.id}`}
                    style={{
                      ...chatStyles.msgText,
                      ...(highlightedMsgId === m.id ? chatStyles.msgHighlighted : {}),
                    }}
                  >
                    {m.is_pinned && <span style={chatStyles.pinBadge}>📌</span>}
                    {formatMessageContent(m.content, channels, onSwitchChannel)}
                    {m.edited_at && <span style={chatStyles.editedTag}>(edited)</span>}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={send} style={{ ...chatStyles.composer, paddingBottom: `calc(${mobileTokens.space.md}px + ${mobileTokens.safeBottom})` }}>
        <MobileFormatToolbar targetRef={inputRef} value={text} setValue={setText} />
        <div style={chatStyles.composerRow}>
          <textarea
            ref={inputRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Message #${channel.name}`}
            style={chatStyles.input}
          />
          <button type="submit" disabled={!text.trim()} style={{ ...chatStyles.sendBtn, opacity: text.trim() ? 1 : 0.4 }} aria-label="Send">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M2 10l16-7-7 16-2-7-7-2z" /></svg>
          </button>
        </div>
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

// Inline-format element styles shared by messages and pinned titles.
const fmtStyles = {
  link: {
    color: '#818cf8', textDecoration: 'underline', wordBreak: 'break-word',
  },
  mention: {
    background: 'rgba(99,102,241,0.2)', color: '#a5b4fc',
    padding: '1px 4px', borderRadius: 4, fontWeight: 600,
  },
  channelLink: {
    background: 'rgba(99,102,241,0.15)', color: '#a5b4fc',
    padding: '1px 4px', borderRadius: 4, fontWeight: 600,
    cursor: 'pointer', textDecoration: 'none',
  },
  divider: {
    border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', margin: '8px 0',
  },
  bulletList: {
    margin: '4px 0', paddingLeft: 20, listStyleType: 'disc',
  },
  bulletItem: {
    lineHeight: 1.5, marginBottom: 2,
  },
};

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
  groupHeader: {
    ...mobileTapButton,
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    gap: mobileTokens.space.sm,
    padding: `${mobileTokens.space.sm}px ${mobileTokens.space.lg}px`,
    background: 'rgba(255,255,255,0.02)',
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'left',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    minHeight: mobileTokens.tap,
  },
  groupChevron: {
    fontSize: mobileTokens.font.xs,
    transition: 'transform 0.15s',
    width: 12,
    flexShrink: 0,
  },
  groupName: {
    fontSize: mobileTokens.font.sm,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.4px',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  groupCount: {
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.35)',
    flexShrink: 0,
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
  pinnedPanel: {
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    background: 'rgba(99,102,241,0.05)',
    flexShrink: 0,
  },
  pinnedHeader: {
    ...mobileTapButton,
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: `${mobileTokens.space.sm}px ${mobileTokens.space.lg}px`,
    background: 'transparent',
    color: '#a5b4fc',
    minHeight: mobileTokens.tap,
  },
  pinnedTitle: {
    fontSize: mobileTokens.font.sm,
    fontWeight: 700,
  },
  pinnedChevron: {
    fontSize: mobileTokens.font.sm,
    color: 'rgba(255,255,255,0.4)',
  },
  pinnedList: {
    maxHeight: '32vh',
    overflowY: 'auto',
    padding: `0 ${mobileTokens.space.lg}px ${mobileTokens.space.sm}px`,
  },
  pinnedItem: {
    display: 'flex',
    alignItems: 'baseline',
    gap: mobileTokens.space.sm,
    padding: `${mobileTokens.space.sm}px 0`,
    borderTop: '1px solid rgba(255,255,255,0.04)',
    cursor: 'pointer',
  },
  pinnedItemTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: mobileTokens.font.sm,
    color: 'rgba(255,255,255,0.8)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  pinnedItemUpdated: {
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.3)',
    flexShrink: 0,
  },
  scroll: {
    flex: 1,
    overflowY: 'auto',
    padding: mobileTokens.space.lg,
    WebkitOverflowScrolling: 'touch',
  },
  msgGroup: {
    display: 'flex',
    gap: mobileTokens.space.md,
    marginBottom: mobileTokens.space.lg,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 10,
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: mobileTokens.font.sm,
    fontWeight: 700,
    color: '#fff',
    flexShrink: 0,
  },
  avatarImg: {
    width: 34, height: 34, borderRadius: 10, objectFit: 'cover',
  },
  msgContent: { flex: 1, minWidth: 0 },
  msgHeader: {
    display: 'flex', alignItems: 'baseline', gap: mobileTokens.space.sm, marginBottom: 2,
  },
  userName: {
    fontSize: mobileTokens.font.sm,
    fontWeight: 600,
    color: '#e2e8f0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  time: { fontSize: mobileTokens.font.xs, color: 'rgba(255,255,255,0.3)', flexShrink: 0 },
  msgText: {
    fontSize: mobileTokens.font.md,
    color: 'rgba(255,255,255,0.75)',
    margin: '2px 0',
    lineHeight: 1.5,
    wordBreak: 'break-word',
    borderRadius: mobileTokens.radius.sm,
    transition: 'background 0.4s',
  },
  msgHighlighted: {
    background: 'rgba(99,102,241,0.25)',
  },
  pinBadge: { marginRight: 4, fontSize: mobileTokens.font.xs },
  editedTag: {
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.25)',
    marginLeft: 6,
    fontStyle: 'italic',
  },
  composer: {
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.sm,
    padding: `${mobileTokens.space.sm}px ${mobileTokens.space.lg}px`,
    background: 'rgba(15,15,30,0.96)',
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  composerRow: {
    display: 'flex',
    gap: mobileTokens.space.sm,
    alignItems: 'flex-end',
  },
  toolbar: {
    display: 'flex',
    gap: mobileTokens.space.xs,
    overflowX: 'auto',
  },
  fmtBtn: {
    minWidth: 34,
    height: 30,
    padding: '0 8px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: mobileTokens.radius.sm,
    color: 'rgba(255,255,255,0.75)',
    fontSize: mobileTokens.font.sm,
    cursor: 'pointer',
    fontFamily: 'inherit',
    flexShrink: 0,
  },
  fmtBtnActive: {
    background: 'rgba(99,102,241,0.25)',
    borderColor: 'rgba(99,102,241,0.5)',
  },
  toolbarTray: {
    display: 'flex',
    alignItems: 'center',
    gap: mobileTokens.space.sm,
    padding: `${mobileTokens.space.xs}px 0`,
  },
  swatch: {
    width: 26,
    height: 26,
    borderRadius: 6,
    border: '1px solid rgba(0,0,0,0.3)',
    cursor: 'pointer',
    flexShrink: 0,
  },
  trayInput: {
    width: 72,
    padding: '6px 8px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: mobileTokens.radius.sm,
    color: '#fff',
    fontSize: mobileTokens.font.sm,
    outline: 'none',
    fontFamily: 'inherit',
  },
  trayApplyBtn: {
    padding: '6px 12px',
    background: '#6366f1',
    border: 'none',
    borderRadius: mobileTokens.radius.sm,
    color: '#fff',
    fontSize: mobileTokens.font.sm,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    flexShrink: 0,
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
    lineHeight: 1.4,
    resize: 'none',
    boxSizing: 'border-box',
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
