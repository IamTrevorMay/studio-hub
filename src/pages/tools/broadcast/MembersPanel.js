import React, { useEffect, useState } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';
import { listMembers, addMember, updateMember, removeMember } from './api';

// Per-project membership. Email-keyed per Q35 — adds resolve to a
// matching Mayday profile at access-check time on the server side.

export default function MembersPanel({ project }) {
  const [members, setMembers] = useState([]);
  const [ownerEmail, setOwnerEmail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ email: '', role: 'producer' });

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await listMembers(project.id);
      setMembers(res.members || []);
      setOwnerEmail(res.owner_email || null);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [project.id]);

  async function handleAdd(e) {
    e.preventDefault();
    if (!form.email.trim()) return;
    setError(null);
    try {
      await addMember({ project_id: project.id, email: form.email.trim(), role: form.role });
      setForm({ email: '', role: 'producer' });
      await load();
    } catch (e) { setError(e.message); }
  }

  async function handleRoleChange(m, role) {
    setMembers(members.map((x) => (x.id === m.id ? { ...x, role } : x)));
    try { await updateMember(m.id, { role }); }
    catch (e) { setError(e.message); await load(); }
  }

  async function handleRemove(m) {
    if (!window.confirm(`Remove ${m.email}?`)) return;
    try { await removeMember(m.id); await load(); }
    catch (e) { setError(e.message); }
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.col}>
        <div style={styles.title}>Members</div>
        {ownerEmail && (
          <div style={styles.ownerRow}>
            <span style={styles.ownerBadge}>OWNER</span>
            <span style={styles.email}>{ownerEmail}</span>
          </div>
        )}

        <form onSubmit={handleAdd} style={styles.addRow}>
          <input
            placeholder="email@example.com" value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            style={{ ...styles.input, flex: 1 }}
          />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} style={styles.input}>
            <option value="producer">producer</option>
            <option value="viewer">viewer</option>
          </select>
          <button type="submit" style={styles.primaryBtn}>Add</button>
        </form>

        {error && <div style={styles.error}>{error}</div>}
        {loading ? (
          <div style={styles.empty}>Loading…</div>
        ) : members.length === 0 ? (
          <div style={styles.empty}>No members yet.</div>
        ) : (
          <div style={styles.list}>
            {members.map((m) => (
              <div key={m.id} style={styles.memberRow}>
                <span style={styles.email}>{m.email}</span>
                <select value={m.role} onChange={(e) => handleRoleChange(m, e.target.value)} style={{ ...styles.input, width: 110 }}>
                  <option value="producer">producer</option>
                  <option value="viewer">viewer</option>
                </select>
                <button onClick={() => handleRemove(m)} style={styles.deleteBtn}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  wrap: { flex: 1, overflow: 'auto', padding: spacing.xxl, display: 'flex', justifyContent: 'center' },
  col: { width: '100%', maxWidth: 640, display: 'flex', flexDirection: 'column', gap: spacing.md },
  title: { fontSize: fontSizes.xl, fontWeight: fontWeights.semibold, color: colors.text },
  ownerRow: { display: 'flex', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, background: colors.bgRaised, border: `1px solid ${colors.border}`, borderRadius: radii.sm },
  ownerBadge: {
    padding: `${spacing.xs}px ${spacing.sm}px`, fontSize: fontSizes.xxs,
    color: colors.warning.fg, background: colors.warning.bg, border: `1px solid ${colors.warning.border}`,
    borderRadius: radii.pill, textTransform: 'uppercase', letterSpacing: '0.06em',
  },
  email: { flex: 1, fontSize: fontSizes.sm, color: colors.text },
  addRow: { display: 'flex', gap: spacing.xs },
  input: {
    padding: `${spacing.sm}px ${spacing.md}px`, background: colors.bgInput,
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    color: colors.text, fontSize: fontSizes.sm, fontFamily: 'inherit', outline: 'none',
  },
  primaryBtn: {
    padding: `${spacing.sm}px ${spacing.lg}px`, background: colors.accent,
    color: '#fff', border: 'none', borderRadius: radii.sm, cursor: 'pointer',
    fontSize: fontSizes.sm, fontWeight: fontWeights.medium, fontFamily: 'inherit',
  },
  error: { padding: spacing.sm, background: colors.danger.bg, color: colors.danger.fg, border: `1px solid ${colors.danger.border}`, borderRadius: radii.sm, fontSize: fontSizes.xs },
  empty: { padding: spacing.xxl, textAlign: 'center', color: colors.textSubtle, fontSize: fontSizes.sm },
  list: { display: 'flex', flexDirection: 'column', gap: spacing.xs },
  memberRow: { display: 'flex', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, background: colors.bgRaised, border: `1px solid ${colors.border}`, borderRadius: radii.sm },
  deleteBtn: {
    padding: `${spacing.xs}px ${spacing.sm}px`, background: 'transparent',
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    color: colors.danger.fg, cursor: 'pointer', fontSize: fontSizes.xs, fontFamily: 'inherit',
  },
};
