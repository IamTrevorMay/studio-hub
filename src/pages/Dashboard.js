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

const STATUS_LABELS = {
  concept: 'Concept',
  script: 'Script',
  production: 'Production',
  edit: 'Edit',
  review: 'Review',
  published: 'Published',
};

export default function Dashboard() {
  const { profile, updateProfile, isAdmin, isAssistant } = useAuth();
  const { safeQuery } = useSupabaseQuery();
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(profile?.title || '');

  // Itinerary state
  const [itineraryItems, setItineraryItems] = useState([]);
  const [itineraryLoading, setItineraryLoading] = useState(false);
  const [newItemText, setNewItemText] = useState('');
  const [editingItemId, setEditingItemId] = useState(null);
  const [editingItemText, setEditingItemText] = useState('');

  const todayStr = new Date().toISOString().split('T')[0];

  const fetchItinerary = useCallback(async () => {
    if (!profile?.id) return;
    setItineraryLoading(true);
    try {
      let query = supabase
        .from('daily_itinerary')
        .select(isAdmin ? '*, creator:profiles!created_by(full_name)' : '*')
        .eq('target_date', todayStr)
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
    try {
      const { error } = await supabase.from('daily_itinerary').insert({
        created_by: profile.id,
        target_date: todayStr,
        content: newItemText.trim(),
      });
      if (error) throw error;
      setNewItemText('');
      fetchItinerary();
    } catch (err) {
      console.error('Error adding itinerary item:', err);
    }
  }

  async function updateItineraryItem(id, updates) {
    try {
      const { error } = await supabase
        .from('daily_itinerary')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      fetchItinerary();
    } catch (err) {
      console.error('Error updating itinerary item:', err);
    }
  }

  async function deleteItineraryItem(id) {
    try {
      const { error } = await supabase.from('daily_itinerary').delete().eq('id', id);
      if (error) throw error;
      fetchItinerary();
    } catch (err) {
      console.error('Error deleting itinerary item:', err);
    }
  }

  function handleEditSave(id) {
    if (editingItemText.trim()) {
      updateItineraryItem(id, { content: editingItemText.trim() });
    }
    setEditingItemId(null);
    setEditingItemText('');
  }

  async function handleTitleSave() {
    await updateProfile({ title: titleDraft });
    setEditingTitle(false);
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

  // Sort: active projects first, then by deadline urgency
  const activeAssignments = assignments
    .filter(a => a.project && a.project.status !== 'published')
    .sort((a, b) => new Date(a.project.deadline) - new Date(b.project.deadline));

  const completedAssignments = assignments
    .filter(a => a.project && a.project.status === 'published');

  // ── Itinerary section (shared renderer) ──
  function renderItineraryItem(item) {
    const isEditing = editingItemId === item.id;
    return (
      <div key={item.id} style={styles.itineraryItem}>
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
          {!isEditing && (
            <button
              onClick={() => { setEditingItemId(item.id); setEditingItemText(item.content); }}
              style={styles.itineraryActionBtn}
              title="Edit"
            >
              ✎
            </button>
          )}
          <button
            onClick={() => deleteItineraryItem(item.id)}
            style={{ ...styles.itineraryActionBtn, color: '#ef4444' }}
            title="Delete"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

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
          <h2 style={styles.profileName}>{profile?.full_name}</h2>
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

      {/* Admin: Today's Itinerary (above projects) */}
      {isAdmin && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Today's Itinerary</h2>
          <div style={styles.itineraryCard}>
            {itineraryLoading ? (
              <p style={styles.emptyText}>Loading...</p>
            ) : itineraryItems.length === 0 ? (
              <p style={styles.emptyText}>No itinerary items for today</p>
            ) : (
              <div style={styles.itineraryList}>
                {itineraryItems.map(item => renderItineraryItem(item))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Assistant: Itinerary Tool */}
      {isAssistant && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Today's Itinerary</h2>
          <div style={styles.itineraryCard}>
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
  itineraryItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 14px',
    background: 'rgba(255,255,255,0.02)',
    borderRadius: '10px',
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
};
