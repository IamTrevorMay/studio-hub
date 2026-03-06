import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useSupabaseQuery } from '../hooks/useSupabaseQuery';

const STATUS_COLORS = {
  concept: '#8b5cf6',
  script: '#3b82f6',
  production: '#f59e0b',
  edit: '#f97316',
  review: '#ec4899',
  published: '#22c55e',
};

const EVENT_TYPE_COLORS = {
  deadline: '#ef4444', meeting: '#3b82f6', live_recording: '#22c55e',
  filming: '#f59e0b', video_post: '#a855f7', unavailable: '#6b7280',
};
const EVENT_TYPE_LABELS = {
  deadline: 'Deadline', meeting: 'Meeting', live_recording: 'Live/Recording',
  filming: 'Filming', video_post: 'Video Post', unavailable: 'Unavailable',
};
const EVENT_TYPE_ICONS = {
  deadline: '\u23F0', meeting: '\uD83D\uDC65', live_recording: '\uD83D\uDD34',
  filming: '\uD83C\uDFAC', video_post: '\uD83D\uDCF9', unavailable: '\uD83D\uDEAB',
};

const STATUS_LABELS = {
  concept: 'Concept',
  script: 'Script',
  production: 'Production',
  edit: 'Edit',
  review: 'Review',
  published: 'Published',
};

export default function Dashboard({ onNavigate }) {
  const { profile, updateProfile, isAdmin, isAssistant } = useAuth();
  const { safeQuery } = useSupabaseQuery();
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(profile?.title || '');
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(profile?.full_name || '');

  // Itinerary state
  const [itineraryItems, setItineraryItems] = useState([]);
  const [itineraryLoading, setItineraryLoading] = useState(false);
  const [newItemText, setNewItemText] = useState('');
  const [editingItemId, setEditingItemId] = useState(null);
  const [editingItemText, setEditingItemText] = useState('');

  // Admin comment state
  const [commentingItemId, setCommentingItemId] = useState(null);
  const [commentText, setCommentText] = useState('');

  // Announcements state
  const [announcements, setAnnouncements] = useState([]);
  const [announcementsLoading, setAnnouncementsLoading] = useState(false);
  const [newAnnouncementText, setNewAnnouncementText] = useState('');
  const [showAnnouncementInput, setShowAnnouncementInput] = useState(false);

  // Today's schedule state
  const [todayEvents, setTodayEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  // Brain Dump state
  const [brainDumpItems, setBrainDumpItems] = useState([]);
  const [brainDumpLoading, setBrainDumpLoading] = useState(false);
  const [newBrainDumpText, setNewBrainDumpText] = useState('');
  const [editingBrainDumpId, setEditingBrainDumpId] = useState(null);
  const [editingBrainDumpText, setEditingBrainDumpText] = useState('');

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const fetchItinerary = useCallback(async () => {
    if (!profile?.id) return;
    setItineraryLoading(true);
    try {
      let query = supabase
        .from('daily_itinerary')
        .select(isAdmin ? '*, creator:profiles!created_by(full_name)' : '*')
        .or(`is_complete.eq.false,target_date.eq.${todayStr}`)
        .order('created_at', { ascending: true });

      if (!isAdmin) {
        query = query.eq('created_by', profile.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      setItineraryItems(data || []);
    } catch (err) {
      console.error('Error fetching itinerary:', err);
      setItineraryItems([]);
    } finally {
      setItineraryLoading(false);
    }
  }, [profile?.id, isAdmin, todayStr]);

  const fetchAnnouncements = useCallback(async () => {
    if (!profile?.id) return;
    setAnnouncementsLoading(true);
    try {
      const [announcementsResult, readsResult] = await Promise.all([
        supabase
          .from('announcements')
          .select('*, creator:profiles!created_by(full_name)')
          .eq('target_date', todayStr)
          .order('created_at', { ascending: false }),
        supabase
          .from('announcement_reads')
          .select('announcement_id')
          .eq('user_id', profile.id),
      ]);

      if (announcementsResult.error) throw announcementsResult.error;
      const data = announcementsResult.data || [];
      const readIds = new Set((readsResult.data || []).map(r => r.announcement_id));

      setAnnouncements(data.map(a => ({ ...a, isRead: readIds.has(a.id) })));
    } catch (err) {
      console.error('Error fetching announcements:', err);
      setAnnouncements([]);
    } finally {
      setAnnouncementsLoading(false);
    }
  }, [profile?.id, todayStr]);

  useEffect(() => {
    if (!profile?.id) return;
    const timeout = setTimeout(() => setLoading(false), 5000);
    fetchAssignments().finally(() => clearTimeout(timeout));
    return () => clearTimeout(timeout);
  }, [profile?.id]);

  useEffect(() => {
    if ((isAdmin || isAssistant) && profile?.id) {
      fetchItinerary();
    }
  }, [isAdmin, isAssistant, profile?.id, fetchItinerary]);

  useEffect(() => {
    if (profile?.id) {
      fetchAnnouncements();
    }
  }, [profile?.id, fetchAnnouncements]);

  const fetchTodayEvents = useCallback(async () => {
    if (!profile?.id) return;
    setEventsLoading(true);
    try {
      const dayStart = new Date(todayStr + 'T00:00:00').toISOString();
      const dayEnd = new Date(todayStr + 'T23:59:59').toISOString();
      const { data, error } = await supabase
        .from('calendar_events')
        .select('*, creator:profiles!created_by(id, full_name)')
        .lte('start_date', dayEnd)
        .gte('end_date', dayStart)
        .order('all_day', { ascending: false })
        .order('start_date', { ascending: true });
      if (error) throw error;
      setTodayEvents(data || []);
    } catch (err) {
      console.error('Error fetching today events:', err);
      setTodayEvents([]);
    } finally {
      setEventsLoading(false);
    }
  }, [profile?.id, todayStr]);

  useEffect(() => {
    if (profile?.id) fetchTodayEvents();
  }, [profile?.id, fetchTodayEvents]);

  async function fetchAssignments() {
    if (!profile?.id) return;
    try {
      const { data, error } = await safeQuery(() =>
        supabase
          .from('project_assignments')
          .select(`
            assignment_role,
            project:projects(*)
          `)
          .eq('user_id', profile.id)
          .order('created_at', { ascending: false })
      );

      if (error) throw error;
      setAssignments(data || []);
    } catch (err) {
      console.error('Error fetching assignments:', err);
      setAssignments([]);
    } finally {
      setLoading(false);
    }
  }

  async function addItineraryItem() {
    if (!newItemText.trim()) return;
    const content = newItemText.trim();
    const tempItem = {
      id: `temp-${Date.now()}`,
      created_by: profile.id,
      target_date: todayStr,
      content,
      is_complete: false,
      admin_comment: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      creator: { full_name: profile.full_name },
    };
    setNewItemText('');
    setItineraryItems(prev => [...prev, tempItem]);
    try {
      const { error } = await supabase.from('daily_itinerary').insert({
        created_by: profile.id,
        target_date: todayStr,
        content,
      });
      if (error) throw error;
      fetchItinerary(); // Re-fetch to get real ID
    } catch (err) {
      console.error('Error adding itinerary item:', err);
      setItineraryItems(prev => prev.filter(i => i.id !== tempItem.id));
      setNewItemText(content);
    }
  }

  async function updateItineraryItem(id, updates) {
    const prev = itineraryItems;
    setItineraryItems(items => items.map(i => i.id === id ? { ...i, ...updates, updated_at: new Date().toISOString() } : i));
    try {
      const { error } = await supabase
        .from('daily_itinerary')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    } catch (err) {
      console.error('Error updating itinerary item:', err);
      setItineraryItems(prev);
    }
  }

  async function deleteItineraryItem(id) {
    const prev = itineraryItems;
    setItineraryItems(items => items.filter(i => i.id !== id));
    try {
      const { error } = await supabase.from('daily_itinerary').delete().eq('id', id);
      if (error) throw error;
    } catch (err) {
      console.error('Error deleting itinerary item:', err);
      setItineraryItems(prev);
    }
  }

  function handleEditSave(id) {
    if (editingItemText.trim()) {
      updateItineraryItem(id, { content: editingItemText.trim() });
    }
    setEditingItemId(null);
    setEditingItemText('');
  }

  // Admin comment handlers
  async function saveAdminComment(itemId) {
    const newComment = commentText.trim() || null;
    const prev = itineraryItems;
    setItineraryItems(items => items.map(i => i.id === itemId ? { ...i, admin_comment: newComment, updated_at: new Date().toISOString() } : i));
    setCommentingItemId(null);
    setCommentText('');
    try {
      const { error } = await supabase
        .from('daily_itinerary')
        .update({ admin_comment: newComment, updated_at: new Date().toISOString() })
        .eq('id', itemId);
      if (error) throw error;
    } catch (err) {
      console.error('Error saving admin comment:', err);
      setItineraryItems(prev);
    }
  }

  // Announcement handlers
  async function addAnnouncement() {
    if (!newAnnouncementText.trim()) return;
    const content = newAnnouncementText.trim();
    const tempAnnouncement = {
      id: `temp-${Date.now()}`,
      created_by: profile.id,
      target_date: todayStr,
      content,
      created_at: new Date().toISOString(),
      creator: { full_name: profile.full_name },
      isRead: true,
    };
    setNewAnnouncementText('');
    setShowAnnouncementInput(false);
    setAnnouncements(prev => [tempAnnouncement, ...prev]);
    try {
      const { error } = await supabase.from('announcements').insert({
        created_by: profile.id,
        target_date: todayStr,
        content,
      });
      if (error) throw error;
      // Notify all team members
      try {
        const { data: allMembers } = await supabase.from('profiles').select('id');
        if (allMembers) {
          const notifs = allMembers
            .filter(m => m.id !== profile.id)
            .map(m => ({
              user_id: m.id,
              type: 'announcement',
              title: 'New announcement',
              body: content.substring(0, 100),
              link_tab: 'dashboard',
            }));
          if (notifs.length > 0) {
            await supabase.from('notifications').insert(notifs);
          }
        }
      } catch (e) {
        console.error('Error sending announcement notifications:', e);
      }
      fetchAnnouncements(); // Re-fetch to get real ID
    } catch (err) {
      console.error('Error adding announcement:', err);
      setAnnouncements(prev => prev.filter(a => a.id !== tempAnnouncement.id));
    }
  }

  async function deleteAnnouncement(id) {
    const prev = announcements;
    setAnnouncements(items => items.filter(a => a.id !== id));
    try {
      const { error } = await supabase.from('announcements').delete().eq('id', id);
      if (error) throw error;
    } catch (err) {
      console.error('Error deleting announcement:', err);
      setAnnouncements(prev);
    }
  }

  async function markAnnouncementRead(announcementId) {
    setAnnouncements(prev => prev.map(a => a.id === announcementId ? { ...a, isRead: true } : a));
    try {
      const { error } = await supabase.from('announcement_reads').insert({
        announcement_id: announcementId,
        user_id: profile.id,
      });
      if (error) throw error;
    } catch (err) {
      console.error('Error marking announcement read:', err);
    }
  }

  async function handleTitleSave() {
    await updateProfile({ title: titleDraft });
    setEditingTitle(false);
  }

  async function handleNameSave() {
    if (!nameDraft.trim()) return;
    await updateProfile({ full_name: nameDraft.trim() });
    await supabase.auth.updateUser({ data: { full_name: nameDraft.trim() } });
    setEditingName(false);
  }

  // ── Brain Dump handlers ──
  const fetchBrainDump = useCallback(async () => {
    if (!profile?.id) return;
    setBrainDumpLoading(true);
    try {
      const { data, error } = await supabase
        .from('brain_dump')
        .select('*')
        .eq('created_by', profile.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setBrainDumpItems(data || []);
    } catch (err) {
      console.error('Error fetching brain dump:', err);
      setBrainDumpItems([]);
    } finally {
      setBrainDumpLoading(false);
    }
  }, [profile?.id]);

  useEffect(() => {
    if (profile?.id) fetchBrainDump();
  }, [profile?.id, fetchBrainDump]);

  async function addBrainDumpItem() {
    if (!newBrainDumpText.trim() || !profile?.id) return;
    const content = newBrainDumpText.trim();
    const tempItem = {
      id: `temp-${Date.now()}`,
      created_by: profile.id,
      content,
      is_complete: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setNewBrainDumpText('');
    setBrainDumpItems(prev => [...prev, tempItem]);
    try {
      const { error } = await supabase.from('brain_dump').insert({
        created_by: profile.id,
        content,
      });
      if (error) throw error;
      fetchBrainDump(); // Re-fetch to get real ID
    } catch (err) {
      console.error('Error adding brain dump item:', err);
      setBrainDumpItems(prev => prev.filter(i => i.id !== tempItem.id));
      setNewBrainDumpText(content);
    }
  }

  async function updateBrainDumpItem(id, updates) {
    const prev = brainDumpItems;
    setBrainDumpItems(items => items.map(i => i.id === id ? { ...i, ...updates, updated_at: new Date().toISOString() } : i));
    try {
      const { error } = await supabase
        .from('brain_dump')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    } catch (err) {
      console.error('Error updating brain dump item:', err);
      setBrainDumpItems(prev);
    }
  }

  async function deleteBrainDumpItem(id) {
    const prev = brainDumpItems;
    setBrainDumpItems(items => items.filter(i => i.id !== id));
    try {
      const { error } = await supabase.from('brain_dump').delete().eq('id', id);
      if (error) throw error;
    } catch (err) {
      console.error('Error deleting brain dump item:', err);
      setBrainDumpItems(prev);
    }
  }

  function handleBrainDumpEditSave(id) {
    if (editingBrainDumpText.trim()) {
      updateBrainDumpItem(id, { content: editingBrainDumpText.trim() });
    }
    setEditingBrainDumpId(null);
    setEditingBrainDumpText('');
  }

  function getDaysUntil(deadline) {
    const now = new Date();
    const dl = new Date(deadline);
    const diff = Math.ceil((dl - now) / (1000 * 60 * 60 * 24));
    return diff;
  }

  function getUrgencyColor(days) {
    if (days < 0) return '#ef4444';
    if (days <= 3) return '#f97316';
    if (days <= 7) return '#f59e0b';
    return '#22c55e';
  }

  function formatContent(content) {
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

  // Sort: active projects first, then by deadline urgency
  const activeAssignments = assignments
    .filter(a => a.project && a.project.status !== 'published')
    .sort((a, b) => new Date(a.project.deadline) - new Date(b.project.deadline));

  const completedAssignments = assignments
    .filter(a => a.project && a.project.status === 'published');

  // ── Itinerary item renderer ──
  function renderItineraryItem(item) {
    const isEditing = editingItemId === item.id;
    const isCommenting = commentingItemId === item.id;
    return (
      <div key={item.id} style={styles.itineraryItemWrapper}>
        <div style={styles.itineraryItem}>
          <input
            type="checkbox"
            checked={item.is_complete}
            onChange={() => updateItineraryItem(item.id, { is_complete: !item.is_complete })}
            style={styles.itineraryCheckbox}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            {isEditing ? (
              <input
                value={editingItemText}
                onChange={(e) => setEditingItemText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleEditSave(item.id)}
                onBlur={() => handleEditSave(item.id)}
                style={styles.itineraryEditInput}
                autoFocus
              />
            ) : (
              <span style={{
                ...styles.itineraryContent,
                textDecoration: item.is_complete ? 'line-through' : 'none',
                opacity: item.is_complete ? 0.5 : 1,
              }}>
                {item.content}
              </span>
            )}
            {isAdmin && item.creator && (
              <span style={styles.itineraryCreator}>{item.creator.full_name}</span>
            )}
          </div>
          <div style={styles.itineraryActions}>
            {!isEditing && (isAdmin || isAssistant) && (
              <button
                onClick={() => { setEditingItemId(item.id); setEditingItemText(item.content); }}
                style={styles.itineraryActionBtn}
                title="Edit"
              >
                ✎
              </button>
            )}
            {(isAdmin || isAssistant) && (
              <button
                onClick={() => deleteItineraryItem(item.id)}
                style={{ ...styles.itineraryActionBtn, color: '#ef4444' }}
                title="Delete"
              >
                ✕
              </button>
            )}
          </div>
        </div>
        {/* Admin comment section */}
        {isAdmin && (
          <div style={styles.commentSection}>
            {isCommenting ? (
              <div style={styles.commentEditRow}>
                <input
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveAdminComment(item.id)}
                  placeholder="Add a comment..."
                  style={styles.commentInput}
                  autoFocus
                />
                <button onClick={() => saveAdminComment(item.id)} style={styles.commentSaveBtn}>Save</button>
                <button onClick={() => { setCommentingItemId(null); setCommentText(''); }} style={styles.commentCancelBtn}>Cancel</button>
              </div>
            ) : item.admin_comment ? (
              <div style={styles.commentDisplay}>
                <span style={styles.commentLabel}>Admin:</span>
                <span style={styles.commentText}>{item.admin_comment}</span>
                <button
                  onClick={() => { setCommentingItemId(item.id); setCommentText(item.admin_comment); }}
                  style={styles.commentEditBtn}
                >
                  ✎
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setCommentingItemId(item.id); setCommentText(''); }}
                style={styles.addCommentBtn}
              >
                + Add comment
              </button>
            )}
          </div>
        )}
        {/* Assistant sees admin comment read-only */}
        {isAssistant && item.admin_comment && (
          <div style={styles.commentSection}>
            <div style={styles.commentDisplay}>
              <span style={styles.commentLabel}>Admin:</span>
              <span style={styles.commentText}>{item.admin_comment}</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Announcements renderer ──
  function renderAnnouncements({ showInput }) {
    return (
      <div style={styles.announcementsSection}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={styles.subSectionTitle}>Announcements</h3>
          {showInput && !showAnnouncementInput && (
            <button
              onClick={() => setShowAnnouncementInput(true)}
              style={styles.postAnnouncementBtn}
            >
              + Post
            </button>
          )}
        </div>
        {showInput && showAnnouncementInput && (
          <div style={styles.itineraryAddRow}>
            <input
              value={newAnnouncementText}
              onChange={(e) => setNewAnnouncementText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addAnnouncement();
                if (e.key === 'Escape') { setShowAnnouncementInput(false); setNewAnnouncementText(''); }
              }}
              placeholder="Post an announcement to all members..."
              style={styles.itineraryInput}
              autoFocus
            />
            <button
              onClick={addAnnouncement}
              disabled={!newAnnouncementText.trim()}
              style={{
                ...styles.itineraryAddBtn,
                opacity: newAnnouncementText.trim() ? 1 : 0.4,
              }}
            >
              Post
            </button>
            <button
              onClick={() => { setShowAnnouncementInput(false); setNewAnnouncementText(''); }}
              style={styles.cancelTitleBtn}
            >
              Cancel
            </button>
          </div>
        )}
        {announcementsLoading ? (
          <p style={styles.emptyText}>Loading...</p>
        ) : announcements.length === 0 ? (
          <p style={{ ...styles.emptyText, marginTop: '8px' }}>No announcements today</p>
        ) : (
          <div style={styles.announcementList}>
            {announcements.map(a => (
              <div key={a.id} style={{
                ...styles.announcementItem,
                borderLeft: a.isRead ? '3px solid rgba(255,255,255,0.1)' : '3px solid #6366f1',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={styles.announcementContent}>{formatContent(a.content)}</span>
                  <span style={styles.announcementMeta}>
                    {a.creator?.full_name} &middot; {new Date(a.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
                <div style={styles.announcementActions}>
                  {!a.isRead && (
                    <button onClick={() => markAnnouncementRead(a.id)} style={styles.readBtn}>
                      Mark Read
                    </button>
                  )}
                  {a.created_by === profile.id && (
                    <button
                      onClick={() => deleteAnnouncement(a.id)}
                      style={{ ...styles.itineraryActionBtn, color: '#ef4444' }}
                      title="Delete"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Today's Schedule renderer ──
  function renderTodaySchedule() {
    return (
      <div style={styles.scheduleSection}>
        <h3 style={styles.subSectionTitle}>Today's Schedule</h3>
        {eventsLoading ? (
          <p style={styles.emptyText}>Loading...</p>
        ) : todayEvents.length === 0 ? (
          <p style={{ ...styles.emptyText, marginTop: '8px' }}>No events scheduled for today</p>
        ) : (
          <div style={styles.scheduleList}>
            {todayEvents.map(ev => {
              const color = EVENT_TYPE_COLORS[ev.event_type] || '#6b7280';
              const icon = EVENT_TYPE_ICONS[ev.event_type] || '\u2022';
              const startD = new Date(ev.start_date);
              const endD = new Date(ev.end_date);
              const timeStr = ev.all_day
                ? 'All day'
                : `${startD.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} \u2013 ${endD.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
              return (
                <div key={ev.id} style={{ ...styles.scheduleItem, borderLeftColor: color }}>
                  <div style={styles.scheduleItemHeader}>
                    <span style={{ fontSize: '13px' }}>{icon}</span>
                    <span style={{ ...styles.scheduleItemTitle, color }}>{ev.title}</span>
                    <span style={styles.scheduleItemType}>{EVENT_TYPE_LABELS[ev.event_type]}</span>
                  </div>
                  <div style={styles.scheduleItemMeta}>
                    <span>{timeStr}</span>
                    {ev.location && <span> &middot; {ev.location}</span>}
                  </div>
                  {ev.description && (
                    <p style={styles.scheduleItemDesc}>{ev.description}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  const isMember = !isAdmin && !isAssistant;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.greeting}>
            Welcome back, {profile?.full_name?.split(' ')[0]}
          </h1>
          <p style={styles.date}>
            {new Date().toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
        </div>
      </div>

      {/* Profile Card */}
      <div style={styles.profileCard}>
        <div style={styles.profileAvatar}>
          {profile?.full_name?.charAt(0)?.toUpperCase()}
        </div>
        <div style={styles.profileInfo}>
          {editingName ? (
            <div style={styles.titleEdit}>
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="Enter your name"
                style={styles.titleInput}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleNameSave()}
              />
              <button onClick={handleNameSave} style={styles.saveTitleBtn}>Save</button>
              <button onClick={() => setEditingName(false)} style={styles.cancelTitleBtn}>Cancel</button>
            </div>
          ) : (
            <h2
              style={{ ...styles.profileName, cursor: 'pointer' }}
              onClick={() => { setNameDraft(profile?.full_name || ''); setEditingName(true); }}
              title="Click to edit"
            >
              {profile?.full_name} <span style={{ fontSize: '14px', opacity: 0.4 }}>✎</span>
            </h2>
          )}
          {editingTitle ? (
            <div style={styles.titleEdit}>
              <input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                placeholder="Enter your title"
                style={styles.titleInput}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleTitleSave()}
              />
              <button onClick={handleTitleSave} style={styles.saveTitleBtn}>Save</button>
              <button onClick={() => setEditingTitle(false)} style={styles.cancelTitleBtn}>Cancel</button>
            </div>
          ) : (
            <p
              style={styles.profileTitle}
              onClick={() => { setTitleDraft(profile?.title || ''); setEditingTitle(true); }}
              title="Click to edit"
            >
              {profile?.title || 'Click to set your title'} ✎
            </p>
          )}
          <p style={styles.profileEmail}>{profile?.email}</p>
        </div>
        <div style={styles.statsRow}>
          <div style={styles.stat}>
            <div style={styles.statValue}>{activeAssignments.length}</div>
            <div style={styles.statLabel}>Active Projects</div>
          </div>
          <div style={styles.stat}>
            <div style={styles.statValue}>{completedAssignments.length}</div>
            <div style={styles.statLabel}>Completed</div>
          </div>
          <div style={styles.stat}>
            <div style={styles.statValue}>
              {activeAssignments.filter(a => getDaysUntil(a.project.deadline) <= 3).length}
            </div>
            <div style={styles.statLabel}>Due Soon</div>
          </div>
        </div>
      </div>

      {/* Admin: Today section */}
      {isAdmin && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Today</h2>
          <div style={styles.itineraryCard}>
            {renderTodaySchedule()}
            <h3 style={styles.subSectionTitle}>Itinerary</h3>
            <div style={styles.itineraryAddRow}>
              <input
                value={newItemText}
                onChange={(e) => setNewItemText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addItineraryItem()}
                placeholder="Add an itinerary item..."
                style={styles.itineraryInput}
              />
              <button
                onClick={addItineraryItem}
                disabled={!newItemText.trim()}
                style={{
                  ...styles.itineraryAddBtn,
                  opacity: newItemText.trim() ? 1 : 0.4,
                }}
              >
                Add
              </button>
            </div>
            {itineraryLoading ? (
              <p style={styles.emptyText}>Loading...</p>
            ) : itineraryItems.length === 0 ? (
              <p style={{ ...styles.emptyText, marginTop: '8px' }}>No itinerary items for today</p>
            ) : (
              <div style={styles.itineraryList}>
                {itineraryItems.map(item => renderItineraryItem(item))}
              </div>
            )}
            {renderAnnouncements({ showInput: true })}
          </div>
        </div>
      )}

      {/* Assistant: Today section */}
      {isAssistant && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Today</h2>
          <div style={styles.itineraryCard}>
            {renderTodaySchedule()}
            <div style={styles.itineraryAddRow}>
              <input
                value={newItemText}
                onChange={(e) => setNewItemText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addItineraryItem()}
                placeholder="Add an itinerary item..."
                style={styles.itineraryInput}
              />
              <button
                onClick={addItineraryItem}
                disabled={!newItemText.trim()}
                style={{
                  ...styles.itineraryAddBtn,
                  opacity: newItemText.trim() ? 1 : 0.4,
                }}
              >
                Add
              </button>
            </div>
            {itineraryLoading ? (
              <p style={styles.emptyText}>Loading...</p>
            ) : itineraryItems.length === 0 ? (
              <p style={{ ...styles.emptyText, marginTop: '12px' }}>No items yet — add one above</p>
            ) : (
              <div style={styles.itineraryList}>
                {itineraryItems.map(item => renderItineraryItem(item))}
              </div>
            )}
            {renderAnnouncements({ showInput: true })}
          </div>
        </div>
      )}

      {/* Regular member: Today section */}
      {isMember && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Today</h2>
          <div style={styles.itineraryCard}>
            {renderTodaySchedule()}
            {renderAnnouncements({ showInput: false })}
          </div>
        </div>
      )}

      {/* Active Projects */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Your Active Projects</h2>
        {loading ? (
          <p style={styles.emptyText}>Loading...</p>
        ) : activeAssignments.length === 0 ? (
          <div style={styles.emptyCard}>
            <p style={styles.emptyText}>No active projects assigned to you yet.</p>
          </div>
        ) : (
          <div style={styles.projectGrid}>
            {activeAssignments.map(({ project, assignment_role }) => {
              const days = getDaysUntil(project.deadline);
              const urgency = getUrgencyColor(days);
              return (
                <div key={project.id} style={styles.projectCard}>
                  <div style={styles.projectCardHeader}>
                    <span style={{
                      ...styles.statusBadge,
                      background: `${STATUS_COLORS[project.status]}20`,
                      color: STATUS_COLORS[project.status],
                    }}>
                      {STATUS_LABELS[project.status]}
                    </span>
                    <span style={styles.roleBadge}>{assignment_role}</span>
                  </div>
                  <h3 style={styles.projectName}>{project.name}</h3>
                  {project.channel && (
                    <p style={styles.projectChannel}>{project.channel}</p>
                  )}
                  <div style={styles.projectDeadline}>
                    <div style={{
                      ...styles.deadlineIndicator,
                      background: urgency,
                    }} />
                    <span style={{ color: urgency, fontWeight: 600, fontSize: '13px' }}>
                      {days < 0
                        ? `${Math.abs(days)} days overdue`
                        : days === 0
                          ? 'Due today'
                          : `${days} days remaining`}
                    </span>
                  </div>
                  <div style={styles.projectDates}>
                    <span>{new Date(project.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    <span style={styles.dateArrow}>→</span>
                    <span>{new Date(project.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Completed Projects */}
      {completedAssignments.length > 0 && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Recently Completed</h2>
          <div style={styles.completedList}>
            {completedAssignments.slice(0, 5).map(({ project, assignment_role }) => (
              <div key={project.id} style={styles.completedItem}>
                <div style={styles.checkIcon}>✓</div>
                <span style={styles.completedName}>{project.name}</span>
                <span style={styles.completedRole}>{assignment_role}</span>
                <span style={styles.completedDate}>
                  {new Date(project.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Brain Dump */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Brain Dump</h2>
        <div style={styles.itineraryCard}>
          <div style={styles.itineraryAddRow}>
            <input
              value={newBrainDumpText}
              onChange={(e) => setNewBrainDumpText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addBrainDumpItem()}
              placeholder="Drop an idea, task, or note..."
              style={styles.itineraryInput}
            />
            <button
              onClick={addBrainDumpItem}
              disabled={!newBrainDumpText.trim()}
              style={{
                ...styles.itineraryAddBtn,
                opacity: newBrainDumpText.trim() ? 1 : 0.4,
              }}
            >
              Add
            </button>
          </div>
          {brainDumpLoading ? (
            <p style={styles.emptyText}>Loading...</p>
          ) : brainDumpItems.length === 0 ? (
            <p style={{ ...styles.emptyText, marginTop: '12px' }}>No items yet — drop something in above</p>
          ) : (
            <div style={styles.brainDumpList}>
              {brainDumpItems.map(item => {
                const isOwner = item.created_by === profile?.id;
                const isEditingThis = editingBrainDumpId === item.id;
                return (
                  <div key={item.id} style={styles.brainDumpItem}>
                    <input
                      type="checkbox"
                      checked={item.is_complete}
                      onChange={() => isOwner && updateBrainDumpItem(item.id, { is_complete: !item.is_complete })}
                      style={styles.itineraryCheckbox}
                      disabled={!isOwner}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {isEditingThis ? (
                        <input
                          value={editingBrainDumpText}
                          onChange={(e) => setEditingBrainDumpText(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleBrainDumpEditSave(item.id)}
                          onBlur={() => handleBrainDumpEditSave(item.id)}
                          style={styles.itineraryEditInput}
                          autoFocus
                        />
                      ) : (
                        <span style={{
                          ...styles.itineraryContent,
                          textDecoration: item.is_complete ? 'line-through' : 'none',
                          opacity: item.is_complete ? 0.5 : 1,
                        }}>
                          {item.content}
                        </span>
                      )}
                    </div>
                    {isOwner && (
                      <div style={styles.itineraryActions}>
                        {!isEditingThis && (
                          <button
                            onClick={() => { setEditingBrainDumpId(item.id); setEditingBrainDumpText(item.content); }}
                            style={styles.itineraryActionBtn}
                            title="Edit"
                          >
                            ✎
                          </button>
                        )}
                        <button
                          onClick={() => deleteBrainDumpItem(item.id)}
                          style={{ ...styles.itineraryActionBtn, color: '#ef4444' }}
                          title="Delete"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Morty Mascot Controls */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        padding: '16px 0',
        marginTop: '24px',
        borderTop: '1px solid rgba(255,255,255,0.06)',
      }}>
        <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.35)' }}>Morty</span>
        <button
          onClick={() => updateProfile({ mascot_enabled: profile?.mascot_enabled === false ? true : false })}
          style={{
            position: 'relative',
            width: '40px',
            height: '22px',
            borderRadius: '11px',
            border: 'none',
            background: profile?.mascot_enabled !== false ? '#22c55e' : 'rgba(255,255,255,0.15)',
            cursor: 'pointer',
            transition: 'background 0.2s',
            padding: 0,
            flexShrink: 0,
          }}
        >
          <div style={{
            position: 'absolute',
            top: '2px',
            left: profile?.mascot_enabled !== false ? '20px' : '2px',
            width: '18px',
            height: '18px',
            borderRadius: '50%',
            background: '#fff',
            transition: 'left 0.2s',
            boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
          }} />
        </button>
        {isAdmin && profile?.mascot_enabled !== false && (
          <button
            onClick={() => window.dispatchEvent(new Event('summon-morty'))}
            style={{
              padding: '4px 10px',
              borderRadius: '6px',
              border: '1px solid rgba(99,102,241,0.3)',
              background: 'rgba(99,102,241,0.1)',
              color: '#a5b4fc',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'all 0.15s',
            }}
            title="Summon Morty now"
          >
            Summon
          </button>
        )}
      </div>
    </div>
  );
}

const styles = {
  page: {
    padding: '32px 40px',
    maxWidth: '1100px',
  },
  header: {
    marginBottom: '32px',
  },
  greeting: {
    fontSize: '28px',
    fontWeight: 700,
    color: '#ffffff',
    margin: '0 0 4px 0',
    letterSpacing: '-0.5px',
  },
  date: {
    fontSize: '14px',
    color: 'rgba(255,255,255,0.4)',
    margin: 0,
  },
  profileCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '16px',
    padding: '28px',
    display: 'flex',
    alignItems: 'center',
    gap: '20px',
    marginBottom: '36px',
    flexWrap: 'wrap',
  },
  profileAvatar: {
    width: '60px',
    height: '60px',
    borderRadius: '16px',
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '24px',
    fontWeight: 700,
    color: '#fff',
    flexShrink: 0,
  },
  profileInfo: {
    flex: 1,
    minWidth: '200px',
  },
  profileName: {
    fontSize: '20px',
    fontWeight: 700,
    color: '#ffffff',
    margin: '0 0 2px 0',
  },
  profileTitle: {
    fontSize: '14px',
    color: '#a5b4fc',
    margin: '0 0 2px 0',
    cursor: 'pointer',
  },
  profileEmail: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.35)',
    margin: 0,
  },
  titleEdit: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    margin: '4px 0',
  },
  titleInput: {
    padding: '6px 10px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '14px',
    fontFamily: 'inherit',
    outline: 'none',
    width: '200px',
  },
  saveTitleBtn: {
    padding: '6px 12px',
    background: '#6366f1',
    border: 'none',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  cancelTitleBtn: {
    padding: '6px 12px',
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '12px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  statsRow: {
    display: 'flex',
    gap: '24px',
  },
  stat: {
    textAlign: 'center',
  },
  statValue: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#ffffff',
  },
  statLabel: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  section: {
    marginBottom: '36px',
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.7)',
    margin: '0 0 16px 0',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  subSectionTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.5)',
    margin: '0 0 10px 0',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  // Itinerary styles
  itineraryCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '14px',
    padding: '20px',
  },
  itineraryAddRow: {
    display: 'flex',
    gap: '10px',
    marginBottom: '4px',
  },
  itineraryInput: {
    flex: 1,
    padding: '10px 14px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    fontFamily: 'inherit',
    outline: 'none',
  },
  itineraryAddBtn: {
    padding: '10px 20px',
    background: '#6366f1',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  itineraryList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    marginTop: '12px',
  },
  itineraryItemWrapper: {
    background: 'rgba(255,255,255,0.02)',
    borderRadius: '10px',
    overflow: 'hidden',
  },
  itineraryItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 14px',
    transition: 'background 0.1s',
  },
  itineraryCheckbox: {
    width: '18px',
    height: '18px',
    accentColor: '#6366f1',
    cursor: 'pointer',
    flexShrink: 0,
  },
  itineraryContent: {
    fontSize: '14px',
    color: '#e2e8f0',
    display: 'block',
  },
  itineraryCreator: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.35)',
    marginTop: '2px',
    display: 'block',
  },
  itineraryEditInput: {
    width: '100%',
    padding: '6px 10px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '14px',
    fontFamily: 'inherit',
    outline: 'none',
  },
  itineraryActions: {
    display: 'flex',
    gap: '4px',
    flexShrink: 0,
  },
  itineraryActionBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.35)',
    cursor: 'pointer',
    fontSize: '14px',
    padding: '4px 6px',
    borderRadius: '4px',
    lineHeight: 1,
  },
  // Admin comment styles
  commentSection: {
    padding: '4px 14px 10px 44px',
  },
  commentEditRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  commentInput: {
    flex: 1,
    padding: '6px 10px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '13px',
    fontFamily: 'inherit',
    outline: 'none',
  },
  commentSaveBtn: {
    padding: '5px 12px',
    background: '#6366f1',
    border: 'none',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  commentCancelBtn: {
    padding: '5px 12px',
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '12px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  commentDisplay: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
  },
  commentLabel: {
    color: '#a5b4fc',
    fontWeight: 600,
    fontSize: '11px',
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
  },
  commentText: {
    color: 'rgba(255,255,255,0.6)',
    flex: 1,
  },
  commentEditBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.3)',
    cursor: 'pointer',
    fontSize: '13px',
    padding: '2px 4px',
  },
  addCommentBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.3)',
    cursor: 'pointer',
    fontSize: '12px',
    padding: 0,
    fontFamily: 'inherit',
  },
  // Announcement styles
  announcementsSection: {
    marginTop: '20px',
    paddingTop: '16px',
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  announcementList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    marginTop: '10px',
  },
  announcementItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 14px',
    background: 'rgba(255,255,255,0.02)',
    borderRadius: '8px',
  },
  announcementContent: {
    fontSize: '14px',
    color: '#e2e8f0',
    display: 'block',
  },
  announcementMeta: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.3)',
    marginTop: '2px',
    display: 'block',
  },
  announcementActions: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    flexShrink: 0,
  },
  readBtn: {
    padding: '4px 10px',
    background: 'rgba(99,102,241,0.15)',
    border: '1px solid rgba(99,102,241,0.3)',
    borderRadius: '6px',
    color: '#a5b4fc',
    fontSize: '11px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  // Project styles
  projectGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '16px',
  },
  projectCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '14px',
    padding: '20px',
    transition: 'border-color 0.15s',
  },
  projectCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  },
  statusBadge: {
    padding: '4px 10px',
    borderRadius: '6px',
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
  },
  roleBadge: {
    padding: '4px 10px',
    borderRadius: '6px',
    fontSize: '11px',
    fontWeight: 600,
    background: 'rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'capitalize',
  },
  projectName: {
    fontSize: '17px',
    fontWeight: 600,
    color: '#ffffff',
    margin: '0 0 4px 0',
  },
  projectChannel: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.4)',
    margin: '0 0 14px 0',
  },
  projectDeadline: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '8px',
  },
  deadlineIndicator: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },
  projectDates: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    fontSize: '12px',
    color: 'rgba(255,255,255,0.35)',
  },
  dateArrow: {
    color: 'rgba(255,255,255,0.2)',
  },
  emptyCard: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px dashed rgba(255,255,255,0.08)',
    borderRadius: '14px',
    padding: '40px',
    textAlign: 'center',
  },
  emptyText: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: '14px',
    margin: 0,
  },
  completedList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  completedItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 16px',
    background: 'rgba(255,255,255,0.02)',
    borderRadius: '10px',
  },
  checkIcon: {
    color: '#22c55e',
    fontSize: '14px',
    fontWeight: 700,
  },
  completedName: {
    flex: 1,
    fontSize: '14px',
    color: 'rgba(255,255,255,0.5)',
  },
  completedRole: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.3)',
    textTransform: 'capitalize',
  },
  completedDate: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.25)',
  },
  channelLink: {
    background: 'rgba(99,102,241,0.15)',
    color: '#a5b4fc',
    padding: '1px 4px',
    borderRadius: '4px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  brainDumpList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    marginTop: '8px',
  },
  brainDumpItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    padding: '8px 10px',
    borderRadius: '8px',
    transition: 'background 0.1s',
  },
  brainDumpCreator: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.25)',
    marginLeft: '8px',
  },
  postAnnouncementBtn: {
    padding: '4px 12px',
    background: 'rgba(99,102,241,0.1)',
    border: '1px solid rgba(99,102,241,0.25)',
    borderRadius: '6px',
    color: '#a5b4fc',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  scheduleSection: {
    marginBottom: '16px',
    paddingBottom: '16px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  scheduleList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginTop: '8px',
  },
  scheduleItem: {
    padding: '10px 14px',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderLeft: '3px solid',
    borderRadius: '8px',
  },
  scheduleItemHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '4px',
  },
  scheduleItemTitle: {
    fontSize: '14px',
    fontWeight: 600,
    flex: 1,
  },
  scheduleItemType: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.3)',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
  },
  scheduleItemMeta: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.4)',
  },
  scheduleItemDesc: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.3)',
    margin: '4px 0 0 0',
    lineHeight: 1.4,
  },
};
