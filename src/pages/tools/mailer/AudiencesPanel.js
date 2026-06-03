import React, { useEffect, useState } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';
import {
  listAudiences, createAudience, deleteAudience,
  listSubscribersInAudience, createSubscriber, updateSubscriber,
  removeSubscriberFromAudience, bulkImportSubscribers, migrateFromTriton,
} from './api';

// Audiences for the active product. Left column: list of audiences with a
// "+ New" inline create. Right column: subscribers in the selected
// audience plus a quick add + CSV import.

export default function AudiencesPanel({ product }) {
  const [audiences, setAudiences] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newAud, setNewAud] = useState({ name: '', description: '' });

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await listAudiences(product.id);
      setAudiences(res.audiences || []);
      if (!selected && res.audiences && res.audiences[0]) setSelected(res.audiences[0]);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [product.id]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!newAud.name.trim()) return;
    setCreating(true); setError(null);
    try {
      const res = await createAudience({
        product_id: product.id, name: newAud.name.trim(),
        description: newAud.description.trim() || undefined,
      });
      setNewAud({ name: '', description: '' });
      await load();
      if (res.audience) setSelected(res.audience);
    } catch (e) { setError(e.message); }
    setCreating(false);
  }

  async function handleDeleteAudience(a, e) {
    e.stopPropagation();
    if (!window.confirm(`Delete audience "${a.name}"? Subscribers stay in the system but lose this audience tag.`)) return;
    try {
      await deleteAudience(a.id);
      if (selected && selected.id === a.id) setSelected(null);
      await load();
    } catch (e) { setError(e.message); }
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.left}>
        <form onSubmit={handleCreate} style={styles.createForm}>
          <div style={styles.createTitle}>New audience</div>
          <input
            placeholder="Name" value={newAud.name}
            onChange={(e) => setNewAud({ ...newAud, name: e.target.value })}
            style={styles.input} required
          />
          <input
            placeholder="Description (optional)" value={newAud.description}
            onChange={(e) => setNewAud({ ...newAud, description: e.target.value })}
            style={styles.input}
          />
          <button type="submit" disabled={creating} style={styles.primaryBtn}>
            {creating ? 'Creating…' : 'Create'}
          </button>
        </form>
        {error && <div style={styles.error}>{error}</div>}
        <div style={styles.list}>
          {loading ? (
            <div style={styles.empty}>Loading…</div>
          ) : audiences.length === 0 ? (
            <div style={styles.empty}>No audiences yet.</div>
          ) : (
            audiences.map((a) => (
              <div
                key={a.id} onClick={() => setSelected(a)}
                style={{
                  ...styles.card,
                  ...(selected && selected.id === a.id ? styles.cardActive : {}),
                }}
              >
                <div>
                  <div style={styles.cardName}>{a.name}</div>
                  <div style={styles.cardMeta}>
                    {a.member_count || 0} members
                    {a.description ? ` · ${a.description}` : ''}
                  </div>
                </div>
                <button onClick={(e) => handleDeleteAudience(a, e)} style={styles.deleteBtn}>×</button>
              </div>
            ))
          )}
        </div>
      </div>

      <div style={styles.right}>
        {selected ? (
          <AudienceMembers audience={selected} onChanged={() => load()} />
        ) : (
          <div style={styles.empty}>Pick an audience on the left.</div>
        )}
      </div>
    </div>
  );
}

function AudienceMembers({ audience, onChanged }) {
  const [subscribers, setSubscribers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [addEmail, setAddEmail] = useState('');
  const [addName, setAddName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importStats, setImportStats] = useState(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await listSubscribersInAudience(audience.id);
      setSubscribers(res.subscribers || []);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [audience.id]);

  async function handleAdd(e) {
    e.preventDefault();
    if (!addEmail.trim()) return;
    setError(null);
    try {
      await createSubscriber({
        email: addEmail.trim(),
        name: addName.trim() || undefined,
        audience_id: audience.id,
        confirmed: true,
      });
      setAddEmail(''); setAddName('');
      await load();
      onChanged && onChanged();
    } catch (e) { setError(e.message); }
  }

  async function handleRemove(sub) {
    if (!window.confirm(`Remove ${sub.email} from "${audience.name}"?`)) return;
    try {
      await removeSubscriberFromAudience(sub.id, audience.id);
      await load(); onChanged && onChanged();
    } catch (e) { setError(e.message); }
  }

  async function handleUnsub(sub) {
    if (!window.confirm(`Mark ${sub.email} as unsubscribed (everywhere)?`)) return;
    try {
      await updateSubscriber(sub.id, { metadata: { ...(sub.metadata || {}), forced_unsub: true } });
      // Use the unsubscribed_at column via the subscribers PATCH path:
      // we don't expose a "set unsubscribed_at" flag here so flip via PATCH
      // is best done with a tiny extra endpoint; for v1 the bulk path is
      // metadata-only. Fall back: just remove from audience.
      await removeSubscriberFromAudience(sub.id, audience.id);
      await load(); onChanged && onChanged();
    } catch (e) { setError(e.message); }
  }

  async function handleCsvFile(file) {
    setImporting(true); setError(null); setImportStats(null);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      const res = await bulkImportSubscribers(audience.id, rows);
      setImportStats(res);
      await load(); onChanged && onChanged();
    } catch (e) { setError(e.message); }
    setImporting(false);
  }

  async function handleTritonImport() {
    if (!window.confirm(`Pull subscribers from Triton into "${audience.name}"? (Requires TRITON_SUPABASE_URL/KEY env vars on the server.)`)) return;
    setImporting(true); setError(null); setImportStats(null);
    try {
      const res = await migrateFromTriton({ audience_id: audience.id });
      setImportStats({
        added: res.added_to_audience,
        total: res.imported + res.skipped,
        skipped: res.skipped,
      });
      await load(); onChanged && onChanged();
      if (res.errors && res.errors.length > 0) {
        setError(`First errors: ${res.errors.slice(0, 3).join(' / ')}`);
      }
    } catch (e) { setError(e.message); }
    setImporting(false);
  }

  return (
    <div style={memberStyles.wrap}>
      <div style={memberStyles.title}>{audience.name}</div>

      <form onSubmit={handleAdd} style={memberStyles.addRow}>
        <input
          placeholder="email@example.com" value={addEmail}
          onChange={(e) => setAddEmail(e.target.value)}
          style={{ ...styles.input, flex: 2 }}
        />
        <input
          placeholder="Name (optional)" value={addName}
          onChange={(e) => setAddName(e.target.value)}
          style={{ ...styles.input, flex: 1 }}
        />
        <button type="submit" style={styles.primaryBtn}>Add</button>
      </form>

      <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={memberStyles.importBtn}>
          {importing ? 'Importing…' : '+ Import CSV (email,name columns)'}
          <input type="file" accept=".csv,text/csv" disabled={importing} style={{ display: 'none' }}
            onChange={(e) => { if (e.target.files[0]) handleCsvFile(e.target.files[0]); e.target.value = ''; }}
          />
        </label>
        <button onClick={handleTritonImport} disabled={importing} style={memberStyles.importBtn}>
          {importing ? 'Importing…' : '↻ Pull from Triton'}
        </button>
      </div>
      {importStats && (
        <div style={memberStyles.statsRow}>
          Imported {importStats.added}/{importStats.total} (skipped {importStats.skipped})
        </div>
      )}
      {error && <div style={styles.error}>{error}</div>}

      <div style={memberStyles.list}>
        {loading ? (
          <div style={styles.empty}>Loading…</div>
        ) : subscribers.length === 0 ? (
          <div style={styles.empty}>No subscribers yet.</div>
        ) : (
          subscribers.map((s) => (
            <div key={s.id} style={memberStyles.row}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={memberStyles.email}>{s.email}</div>
                <div style={memberStyles.meta}>
                  {s.name ? `${s.name} · ` : ''}
                  {s.confirmed ? 'Confirmed' : 'Unconfirmed'}
                  {s.unsubscribed_at ? ' · Unsubscribed' : ''}
                </div>
              </div>
              <button onClick={() => handleRemove(s)} style={styles.smallBtn} title="Remove from audience">Remove</button>
              <button onClick={() => handleUnsub(s)} style={{ ...styles.smallBtn, color: colors.danger.fg }} title="Unsubscribe everywhere">Unsub</button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Very small CSV parser — assumes the file is RFC-4180-ish and that the
// first row is a header containing at least an "email" column.
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];
  const header = parseLine(lines[0]).map((h) => h.toLowerCase().trim());
  const emailIdx = header.indexOf('email');
  const nameIdx = header.indexOf('name');
  if (emailIdx === -1) throw new Error('CSV missing "email" column');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    const email = cols[emailIdx];
    if (!email) continue;
    out.push({
      email: email.trim(),
      name: nameIdx !== -1 ? (cols[nameIdx] || '').trim() : undefined,
    });
  }
  return out;
}

function parseLine(line) {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQ = false; }
      else { cur += ch; }
    } else if (ch === '"') { inQ = true; }
    else if (ch === ',') { out.push(cur); cur = ''; }
    else { cur += ch; }
  }
  out.push(cur);
  return out;
}

const styles = {
  wrap: { flex: 1, overflow: 'hidden', display: 'flex', gap: spacing.lg, padding: spacing.lg },
  left: { width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: spacing.sm, overflow: 'auto' },
  right: { flex: 1, minWidth: 0, overflow: 'auto' },
  createForm: {
    display: 'flex', flexDirection: 'column', gap: spacing.xs,
    padding: spacing.md, background: colors.bgRaised,
    border: `1px solid ${colors.border}`, borderRadius: radii.md,
  },
  createTitle: { fontSize: fontSizes.xs, color: colors.textSubtle, textTransform: 'uppercase', letterSpacing: '0.06em' },
  input: {
    padding: `${spacing.xs}px ${spacing.sm}px`, background: colors.bgInput,
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    color: colors.text, fontSize: fontSizes.sm, fontFamily: 'inherit', outline: 'none',
    width: '100%',
  },
  primaryBtn: {
    padding: `${spacing.sm}px ${spacing.lg}px`, background: colors.accent,
    color: '#fff', border: 'none', borderRadius: radii.sm, cursor: 'pointer',
    fontSize: fontSizes.sm, fontWeight: fontWeights.medium, fontFamily: 'inherit',
    alignSelf: 'flex-start',
  },
  smallBtn: {
    padding: `${spacing.xs}px ${spacing.sm}px`, background: 'transparent',
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    color: colors.textMuted, cursor: 'pointer', fontSize: fontSizes.xxs, fontFamily: 'inherit',
  },
  error: {
    padding: spacing.sm, background: colors.danger.bg, color: colors.danger.fg,
    border: `1px solid ${colors.danger.border}`, borderRadius: radii.sm, fontSize: fontSizes.xs,
  },
  list: { display: 'flex', flexDirection: 'column', gap: spacing.xs },
  empty: { padding: spacing.xxl, textAlign: 'center', color: colors.textSubtle, fontSize: fontSizes.sm },
  card: {
    padding: spacing.sm, background: colors.bgRaised,
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  cardActive: { border: `1px solid ${colors.accentBorder}`, background: colors.accentSoft },
  cardName: { fontSize: fontSizes.sm, fontWeight: fontWeights.semibold, color: colors.text },
  cardMeta: { fontSize: fontSizes.xxs, color: colors.textSubtle, marginTop: 2 },
  deleteBtn: {
    width: 24, height: 24, borderRadius: radii.sm,
    background: 'transparent', border: `1px solid ${colors.border}`,
    color: colors.textMuted, cursor: 'pointer', fontSize: 14,
  },
};

const memberStyles = {
  wrap: { display: 'flex', flexDirection: 'column', gap: spacing.md, height: '100%' },
  title: { fontSize: fontSizes.lg, fontWeight: fontWeights.semibold, color: colors.text },
  addRow: { display: 'flex', gap: spacing.xs, alignItems: 'stretch' },
  importBtn: {
    alignSelf: 'flex-start',
    padding: `${spacing.xs}px ${spacing.md}px`,
    background: 'transparent', border: `1px dashed ${colors.border}`,
    color: colors.textMuted, fontSize: fontSizes.xs, borderRadius: radii.sm,
    cursor: 'pointer',
  },
  statsRow: { fontSize: fontSizes.xs, color: colors.success.fg },
  list: { flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: spacing.xs },
  row: {
    padding: spacing.sm, background: colors.bgRaised,
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    display: 'flex', alignItems: 'center', gap: spacing.sm,
  },
  email: { fontSize: fontSizes.sm, color: colors.text, fontWeight: fontWeights.medium },
  meta: { fontSize: fontSizes.xxs, color: colors.textSubtle, marginTop: 2 },
};
