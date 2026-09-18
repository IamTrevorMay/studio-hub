import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { queueTypeLabel } from '../lib/filmQueue';
import { colors } from '../lib/styleTokens';

// Optional "this edits a slate item" field on the + Assignment modals.
//
// Picking an item is what marks it filmed — the link and the send are the same
// action — and completing the assignment marks the item done. One assignment
// per item, so the RPC only returns approved items that don't already have one
// (plus `includeId`, which keeps an existing link visible while editing).
//
// Staff-only by construction: slate_items_for_assignment() is is_staff()-gated
// and returns nothing for a client, but callers should also hide the field.
export default function SlateItemPicker({
  value,
  onChange,
  includeId = null,
  disabled = false,
  hint = null,
  styles: s = {},
}) {
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .rpc('slate_items_for_assignment', { p_include: includeId || null });
    if (err) {
      console.error('Error loading slate items:', err);
      setError(err.message);
      setOptions([]);
    } else {
      setError(null);
      setOptions(data || []);
    }
    setLoading(false);
  }, [includeId]);

  useEffect(() => { load(); }, [load]);

  const labelFor = (row) => {
    const parts = [row.title, queueTypeLabel(row.queue_type)];
    if (row.film_date) {
      parts.push(`Films ${new Date(`${row.film_date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`);
    }
    return parts.filter(Boolean).join(' · ');
  };

  return (
    <>
      <label style={s.label || defaults.label}>Slate item (optional)</label>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value || '')}
        style={s.select || defaults.select}
        disabled={disabled || loading}
      >
        <option value="">
          {loading ? 'Loading slate items…' : '— Not a slate item —'}
        </option>
        {options.map((row) => (
          <option key={row.id} value={row.id}>{labelFor(row)}</option>
        ))}
      </select>
      {error ? (
        <div style={{ ...(s.hint || defaults.hint), color: '#f87171' }}>
          Could not load slate items: {error}
        </div>
      ) : (
        <div style={s.hint || defaults.hint}>
          {hint || 'Linking an approved slate item marks it filmed. Finishing this assignment marks it complete.'}
          {!loading && options.length === 0 && ' Nothing is waiting for an editor right now.'}
        </div>
      )}
    </>
  );
}

const defaults = {
  label: { fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.55)' },
  select: {
    background: colors.bgHover,
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8,
    padding: '9px 11px',
    color: '#fff',
    fontSize: 13,
    fontFamily: 'inherit',
    width: '100%',
    boxSizing: 'border-box',
  },
  hint: { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2, lineHeight: 1.5 },
};
