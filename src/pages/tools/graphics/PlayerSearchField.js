import React, { useEffect, useState } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights, zIndex } from '../../../lib/styleTokens';
import { supabase } from '../../../supabaseClient';

// Compact, debounced player-search field used inside widget filter panels.
// Calls Mayday's /api/triton-search proxy (which holds the Triton anon key
// server-side and validates a Mayday JWT) instead of hitting Triton's
// PostgREST directly with a browser-leaked anon JWT.

export default function PlayerSearchField({
  value,
  playerType,        // 'pitcher' | 'batter' | 'all'
  placeholder,
  onChange,
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [focused, setFocused] = useState(false);
  const [searchError, setSearchError] = useState(null);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return undefined; }
    let cancelled = false;
    const t = setTimeout(async () => {
      const rpc = playerType === 'batter' ? 'search_batters'
        : playerType === 'pitcher' ? 'search_players'
        : 'search_all_players';
      const params = { search_term: query.trim(), result_limit: 8 };
      if (rpc === 'search_all_players') params.player_type = playerType || 'all';
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (cancelled) return;
        if (!session) { setSearchError('Not authenticated'); setResults([]); return; }
        const res = await fetch('/api/triton-search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ rpc, params }),
        });
        if (cancelled) return;
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setSearchError(json.error || `Search failed (${res.status})`);
          setResults([]);
        } else {
          setSearchError(null);
          setResults(Array.isArray(json.rows) ? json.rows : []);
        }
      } catch (err) {
        if (cancelled) return;
        setSearchError(err.message || 'Search failed');
        setResults([]);
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, playerType]);

  const idKey = playerType === 'batter' ? 'batter' : 'pitcher';

  if (value && value.playerId) {
    return (
      <div style={styles.pickedRow}>
        <span style={styles.pickedName}>{value.playerName}</span>
        <button
          onClick={() => onChange({ playerId: null, playerName: '' })}
          style={styles.clearBtn}
          aria-label="Clear"
          title="Clear"
        >×</button>
      </div>
    );
  }

  return (
    <div style={styles.wrap}>
      <input
        type="text"
        value={query}
        placeholder={placeholder || 'Search players…'}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 200)}
        style={styles.input}
      />
      {searchError && (
        <div style={styles.errorMsg}>{searchError}</div>
      )}
      {focused && results.length > 0 && (
        <div style={styles.dropdown}>
          {results.map((p, i) => {
            const id = (p && p[idKey] != null) ? p[idKey]
              : (p.pitcher != null ? p.pitcher : p.batter);
            return (
              <button
                key={`${id != null ? id : p.player_name}-${i}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (id != null) {
                    onChange({ playerId: Number(id), playerName: p.player_name });
                  }
                  setQuery('');
                  setResults([]);
                }}
                style={styles.row}
              >
                <span style={styles.rowName}>{p.player_name}</span>
                <span style={styles.rowTeam}>{p.team || ''}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const styles = {
  wrap: {
    position: 'relative',
  },
  input: {
    width: '100%',
    padding: `${spacing.sm}px ${spacing.md}px`,
    fontSize: fontSizes.sm,
    color: colors.text,
    background: colors.bgInput,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.sm,
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  pickedRow: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    padding: `${spacing.xs}px ${spacing.sm}px`,
    background: colors.bgInput,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.sm,
  },
  pickedName: {
    flex: 1,
    fontSize: fontSizes.sm,
    color: colors.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  clearBtn: {
    width: 22,
    height: 22,
    border: 'none',
    background: 'transparent',
    color: colors.textDim,
    cursor: 'pointer',
    fontSize: fontSizes.lg,
    lineHeight: '22px',
    padding: 0,
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: spacing.xs,
    background: colors.bgModal,
    border: `1px solid ${colors.borderStrong}`,
    borderRadius: radii.md,
    maxHeight: 256,
    overflowY: 'auto',
    zIndex: zIndex.dropdown,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  },
  row: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: `${spacing.sm}px ${spacing.md}px`,
    background: 'transparent',
    border: 'none',
    color: colors.text,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: fontSizes.sm,
    textAlign: 'left',
  },
  rowName: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontWeight: fontWeights.medium,
  },
  rowTeam: {
    flexShrink: 0,
    fontSize: fontSizes.xs,
    color: colors.textDim,
  },
  errorMsg: {
    marginTop: spacing.xs,
    padding: spacing.xs,
    fontSize: fontSizes.xs,
    color: colors.danger?.fg || '#ef4444',
  },
};
