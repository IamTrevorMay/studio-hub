import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { mobileTokens } from '../utils/mobileTokens';

// Mobile AdminPanel: invite users + team list. Google Calendar mapping,
// nav config, freelancer mgmt and other deep admin tools stay desktop-only.

const ROLE_LABELS = {
  admin: 'Admin', assistant: 'Assistant', member: 'Member',
  partner: 'Partner', freelancer: 'Contractor',
};
const ROLE_COLORS = {
  admin: '#a5b4fc', assistant: '#86efac', member: 'rgba(255,255,255,0.55)',
  partner: '#fcd34d', freelancer: '#f9a8d4',
};

export default function AdminPanelMobile() {
  const { profile, isAdmin } = useAuth();
  const [invitations, setInvitations] = useState([]);
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [invRes, memRes] = await Promise.all([
        supabase.from('invitations').select('*').order('created_at', { ascending: false }),
        supabase.from('profiles').select('id, full_name, email, role, title').order('full_name'),
      ]);
      setInvitations(invRes.data || []);
      setTeam(memRes.data || []);
    } catch (err) {
      console.error('Admin fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (profile?.id) fetchAll(); }, [profile?.id, fetchAll]);

  if (!isAdmin) return <p style={styles.empty}>Admin access required.</p>;
  if (loading) return <p style={styles.empty}>Loading…</p>;

  async function handleInvite(e) {
    e.preventDefault();
    if (!inviteEmail.trim() || inviting) return;
    setInviting(true);
    setInviteResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const res = await fetch(
        `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/invite-user`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
            apikey: process.env.REACT_APP_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ email: inviteEmail.toLowerCase().trim() }),
        },
      );
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to send invite');
      setInviteResult({ ok: true, msg: `Invitation sent to ${inviteEmail}` });
      setInviteEmail('');
      fetchAll();
    } catch (err) {
      setInviteResult({ ok: false, msg: err.message });
    } finally {
      setInviting(false);
    }
  }

  const pendingInvites = invitations.filter((i) => !i.accepted_at);

  return (
    <div style={styles.root}>
      <Section title="Invite teammate">
        <form onSubmit={handleInvite} style={styles.inviteForm}>
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="email@company.com"
            required
            style={styles.input}
          />
          <button type="submit" disabled={inviting || !inviteEmail.trim()} style={{ ...styles.primaryBtn, opacity: inviting || !inviteEmail.trim() ? 0.5 : 1 }}>
            {inviting ? 'Sending…' : 'Send invitation'}
          </button>
        </form>
        {inviteResult && (
          <div style={{
            ...styles.inviteResult,
            color: inviteResult.ok ? '#86efac' : '#fca5a5',
            background: inviteResult.ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            borderColor: inviteResult.ok ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)',
          }}>
            {inviteResult.msg}
          </div>
        )}
      </Section>

      {pendingInvites.length > 0 && (
        <Section title={`Pending · ${pendingInvites.length}`}>
          <ul style={styles.list}>
            {pendingInvites.map((inv) => (
              <li key={inv.id} style={styles.row}>
                <div style={styles.rowBody}>
                  <div style={styles.rowName}>{inv.email}</div>
                  <div style={styles.rowMeta}>
                    {inv.role && (
                      <span style={{ ...styles.rolePill, color: ROLE_COLORS[inv.role] || 'rgba(255,255,255,0.5)' }}>
                        {ROLE_LABELS[inv.role] || inv.role}
                      </span>
                    )}
                    <span style={{ color: 'rgba(255,255,255,0.4)' }}>· Invited {fmtRelative(inv.created_at)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={`Team · ${team.length}`}>
        <ul style={styles.list}>
          {team.map((m) => (
            <li key={m.id} style={styles.row}>
              <div style={styles.avatar}>{(m.full_name || '?').charAt(0).toUpperCase()}</div>
              <div style={styles.rowBody}>
                <div style={styles.rowName}>{m.full_name || m.email}</div>
                <div style={styles.rowMeta}>
                  {m.role && (
                    <span style={{ ...styles.rolePill, color: ROLE_COLORS[m.role] || 'rgba(255,255,255,0.5)' }}>
                      {ROLE_LABELS[m.role] || m.role}
                    </span>
                  )}
                  {m.title && <span style={{ color: 'rgba(255,255,255,0.45)' }}>· {m.title}</span>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <p style={styles.footer}>Google Calendar mapping, nav config, and other deep admin tools live on desktop.</p>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section style={styles.section}>
      <h3 style={styles.sectionTitle}>{title}</h3>
      {children}
    </section>
  );
}

function fmtRelative(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const styles = {
  root: {
    minHeight: '100%',
    background: '#0f0f1a',
    color: '#e2e8f0',
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.lg}px ${mobileTokens.space.xxxl}px`,
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.lg,
  },
  empty: { color: 'rgba(255,255,255,0.4)', textAlign: 'center', fontSize: mobileTokens.font.md, padding: mobileTokens.space.xxl, margin: 0 },
  section: { display: 'flex', flexDirection: 'column', gap: mobileTokens.space.sm },
  sectionTitle: {
    margin: 0,
    fontSize: mobileTokens.font.sm,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.55)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  inviteForm: { display: 'flex', flexDirection: 'column', gap: mobileTokens.space.sm },
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
  primaryBtn: {
    minHeight: mobileTokens.tap,
    padding: mobileTokens.space.md,
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    border: 'none',
    borderRadius: mobileTokens.radius.md,
    color: '#fff',
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  inviteResult: {
    padding: mobileTokens.space.sm,
    border: '1px solid',
    borderRadius: mobileTokens.radius.sm,
    fontSize: mobileTokens.font.sm,
  },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: mobileTokens.space.sm },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: mobileTokens.space.md,
    padding: mobileTokens.space.md,
    background: 'rgba(255,255,255,0.04)',
    borderRadius: mobileTokens.radius.md,
    minHeight: mobileTokens.tap + 8,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: mobileTokens.radius.sm,
    background: 'rgba(99,102,241,0.2)',
    color: '#a5b4fc',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: mobileTokens.font.md,
    flexShrink: 0,
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowName: {
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    color: '#fff',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rowMeta: {
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 2,
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
  },
  rolePill: {
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  footer: {
    marginTop: mobileTokens.space.md,
    padding: mobileTokens.space.md,
    background: 'rgba(99,102,241,0.06)',
    border: '1px solid rgba(99,102,241,0.18)',
    borderRadius: mobileTokens.radius.sm,
    color: 'rgba(255,255,255,0.55)',
    fontSize: mobileTokens.font.sm,
    textAlign: 'center',
  },
};
