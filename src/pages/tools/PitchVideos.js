import React, { useState, useRef, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import PlayerSearchField from './graphics/PlayerSearchField';

// Pitch Videos — search the Savant clip archive (Triton pitch_videos index +
// Mayday Cloud NAS) and download clips. Talks to the same-origin
// /api/pitch-video proxy, which validates the Mayday JWT and holds the
// Triton consumer key server-side. video_url on each row streams straight
// from Mayday Cloud with range support, so it drops into <video> as-is.

const PITCH_TYPES = [
  ['FF', 'Four-Seam'], ['SI', 'Sinker'], ['FC', 'Cutter'],
  ['SL', 'Slider'], ['ST', 'Sweeper'], ['SV', 'Slurve'],
  ['CU', 'Curveball'], ['KC', 'Knuckle Curve'], ['CH', 'Changeup'],
  ['FS', 'Splitter'], ['KN', 'Knuckleball'], ['EP', 'Eephus'],
];

const EVENTS = [
  'home_run', 'strikeout', 'single', 'double', 'triple', 'walk',
  'field_out', 'force_out', 'grounded_into_double_play', 'sac_fly',
  'hit_by_pitch', 'field_error',
];

const DESCRIPTIONS = [
  'swinging_strike', 'swinging_strike_blocked', 'called_strike',
  'foul', 'foul_tip', 'ball', 'blocked_ball', 'hit_into_play', 'missed_bunt',
];

const EMPTY_FILTERS = {
  pitcher: { playerId: null, playerName: '' },
  batter: { playerId: null, playerName: '' },
  team: '',
  pitchTypes: [],
  event: '',
  description: '',
  dateFrom: '',
  dateTo: '',
  gameYear: '',
  veloMin: '',
  veloMax: '',
  stand: '',
  pThrows: '',
  balls: '',
  strikes: '',
  inning: '',
  onlyArchived: true,
};

function label(s) {
  return s.replace(/_/g, ' ');
}

function fmtCount(row) {
  return `${row.balls ?? '–'}-${row.strikes ?? '–'}`;
}

function fmtResult(row) {
  if (row.events) return label(row.events);
  return row.description ? label(row.description) : '—';
}

// "Palmquist, Carson" + row → Palmquist_Carson_2026-07-04_SI_g822716-ab1-p1.mp4
function clipFilename(row) {
  const name = String(row.player_name || 'unknown')
    .replace(/[^a-zA-Z0-9, ]/g, '')
    .replace(/,?\s+/g, '_');
  return `${name}_${row.game_date}_${row.pitch_type || 'NA'}_g${row.game_pk}-ab${row.at_bat_number}-p${row.pitch_number}.mp4`;
}

export default function PitchVideos({ onBack }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [rows, setRows] = useState(null); // null = not searched yet
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [batch, setBatch] = useState(null); // { done, total, failed } while running
  const batchCancelRef = useRef(false);

  const setF = (patch) => setFilters((f) => ({ ...f, ...patch }));

  const buildQuery = useCallback(() => {
    const q = new URLSearchParams();
    const f = filters;
    if (f.pitcher.playerId) q.set('pitcher', f.pitcher.playerId);
    if (f.batter.playerId) q.set('batter', f.batter.playerId);
    if (f.team.trim()) q.set('team', f.team.trim().toUpperCase());
    if (f.pitchTypes.length) q.set('pitch_type', f.pitchTypes.join(','));
    if (f.event) q.set('event', f.event);
    if (f.description) q.set('description', f.description);
    if (f.dateFrom) q.set('date_from', f.dateFrom);
    if (f.dateTo) q.set('date_to', f.dateTo);
    if (f.gameYear) q.set('game_year', f.gameYear);
    if (f.veloMin) q.set('velo_min', f.veloMin);
    if (f.veloMax) q.set('velo_max', f.veloMax);
    if (f.stand) q.set('stand', f.stand);
    if (f.pThrows) q.set('p_throws', f.pThrows);
    if (f.balls !== '') q.set('balls', f.balls);
    if (f.strikes !== '') q.set('strikes', f.strikes);
    if (f.inning !== '') q.set('inning', f.inning);
    if (f.onlyArchived) q.set('only_archived', 'true');
    q.set('limit', '200');
    return q;
  }, [filters]);

  const runSearch = async () => {
    const q = buildQuery();
    // The API requires at least one filter beyond paging.
    const meaningful = [...q.keys()].filter((k) => !['limit', 'offset'].includes(k));
    if (meaningful.length === 0) {
      setSearchError('Set at least one filter first.');
      return;
    }
    setSearching(true);
    setSearchError(null);
    setSelected(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const res = await fetch(`/api/pitch-video?${q.toString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Search failed (${res.status})`);
      setRows(json.rows || []);
    } catch (err) {
      setSearchError(err.message || 'Search failed');
      setRows(null);
    } finally {
      setSearching(false);
    }
  };

  // Fetch the clip bytes and save under a readable filename. Falls back to
  // opening the stream URL directly if the blob fetch fails (e.g. CORS).
  const downloadClip = async (row) => {
    try {
      const res = await fetch(row.video_url);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = clipFilename(row);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return true;
    } catch {
      window.open(row.video_url, '_blank', 'noopener');
      return false;
    }
  };

  const runBatchDownload = async () => {
    const targets = (rows || []).filter((r) => r.video_url);
    if (!targets.length) return;
    batchCancelRef.current = false;
    setBatch({ done: 0, total: targets.length, failed: 0 });
    for (let i = 0; i < targets.length; i++) {
      if (batchCancelRef.current) break;
      const ok = await downloadClip(targets[i]);
      setBatch((b) => b && ({ ...b, done: i + 1, failed: b.failed + (ok ? 0 : 1) }));
    }
    setBatch(null);
  };

  const archivedCount = (rows || []).filter((r) => r.video_url).length;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button onClick={onBack} style={styles.backBtn} title="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <span style={styles.headerTitle}>Pitch Videos</span>
        <span style={styles.headerSub}>Savant clip archive search</span>
      </div>

      {/* Filter bar */}
      <div style={styles.filterCard}>
        <div style={styles.filterGrid}>
          <div style={styles.filterField}>
            <label style={styles.filterLabel}>Pitcher</label>
            <PlayerSearchField
              value={filters.pitcher}
              playerType="pitcher"
              placeholder="Search pitchers…"
              onChange={(v) => setF({ pitcher: v })}
            />
          </div>
          <div style={styles.filterField}>
            <label style={styles.filterLabel}>Batter</label>
            <PlayerSearchField
              value={filters.batter}
              playerType="batter"
              placeholder="Search batters…"
              onChange={(v) => setF({ batter: v })}
            />
          </div>
          <div style={styles.filterField}>
            <label style={styles.filterLabel}>Team</label>
            <input
              style={styles.input}
              value={filters.team}
              maxLength={3}
              placeholder="e.g. PIT"
              onChange={(e) => setF({ team: e.target.value })}
            />
          </div>
          <div style={styles.filterField}>
            <label style={styles.filterLabel}>Result (event)</label>
            <select style={styles.input} value={filters.event} onChange={(e) => setF({ event: e.target.value })}>
              <option value="">Any</option>
              {EVENTS.map((ev) => <option key={ev} value={ev}>{label(ev)}</option>)}
            </select>
          </div>
          <div style={styles.filterField}>
            <label style={styles.filterLabel}>Pitch result</label>
            <select style={styles.input} value={filters.description} onChange={(e) => setF({ description: e.target.value })}>
              <option value="">Any</option>
              {DESCRIPTIONS.map((d) => <option key={d} value={d}>{label(d)}</option>)}
            </select>
          </div>
          <div style={styles.filterField}>
            <label style={styles.filterLabel}>Season</label>
            <input
              style={styles.input}
              value={filters.gameYear}
              placeholder="2026"
              onChange={(e) => setF({ gameYear: e.target.value.replace(/\D/g, '').slice(0, 4) })}
            />
          </div>
          <div style={styles.filterField}>
            <label style={styles.filterLabel}>Date from / to</label>
            <div style={styles.pairRow}>
              <input type="date" style={styles.input} value={filters.dateFrom} onChange={(e) => setF({ dateFrom: e.target.value })} />
              <input type="date" style={styles.input} value={filters.dateTo} onChange={(e) => setF({ dateTo: e.target.value })} />
            </div>
          </div>
          <div style={styles.filterField}>
            <label style={styles.filterLabel}>Velo (mph)</label>
            <div style={styles.pairRow}>
              <input style={styles.input} value={filters.veloMin} placeholder="min" onChange={(e) => setF({ veloMin: e.target.value.replace(/[^\d.]/g, '') })} />
              <input style={styles.input} value={filters.veloMax} placeholder="max" onChange={(e) => setF({ veloMax: e.target.value.replace(/[^\d.]/g, '') })} />
            </div>
          </div>
          <div style={styles.filterField}>
            <label style={styles.filterLabel}>Count (B-S)</label>
            <div style={styles.pairRow}>
              <select style={styles.input} value={filters.balls} onChange={(e) => setF({ balls: e.target.value })}>
                <option value="">B</option>
                {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <select style={styles.input} value={filters.strikes} onChange={(e) => setF({ strikes: e.target.value })}>
                <option value="">S</option>
                {[0, 1, 2].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
          <div style={styles.filterField}>
            <label style={styles.filterLabel}>Sides</label>
            <div style={styles.pairRow}>
              <select style={styles.input} value={filters.stand} onChange={(e) => setF({ stand: e.target.value })}>
                <option value="">Bat: any</option>
                <option value="L">Bat: L</option>
                <option value="R">Bat: R</option>
              </select>
              <select style={styles.input} value={filters.pThrows} onChange={(e) => setF({ pThrows: e.target.value })}>
                <option value="">Thr: any</option>
                <option value="L">Thr: L</option>
                <option value="R">Thr: R</option>
              </select>
            </div>
          </div>
          <div style={styles.filterField}>
            <label style={styles.filterLabel}>Inning</label>
            <input
              style={styles.input}
              value={filters.inning}
              placeholder="any"
              onChange={(e) => setF({ inning: e.target.value.replace(/\D/g, '').slice(0, 2) })}
            />
          </div>
        </div>

        {/* Pitch type chips */}
        <div style={styles.chipRow}>
          {PITCH_TYPES.map(([code, name]) => {
            const on = filters.pitchTypes.includes(code);
            return (
              <button
                key={code}
                title={name}
                onClick={() => setF({
                  pitchTypes: on
                    ? filters.pitchTypes.filter((c) => c !== code)
                    : [...filters.pitchTypes, code],
                })}
                style={{ ...styles.chip, ...(on ? styles.chipOn : null) }}
              >
                {code}
              </button>
            );
          })}
        </div>

        <div style={styles.filterActions}>
          <label style={styles.archToggle}>
            <input
              type="checkbox"
              checked={filters.onlyArchived}
              onChange={(e) => setF({ onlyArchived: e.target.checked })}
            />
            Archived only (instantly playable)
          </label>
          <div style={{ flex: 1 }} />
          <button style={styles.clearFiltersBtn} onClick={() => setFilters(EMPTY_FILTERS)}>Clear</button>
          <button style={styles.searchBtn} onClick={runSearch} disabled={searching}>
            {searching ? 'Searching…' : 'Search'}
          </button>
        </div>
        {searchError && <div style={styles.errorMsg}>{searchError}</div>}
      </div>

      {/* Results + preview */}
      {rows !== null && (
        <div style={styles.resultsWrap}>
          <div style={styles.resultsCol}>
            <div style={styles.resultsBar}>
              <span style={styles.resultsCount}>
                {rows.length} pitches · {archivedCount} with video
              </span>
              <div style={{ flex: 1 }} />
              {batch ? (
                <>
                  <span style={styles.batchProgress}>
                    Downloading {batch.done}/{batch.total}{batch.failed ? ` (${batch.failed} failed)` : ''}
                  </span>
                  <button style={styles.clearFiltersBtn} onClick={() => { batchCancelRef.current = true; }}>
                    Cancel
                  </button>
                </>
              ) : (
                archivedCount > 0 && (
                  <button style={styles.batchBtn} onClick={runBatchDownload}>
                    Download all ({archivedCount})
                  </button>
                )
              )}
            </div>

            <div style={styles.tableScroll}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {['Date', 'Pitcher', 'Batter', 'Pitch', 'Velo', 'Count', 'Inn', 'Result', ''].map((h, i) => (
                      <th key={i} style={styles.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const key = `${row.game_pk}-${row.at_bat_number}-${row.pitch_number}`;
                    const isSel = selected && `${selected.game_pk}-${selected.at_bat_number}-${selected.pitch_number}` === key;
                    return (
                      <tr
                        key={key}
                        onClick={() => setSelected(row)}
                        style={{ ...styles.tr, ...(isSel ? styles.trSelected : null) }}
                      >
                        <td style={styles.td}>{row.game_date}</td>
                        <td style={styles.td}>{row.player_name}</td>
                        <td style={styles.td}>{row.batter_name}</td>
                        <td style={styles.td}>{row.pitch_type || '—'}</td>
                        <td style={styles.td}>{row.release_speed ? row.release_speed.toFixed(1) : '—'}</td>
                        <td style={styles.td}>{fmtCount(row)}</td>
                        <td style={styles.td}>{row.inning ?? '—'}</td>
                        <td style={styles.td}>{fmtResult(row)}</td>
                        <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {row.video_url ? (
                            <button
                              style={styles.rowBtn}
                              title="Download clip"
                              onClick={(e) => { e.stopPropagation(); downloadClip(row); }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                              </svg>
                            </button>
                          ) : (
                            <span style={styles.pendingTag} title={`Status: ${row.status}`}>{row.status}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr><td colSpan={9} style={styles.emptyCell}>No pitches matched these filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Preview panel */}
          <div style={styles.previewCol}>
            {selected ? (
              <>
                {selected.video_url ? (
                  <video
                    key={`${selected.game_pk}-${selected.at_bat_number}-${selected.pitch_number}`}
                    src={selected.video_url}
                    controls
                    autoPlay
                    style={styles.video}
                  />
                ) : (
                  <div style={styles.noVideo}>
                    Clip not archived yet ({selected.status}).{' '}
                    <a href={selected.savant_url} target="_blank" rel="noreferrer" style={styles.link}>
                      Watch on Savant
                    </a>
                  </div>
                )}
                <div style={styles.metaCard}>
                  <div style={styles.metaTitle}>
                    {selected.player_name} vs {selected.batter_name}
                  </div>
                  <div style={styles.metaGrid}>
                    <span style={styles.metaKey}>Pitch</span>
                    <span style={styles.metaVal}>
                      {selected.pitch_name || selected.pitch_type || '—'}
                      {selected.release_speed ? ` · ${selected.release_speed.toFixed(1)} mph` : ''}
                    </span>
                    <span style={styles.metaKey}>Result</span>
                    <span style={styles.metaVal}>{fmtResult(selected)}</span>
                    <span style={styles.metaKey}>Count</span>
                    <span style={styles.metaVal}>{fmtCount(selected)}, {selected.outs_when_up ?? '–'} out</span>
                    <span style={styles.metaKey}>Game</span>
                    <span style={styles.metaVal}>
                      {selected.away_team} @ {selected.home_team} · {selected.game_date} · {selected.inning_topbot} {selected.inning}
                    </span>
                    {selected.launch_speed != null && (
                      <>
                        <span style={styles.metaKey}>Contact</span>
                        <span style={styles.metaVal}>{selected.launch_speed} mph EV · {selected.launch_angle}°</span>
                      </>
                    )}
                  </div>
                  <div style={styles.metaActions}>
                    {selected.video_url && (
                      <button style={styles.searchBtn} onClick={() => downloadClip(selected)}>Download</button>
                    )}
                    <a href={selected.savant_url} target="_blank" rel="noreferrer" style={styles.link}>
                      Savant ↗
                    </a>
                  </div>
                </div>
              </>
            ) : (
              <div style={styles.previewEmpty}>Select a pitch to preview the clip</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    background: '#0f0f1a',
    color: '#e2e8f0',
    padding: '0 0 40px 0',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '20px 32px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  backBtn: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px',
    color: '#e2e8f0',
    width: '34px',
    height: '34px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  headerTitle: {
    fontSize: '18px',
    fontWeight: 700,
  },
  headerSub: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.35)',
  },
  filterCard: {
    margin: '20px 32px 0',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '12px',
    padding: '16px',
  },
  filterGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
    gap: '12px',
  },
  filterField: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
  },
  filterLabel: {
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.4px',
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.4)',
  },
  input: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px',
    color: '#e2e8f0',
    padding: '7px 10px',
    fontSize: '13px',
    fontFamily: 'inherit',
    width: '100%',
    boxSizing: 'border-box',
    colorScheme: 'dark',
  },
  pairRow: {
    display: 'flex',
    gap: '6px',
  },
  chipRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    marginTop: '14px',
  },
  chip: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '999px',
    color: 'rgba(255,255,255,0.55)',
    padding: '4px 12px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  chipOn: {
    background: 'rgba(99,102,241,0.18)',
    borderColor: 'rgba(99,102,241,0.5)',
    color: '#a5b4fc',
  },
  filterActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginTop: '14px',
  },
  archToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    fontSize: '13px',
    color: 'rgba(255,255,255,0.6)',
    cursor: 'pointer',
  },
  clearFiltersBtn: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px',
    color: 'rgba(255,255,255,0.6)',
    padding: '8px 16px',
    fontSize: '13px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  searchBtn: {
    background: '#6366f1',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    padding: '8px 22px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  batchBtn: {
    background: 'rgba(99,102,241,0.15)',
    border: '1px solid rgba(99,102,241,0.4)',
    borderRadius: '8px',
    color: '#a5b4fc',
    padding: '7px 16px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  batchProgress: {
    fontSize: '13px',
    color: '#a5b4fc',
  },
  errorMsg: {
    marginTop: '10px',
    color: '#f87171',
    fontSize: '13px',
  },
  resultsWrap: {
    display: 'flex',
    gap: '20px',
    margin: '20px 32px 0',
    alignItems: 'flex-start',
  },
  resultsCol: {
    flex: 1,
    minWidth: 0,
  },
  resultsBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '10px',
  },
  resultsCount: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.45)',
  },
  tableScroll: {
    overflow: 'auto',
    maxHeight: 'calc(100vh - 340px)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '12px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px',
  },
  th: {
    position: 'sticky',
    top: 0,
    background: '#16162a',
    textAlign: 'left',
    padding: '9px 12px',
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.4px',
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.4)',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    zIndex: 1,
  },
  tr: {
    cursor: 'pointer',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
  },
  trSelected: {
    background: 'rgba(99,102,241,0.12)',
  },
  td: {
    padding: '8px 12px',
    whiteSpace: 'nowrap',
  },
  rowBtn: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '6px',
    color: '#a5b4fc',
    width: '26px',
    height: '26px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  pendingTag: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.3)',
    fontStyle: 'italic',
  },
  emptyCell: {
    padding: '28px',
    textAlign: 'center',
    color: 'rgba(255,255,255,0.35)',
  },
  previewCol: {
    width: '420px',
    flexShrink: 0,
    position: 'sticky',
    top: '20px',
  },
  video: {
    width: '100%',
    borderRadius: '12px',
    background: '#000',
    border: '1px solid rgba(255,255,255,0.08)',
  },
  noVideo: {
    padding: '40px 20px',
    textAlign: 'center',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '12px',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '13px',
  },
  previewEmpty: {
    padding: '60px 20px',
    textAlign: 'center',
    background: 'rgba(255,255,255,0.02)',
    border: '1px dashed rgba(255,255,255,0.1)',
    borderRadius: '12px',
    color: 'rgba(255,255,255,0.3)',
    fontSize: '13px',
  },
  metaCard: {
    marginTop: '12px',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '12px',
    padding: '16px',
  },
  metaTitle: {
    fontSize: '15px',
    fontWeight: 700,
    marginBottom: '10px',
  },
  metaGrid: {
    display: 'grid',
    gridTemplateColumns: '70px 1fr',
    rowGap: '6px',
    columnGap: '10px',
    fontSize: '13px',
  },
  metaKey: {
    color: 'rgba(255,255,255,0.4)',
  },
  metaVal: {
    color: '#e2e8f0',
    textTransform: 'capitalize',
  },
  metaActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    marginTop: '14px',
  },
  link: {
    color: '#a5b4fc',
    fontSize: '13px',
    textDecoration: 'none',
  },
};
