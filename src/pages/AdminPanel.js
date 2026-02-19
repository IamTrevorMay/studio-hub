import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';

export default function AdminPanel() {
  const { profile, isAdmin } = useAuth();
  const [invitations, setInvitations] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [activeTab, setActiveTab] = useState('invite');

  useEffect(() => {
    if (isAdmin) {
      fetchInvitations();
      fetchTeamMembers();
    }
  }, [isAdmin]);

  async function fetchInvitations() {
    const { data } = await supabase
      .from('invitations')
      .select('*')
      .order('created_at', { ascending: false });
    setInvitations(data || []);
  }

  async function fetchTeamMembers() {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('full_name');
    setTeamMembers(data || []);
  }

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
          body: JSON.stringify({ email: inviteEmail.toLowerCase().trim() }),
        }
      );

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to send invite');

      const sentTo = inviteEmail;
      setInviteEmail('');
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

  async function handleRoleChange(userId, newRole) {
    await supabase.from('profiles').update({ role: newRole }).eq('id', userId);
    fetchTeamMembers();
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
      </div>

      {activeTab === 'invite' && (
        <>
          {/* Invite Form */}
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Invite a Team Member</h3>
            <form onSubmit={handleInvite} style={styles.inviteForm}>
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
                  const isAccepted = !!inv.accepted_at;
                  return (
                    <div key={inv.id} style={styles.inviteItem}>
                      <div style={styles.inviteInfo}>
                        <div style={styles.inviteEmail}>{inv.email}</div>
                        <div style={styles.inviteMeta}>
                          Sent {new Date(inv.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </div>
                      </div>
                      <div style={{
                        ...styles.statusBadge,
                        ...(isAccepted ? styles.statusAccepted : styles.statusPending),
                      }}>
                        {isAccepted ? '✓ Joined' : '● Pending'}
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
                  {member.full_name?.charAt(0)?.toUpperCase()}
                </div>
                <div style={styles.teamInfo}>
                  <div style={styles.teamName}>
                    {member.full_name}
                    {member.id === profile.id && (
                      <span style={styles.youBadge}>You</span>
                    )}
                  </div>
                  <div style={styles.teamMeta}>
                    {member.email} · {member.title || 'No title set'}
                  </div>
                </div>
                <select
                  value={member.role}
                  onChange={(e) => handleRoleChange(member.id, e.target.value)}
                  disabled={member.id === profile.id}
                  style={styles.roleSelect}
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            ))}
          </div>
        </div>
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
    background: 'rgba(99,102,241,0.15)', color: '#a5b4fc',
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
    padding: '10px 20px', background: '#6366f1', border: 'none',
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
  emptyText: { color: 'rgba(255,255,255,0.35)', fontSize: '14px', margin: 0 },
  teamList: { display: 'flex', flexDirection: 'column', gap: '6px' },
  teamItem: {
    display: 'flex', alignItems: 'center', gap: '14px',
    padding: '12px 14px', background: 'rgba(255,255,255,0.02)',
    borderRadius: '10px',
  },
  teamAvatar: {
    width: '40px', height: '40px', borderRadius: '10px',
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '16px', fontWeight: 700, color: '#fff', flexShrink: 0,
  },
  teamInfo: { flex: 1 },
  teamName: {
    fontSize: '14px', fontWeight: 600, color: '#e2e8f0',
    display: 'flex', alignItems: 'center', gap: '8px',
  },
  youBadge: {
    padding: '2px 8px', background: 'rgba(99,102,241,0.15)',
    borderRadius: '4px', fontSize: '10px', color: '#a5b4fc', fontWeight: 600,
  },
  teamMeta: { fontSize: '12px', color: 'rgba(255,255,255,0.35)', marginTop: '2px' },
  roleSelect: {
    padding: '6px 10px', background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
    color: '#fff', fontSize: '12px', fontFamily: 'inherit', outline: 'none',
  },
  accessDenied: {
    textAlign: 'center', padding: '80px 20px', color: 'rgba(255,255,255,0.5)',
  },
};
