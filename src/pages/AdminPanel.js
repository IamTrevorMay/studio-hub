import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import usePersistedTab from '../hooks/usePersistedTab';
import { colors } from '../lib/styleTokens';


const CONTRACTOR_TITLES = [
  'Long Form Editor', 'Short Form Editor', 'Podcast Editor',
  'Graphic Designer', 'Developer', 'Writer', 'Producer', 'Production/Camera',
];

const EVENT_TYPE_LABELS = {
  deadline: 'Deadline',
  meeting: 'Meeting',
  live_recording: 'Live/Recording',
  filming: 'Filming/Recording',
  video_post: 'Mayday Video',
  tmbb_video: 'TMBB Video',
  unavailable: 'Unavailable',
};
const EVENT_TYPES = Object.keys(EVENT_TYPE_LABELS);

export default function AdminPanel({ initialTab }) {
  const { profile, isAdmin, refreshKey } = useAuth();
  const confirm = useConfirm();
  const [invitations, setInvitations] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviteTitle, setInviteTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [titlePickerFor, setTitlePickerFor] = useState(null);
  const [activeTab, setActiveTab] = usePersistedTab('admin-panel', 'invite', ['invite', 'team', 'google', 'notifications']);

  // Google Calendar state
  const [gcalConnection, setGcalConnection] = useState(null);
  const [gcalLoading, setGcalLoading] = useState(false);
  const [gcalCalendars, setGcalCalendars] = useState([]);
  const [gcalMappings, setGcalMappings] = useState({});
  const [gcalMessage, setGcalMessage] = useState('');
  const [gcalError, setGcalError] = useState('');

  // Email notification preferences
  const [emailPrefs, setEmailPrefs] = useState({});
  const [emailPrefsLoading, setEmailPrefsLoading] = useState(true);

  // Contractor email notification preferences (admin-managed)
  const [contractors, setContractors] = useState([]);
  const [contractorPrefs, setContractorPrefs] = useState({});

  // Sync activeTab when navigated to externally (e.g., after Google OAuth redirect)
  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  const fetchInvitations = useCallback(async () => {
    const { data } = await supabase
      .from('invitations')
      .select('*')
      .order('created_at', { ascending: false });
    setInvitations(data || []);
  }, []);

  const fetchTeamMembers = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('full_name');
    setTeamMembers(data || []);
  }, []);

  async function handleInvite(e) {
    e.preventDefault();
    setLoading(true);
    setInviteSuccess('');
    setInviteError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(
        `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/invite-user`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': process.env.REACT_APP_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ email: inviteEmail.toLowerCase().trim(), role: inviteRole, title: inviteRole === 'contractor' ? inviteTitle : null }),
        }
      );

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to send invite');

      const sentTo = inviteEmail;
      setInviteEmail('');
      setInviteRole('member');
      setInviteTitle('');
      fetchInvitations();
      setInviteSuccess(`✉ Invitation email sent to ${sentTo}!`);
      setTimeout(() => setInviteSuccess(''), 8000);
    } catch (err) {
      setInviteError(err.message);
      setTimeout(() => setInviteError(''), 8000);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteInvitation(inv) {
    if (!(await confirm(`Delete invitation for ${inv.email}?`))) return;
    const { error } = await supabase.from('invitations').delete().eq('id', inv.id);
    if (error) {
      console.error('Delete invitation failed:', error);
      alert('Failed to delete invitation: ' + error.message);
      return;
    }
    fetchInvitations();
  }

  async function handleRoleChange(userId, newRole) {
    const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', userId);
    if (error) console.error('Role change failed:', error);
    if (newRole === 'contractor') {
      setTitlePickerFor(userId);
    } else {
      setTitlePickerFor(null);
    }
    fetchTeamMembers();
  }

  async function handleTitleAssign(userId, title) {
    const { error } = await supabase.from('profiles').update({ title }).eq('id', userId);
    if (error) console.error('Title assign failed:', error);
    setTitlePickerFor(null);
    fetchTeamMembers();
  }

  async function handleRemoveMember(member) {
    if (!(await confirm(`Remove ${member.full_name} from the team? This cannot be undone.`))) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      // Delete auth user via edge function (cascades to profile via FK)
      const res = await fetch(
        `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/remove-user`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': process.env.REACT_APP_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ userId: member.id }),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to remove member');
      fetchTeamMembers();
    } catch (err) {
      console.error('Remove member failed:', err);
      alert('Failed to remove member: ' + err.message);
    }
  }

  // --- Google Calendar functions ---
  const fetchGcalConnection = useCallback(async () => {
    const { data } = await supabase
      .from('google_calendar_connections')
      .select('*')
      .eq('user_id', profile?.id)
      .single();
    setGcalConnection(data || null);
    if (data) fetchGcalCalendars();
  }, [profile?.id]);

  const fetchGcalMappings = useCallback(async () => {
    const { data } = await supabase
      .from('google_calendar_mappings')
      .select('*')
      .eq('user_id', profile?.id);
    const map = {};
    (data || []).forEach(m => { map[m.event_type] = m; });
    setGcalMappings(map);
  }, [profile?.id]);

  const ADMIN_EMAIL_TRIGGERS = [
    { key: 'fl_assignment_completed', label: 'Contractor completes an assignment' },
    { key: 'fl_comment', label: 'Contractor comments on an assignment' },
    { key: 'fl_stuck', label: 'Contractor reports being stuck' },
    { key: 'fl_hours_submitted', label: 'Contractor submits hours' },
  ];

  const fetchEmailPrefs = useCallback(async () => {
    if (!profile?.id) return;
    setEmailPrefsLoading(true);
    const { data } = await supabase
      .from('email_notification_preferences')
      .select('trigger_key, enabled')
      .eq('user_id', profile.id);
    const map = {};
    (data || []).forEach(r => { map[r.trigger_key] = r.enabled; });
    setEmailPrefs(map);
    setEmailPrefsLoading(false);
  }, [profile?.id]);

  async function toggleEmailPref(triggerKey) {
    const current = !!emailPrefs[triggerKey];
    const next = !current;
    setEmailPrefs(prev => ({ ...prev, [triggerKey]: next }));
    await supabase.from('email_notification_preferences').upsert({
      user_id: profile.id,
      trigger_key: triggerKey,
      enabled: next,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,trigger_key' });
  }

  const CONTRACTOR_EMAIL_TRIGGERS = [
    { key: 'fl_comment_on_mine', label: 'New comment on their assignment' },
    { key: 'fl_assignment_due_soon', label: 'Assignment due tomorrow' },
  ];

  const fetchContractorPrefs = useCallback(async () => {
    const { data: flProfiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('role', ['contractor', 'freelancer'])
      .order('full_name');
    setContractors(flProfiles || []);

    if (!flProfiles?.length) return;
    const { data: prefs } = await supabase
      .from('email_notification_preferences')
      .select('user_id, trigger_key, enabled')
      .in('user_id', flProfiles.map(c => c.id));
    const map = {};
    (prefs || []).forEach(r => {
      if (!map[r.user_id]) map[r.user_id] = {};
      map[r.user_id][r.trigger_key] = r.enabled;
    });
    setContractorPrefs(map);
  }, []);

  async function toggleContractorPref(contractorId, triggerKey) {
    const current = !!(contractorPrefs[contractorId]?.[triggerKey]);
    const next = !current;
    setContractorPrefs(prev => ({
      ...prev,
      [contractorId]: { ...(prev[contractorId] || {}), [triggerKey]: next },
    }));
    await supabase.from('email_notification_preferences').upsert({
      user_id: contractorId,
      trigger_key: triggerKey,
      enabled: next,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,trigger_key' });
  }

  useEffect(() => {
    if (!isAdmin) return;
    setLoading(true);
    Promise.all([fetchInvitations(), fetchTeamMembers(), fetchGcalConnection(), fetchGcalMappings(), fetchEmailPrefs(), fetchContractorPrefs()])
      .finally(() => setLoading(false));
  }, [isAdmin, fetchInvitations, fetchTeamMembers, fetchGcalConnection, fetchGcalMappings, fetchEmailPrefs, fetchContractorPrefs]);
  useVisibilityRefresh(useCallback(() => {
    if (!isAdmin) return;
    Promise.all([fetchInvitations(), fetchTeamMembers(), fetchGcalConnection(), fetchGcalMappings(), fetchEmailPrefs(), fetchContractorPrefs()]);
  }, [isAdmin, fetchInvitations, fetchTeamMembers, fetchGcalConnection, fetchGcalMappings, fetchEmailPrefs, fetchContractorPrefs]));

  async function fetchGcalCalendars() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(
        `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/google-calendars-list`,
        {
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': process.env.REACT_APP_SUPABASE_ANON_KEY,
          },
        }
      );
      const result = await res.json();
      if (res.ok) setGcalCalendars(result.calendars || []);
    } catch (err) {
      console.error('Error fetching Google calendars:', err);
    }
  }

  async function handleGcalConnect() {
    setGcalLoading(true);
    setGcalError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const res = await fetch(
        `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/google-auth-url`,
        {
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': process.env.REACT_APP_SUPABASE_ANON_KEY,
          },
        }
      );
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to get auth URL');
      window.location.href = result.url;
    } catch (err) {
      setGcalError(err.message);
      setTimeout(() => setGcalError(''), 8000);
    } finally {
      setGcalLoading(false);
    }
  }

  async function handleGcalDisconnect() {
    if (!(await confirm('Disconnect Google Calendar? This will remove all calendar mappings and sync data.'))) return;
    setGcalLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const res = await fetch(
        `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/google-disconnect`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
            'apikey': process.env.REACT_APP_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({}),
        }
      );
      if (!res.ok) {
        const result = await res.json();
        throw new Error(result.error || 'Failed to disconnect');
      }
      setGcalConnection(null);
      setGcalCalendars([]);
      setGcalMappings({});
      setGcalMessage('Google Calendar disconnected');
      setTimeout(() => setGcalMessage(''), 5000);
    } catch (err) {
      setGcalError(err.message);
      setTimeout(() => setGcalError(''), 8000);
    } finally {
      setGcalLoading(false);
    }
  }

  async function handleMappingChange(eventType, calendarId) {
    if (!calendarId) {
      // Remove mapping
      await supabase
        .from('google_calendar_mappings')
        .delete()
        .eq('user_id', profile.id)
        .eq('event_type', eventType);
      const updated = { ...gcalMappings };
      delete updated[eventType];
      setGcalMappings(updated);
      return;
    }
    const cal = gcalCalendars.find(c => c.id === calendarId);
    const { error } = await supabase
      .from('google_calendar_mappings')
      .upsert({
        user_id: profile.id,
        event_type: eventType,
        google_calendar_id: calendarId,
        google_calendar_name: cal?.summary || calendarId,
      }, { onConflict: 'user_id,event_type' });
    if (!error) {
      setGcalMappings(prev => ({
        ...prev,
        [eventType]: { google_calendar_id: calendarId, google_calendar_name: cal?.summary || calendarId },
      }));
    }
  }

  if (!isAdmin) {
    return (
      <div style={styles.page}>
        <div style={styles.accessDenied}>
          <h2>Admin Access Required</h2>
          <p>You don't have permission to view this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <h1 style={styles.pageTitle}>Admin Panel</h1>
      <p style={styles.pageSubtitle}>Manage your team and invitations</p>

      {/* Tabs */}
      <div style={styles.tabs}>
        <button
          onClick={() => setActiveTab('invite')}
          style={{ ...styles.tab, ...(activeTab === 'invite' ? styles.tabActive : {}) }}
        >Invite Members</button>
        <button
          onClick={() => setActiveTab('team')}
          style={{ ...styles.tab, ...(activeTab === 'team' ? styles.tabActive : {}) }}
        >Team ({teamMembers.length})</button>
        <button
          onClick={() => setActiveTab('google')}
          style={{ ...styles.tab, ...(activeTab === 'google' ? styles.tabActive : {}) }}
        >Google Calendar</button>
        <button
          onClick={() => setActiveTab('notifications')}
          style={{ ...styles.tab, ...(activeTab === 'notifications' ? styles.tabActive : {}) }}
        >Notifications</button>
      </div>

      {activeTab === 'invite' && (
        <>
          {/* Invite Form */}
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Invite a Team Member</h3>
            <form onSubmit={handleInvite} style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '12px' }}>
              <div style={styles.inviteForm}>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@company.com"
                  required
                  style={styles.input}
                />
                <button type="submit" disabled={loading} style={styles.inviteBtn}>
                  {loading ? 'Sending...' : '✉ Send Invite'}
                </button>
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <select
                  value={inviteRole}
                  onChange={(e) => { setInviteRole(e.target.value); if (e.target.value !== 'contractor') setInviteTitle(''); }}
                  style={styles.roleSelect}
                >
                  <option value="member">Member</option>
                  <option value="assistant">Assistant</option>
                  <option value="partner">Partner</option>
                  <option value="contractor">Contractor</option>
                  <option value="director_creative">Director of Creative</option>
                  <option value="director_comms">Director of Communications</option>
                  <option value="admin">Admin</option>
                </select>
                {inviteRole === 'contractor' && (
                  <select
                    value={inviteTitle}
                    onChange={(e) => setInviteTitle(e.target.value)}
                    style={styles.roleSelect}
                  >
                    <option value="">Select title...</option>
                    {CONTRACTOR_TITLES.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                )}
              </div>
            </form>
            {inviteSuccess && <div style={styles.successMsg}>{inviteSuccess}</div>}
            {inviteError && <div style={styles.errorMsg}>{inviteError}</div>}
            <p style={styles.helpText}>
              They'll receive an email with a link to set up their account.
            </p>
          </div>

          {/* Invitation History */}
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Invitation History</h3>
            {invitations.length === 0 ? (
              <p style={styles.emptyText}>No invitations sent yet.</p>
            ) : (
              <div style={styles.inviteList}>
                {invitations.map(inv => {
                  const memberEmails = teamMembers.map(m => m.email?.toLowerCase());
                  const isAccepted = !!inv.accepted_at || memberEmails.includes(inv.email?.toLowerCase());
                  return (
                    <div key={inv.id} style={styles.inviteItem}>
                      <div style={styles.inviteInfo}>
                        <div style={styles.inviteEmail}>{inv.email}</div>
                        <div style={styles.inviteMeta}>
                          Sent {new Date(inv.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{
                          ...styles.statusBadge,
                          ...(isAccepted ? styles.statusAccepted : styles.statusPending),
                        }}>
                          {isAccepted ? '✓ Accepted' : '● Pending'}
                        </div>
                        <button
                          onClick={() => handleDeleteInvitation(inv)}
                          style={styles.inviteDeleteBtn}
                          title="Delete invitation"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'team' && (
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Team Members</h3>
          <div style={styles.teamList}>
            {teamMembers.map(member => (
              <div key={member.id} style={styles.teamItem}>
                <div style={styles.teamAvatar}>
                  {member.avatar_url ? (
                    <img src={member.avatar_url} alt="" style={styles.teamAvatarImg} />
                  ) : member.full_name?.charAt(0)?.toUpperCase()}
                </div>
                <div style={styles.teamInfo}>
                  <div style={styles.teamName}>
                    {member.full_name}
                    {member.id === profile.id && (
                      <span style={styles.youBadge}>You</span>
                    )}
                  </div>
                  <div style={styles.teamMeta}>
                    {member.email} ·{' '}
                    <span
                      onClick={() => setTitlePickerFor(titlePickerFor === member.id ? null : member.id)}
                      style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: '3px' }}
                    >
                      {member.title || 'No title set'}
                    </span>
                  </div>
                </div>
                <select
                  value={member.role}
                  onChange={(e) => handleRoleChange(member.id, e.target.value)}
                  disabled={member.id === profile.id}
                  style={styles.roleSelect}
                >
                  <option value="member">Member</option>
                  <option value="assistant">Assistant</option>
                  <option value="partner">Partner</option>
                  <option value="contractor">Contractor</option>
                  <option value="director_creative">Director of Creative</option>
                  <option value="director_comms">Director of Communications</option>
                  <option value="admin">Admin</option>
                </select>
                {titlePickerFor === member.id && (
                  <select
                    value=""
                    onChange={(e) => handleTitleAssign(member.id, e.target.value)}
                    style={styles.roleSelect}
                  >
                    <option value="">Assign title...</option>
                    {CONTRACTOR_TITLES.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                )}
                {member.id !== profile.id && (
                  <button
                    onClick={() => handleRemoveMember(member)}
                    style={styles.removeBtn}
                    title="Remove member"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'google' && (
        <>
          {gcalMessage && <div style={styles.successMsg}>{gcalMessage}</div>}
          {gcalError && <div style={styles.errorMsg}>{gcalError}</div>}

          {/* Connection Card */}
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Google Calendar Connection</h3>
            {gcalConnection ? (
              <div style={styles.gcalConnected}>
                <div style={styles.gcalConnectedInfo}>
                  <div style={styles.gcalConnectedIcon}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                      <path d="M20 6L9 17l-5-5" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#e2e8f0' }}>
                      Connected as {gcalConnection.google_email}
                    </div>
                    <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)', marginTop: '2px' }}>
                      Connected {new Date(gcalConnection.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </div>
                  </div>
                </div>
                <button onClick={handleGcalDisconnect} disabled={gcalLoading} style={styles.gcalDisconnectBtn}>
                  {gcalLoading ? 'Disconnecting...' : 'Disconnect'}
                </button>
              </div>
            ) : (
              <div>
                <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.5)', margin: '0 0 16px 0' }}>
                  Connect your Google account to automatically sync Studio Hub events to your Google Calendars.
                </p>
                <button onClick={handleGcalConnect} disabled={gcalLoading} style={styles.gcalConnectBtn}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ marginRight: '8px' }}>
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  {gcalLoading ? 'Connecting...' : 'Connect Google Calendar'}
                </button>
              </div>
            )}
          </div>

          {/* Mapping Grid */}
          {gcalConnection && (
            <div style={styles.card}>
              <h3 style={styles.cardTitle}>Event Type Mapping</h3>
              <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', margin: '0 0 16px 0' }}>
                Choose which Google Calendar each event type syncs to. Unmapped types won't sync.
              </p>
              <div style={styles.mappingList}>
                {EVENT_TYPES.map(type => (
                  <div key={type} style={styles.mappingRow}>
                    <div style={styles.mappingLabel}>{EVENT_TYPE_LABELS[type]}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                        <path d="M2 8h12M10 4l4 4-4 4" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                    <select
                      value={gcalMappings[type]?.google_calendar_id || ''}
                      onChange={(e) => handleMappingChange(type, e.target.value)}
                      style={styles.mappingSelect}
                    >
                      <option value="">-- Not synced --</option>
                      {gcalCalendars.map(cal => (
                        <option key={cal.id} value={cal.id}>
                          {cal.summary}{cal.primary ? ' (Primary)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === 'notifications' && (
        <>
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Email Notifications</h3>
            <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.45)', margin: '0 0 20px 0' }}>
              Choose which events send you an email alert.
            </p>
            {emailPrefsLoading ? (
              <p style={styles.emptyText}>Loading...</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {ADMIN_EMAIL_TRIGGERS.map(t => (
                  <div key={t.key} style={styles.toggleRow}>
                    <span style={styles.toggleLabel}>{t.label}</span>
                    <button
                      onClick={() => toggleEmailPref(t.key)}
                      style={{
                        ...styles.toggleTrack,
                        background: emailPrefs[t.key] ? '#5b8fc7' : 'rgba(255,255,255,0.1)',
                      }}
                    >
                      <span style={{
                        ...styles.toggleKnob,
                        transform: emailPrefs[t.key] ? 'translateX(18px)' : 'translateX(0)',
                      }} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {contractors.length > 0 && (
            <div style={styles.card}>
              <h3 style={styles.cardTitle}>Contractor Notifications</h3>
              <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.45)', margin: '0 0 20px 0' }}>
                Manage which email alerts each contractor receives.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {contractors.map(c => (
                  <div key={c.id}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#e2e8f0', marginBottom: '10px' }}>
                      {c.full_name || 'Unnamed'}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {CONTRACTOR_EMAIL_TRIGGERS.map(t => (
                        <div key={t.key} style={styles.toggleRow}>
                          <span style={styles.toggleLabel}>{t.label}</span>
                          <button
                            onClick={() => toggleContractorPref(c.id, t.key)}
                            style={{
                              ...styles.toggleTrack,
                              background: contractorPrefs[c.id]?.[t.key] ? '#5b8fc7' : 'rgba(255,255,255,0.1)',
                            }}
                          >
                            <span style={{
                              ...styles.toggleKnob,
                              transform: contractorPrefs[c.id]?.[t.key] ? 'translateX(18px)' : 'translateX(0)',
                            }} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const styles = {
  page: { padding: '32px 40px', maxWidth: '800px' },
  pageTitle: {
    fontSize: '28px', fontWeight: 700, color: '#ffffff',
    margin: '0 0 4px 0', letterSpacing: '-0.5px',
  },
  pageSubtitle: {
    fontSize: '14px', color: 'rgba(255,255,255,0.4)', margin: '0 0 28px 0',
  },
  tabs: {
    display: 'flex', gap: '4px', marginBottom: '24px',
    background: 'rgba(255,255,255,0.03)', borderRadius: '10px', padding: '4px',
    width: 'fit-content',
  },
  tab: {
    padding: '8px 20px', border: 'none', borderRadius: '8px',
    background: 'transparent', color: 'rgba(255,255,255,0.45)',
    fontSize: '14px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
  },
  tabActive: {
    background: colors.accentA15, color: colors.accentFg,
  },
  card: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '14px', padding: '24px', marginBottom: '20px',
  },
  cardTitle: {
    fontSize: '16px', fontWeight: 600, color: '#e2e8f0',
    margin: '0 0 16px 0',
  },
  inviteForm: { display: 'flex', gap: '10px', marginBottom: '12px' },
  input: {
    flex: 1, padding: '10px 14px', background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px',
    color: '#fff', fontSize: '14px', fontFamily: 'inherit', outline: 'none',
  },
  inviteBtn: {
    padding: '10px 20px', background: colors.accent, border: 'none',
    borderRadius: '8px', color: '#fff', fontSize: '14px', fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  },
  helpText: { fontSize: '13px', color: 'rgba(255,255,255,0.35)', margin: 0 },
  successMsg: {
    padding: '10px 14px', background: 'rgba(34,197,94,0.1)',
    border: '1px solid rgba(34,197,94,0.2)', borderRadius: '8px',
    color: '#86efac', fontSize: '13px', marginBottom: '10px',
  },
  errorMsg: {
    padding: '10px 14px', background: 'rgba(239,68,68,0.1)',
    border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px',
    color: '#fca5a5', fontSize: '13px', marginBottom: '10px',
  },
  inviteList: { display: 'flex', flexDirection: 'column', gap: '8px' },
  inviteItem: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 16px', background: 'rgba(255,255,255,0.02)',
    borderRadius: '10px', gap: '12px',
  },
  inviteInfo: { flex: 1 },
  inviteEmail: { fontSize: '14px', fontWeight: 600, color: '#e2e8f0' },
  inviteMeta: { fontSize: '12px', color: 'rgba(255,255,255,0.35)', marginTop: '2px' },
  statusBadge: {
    padding: '4px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  statusPending: {
    background: 'rgba(245,158,11,0.1)', color: '#fbbf24',
    border: '1px solid rgba(245,158,11,0.2)',
  },
  statusAccepted: {
    background: 'rgba(34,197,94,0.1)', color: '#86efac',
    border: '1px solid rgba(34,197,94,0.2)',
  },
  inviteDeleteBtn: {
    padding: '4px 8px', background: 'transparent',
    border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px',
    color: '#ef4444', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit',
    flexShrink: 0, lineHeight: 1,
  },
  emptyText: { color: 'rgba(255,255,255,0.35)', fontSize: '14px', margin: 0 },
  teamList: { display: 'flex', flexDirection: 'column', gap: '6px' },
  teamItem: {
    display: 'flex', alignItems: 'center', gap: '14px',
    padding: '12px 14px', background: 'rgba(255,255,255,0.02)',
    borderRadius: '10px',
  },
  teamAvatar: {
    width: '40px', height: '40px', borderRadius: '10px',
    background: 'linear-gradient(135deg, #5b8fc7, #8fb4d8)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '16px', fontWeight: 700, color: '#fff', flexShrink: 0,
  },
  teamAvatarImg: {
    width: '40px', height: '40px', borderRadius: '10px', objectFit: 'cover',
  },
  teamInfo: { flex: 1 },
  teamName: {
    fontSize: '14px', fontWeight: 600, color: '#e2e8f0',
    display: 'flex', alignItems: 'center', gap: '8px',
  },
  youBadge: {
    padding: '2px 8px', background: colors.accentA15,
    borderRadius: '4px', fontSize: '10px', color: colors.accentFg, fontWeight: 600,
  },
  teamMeta: { fontSize: '12px', color: 'rgba(255,255,255,0.35)', marginTop: '2px' },
  roleSelect: {
    padding: '6px 10px', background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
    color: '#fff', fontSize: '12px', fontFamily: 'inherit', outline: 'none',
  },
  removeBtn: {
    padding: '6px 10px', background: 'transparent',
    border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px',
    color: '#ef4444', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit',
    flexShrink: 0, transition: 'background 0.15s',
  },
  accessDenied: {
    textAlign: 'center', padding: '80px 20px', color: 'rgba(255,255,255,0.5)',
  },
  gcalConnected: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '14px 16px', background: 'rgba(34,197,94,0.06)',
    border: '1px solid rgba(34,197,94,0.15)', borderRadius: '10px',
  },
  gcalConnectedInfo: {
    display: 'flex', alignItems: 'center', gap: '12px',
  },
  gcalConnectedIcon: {
    width: '40px', height: '40px', borderRadius: '10px',
    background: 'rgba(34,197,94,0.1)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  gcalDisconnectBtn: {
    padding: '8px 16px', background: 'transparent',
    border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px',
    color: '#ef4444', fontSize: '13px', fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  gcalConnectBtn: {
    display: 'flex', alignItems: 'center', padding: '12px 24px',
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '10px', color: '#fff', fontSize: '14px', fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit', transition: 'background 0.15s',
  },
  mappingList: { display: 'flex', flexDirection: 'column', gap: '8px' },
  mappingRow: {
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '10px 14px', background: 'rgba(255,255,255,0.02)',
    borderRadius: '8px',
  },
  mappingLabel: {
    width: '130px', fontSize: '14px', fontWeight: 500, color: '#e2e8f0',
    flexShrink: 0,
  },
  mappingSelect: {
    flex: 1, padding: '8px 10px', background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
    color: '#fff', fontSize: '13px', fontFamily: 'inherit', outline: 'none',
  },
  toggleRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '10px 14px', background: 'rgba(255,255,255,0.02)',
    borderRadius: '8px',
  },
  toggleLabel: {
    fontSize: '14px', color: '#e2e8f0', fontWeight: 500,
  },
  toggleTrack: {
    width: '40px', height: '22px', borderRadius: '11px',
    border: 'none', cursor: 'pointer', position: 'relative',
    transition: 'background 0.2s', padding: 0, flexShrink: 0,
  },
  toggleKnob: {
    display: 'block', width: '18px', height: '18px', borderRadius: '50%',
    background: '#fff', position: 'absolute', top: '2px', left: '2px',
    transition: 'transform 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
  },
};
