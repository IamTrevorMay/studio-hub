import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useConfirm } from '../contexts/ConfirmContext';
import { colors } from '../lib/styleTokens';

// One style guide, rendered as rule cards grouped by category.
//
// mode:
//   'admin'    every card incl. the Suggested block (accept / dismiss),
//              edit / delete / add, evidence drawer, Dismissed expander
//   'client'   active cards only (RLS enforces that); edit / delete / add
//   'readonly' active cards only, no controls
//
// The AI never writes an active rule — `suggested` cards wait here for an
// admin. Editing a suggestion's text accepts it (DB trigger). `ref_count` is
// AI-owned; the evidence drawer lists the source comments behind a card.
//
// onOpenReview(reviewId) — optional; when given, evidence rows deep-link to
// the review (the host decides which page that means: staff Reviews page or
// the client's Review tab).

export const CATEGORIES = [
  { key: 'pacing_cuts', label: 'Pacing & Cuts' },
  { key: 'audio_music', label: 'Audio & Music' },
  { key: 'graphics_text', label: 'Graphics & Text' },
  { key: 'sponsor_brand', label: 'Sponsor & Brand' },
  { key: 'transitions_effects', label: 'Transitions & Effects' },
  { key: 'story_content', label: 'Story & Content' },
  { key: 'color_look', label: 'Color & Look' },
  { key: 'delivery_export', label: 'Delivery & Export' },
];
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map(c => [c.key, c.label]));

function fmtTime(secs) {
  const s = Math.max(0, Math.floor(Number(secs || 0)));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function StyleGuidePanel({ guideId, mode = 'readonly', onOpenReview, embedded = false }) {
  const confirm = useConfirm();
  const canEdit = mode === 'admin' || mode === 'client';
  const isAdminMode = mode === 'admin';

  const [guide, setGuide] = useState(null);
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [openRefs, setOpenRefs] = useState({});     // ruleId → refs[] | 'loading'
  const [showDismissed, setShowDismissed] = useState(false);
  const [addingCat, setAddingCat] = useState(null);
  const [addText, setAddText] = useState('');
  const [error, setError] = useState(null);

  const fetchAll = useCallback(async () => {
    if (!guideId) return;
    const [{ data: g, error: gErr }, { data: r, error: rErr }] = await Promise.all([
      supabase.from('style_guides').select('*').eq('id', guideId).maybeSingle(),
      supabase.from('style_guide_rules')
        .select('*, first_review:reviews!style_guide_rules_first_review_id_fkey(title)')
        .eq('guide_id', guideId)
        .order('position', { ascending: true })
        .order('ref_count', { ascending: false })
        .order('created_at', { ascending: true }),
    ]);
    if (gErr || rErr) { setError((gErr || rErr).message); }
    setGuide(g || null);
    setRules(r || []);
    setLoading(false);
  }, [guideId]);

  useEffect(() => { setLoading(true); fetchAll(); }, [fetchAll]);

  async function updateRule(id, patch) {
    setBusyId(id);
    setError(null);
    const { error: e } = await supabase.from('style_guide_rules').update(patch).eq('id', id);
    if (e) setError(e.message);
    await fetchAll();
    setBusyId(null);
  }

  async function deleteRule(rule) {
    if (!(await confirm(`Delete this rule?\n\n“${rule.text}”`))) return;
    setBusyId(rule.id);
    const { error: e } = await supabase.from('style_guide_rules').delete().eq('id', rule.id);
    if (e) setError(e.message);
    await fetchAll();
    setBusyId(null);
  }

  function startEdit(rule) {
    setEditingId(rule.id);
    setEditText(rule.text);
    setEditCategory(rule.category);
  }

  async function saveEdit(rule) {
    const text = editText.trim();
    if (!text) return;
    const patch = {};
    if (text !== rule.text) patch.text = text;
    if (editCategory !== rule.category) patch.category = editCategory;
    setEditingId(null);
    if (Object.keys(patch).length === 0) return;
    await updateRule(rule.id, patch);
  }

  async function addRule(category) {
    const text = addText.trim();
    if (!text || !guideId) return;
    setBusyId('add');
    setError(null);
    const { error: e } = await supabase.from('style_guide_rules').insert({
      guide_id: guideId, category, text, status: 'active', source: 'manual',
    });
    if (e) setError(e.message);
    setAddText('');
    setAddingCat(null);
    await fetchAll();
    setBusyId(null);
  }

  async function toggleRefs(ruleId) {
    if (openRefs[ruleId]) { setOpenRefs(prev => { const n = { ...prev }; delete n[ruleId]; return n; }); return; }
    setOpenRefs(prev => ({ ...prev, [ruleId]: 'loading' }));
    const { data } = await supabase.from('style_guide_rule_refs')
      .select('id, review_id, review_title, version_label, timestamp_seconds, excerpt, created_at, author:profiles!style_guide_rule_refs_author_id_fkey(full_name)')
      .eq('rule_id', ruleId)
      .order('created_at', { ascending: false });
    setOpenRefs(prev => ({ ...prev, [ruleId]: data || [] }));
  }

  if (!guideId) return null;
  if (loading) return <p style={styles.muted}>Loading style guide…</p>;
  if (!guide) return <p style={styles.muted}>This style guide isn’t available.</p>;

  const suggested = rules.filter(r => r.status === 'suggested');
  const active = rules.filter(r => r.status === 'active');
  const dismissed = rules.filter(r => r.status === 'dismissed');
  const activeByCat = CATEGORIES.map(c => ({ ...c, rules: active.filter(r => r.category === c.key) }));

  function renderRefs(rule) {
    const refs = openRefs[rule.id];
    if (!refs) return null;
    if (refs === 'loading') return <p style={styles.refsLoading}>Loading evidence…</p>;
    if (refs.length === 0) return <p style={styles.refsLoading}>No linked comments.</p>;
    return (
      <div style={styles.refsList}>
        {refs.map(ref => (
          <div key={ref.id} style={styles.refRow}>
            <div style={styles.refMeta}>
              {onOpenReview && ref.review_id ? (
                <button style={styles.refLink} onClick={() => onOpenReview(ref.review_id)}>
                  {ref.review_title || 'Review'} ↗
                </button>
              ) : (
                <span style={styles.refTitle}>{ref.review_title || 'Review'}</span>
              )}
              {ref.version_label && <span style={styles.refChip}>{ref.version_label}</span>}
              <span style={styles.refChip}>{fmtTime(ref.timestamp_seconds)}</span>
              {ref.author?.full_name && <span style={styles.refAuthor}>{ref.author.full_name}</span>}
            </div>
            <p style={styles.refExcerpt}>“{ref.excerpt}”</p>
          </div>
        ))}
      </div>
    );
  }

  function renderCard(rule, { suggestedCard = false, dismissedCard = false } = {}) {
    const isEditing = editingId === rule.id;
    const busy = busyId === rule.id;
    return (
      <div key={rule.id} style={{ ...styles.card, ...(suggestedCard ? styles.cardSuggested : {}), ...(dismissedCard ? styles.cardDismissed : {}), ...(busy ? styles.cardBusy : {}) }}>
        <div style={styles.cardMain}>
          {isEditing ? (
            <div style={styles.editWrap}>
              <textarea
                value={editText}
                onChange={e => setEditText(e.target.value)}
                rows={2}
                autoFocus
                style={styles.editInput}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(rule); }
                  if (e.key === 'Escape') setEditingId(null);
                }}
              />
              <div style={styles.editRow}>
                <select value={editCategory} onChange={e => setEditCategory(e.target.value)} style={styles.select}>
                  {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
                <button style={styles.primaryBtn} onClick={() => saveEdit(rule)}>Save</button>
                <button style={styles.ghostBtn} onClick={() => setEditingId(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <p style={styles.cardText}>{rule.text}</p>
          )}
          <div style={styles.cardMetaRow}>
            {suggestedCard && rule.first_review?.title && (
              <span style={styles.metaChip}>from “{rule.first_review.title}”</span>
            )}
            {suggestedCard && <span style={styles.metaChipCat}>{CATEGORY_LABEL[rule.category]}</span>}
            {rule.source === 'manual' && <span style={styles.metaChip}>added by hand</span>}
            {rule.ref_count > 0 ? (
              <button style={styles.refsBtn} onClick={() => toggleRefs(rule.id)}>
                {rule.ref_count} {rule.ref_count === 1 ? 'note' : 'notes'} {openRefs[rule.id] ? '▾' : '▸'}
              </button>
            ) : null}
            {rule.edited_at && <span style={styles.metaFaint}>edited {fmtDate(rule.edited_at)}</span>}
          </div>
          {renderRefs(rule)}
        </div>

        {!isEditing && (
          <div style={styles.cardActions}>
            {suggestedCard && isAdminMode && (
              <>
                <button style={styles.acceptBtn} disabled={busy} onClick={() => updateRule(rule.id, { status: 'active' })} title="Add to the guide">✓ Accept</button>
                <button style={styles.dismissBtn} disabled={busy} onClick={() => updateRule(rule.id, { status: 'dismissed' })} title="Not a rule">✕</button>
              </>
            )}
            {dismissedCard && isAdminMode && (
              <button style={styles.ghostBtn} disabled={busy} onClick={() => updateRule(rule.id, { status: 'active' })}>Restore</button>
            )}
            {canEdit && (
              <>
                <button style={styles.iconBtn} disabled={busy} onClick={() => startEdit(rule)} title="Edit">✎</button>
                {!suggestedCard && (
                  <button style={styles.iconBtn} disabled={busy} onClick={() => deleteRule(rule)} title="Delete">🗑</button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={embedded ? styles.wrapEmbedded : styles.wrap}>
      {!embedded && (
        <div style={styles.header}>
          <div>
            <h2 style={styles.title}>{guide.title}</h2>
            <p style={styles.sub}>
              {active.length} rule{active.length !== 1 ? 's' : ''}
              {isAdminMode && suggested.length > 0 ? ` · ${suggested.length} suggested` : ''}
              {guide.last_run_at ? ` · last updated ${fmtDate(guide.last_run_at)}` : ''}
            </p>
          </div>
        </div>
      )}

      {error && <div style={styles.errorBar}>{error}</div>}

      {isAdminMode && suggested.length > 0 && (
        <section style={styles.suggestedBlock}>
          <div style={styles.suggestedHead}>
            <span style={styles.suggestedTitle}>Suggested</span>
            <span style={styles.suggestedSub}>Pulled from review notes. Accept to add to the guide, or dismiss.</span>
          </div>
          {suggested.map(r => renderCard(r, { suggestedCard: true }))}
        </section>
      )}

      {active.length === 0 && (!isAdminMode || suggested.length === 0) && (
        <div style={styles.empty}>
          <p style={styles.emptyTitle}>No rules yet</p>
          <p style={styles.emptyBody}>
            {isAdminMode
              ? 'Open a review and press “Update Style Guide” to pull rules from its notes, or add one by hand below.'
              : canEdit ? 'Add your first rule below.' : 'Nothing here yet.'}
          </p>
        </div>
      )}

      {activeByCat.map(cat => {
        if (cat.rules.length === 0 && !canEdit) return null;
        const adding = addingCat === cat.key;
        return (
          <section key={cat.key} style={styles.catBlock}>
            <div style={styles.catHead}>
              <span style={styles.catTitle}>{cat.label}</span>
              <span style={styles.catCount}>{cat.rules.length}</span>
              {canEdit && !adding && (
                <button style={styles.addBtn} onClick={() => { setAddingCat(cat.key); setAddText(''); }}>+ Add rule</button>
              )}
            </div>
            {cat.rules.map(r => renderCard(r))}
            {adding && (
              <div style={styles.addWrap}>
                <textarea
                  value={addText}
                  onChange={e => setAddText(e.target.value)}
                  rows={2}
                  autoFocus
                  placeholder={`New ${cat.label.toLowerCase()} rule…`}
                  style={styles.editInput}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addRule(cat.key); }
                    if (e.key === 'Escape') setAddingCat(null);
                  }}
                />
                <div style={styles.editRow}>
                  <button style={styles.primaryBtn} disabled={busyId === 'add'} onClick={() => addRule(cat.key)}>Add</button>
                  <button style={styles.ghostBtn} onClick={() => setAddingCat(null)}>Cancel</button>
                </div>
              </div>
            )}
            {cat.rules.length === 0 && !adding && (
              <p style={styles.catEmpty}>No rules in this category yet.</p>
            )}
          </section>
        );
      })}

      {isAdminMode && dismissed.length > 0 && (
        <section style={styles.dismissedBlock}>
          <button style={styles.dismissedToggle} onClick={() => setShowDismissed(v => !v)}>
            {showDismissed ? '▾' : '▸'} Dismissed ({dismissed.length})
          </button>
          {showDismissed && dismissed.map(r => renderCard(r, { dismissedCard: true }))}
        </section>
      )}
    </div>
  );
}

const styles = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 18 },
  wrapEmbedded: { display: 'flex', flexDirection: 'column', gap: 14 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  title: { fontSize: 22, fontWeight: 700, color: colors.white, margin: 0, letterSpacing: '-0.3px' },
  sub: { fontSize: 13, color: colors.textDim, margin: '4px 0 0' },
  muted: { color: colors.textDim, fontSize: 13, margin: 0 },
  errorBar: { padding: '8px 12px', background: colors.danger.bg, border: `1px solid ${colors.danger.border}`, borderRadius: 8, color: colors.danger.fgSoft, fontSize: 12 },

  suggestedBlock: { background: colors.warning.bg, border: `1px solid ${colors.warning.border}`, borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 },
  suggestedHead: { display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 4 },
  suggestedTitle: { fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.6px', color: colors.warning.fgSoft },
  suggestedSub: { fontSize: 12, color: 'rgba(255,255,255,0.55)' },

  catBlock: { display: 'flex', flexDirection: 'column', gap: 8 },
  catHead: { display: 'flex', alignItems: 'center', gap: 10 },
  catTitle: { fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.6px', color: colors.textSubtle },
  catCount: { fontSize: 11, fontWeight: 700, color: colors.textPlaceholder, background: colors.whiteA05, padding: '1px 7px', borderRadius: 999 },
  catEmpty: { fontSize: 12, color: colors.textPlaceholder, margin: 0, padding: '2px 0 0 2px' },
  addBtn: { marginLeft: 'auto', background: 'none', border: `1px dashed ${colors.border}`, borderRadius: 8, color: colors.textSubtle, fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '4px 10px', fontFamily: 'inherit' },

  card: { display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px', background: colors.whiteA03, border: `1px solid ${colors.whiteA06}`, borderRadius: 12 },
  cardSuggested: { background: 'rgba(0,0,0,0.18)', border: `1px solid ${colors.warning.border}` },
  cardDismissed: { opacity: 0.6 },
  cardBusy: { opacity: 0.5, pointerEvents: 'none' },
  cardMain: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 },
  cardText: { fontSize: 14, color: colors.text, margin: 0, lineHeight: 1.45 },
  cardMetaRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  metaChip: { fontSize: 11, color: colors.textSubtle, background: colors.whiteA05, padding: '2px 8px', borderRadius: 6 },
  metaChipCat: { fontSize: 11, color: colors.accentFg, background: colors.accentA12, padding: '2px 8px', borderRadius: 6, fontWeight: 600 },
  metaFaint: { fontSize: 11, color: colors.textPlaceholder },
  refsBtn: { background: 'none', border: 'none', color: colors.accentFg, fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'inherit' },
  cardActions: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 },
  iconBtn: { background: 'none', border: 'none', color: colors.textDim, fontSize: 14, cursor: 'pointer', padding: '2px 4px', fontFamily: 'inherit' },
  acceptBtn: { padding: '5px 10px', background: colors.success.bg, border: `1px solid ${colors.success.border}`, borderRadius: 8, color: colors.success.fgSoft, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  dismissBtn: { padding: '5px 9px', background: colors.whiteA05, border: `1px solid ${colors.border}`, borderRadius: 8, color: colors.textSubtle, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  primaryBtn: { padding: '6px 14px', background: colors.accent, border: 'none', borderRadius: 8, color: colors.white, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  ghostBtn: { padding: '6px 12px', background: 'none', border: `1px solid ${colors.border}`, borderRadius: 8, color: colors.textSubtle, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },

  editWrap: { display: 'flex', flexDirection: 'column', gap: 8 },
  editRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  editInput: { width: '100%', boxSizing: 'border-box', padding: '8px 10px', background: colors.bgInput, border: `1px solid ${colors.borderStrong}`, borderRadius: 8, color: colors.white, fontSize: 14, fontFamily: 'inherit', outline: 'none', resize: 'vertical', lineHeight: 1.4 },
  select: { padding: '6px 10px', background: colors.bgRaised, border: `1px solid ${colors.border}`, borderRadius: 8, color: colors.text, fontSize: 12, fontFamily: 'inherit', outline: 'none' },
  addWrap: { display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', background: colors.whiteA02, border: `1px dashed ${colors.border}`, borderRadius: 12 },

  refsList: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4, paddingLeft: 10, borderLeft: `2px solid ${colors.accentA30}` },
  refsLoading: { fontSize: 12, color: colors.textPlaceholder, margin: '4px 0 0 10px' },
  refRow: { display: 'flex', flexDirection: 'column', gap: 2 },
  refMeta: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  refLink: { background: 'none', border: 'none', color: colors.accentFg, fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'inherit' },
  refTitle: { fontSize: 12, fontWeight: 600, color: colors.textMuted },
  refChip: { fontSize: 10, fontWeight: 700, color: colors.textSubtle, background: colors.whiteA05, padding: '1px 6px', borderRadius: 5 },
  refAuthor: { fontSize: 11, color: colors.textPlaceholder },
  refExcerpt: { fontSize: 12, color: colors.textMuted, margin: 0, fontStyle: 'italic' },

  dismissedBlock: { display: 'flex', flexDirection: 'column', gap: 8 },
  dismissedToggle: { alignSelf: 'flex-start', background: 'none', border: 'none', color: colors.textDim, fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'inherit' },

  empty: { padding: '28px 20px', textAlign: 'center', background: colors.whiteA02, border: `1px dashed ${colors.border}`, borderRadius: 14 },
  emptyTitle: { fontSize: 15, fontWeight: 700, color: colors.text, margin: '0 0 4px' },
  emptyBody: { fontSize: 13, color: colors.textDim, margin: 0 },
};
