import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import BottomSheet from '../components/mobile/BottomSheet';
import FullScreenSheet from '../components/mobile/FullScreenSheet';
import { mobileTokens, mobileTapButton } from '../utils/mobileTokens';

const CATEGORY_COLORS = {
  video: '#3b82f6', short: '#a78bfa', podcast: '#f59e0b',
  social: '#22c55e', article: '#ec4899', other: '#94a3b8',
};
const CATEGORY_LABELS = {
  video: 'Video', short: 'Short', podcast: 'Podcast',
  social: 'Social', article: 'Article', other: 'Other',
};

export default function IdeationMobile({ initialConceptId, onConceptOpened }) {
  const { profile } = useAuth();
  const [concepts, setConcepts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeConcept, setActiveConcept] = useState(null);
  const [conceptDocs, setConceptDocs] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchConcepts = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('concepts')
        .select('*, creator:profiles!concepts_created_by_fkey(full_name, nickname)')
        .order('sort_order', { ascending: true });
      setConcepts(data || []);
    } catch (err) {
      console.error('Concepts fetch failed:', err);
      setConcepts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (profile?.id) fetchConcepts(); }, [profile?.id, fetchConcepts]);

  useEffect(() => {
    if (initialConceptId && concepts.length > 0) {
      const target = concepts.find((c) => c.id === initialConceptId);
      if (target) {
        setActiveConcept(target);
        if (onConceptOpened) onConceptOpened();
      }
    }
  }, [initialConceptId, concepts, onConceptOpened]);

  useEffect(() => {
    if (!activeConcept) { setConceptDocs([]); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('concept_documents')
        .select('id, type, title, updated_at')
        .eq('concept_id', activeConcept.id)
        .order('sort_order', { ascending: true });
      if (!cancelled) setConceptDocs(data || []);
    })();
    return () => { cancelled = true; };
  }, [activeConcept]);

  async function addConcept() {
    if (!newName.trim() || !profile?.id || saving) return;
    setSaving(true);
    const name = newName.trim();
    const description = newDesc.trim();
    try {
      const { error } = await supabase.from('concepts').insert({
        name,
        description,
        color: '#6366f1',
        category: 'other',
        created_by: profile.id,
        // Use max+1 not length — after deletes, length can collide with an existing sort_order.
        sort_order: Math.max(0, ...concepts.map(c => c.sort_order || 0)) + 1,
      });
      if (error) throw error;
      setNewName(''); setNewDesc(''); setShowAdd(false);
      fetchConcepts();
    } catch (err) {
      alert('Failed to add: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={styles.root}>
      <div style={styles.list}>
        {loading ? (
          <p style={styles.empty}>Loading…</p>
        ) : concepts.length === 0 ? (
          <div style={styles.emptyCard}>
            <p style={styles.emptyTitle}>No concepts yet</p>
            <p style={styles.emptyHint}>Tap "+ Capture" below to start a new idea.</p>
          </div>
        ) : (
          concepts.map((c) => {
            const accent = c.color || CATEGORY_COLORS[c.category] || '#6366f1';
            return (
              <button key={c.id} onClick={() => setActiveConcept(c)} style={styles.card}>
                <div style={{ ...styles.colorBar, background: accent }} />
                <div style={styles.cardBody}>
                  <div style={styles.cardHeader}>
                    <span style={styles.cardName}>{c.name}</span>
                    {c.category && (
                      <span style={{ ...styles.tag, background: `${accent}22`, color: accent, borderColor: `${accent}55` }}>
                        {CATEGORY_LABELS[c.category] || c.category}
                      </span>
                    )}
                  </div>
                  {c.description && <div style={styles.cardDesc}>{c.description}</div>}
                </div>
              </button>
            );
          })
        )}
      </div>

      <div style={{ ...styles.captureBar, paddingBottom: `calc(${mobileTokens.space.md}px + ${mobileTokens.safeBottom})` }}>
        <button onClick={() => setShowAdd(true)} style={styles.captureBtn}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M10 4v12M4 10h12" strokeLinecap="round" />
          </svg>
          <span>Capture idea</span>
        </button>
      </div>

      <BottomSheet open={showAdd} onClose={() => setShowAdd(false)} title="New idea">
        <div style={addStyles.form}>
          <label style={addStyles.field}>
            <span style={addStyles.label}>Name</span>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="What's the idea?"
              style={addStyles.input}
            />
          </label>
          <label style={addStyles.field}>
            <span style={addStyles.label}>Description</span>
            <textarea
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              rows={4}
              placeholder="Notes, hook, why it matters…"
              style={addStyles.textarea}
            />
          </label>
          <button
            onClick={addConcept}
            disabled={!newName.trim() || saving}
            style={{ ...addStyles.saveBtn, opacity: !newName.trim() || saving ? 0.5 : 1 }}
          >
            {saving ? 'Saving…' : 'Save idea'}
          </button>
        </div>
      </BottomSheet>

      <FullScreenSheet open={!!activeConcept} onClose={() => setActiveConcept(null)} title={activeConcept?.name || 'Concept'}>
        {activeConcept && (
          <ConceptDetail concept={activeConcept} docs={conceptDocs} />
        )}
      </FullScreenSheet>
    </div>
  );
}

function ConceptDetail({ concept, docs }) {
  return (
    <div style={detailStyles.root}>
      {concept.category && (
        <div style={{ ...detailStyles.tag, background: `${concept.color || CATEGORY_COLORS[concept.category]}22`, color: concept.color || CATEGORY_COLORS[concept.category] }}>
          {CATEGORY_LABELS[concept.category] || concept.category}
        </div>
      )}
      {concept.description && <p style={detailStyles.description}>{concept.description}</p>}

      <div style={detailStyles.section}>
        <h4 style={detailStyles.sectionTitle}>Documents · {docs.length}</h4>
        {docs.length === 0 ? (
          <p style={detailStyles.empty}>No documents yet.</p>
        ) : (
          <ul style={detailStyles.docList}>
            {docs.map((d) => (
              <li key={d.id} style={detailStyles.docRow}>
                <span style={detailStyles.docIcon}>📝</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={detailStyles.docTitle}>{d.title || 'Untitled'}</div>
                  <div style={detailStyles.docMeta}>{d.type} · updated {fmtRelative(d.updated_at)}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p style={detailStyles.footer}>To open or edit documents, use Mayday Studio on desktop.</p>
    </div>
  );
}

function fmtRelative(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = Date.now() - d;
  if (diff < 3600000) return `${Math.max(1, Math.floor(diff / 60000))}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 7 * 86400000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100%',
    background: '#0f0f1a',
    color: '#e2e8f0',
  },
  list: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.sm,
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.lg}px ${mobileTokens.space.xxxl}px`,
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
  },
  card: {
    display: 'flex',
    width: '100%',
    background: 'rgba(255,255,255,0.04)',
    border: 'none',
    borderRadius: mobileTokens.radius.md,
    overflow: 'hidden',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
    color: '#e2e8f0',
    minHeight: mobileTokens.tap + 12,
  },
  colorBar: { width: 4, flexShrink: 0 },
  cardBody: {
    flex: 1,
    padding: mobileTokens.space.md,
    minWidth: 0,
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: mobileTokens.space.sm,
    alignItems: 'flex-start',
  },
  cardName: {
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    color: '#fff',
    flex: 1,
    wordBreak: 'break-word',
  },
  tag: {
    fontSize: 10,
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: mobileTokens.radius.pill,
    border: '1px solid',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    flexShrink: 0,
  },
  cardDesc: {
    fontSize: mobileTokens.font.sm,
    color: 'rgba(255,255,255,0.55)',
    marginTop: 4,
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    lineHeight: 1.4,
  },
  empty: {
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    fontSize: mobileTokens.font.md,
    padding: mobileTokens.space.xxl,
    margin: 0,
  },
  emptyCard: {
    margin: mobileTokens.space.lg,
    padding: mobileTokens.space.xl,
    background: 'rgba(255,255,255,0.04)',
    borderRadius: mobileTokens.radius.lg,
    textAlign: 'center',
  },
  emptyTitle: { fontSize: mobileTokens.font.lg, fontWeight: 600, color: '#fff', margin: 0 },
  emptyHint: { fontSize: mobileTokens.font.sm, color: 'rgba(255,255,255,0.5)', margin: `${mobileTokens.space.sm}px 0 0` },
  captureBar: {
    position: 'sticky',
    bottom: 0,
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.lg}px`,
    background: 'rgba(15,15,30,0.96)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  captureBtn: {
    ...mobileTapButton,
    width: '100%',
    minHeight: mobileTokens.tap + 6,
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.lg}px`,
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    color: '#fff',
    borderRadius: mobileTokens.radius.md,
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    flexDirection: 'row',
    gap: mobileTokens.space.sm,
  },
};

const addStyles = {
  form: { display: 'flex', flexDirection: 'column', gap: mobileTokens.space.lg },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: {
    fontSize: mobileTokens.font.xs,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
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
  textarea: {
    padding: mobileTokens.space.md,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: mobileTokens.radius.md,
    color: '#fff',
    fontSize: mobileTokens.font.base,
    outline: 'none',
    fontFamily: 'inherit',
    resize: 'vertical',
    minHeight: 100,
  },
  saveBtn: {
    minHeight: mobileTokens.tap + 4,
    padding: mobileTokens.space.md,
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    border: 'none',
    borderRadius: mobileTokens.radius.md,
    color: '#fff',
    fontSize: mobileTokens.font.base,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
};

const detailStyles = {
  root: { display: 'flex', flexDirection: 'column', gap: mobileTokens.space.md },
  tag: {
    alignSelf: 'flex-start',
    padding: '4px 10px',
    borderRadius: mobileTokens.radius.pill,
    fontSize: mobileTokens.font.xs,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  description: {
    margin: 0,
    fontSize: mobileTokens.font.md,
    color: 'rgba(255,255,255,0.75)',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
  },
  section: { display: 'flex', flexDirection: 'column', gap: mobileTokens.space.sm },
  sectionTitle: {
    margin: 0,
    fontSize: mobileTokens.font.sm,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.55)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  empty: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: mobileTokens.font.sm,
    margin: 0,
  },
  docList: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 },
  docRow: {
    display: 'flex',
    alignItems: 'center',
    gap: mobileTokens.space.sm,
    padding: mobileTokens.space.md,
    background: 'rgba(255,255,255,0.04)',
    borderRadius: mobileTokens.radius.sm,
  },
  docIcon: { fontSize: 18, flexShrink: 0 },
  docTitle: {
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    color: '#e2e8f0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  docMeta: {
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.45)',
    marginTop: 2,
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
