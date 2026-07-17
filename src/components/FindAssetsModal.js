// Find Assets — Beat Sheets asset-suggestion review modal.
//
// Pipeline per run: (1) find-assets-enrich analyzes every tag WITH its beat's
// script text (one batched Claude call) → cleaned queries, structured pitch
// filters, confidence, web-search phrase. (2) Each tag searches the libraries:
//   videos (B-Roll)   → Savant pitch archive (/api/pitch-video; most-recent
//                       first, ordinal "tag N" = Nth-most-recent) with Shade
//                       Assets (VIDEO) as fallback
//   graphics (Images) → Shade Assets (IMAGE)
//   notes             → split on commas → Shade Assets (AUDIO + VIDEO for SFX/VFX)
// (3) Tags the libraries can't fill but the model understands confidently get
// an EXTERNAL suggestion — a curated web link (Claude web-search) or a
// deterministic Google Images / YouTube / Google search URL.
//
// Each tag gets one suggestion. Right-click: Confirm (green) / Deny (red —
// never suggested again) / Suggest Another (yellow → Re-run). Highlighting a
// row previews it in the side viewer (externals embed when the site allows,
// with an always-visible open-in-tab button). Hovering the tag shows the
// source beat. State persists to beat_sheets.asset_review (never rendered on
// the sheet, never in Push Script; "done" marks from the sheet are skipped).
// Confirmed library assets batch-download or push to Drive; external links
// are reference-only and excluded from transfers.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useConfirm } from '../contexts/ConfirmContext';

const SHADE_FN_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/shade-search`;
const PITCH_FN_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/pitch-video-drive`;
const UPLOAD_INIT_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/drive-upload-init`;
const ENRICH_FN_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/find-assets-enrich`;

// External suggestions only fire when the model is at least this sure it
// knows the specific asset the tag wants.
const EXTERNAL_CONFIDENCE = 0.6;

// Deterministic search-page fallback when the curated web lookup misses:
// field decides the surface (footage → YouTube, images → Google Images).
function fallbackExternal(item, enriched) {
  const phrase = enriched?.external_query || item.tag;
  const q = encodeURIComponent(phrase);
  if (item.field === 'graphics') {
    return { title: `Google Images: “${phrase}”`, url: `https://www.google.com/search?tbm=isch&q=${q}` };
  }
  if (item.field === 'videos') {
    return { title: `YouTube search: “${phrase}”`, url: `https://www.youtube.com/results?search_query=${q}` };
  }
  return { title: `Google search: “${phrase}”`, url: `https://www.google.com/search?q=${q}` };
}
const DRIVE_ROOT = { id: '1evC6T-cSra_KF89QzQ0KhDeXR5a4a2g1', name: 'Pitch Videos' };

const FIELD_META = {
  videos: { label: 'B-Roll', types: ['VIDEO'], pitch: true },
  graphics: { label: 'Images', types: ['IMAGE'], pitch: false },
  notes: { label: 'Audio / FX', types: ['AUDIO', 'VIDEO'], pitch: false },
};

// ── Tag → Savant pitch-archive query parsing ──
// The Pitches database (Triton pitch_videos via /api/pitch-video) is a
// structured index, not free text: it filters on pitcher/batter ids, pitch
// type codes, and outcome events. Parse those out of the tag; leftover words
// are treated as a player name and resolved via /api/triton-search.
const PITCH_TYPE_WORDS = [
  [/four[\s-]?seam|fastball|heater/i, 'FF'], [/sinker|two[\s-]?seam/i, 'SI'],
  [/cutter/i, 'FC'], [/slider/i, 'SL'], [/sweeper/i, 'ST'], [/slurve/i, 'SV'],
  [/knuckle[\s-]?curve/i, 'KC'], [/curve(ball)?/i, 'CU'], [/change(up)?/i, 'CH'],
  [/splitter|splinker|forkball/i, 'FS'], [/knuckle(ball)?/i, 'KN'], [/eephus/i, 'EP'],
];
const EVENT_WORDS = [
  [/home[\s-]?run|homer|dinger/i, 'home_run'], [/strike[\s-]?out|punch[\s-]?out/i, 'strikeout'],
  [/double[\s-]?play/i, 'grounded_into_double_play'], [/walk/i, 'walk'],
  [/triple/i, 'triple'], [/double/i, 'double'], [/single/i, 'single'],
  [/hit[\s-]?by[\s-]?pitch|hbp/i, 'hit_by_pitch'],
];

function parsePitchTag(tag) {
  let rest = ` ${tag} `;
  const pitchTypes = [];
  for (const [re, code] of PITCH_TYPE_WORDS) {
    if (re.test(rest)) { pitchTypes.push(code); rest = rest.replace(re, ' '); }
  }
  let event = null;
  for (const [re, code] of EVENT_WORDS) {
    if (re.test(rest)) { event = code; rest = rest.replace(re, ' '); break; }
  }
  const playerQuery = rest.replace(/[^\w' ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return { pitchTypes, event, playerQuery };
}

function pitchRowKey(row) { return `${row.game_pk}-${row.at_bat_number}-${row.pitch_number}`; }
function flipName(name) {
  const parts = String(name || '').split(',');
  if (parts.length === 2) return `${parts[1].trim()} ${parts[0].trim()}`;
  return String(name || '').trim();
}
function pitchClipName(row) {
  const outcome = String(row.events || row.description || 'Unknown').replace(/_/g, ' ');
  const raw = `${flipName(row.player_name)} to ${flipName(row.batter_name)} ${row.pitch_type || 'NA'} ${row.balls ?? '-'}-${row.strikes ?? '-'} ${outcome}`;
  return `${raw.replace(/[^\w\-. ]+/g, '').replace(/\s+/g, ' ').trim()}.mp4`;
}

const STATUS_STYLES = {
  pending: { border: 'rgba(255,255,255,0.12)', bg: 'rgba(255,255,255,0.03)' },
  confirmed: { border: 'rgba(34,197,94,0.5)', bg: 'rgba(34,197,94,0.10)' },
  denied: { border: 'rgba(239,68,68,0.5)', bg: 'rgba(239,68,68,0.10)' },
  reroll: { border: 'rgba(250,204,21,0.5)', bg: 'rgba(250,204,21,0.10)' },
};

function isSegment(item) { return item?.type === 'segment'; }
function flattenBeats(items) {
  if (!items) return [];
  const out = [];
  for (const item of items) {
    if (isSegment(item)) out.push(...(item.children || []));
    else out.push(item);
  }
  return out;
}

// Build the searchable tag list from the sheet's beats. Only string tags count
// (uploaded media objects and legacy items are skipped); notes split on commas.
// Tags marked "done" on the beat sheet (right-click → Mark done, meaning the
// asset was already sourced elsewhere) are excluded entirely.
function collectItems(beats, review = {}) {
  const items = [];
  const push = (key, beatId, beatTitle, field, tag) => {
    if (review[key]?.status === 'done') return;
    items.push({ key, beatId, beatTitle, field, tag });
  };
  for (const beat of flattenBeats(beats)) {
    const beatTitle = (beat.title || '').trim();
    for (const field of ['videos', 'graphics']) {
      for (const v of beat[field] || []) {
        if (typeof v === 'string' && v.trim()) {
          push(`${beat.id}::${field}::${v.trim()}`, beat.id, beatTitle, field, v.trim());
        }
      }
    }
    for (const piece of String(beat.notes || '').split(',').map((s) => s.trim()).filter(Boolean)) {
      push(`${beat.id}::notes::${piece}`, beat.id, beatTitle, 'notes', piece);
    }
  }
  return items;
}

export default function FindAssetsModal({ sheetId, beats, initialReview, onClose }) {
  const confirm = useConfirm();
  const [items] = useState(() => collectItems(beats, initialReview || {}));
  const [review, setReview] = useState(() => ({ ...(initialReview || {}) }));
  const [searching, setSearching] = useState(false);
  // Set when the Savant archive (/api/pitch-video, /api/triton-search) errors
  // — those failures were previously swallowed into "no pitch suggestions",
  // which reads as bad search results instead of a broken pipe.
  const [archiveWarning, setArchiveWarning] = useState(null);
  // LLM context layer: per-tag search intelligence derived from the tag PLUS
  // its beat's script text (find-assets-enrich, one batched Claude call).
  // key → { meaning, confidence, shade_query, pitch, external_query }
  const [enriching, setEnriching] = useState(false);
  const enrichmentRef = useRef({});
  const [selectedKey, setSelectedKey] = useState(null);
  const [viewerUrl, setViewerUrl] = useState(null); // { kind: 'shade'|'pitch', url, type }
  const [viewerLoading, setViewerLoading] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, key }
  const [pushState, setPushState] = useState(null); // { done, total, failed, errors[] }
  const [pickerOpen, setPickerOpen] = useState(false);
  const [driveFolders, setDriveFolders] = useState([]);
  const [drivePath, setDrivePath] = useState([DRIVE_ROOT]);
  const [driveLoading, setDriveLoading] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const reviewRef = useRef(review);
  reviewRef.current = review;
  const saveTimer = useRef(null);

  const authHeaders = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');
    return { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
  };

  const shadeCall = useCallback(async (body, raw = false) => {
    const headers = await authHeaders();
    const res = await fetch(SHADE_FN_URL, { method: 'POST', headers, body: JSON.stringify(body) });
    if (raw) return res;
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
    return json;
  }, []);

  // Search the Savant pitch archive for a tag: parse pitch types / outcomes,
  // resolve any leftover words to a player id (pitchers first, then batters),
  // then hit the structured /api/pitch-video index. Returns [] when the tag
  // carries nothing the archive can filter on (e.g. "stadium crowd").
  const pitchSearch = useCallback(async (tag, hints) => {
    const headers = await authHeaders();
    // Enrichment hints (from the beat-context LLM pass) beat the regex parser
    // — they carry disambiguation the tag alone doesn't have.
    const { pitchTypes, event, playerQuery } = hints
      ? {
        pitchTypes: Array.isArray(hints.pitch_types) ? hints.pitch_types : [],
        event: hints.event || null,
        playerQuery: (hints.player_name || '').trim(),
      }
      : parsePitchTag(tag);

    const q = new URLSearchParams();
    if (pitchTypes.length) q.set('pitch_type', pitchTypes.join(','));
    if (event) q.set('event', event);

    if (playerQuery) {
      // Try the full leftover text, then fall back to the first word — tags
      // like "Latz Save" carry non-archive words ("save" is a game stat, not
      // a pitch event) that would sink an exact name lookup.
      const attempts = [playerQuery];
      const firstWord = playerQuery.split(' ')[0];
      if (firstWord && firstWord !== playerQuery) attempts.push(firstWord);
      outer:
      for (const term of attempts) {
        for (const rpc of ['search_players', 'search_batters']) {
          try {
            const res = await fetch('/api/triton-search', {
              method: 'POST', headers,
              body: JSON.stringify({ rpc, params: { search_term: term, result_limit: 1 } }),
            });
            if (!res.ok) {
              setArchiveWarning(`Player lookup failed (${res.status}) — pitch suggestions may be incomplete`);
              continue;
            }
            const json = await res.json().catch(() => ({}));
            const hit = Array.isArray(json.rows) ? json.rows[0] : null;
            // Row id lives under `pitcher` / `batter` depending on the rpc
            // (same fallback chain PlayerSearchField uses), not `player_id`.
            const playerId = hit?.player_id ?? hit?.pitcher ?? hit?.batter;
            if (playerId != null) {
              q.set(rpc === 'search_players' ? 'pitcher' : 'batter', playerId);
              break outer;
            }
          } catch { /* try the next rpc / term */ }
        }
      }
    }

    // Nothing the archive can filter on → no pitch candidates for this tag.
    if (![...q.keys()].length) return [];

    // Wide fetch, then sort by recency client-side (the proxy passes Triton's
    // ordering through untouched, so don't trust the first row to be newest).
    // Default = the MOST RECENT example: "Skenes sweeper" → his latest sweeper.
    // Archived-on-NAS breaks ties so equally-recent clips prefer the copy that
    // previews/pushes without Savant mp4 resolution.
    q.set('limit', '100');
    try {
      const res = await fetch(`/api/pitch-video?${q.toString()}`, { headers });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setArchiveWarning(`Pitch archive unreachable (${json.error || res.status}) — pitch suggestions skipped`);
        return [];
      }
      const rows = (json.rows || []).slice().sort((a, b) => {
        const dateCmp = String(b.game_date || '').localeCompare(String(a.game_date || ''));
        if (dateCmp !== 0) return dateCmp;
        return (b.video_url ? 1 : 0) - (a.video_url ? 1 : 0);
      });
      return rows.map((row) => ({
        id: pitchRowKey(row),
        name: pitchClipName(row),
        type: 'VIDEO',
        source: 'pitch',
        video_url: row.video_url || null,
        game_pk: row.game_pk,
        at_bat_number: row.at_bat_number,
        pitch_number: row.pitch_number,
        game_date: row.game_date || null,
        thumbnail: null,
      }));
    } catch (e) {
      setArchiveWarning(`Pitch archive unreachable (${e.message}) — pitch suggestions skipped`);
      return [];
    }
  }, []);

  // Playable URL for a pitch suggestion: archived NAS copy, else resolve the
  // Savant CDN mp4 on demand (same path as the Pitch Videos tool).
  const resolvePitchUrl = useCallback(async (s) => {
    if (s.video_url) return s.video_url;
    const headers = await authHeaders();
    const res = await fetch(
      `/api/pitch-video?game_pk=${s.game_pk}&ab=${s.at_bat_number}&pitch=${s.pitch_number}&resolve_mp4=true`,
      { headers },
    );
    const json = await res.json().catch(() => ({}));
    return json?.row?.savant_mp4_url || null;
  }, []);

  // Persist review state (debounced, fire-and-forget). Lives on its own
  // column so it never touches the beats blob.
  const persist = useCallback((next) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      supabase.from('beat_sheets').update({ asset_review: next }).eq('id', sheetId)
        .then(({ error }) => { if (error) console.error('asset_review save failed:', error.message); });
    }, 600);
  }, [sheetId]);

  const updateEntry = useCallback((key, patch) => {
    setReview((prev) => {
      const next = { ...prev, [key]: { ...(prev[key] || { status: 'pending', shownIds: [], deniedIds: [] }), ...patch } };
      persist(next);
      return next;
    });
  }, [persist]);

  // Search one item, excluding already-shown/denied assets. Returns suggestion or null.
  const searchFor = useCallback(async (item, exclude) => {
    const meta = FIELD_META[item.field];
    // Numbered sibling tags are ordinal picks from the recency-sorted archive:
    // "Latz Strikeout 1" = his most recent K, "Latz Strikeout 2" = the one
    // before that, etc. Strip the number from the search text itself.
    const ordMatch = item.tag.match(/^(.*\S)[\s#]+(\d{1,2})$/);
    const query = ordMatch ? ordMatch[1] : item.tag;
    const ordinal = ordMatch ? parseInt(ordMatch[2], 10) : null;

    // Beat-context enrichment: a better shade query, and an explicit verdict
    // on whether this tag wants MLB gameplay footage (pitch !== null). When
    // the model says it isn't gameplay, skip the archive entirely — the
    // regex parser only runs when enrichment is unavailable.
    const e = enrichmentRef.current[item.key] || null;
    const shadeQuery = e?.shade_query || query;
    const pitchPromise = !meta.pitch
      ? Promise.resolve([])
      : e
        ? (e.pitch ? pitchSearch(query, e.pitch) : Promise.resolve([]))
        : pitchSearch(query);

    const [shadeRes, pitchRes] = await Promise.all([
      shadeCall({ op: 'search', query: shadeQuery, types: meta.types, limit: 12 }).catch(() => ({ assets: [] })),
      pitchPromise,
    ]);
    // Pitch-archive hits lead for B-Roll: a tag that parses to a player /
    // pitch type / outcome is asking for a gameplay clip, and the Savant
    // archive is the authoritative source for those. Shade covers the rest.
    const pitchCandidates = pitchRes.filter((c) => !exclude.has(c.id));
    const shadeCandidates = (shadeRes.assets || [])
      .map((a) => ({
        id: a.id, name: a.name, type: a.type, source: 'shade',
        proxy_id: a.proxy_id || null, url: null, thumbnail: a.thumbnail || null,
        extension: a.extension || null,
      }))
      .filter((c) => !exclude.has(c.id));

    if (ordinal && pitchCandidates.length) {
      // Nth most recent (the pitch list is recency-sorted). If the archive
      // has fewer than N left, take the oldest available rather than nothing.
      return pitchCandidates[Math.min(ordinal - 1, pitchCandidates.length - 1)];
    }
    return pitchCandidates[0] || shadeCandidates[0] || null;
  }, [shadeCall, pitchSearch]);

  // One batched Claude call: tag + beat text → search intelligence per tag.
  // Failure is non-fatal — searches proceed on the raw tags with a warning.
  const fetchEnrichment = useCallback(async () => {
    if (!items.length || Object.keys(enrichmentRef.current).length) return;
    setEnriching(true);
    try {
      const headers = await authHeaders();
      const payload = items.map((it) => ({
        key: it.key,
        field: it.field,
        // Strip our ordinal convention before the model sees the tag.
        tag: (it.tag.match(/^(.*\S)[\s#]+\d{1,2}$/) || [null, it.tag])[1],
        beat: it.beatTitle || '',
      }));
      const res = await fetch(ENRICH_FN_URL, {
        method: 'POST', headers, body: JSON.stringify({ op: 'enrich', items: payload }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `enrich failed (${res.status})`);
      const map = {};
      for (const e of json.items || []) { if (e?.key) map[e.key] = e; }
      enrichmentRef.current = map;
    } catch (e) {
      setArchiveWarning(`Context analysis failed (${e.message}) — searching on tags alone`);
    } finally {
      setEnriching(false);
    }
  }, [items]);

  // Third source: when the libraries came up empty on a tag the model is
  // confident about, offer an external web link — a curated one from the
  // web-search lookup, else a deterministic search-page URL.
  const externalPass = useCallback(async (list, isCancelled = () => false) => {
    const needy = list.filter((item) => {
      const entry = reviewRef.current[item.key];
      const e = enrichmentRef.current[item.key];
      return entry && !entry.suggestion && !['confirmed', 'denied'].includes(entry.status)
        && e && (e.confidence ?? 0) >= EXTERNAL_CONFIDENCE;
    });
    if (!needy.length) return;

    let curated = {};
    try {
      const headers = await authHeaders();
      const res = await fetch(ENRICH_FN_URL, {
        method: 'POST', headers,
        body: JSON.stringify({
          op: 'external',
          items: needy.map((it) => {
            const e = enrichmentRef.current[it.key];
            return { key: it.key, query: e.external_query || it.tag, meaning: e.meaning || '' };
          }),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) for (const l of json.links || []) curated[l.key] = l;
    } catch { /* fall through to deterministic links */ }

    for (const item of needy) {
      if (isCancelled()) return;
      const entry = reviewRef.current[item.key] || { shownIds: [], deniedIds: [] };
      const denied = new Set(entry.deniedIds || []);
      let link = curated[item.key];
      if (!link || denied.has(link.url)) link = fallbackExternal(item, enrichmentRef.current[item.key]);
      if (denied.has(link.url)) continue; // everything external already denied
      updateEntry(item.key, {
        suggestion: { id: link.url, name: link.title, type: 'LINK', source: 'external', url: link.url },
        status: 'pending',
        shownIds: [...new Set([...(entry.shownIds || []), link.url])],
      });
    }
  }, [updateEntry]);

  // Search a batch of items, honoring each entry's shown/denied exclusions,
  // then run the external pass over whatever the libraries couldn't fill.
  const searchBatch = useCallback(async (list, isCancelled = () => false) => {
    if (!list.length) return;
    setSearching(true);
    for (const item of list) {
      if (isCancelled()) return;
      const entry = reviewRef.current[item.key] || { status: 'pending', shownIds: [], deniedIds: [] };
      const exclude = new Set([...(entry.shownIds || []), ...(entry.deniedIds || [])]);
      try {
        const suggestion = await searchFor(item, exclude);
        if (isCancelled()) return;
        updateEntry(item.key, {
          suggestion,
          status: 'pending',
          shownIds: suggestion ? [...new Set([...(entry.shownIds || []), suggestion.id])] : (entry.shownIds || []),
        });
      } catch (e) {
        console.error('Find Assets search failed for', item.tag, e);
      }
    }
    await externalPass(list, isCancelled);
    if (!isCancelled()) setSearching(false);
  }, [searchFor, updateEntry, externalPass]);

  // Initial pass: analyze beats first (context layer), then search every
  // item that has no entry yet.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await fetchEnrichment();
      if (cancelled) return;
      const fresh = items.filter((it) => !reviewRef.current[it.key]?.suggestion && !reviewRef.current[it.key]?.status?.match(/confirmed|denied/));
      searchBatch(fresh, () => cancelled);
    })();
    return () => { cancelled = true; };
  }, []);

  // Clear suggestions: wipe ALL review state (statuses, suggestions, and the
  // shown/denied history — denied assets become eligible again) and search
  // every tag from scratch.
  const clearAll = async () => {
    const ok = await confirm('Clear all suggestions and start over? Confirmed, denied, and re-run history will be wiped.');
    if (!ok) return;
    setSelectedKey(null);
    setViewerUrl(null);
    // Preserve "done" marks — those are set on the beat sheet itself
    // (asset sourced elsewhere), not modal suggestion state.
    const kept = Object.fromEntries(
      Object.entries(reviewRef.current).filter(([, v]) => v?.status === 'done'),
    );
    setReview(kept);
    reviewRef.current = kept;
    persist(kept);
    searchBatch(items);
  };

  // Re-run: fresh suggestions for every yellow (reroll) item.
  const rerollKeys = items.filter((it) => review[it.key]?.status === 'reroll').map((it) => it.key);
  const rerun = async () => {
    setSearching(true);
    const rerolled = items.filter((it) => review[it.key]?.status === 'reroll');
    for (const item of rerolled) {
      const entry = review[item.key];
      const exclude = new Set([...(entry.shownIds || []), ...(entry.deniedIds || [])]);
      try {
        const suggestion = await searchFor(item, exclude);
        updateEntry(item.key, {
          suggestion,
          status: 'pending',
          shownIds: suggestion ? [...new Set([...(entry.shownIds || []), suggestion.id])] : (entry.shownIds || []),
        });
      } catch (e) {
        console.error('Re-run failed for', item.tag, e);
      }
    }
    // Rerolled tags the libraries still can't fill get the external option.
    await externalPass(rerolled);
    setSearching(false);
  };

  // Viewer: resolve + preview the highlighted suggestion.
  useEffect(() => {
    const entry = selectedKey ? review[selectedKey] : null;
    const s = entry?.suggestion;
    if (!s) { setViewerUrl(null); return; }
    if (s.source === 'external') {
      // Attempt an embed; most sites refuse framing, so the render always
      // pairs it with an Open-in-new-tab button.
      setViewerUrl({ kind: 'external', url: s.url, type: 'LINK' });
      setViewerLoading(false);
      return;
    }
    let cancelled = false;
    setViewerLoading(true);
    const resolver = s.source === 'pitch'
      ? resolvePitchUrl(s).then((url) => (url ? { url, type: 'VIDEO' } : null))
      : shadeCall({ op: 'resolve', asset_id: s.id, proxy_id: s.proxy_id })
          .then((json) => (json.url ? { url: json.url, type: s.type } : null));
    resolver
      .then((v) => { if (!cancelled) setViewerUrl(v); })
      .catch(() => { if (!cancelled) setViewerUrl(null); })
      .finally(() => { if (!cancelled) setViewerLoading(false); });
    return () => { cancelled = true; };
  }, [selectedKey, review[selectedKey]?.suggestion?.id]);

  const confirmed = items.filter((it) => review[it.key]?.status === 'confirmed' && review[it.key]?.suggestion);
  // External links have no bytes to download/push — they're reference sources.
  const transferable = confirmed.filter((it) => review[it.key].suggestion.source !== 'external');
  const allResolved = items.length > 0 && items.every((it) => ['confirmed', 'denied'].includes(review[it.key]?.status));

  // Context-menu actions
  const act = (key, action) => {
    const entry = review[key] || { shownIds: [], deniedIds: [] };
    if (action === 'confirm') updateEntry(key, { status: 'confirmed' });
    if (action === 'deny') {
      updateEntry(key, {
        status: 'denied',
        deniedIds: entry.suggestion ? [...new Set([...(entry.deniedIds || []), entry.suggestion.id])] : (entry.deniedIds || []),
      });
    }
    if (action === 'reroll') {
      updateEntry(key, {
        status: 'reroll',
        deniedIds: entry.suggestion ? [...new Set([...(entry.deniedIds || []), entry.suggestion.id])] : (entry.deniedIds || []),
      });
    }
    setCtxMenu(null);
  };

  // ── Batch download / push ──
  const fetchShadeBytes = async (s) => {
    const res = await shadeCall({ op: 'fetch', asset_id: s.id, proxy_id: s.proxy_id }, true);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `fetch failed (${res.status})`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length) throw new Error('0 bytes');
    return bytes;
  };

  // Bytes for any confirmed suggestion: Shade assets stream through the
  // shade-search fetch op; pitch clips fetch straight from the NAS / Savant
  // CDN (both allow cross-origin, same as the Pitch Videos tool).
  const fetchSuggestionBytes = async (s) => {
    if (s.source === 'pitch') {
      const src = await resolvePitchUrl(s);
      if (!src) throw new Error('no playable clip');
      const res = await fetch(src);
      if (!res.ok) throw new Error(`clip fetch ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    }
    return fetchShadeBytes(s);
  };

  const suggestionFilename = (s) => {
    if (s.source === 'pitch') return s.name; // already "…outcome.mp4"
    return s.extension && !s.name?.toLowerCase().endsWith(`.${s.extension}`) ? `${s.name}.${s.extension}` : (s.name || 'asset');
  };

  const downloadConfirmed = async () => {
    setPushState({ done: 0, total: transferable.length, failed: 0, errors: [] });
    for (let i = 0; i < transferable.length; i++) {
      const s = review[transferable[i].key].suggestion;
      try {
        const bytes = await fetchSuggestionBytes(s);
        const url = URL.createObjectURL(new Blob([bytes]));
        const a = document.createElement('a');
        a.href = url;
        a.download = suggestionFilename(s);
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        setPushState((p) => p && ({ ...p, done: i + 1 }));
      } catch (e) {
        setPushState((p) => p && ({ ...p, done: i + 1, failed: p.failed + 1, errors: [...p.errors, `${s.name}: ${e.message}`] }));
      }
    }
  };

  const loadDriveFolders = async (parentId) => {
    setDriveLoading(true);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${PITCH_FN_URL}?parentId=${encodeURIComponent(parentId)}`, { headers });
      const json = await res.json().catch(() => ({}));
      setDriveFolders(json.folders || []);
    } finally { setDriveLoading(false); }
  };

  const pushConfirmed = async () => {
    const parentFolderId = drivePath[drivePath.length - 1].id;
    const headers = await authHeaders();
    setPushState({ done: 0, total: transferable.length, failed: 0, errors: [] });
    for (let i = 0; i < transferable.length; i++) {
      const s = review[transferable[i].key].suggestion;
      try {
        const bytes = await fetchSuggestionBytes(s);
        const filename = suggestionFilename(s);
        const mimeType = s.source === 'pitch' ? 'video/mp4' : 'application/octet-stream';
        const initRes = await fetch(UPLOAD_INIT_URL, {
          method: 'POST', headers,
          body: JSON.stringify({ filename, parentFolderId, mimeType, sizeBytes: bytes.length }),
        });
        const initJson = await initRes.json().catch(() => ({}));
        if (!initRes.ok || !initJson.uploadUrl) throw new Error(initJson.error || `init failed (${initRes.status})`);
        const putRes = await fetch(initJson.uploadUrl, { method: 'PUT', body: new Blob([bytes], { type: mimeType }) });
        if (!putRes.ok) throw new Error(`Drive PUT ${putRes.status}`);
        setPushState((p) => p && { ...p, done: i + 1 });
      } catch (e) {
        setPushState((p) => p && { ...p, done: i + 1, failed: p.failed + 1, errors: [...p.errors, `${s.name}: ${e.message}`] });
      }
    }
  };

  const close = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    supabase.from('beat_sheets').update({ asset_review: reviewRef.current }).eq('id', sheetId)
      .then(({ error }) => { if (error) console.error('asset_review save failed:', error.message); });
    onClose(reviewRef.current);
  };

  const selEntry = selectedKey ? review[selectedKey] : null;

  return (
    <div style={s.overlay} onClick={close}>
      <div style={s.modal} onClick={(e) => { e.stopPropagation(); setCtxMenu(null); }}>
        {/* Header */}
        <div style={s.head}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>Find Assets</span>
          <span style={s.headMeta}>
            {items.length} tags · {confirmed.length} confirmed
            {enriching ? ' · analyzing beats…' : searching ? ' · searching…' : ''}
          </span>
          {archiveWarning && (
            <span style={{ fontSize: 11, color: '#fcd34d' }} title={archiveWarning}>⚠ {archiveWarning}</span>
          )}
          <div style={{ flex: 1 }} />
          <button
            onClick={clearAll}
            disabled={searching || !items.length}
            title="Wipe every suggestion (including denied history) and search all tags again"
            style={{ ...s.btn, color: '#fca5a5', borderColor: 'rgba(239,68,68,0.3)', opacity: searching || !items.length ? 0.4 : 1 }}
          >
            Clear suggestions
          </button>
          <button onClick={rerun} disabled={!rerollKeys.length || searching} style={{ ...s.btn, opacity: rerollKeys.length && !searching ? 1 : 0.4 }}>
            ↻ Re-run ({rerollKeys.length})
          </button>
          <button onClick={close} style={s.closeBtn}>✕</button>
        </div>

        <div style={s.body}>
          {/* Left: tag → suggestion list */}
          <div style={s.list}>
            {items.length === 0 && <div style={s.empty}>No tags found. Add B-Roll tags, image tags, or comma-separated notes to your beats first.</div>}
            {items.map((item) => {
              const entry = review[item.key] || {};
              const st = STATUS_STYLES[entry.status] || STATUS_STYLES.pending;
              const sug = entry.suggestion;
              return (
                <div
                  key={item.key}
                  onClick={() => setSelectedKey(item.key)}
                  onContextMenu={(e) => { e.preventDefault(); setSelectedKey(item.key); setCtxMenu({ x: e.clientX, y: e.clientY, key: item.key }); }}
                  style={{
                    ...s.row,
                    borderColor: selectedKey === item.key ? 'rgba(99,102,241,0.6)' : st.border,
                    background: st.bg,
                  }}
                >
                  <span style={s.fieldBadge}>{FIELD_META[item.field].label}</span>
                  <span style={s.tagText} title={`Beat: ${item.beatTitle || '(untitled)'}`}>
                    {item.tag}
                  </span>
                  <span style={s.arrow}>→</span>
                  {sug ? (
                    <span style={s.sugText} title={sug.name}>
                      {sug.thumbnail && <img src={sug.thumbnail} alt="" style={s.thumb} />}
                      {sug.source === 'external' ? (
                        <a
                          href={sug.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: '#fcd34d', textDecoration: 'underline' }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {sug.name}
                        </a>
                      ) : sug.name}
                      <span style={{ ...s.srcBadge, ...(sug.source === 'external' ? { background: 'rgba(250,204,21,0.15)', color: '#fcd34d' } : {}) }}>
                        {sug.source === 'pitch' ? `Pitches${sug.game_date ? ` · ${sug.game_date}` : ''}`
                          : sug.source === 'external' ? 'External ↗' : 'Assets'}
                      </span>
                    </span>
                  ) : (
                    <span style={{ ...s.sugText, color: 'rgba(255,255,255,0.35)' }}>
                      {entry.status === 'denied' ? 'denied' : searching ? '…' : 'no match — right-click to deny or re-run'}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Right: viewer */}
          <div style={s.viewer}>
            {!selEntry?.suggestion ? (
              <div style={s.viewerEmpty}>Select a suggestion to preview it</div>
            ) : viewerLoading ? (
              <div style={s.viewerEmpty}>Loading preview…</div>
            ) : !viewerUrl ? (
              <div style={s.viewerEmpty}>No preview available</div>
            ) : viewerUrl.kind === 'external' ? (
              <>
                <iframe title="external preview" src={viewerUrl.url} style={s.viewerFrame} sandbox="allow-scripts allow-same-origin" />
                <a href={viewerUrl.url} target="_blank" rel="noopener noreferrer" style={s.externalOpenBtn}>
                  Open in new tab ↗
                </a>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>
                  Many sites block embedding — if the preview is blank, use the button.
                </div>
              </>
            ) : viewerUrl.kind === 'pitch' ? (
              <iframe title="preview" src={viewerUrl.url} style={s.viewerFrame} allow="autoplay" />
            ) : viewerUrl.type === 'IMAGE' ? (
              <img src={viewerUrl.url} alt="" style={s.viewerMedia} />
            ) : viewerUrl.type === 'AUDIO' ? (
              <audio src={viewerUrl.url} controls style={{ width: '90%' }} />
            ) : (
              <video src={viewerUrl.url} controls style={s.viewerMedia} />
            )}
            {selEntry?.suggestion && (
              <div style={s.viewerName}>{selEntry.suggestion.name}</div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={s.foot}>
          {pushState ? (
            <span style={{ fontSize: 12, color: pushState.failed ? '#fcd34d' : '#22c55e' }}>
              {pushState.done}/{pushState.total} processed{pushState.failed ? ` · ${pushState.failed} failed` : ''}
              {pushState.errors.length > 0 && <span style={{ color: '#fca5a5' }}> — {pushState.errors[pushState.errors.length - 1]}</span>}
            </span>
          ) : (
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
              {allResolved ? 'All suggestions reviewed.' : 'Right-click a row: Confirm · Deny · Suggest another'}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={downloadConfirmed} disabled={!transferable.length} style={{ ...s.btn, opacity: transferable.length ? 1 : 0.4 }}>
            Download confirmed ({transferable.length})
          </button>
          <button
            onClick={() => { setPickerOpen(true); setDrivePath([DRIVE_ROOT]); loadDriveFolders(DRIVE_ROOT.id); }}
            disabled={!transferable.length}
            style={{ ...s.btnPrimary, opacity: transferable.length ? 1 : 0.4 }}
          >
            Push to Drive…
          </button>
        </div>

        {/* Folder picker */}
        {pickerOpen && (
          <div style={s.picker}>
            <div style={s.pickerCrumbs}>
              {drivePath.map((c, i) => (
                <React.Fragment key={c.id}>
                  {i > 0 && <span style={{ color: 'rgba(255,255,255,0.3)' }}>/</span>}
                  <button style={s.crumb} onClick={() => { const next = drivePath.slice(0, i + 1); setDrivePath(next); loadDriveFolders(c.id); }}>{c.name}</button>
                </React.Fragment>
              ))}
              <div style={{ flex: 1 }} />
              <button style={s.closeBtn} onClick={() => setPickerOpen(false)}>✕</button>
            </div>
            <div style={s.pickerList}>
              {driveLoading ? <div style={s.empty}>Loading…</div> : driveFolders.map((f) => (
                <button key={f.id} style={s.folderBtn} onClick={() => { setDrivePath((p) => [...p, f]); loadDriveFolders(f.id); }}>📁 {f.name}</button>
              ))}
              {!driveLoading && !driveFolders.length && <div style={s.empty}>No subfolders.</div>}
            </div>
            <div style={s.pickerFoot}>
              <input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="New folder…"
                style={s.input}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && newFolderName.trim()) {
                    const headers = await authHeaders();
                    const res = await fetch(PITCH_FN_URL, { method: 'POST', headers, body: JSON.stringify({ parentId: drivePath[drivePath.length - 1].id, name: newFolderName.trim() }) });
                    const j = await res.json().catch(() => ({}));
                    if (res.ok && j.folder) { setNewFolderName(''); setDrivePath((p) => [...p, j.folder]); loadDriveFolders(j.folder.id); }
                  }
                }}
              />
              <button style={s.btnPrimary} onClick={() => { setPickerOpen(false); pushConfirmed(); }}>
                Push {transferable.length} here
              </button>
            </div>
          </div>
        )}

        {/* Right-click menu */}
        {ctxMenu && (
          <div style={{ ...s.ctx, left: ctxMenu.x, top: ctxMenu.y }} onClick={(e) => e.stopPropagation()}>
            <button style={{ ...s.ctxBtn, color: '#22c55e' }} onClick={() => act(ctxMenu.key, 'confirm')}>✓ Confirm</button>
            <button style={{ ...s.ctxBtn, color: '#f87171' }} onClick={() => act(ctxMenu.key, 'deny')}>✕ Deny</button>
            <button style={{ ...s.ctxBtn, color: '#facc15' }} onClick={() => act(ctxMenu.key, 'reroll')}>↻ Suggest another</button>
          </div>
        )}
      </div>
    </div>
  );
}

const s = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal: { width: 'min(1100px, 94vw)', height: 'min(720px, 90vh)', background: '#14141f', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' },
  head: { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)', color: '#e2e8f0' },
  headMeta: { fontSize: 12, color: 'rgba(255,255,255,0.4)' },
  body: { flex: 1, display: 'flex', minHeight: 0 },
  list: { flex: 1.2, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 6, borderRight: '1px solid rgba(255,255,255,0.08)' },
  row: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, border: '1px solid', cursor: 'pointer', minWidth: 0 },
  fieldBadge: { fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, padding: '2px 6px', borderRadius: 4, background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', flexShrink: 0 },
  tagText: { fontSize: 12, fontWeight: 600, color: '#e2e8f0', maxWidth: '30%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 },
  arrow: { color: 'rgba(255,255,255,0.3)', flexShrink: 0 },
  sugText: { fontSize: 12, color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
  thumb: { width: 28, height: 18, objectFit: 'cover', borderRadius: 3, flexShrink: 0 },
  srcBadge: { fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)', flexShrink: 0 },
  viewer: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 12, gap: 8, minWidth: 0 },
  viewerEmpty: { fontSize: 13, color: 'rgba(255,255,255,0.3)' },
  viewerFrame: { width: '100%', height: '85%', border: 'none', borderRadius: 8, background: '#000' },
  viewerMedia: { maxWidth: '100%', maxHeight: '85%', borderRadius: 8 },
  viewerName: { fontSize: 12, color: 'rgba(255,255,255,0.55)', textAlign: 'center', wordBreak: 'break-word' },
  externalOpenBtn: {
    padding: '7px 14px', borderRadius: 8, background: 'rgba(250,204,21,0.15)',
    border: '1px solid rgba(250,204,21,0.4)', color: '#fcd34d', fontSize: 12,
    fontWeight: 600, textDecoration: 'none',
  },
  foot: { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px', borderTop: '1px solid rgba(255,255,255,0.08)' },
  btn: { padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: '#e2e8f0', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  btnPrimary: { padding: '7px 14px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  closeBtn: { background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.45)', cursor: 'pointer', fontSize: 15 },
  empty: { fontSize: 12, color: 'rgba(255,255,255,0.35)', padding: 12 },
  ctx: { position: 'fixed', zIndex: 300, background: '#1c1c2b', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: 4, display: 'flex', flexDirection: 'column', minWidth: 160, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' },
  ctxBtn: { padding: '8px 12px', background: 'transparent', border: 'none', textAlign: 'left', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', borderRadius: 5 },
  picker: { position: 'absolute', inset: '15% 20%', background: '#191926', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, display: 'flex', flexDirection: 'column', zIndex: 250, boxShadow: '0 12px 40px rgba(0,0,0,0.6)' },
  pickerCrumbs: { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)' },
  crumb: { background: 'transparent', border: 'none', color: '#a5b4fc', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  pickerList: { flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 4 },
  folderBtn: { textAlign: 'left', padding: '8px 10px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.03)', color: '#e2e8f0', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' },
  pickerFoot: { display: 'flex', gap: 8, padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,0.08)' },
  input: { flex: 1, padding: '7px 10px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: '#e2e8f0', fontSize: 12, fontFamily: 'inherit' },
};
