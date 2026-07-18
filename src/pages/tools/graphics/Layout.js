import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights, fontFamily } from '../../../lib/styleTokens';
import { supabase } from '../../../supabaseClient';
import WidgetList from './WidgetList';
import HistoryPane from './HistoryPane';
import FilterBar from './FilterBar';
import PreviewPane from './PreviewPane';
import { IMAGINE_WIDGETS } from './registry/registry';
import { renderSceneToBlob } from '../../../lib/imagineRenderer';

// Categories are inferred from widget id so WidgetList can group. Widgets
// themselves don't carry a category in the Triton schema.
const CATEGORY_BY_ID = {
  'top-5-leaderboard':   'Comparisons',
  'player-stats':        'Players',
  'team-stats':          'Teams',
  'heat-maps':           'Charts',
  'heat-map-overlays':   'Charts',
};

const DEFAULT_SIZE = { width: 1080, height: 1080, label: '1:1 Square' };
function slugify(s) {
  return (s || 'graphics')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'graphics';
}

// Try the File System Access API first (Chromium); fall back to a
// classic anchor-click download in browsers without it (Safari/Firefox)
// or when the user denies the prompt.
async function savePngToDisk(blob, filename) {
  if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'PNG image', accept: { 'image/png': ['.png'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return; // user dismissed
      // any other failure: fall through to anchor download
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Downscale the full-res blob into a small thumbnail data URL that the
// imagine-history edge fn will upload to the imagine-thumbnails bucket.
async function makeThumbnailDataUrl(blob, maxDim) {
  const objUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('thumbnail image load failed'));
      i.src = objUrl;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}

const DEFAULT_SIZE_PRESETS = [
  { width: 1080, height: 1080, label: '1:1 Square' },
  { width: 1080, height: 1920, label: '9:16 Story' },
  { width: 1920, height: 1080, label: '16:9 Landscape' },
  { width: 1200, height: 630,  label: '1200x630 OG' },
];

// Fallback demo scene for widgets that don't have fetchData/buildScene.
function buildDemoScene(widgetId, width, height) {
  const pitchData = [
    { label: 'FF',  value: 42, color: '#ef4444' },
    { label: 'SL',  value: 22, color: '#0ea5e9' },
    { label: 'CH',  value: 18, color: '#10b981' },
    { label: 'CU',  value: 12, color: '#a855f7' },
    { label: 'SI',  value:  6, color: '#f97316' },
  ];
  const nb = 16;
  const gridZ = [];
  for (let r = 0; r < nb; r++) {
    const row = [];
    for (let c = 0; c < nb; c++) {
      const cx = (c - 7.5) / 7.5;
      const cy = (r - 7.5) / 7.5;
      const d = Math.sqrt(cx * cx + cy * cy);
      const v = Math.max(0, 1 - d * 0.75) + (Math.sin(r * 1.3) * Math.cos(c * 0.9)) * 0.05;
      row.push(Math.max(0, Math.min(1, v)));
    }
    gridZ.push(row);
  }
  return {
    id: 'demo',
    name: `${widgetId} demo`,
    width,
    height,
    background: '#0e1420',
    elements: [
      {
        id: 'card-bg', type: 'shape', x: 24, y: 24,
        width: width - 48, height: height - 48, zIndex: 1,
        props: { bgColor: '#1b2331', bgOpacity: 1, borderRadius: 24, borderWidth: 1, borderColor: '#5b8fc7' },
      },
      {
        id: 'title', type: 'text', x: 48, y: height * 0.05,
        width: width - 96, height: height * 0.12, zIndex: 2,
        props: { text: widgetId, fontSize: Math.round(height * 0.08), fontWeight: 700, color: '#ffffff', textAlign: 'center', lineHeight: 1.1, textTransform: 'uppercase' },
      },
      {
        id: 'subtitle', type: 'text', x: 48, y: height * 0.18,
        width: width - 96, height: height * 0.05, zIndex: 3,
        props: { text: `${width} \u00d7 ${height} \u00b7 demo scene`, fontSize: Math.round(height * 0.028), fontWeight: 400, color: 'rgba(255,255,255,0.55)', textAlign: 'center' },
      },
      {
        id: 'heatmap', type: 'rc-heatmap', x: 48, y: height * 0.26,
        width: (width - 96) / 2 - 12, height: height * 0.42, zIndex: 4,
        props: { title: 'Whiff Rate', metric: 'whiff_pct', gridZ, colorMode: 'rainbow', showZone: true, showLegend: true, bgColor: '#0f0f12', borderRadius: 14 },
      },
      {
        id: 'donut', type: 'rc-donut-chart', x: width / 2 + 12, y: height * 0.26,
        width: (width - 96) / 2 - 12, height: height * 0.42, zIndex: 4,
        props: { title: 'Pitch Mix', usageData: pitchData, innerRadius: 0.55, fontSize: Math.round(height * 0.018), bgColor: 'rgba(255,255,255,0.04)', borderRadius: 14 },
      },
      {
        id: 'statline', type: 'rc-statline', x: 48, y: height * 0.74,
        width: width - 96, height: height * 0.12, zIndex: 5,
        props: { title: 'Last Outing', statline: { ip: '6.1', h: 4, r: 2, k: 8, bb: 1, decision: 'W', era: '2.41' }, fontSize: Math.round(height * 0.035), color: '#ffffff', bgColor: 'rgba(91, 143, 199,0.10)', borderRadius: 12 },
      },
    ],
  };
}

export default function Layout({ onBack }) {
  const widgets = useMemo(
    () => IMAGINE_WIDGETS.map((w) => ({
      ...w,
      category: CATEGORY_BY_ID[w.id] || 'Other',
    })),
    [],
  );
  const [selectedWidgetId, setSelectedWidgetId] = useState(null);
  const [filters, setFilters] = useState({});
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [history, setHistory] = useState([]);
  const [historyError, setHistoryError] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  // Hold a ref to the underlying blob too. The blob URL passed to <img>
  // can be revoked when the debounced render swaps it; handleExport needs
  // the raw bytes regardless.
  const previewBlobRef = useRef(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [exporting, setExporting] = useState(false);

  const selectedWidget = widgets.find((w) => w.id === selectedWidgetId) || null;

  function pickWidget(widget) {
    setSelectedWidgetId(widget.id);
    setFilters(widget.defaultFilters || {});
    if (widget.defaultSize) setSize(widget.defaultSize);
  }

  const refreshHistory = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke('imagine-history', {
      method: 'GET',
    });
    if (error) {
      setHistoryError(error.message || 'Failed to load history');
      return;
    }
    setHistoryError(null);
    setHistory(Array.isArray(data?.rows) ? data.rows : []);
  }, []);

  useEffect(() => { refreshHistory(); }, [refreshHistory]);

  // Debounced render: 300ms after filters/size/widget settle, render
  // client-side via canvas and swap the preview blob. Revokes the previous
  // blob URL to avoid leaks.
  useEffect(() => {
    if (!selectedWidget) {
      setPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        // All 5 widgets now fetch through Mayday's same-origin /api proxies
        // (tritonProxy.js). Browser never talks to Triton directly — keeps
        // the Triton anon JWT out of the data path and lets us enforce
        // Mayday auth on every read.
        const widgetOrigin = window.location.origin;
        let scene = null;
        if (typeof selectedWidget.fetchData === 'function'
          && typeof selectedWidget.buildScene === 'function') {
          let data;
          try {
            data = await selectedWidget.fetchData(filters, widgetOrigin);
          } catch (err) {
            throw new Error(`Widget data fetch failed: ${err.message || err}`);
          }
          if (cancelled) return;
          try {
            scene = selectedWidget.buildScene(filters, data, size);
          } catch (err) {
            throw new Error(`Widget buildScene failed: ${err.message || err}`);
          }
        }
        if (!scene) scene = buildDemoScene(selectedWidget.id, size.width, size.height);
        const blob = await renderSceneToBlob(scene);
        const blobUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(blobUrl);
          return;
        }
        previewBlobRef.current = blob;
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return blobUrl;
        });
      } catch (err) {
        if (!cancelled) {
          setPreviewError(err.message || String(err));
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [selectedWidget, filters, size]);

  // ── Export flow (2I) ─────────────────────────────────────────────
  // 1. Pull the full-res PNG out of the current previewUrl blob.
  // 2. Save to disk via showSaveFilePicker (Chromium) or anchor-download.
  // 3. Downscale to a ~400-px thumbnail data URL.
  // 4. POST { widget_id, title, filters, size, thumbnail_data_url } to
  //    imagine-history; refresh the history list on success.
  async function handleExport() {
    if (!selectedWidget || !previewBlobRef.current || previewLoading || exporting) return;
    setExporting(true);
    setPreviewError(null);
    try {
      const title = (typeof selectedWidget.autoTitle === 'function'
        ? selectedWidget.autoTitle(filters) : null) || selectedWidget.name;
      const stem = (typeof selectedWidget.autoFilename === 'function'
        ? selectedWidget.autoFilename(filters) : null) || slugify(title);

      // Read directly from the cached blob — previewUrl may have been
      // revoked by a debounced re-render between trigger and click.
      const blob = previewBlobRef.current;
      await savePngToDisk(blob, `${stem}.png`);
      const thumbDataUrl = await makeThumbnailDataUrl(blob, 400);

      const { error } = await supabase.functions.invoke('imagine-history', {
        method: 'POST',
        body: {
          widget_id: selectedWidget.id,
          title,
          filters,
          size,
          thumbnail_data_url: thumbDataUrl,
        },
      });
      if (error) throw new Error(error.message || 'History save failed');
      await refreshHistory();
    } catch (err) {
      setPreviewError(err.message || String(err));
    } finally {
      setExporting(false);
    }
  }

  async function deleteHistoryRow(row) {
    setHistory((h) => h.filter((r) => r.id !== row.id));  // optimistic
    const { error } = await supabase.functions.invoke('imagine-history', {
      method: 'DELETE',
      body: { id: row.id },
    });
    if (error) {
      setHistoryError(error.message || 'Failed to delete history row');
      refreshHistory();  // re-sync
    }
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <button onClick={onBack} style={styles.backBtn} title="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <span style={styles.headerTitle}>Graphics</span>
        <span style={styles.headerBadge}>Graphics</span>
      </header>

      <div style={styles.body}>
        <aside style={styles.leftRail}>
          <WidgetList
            widgets={widgets}
            selectedId={selectedWidgetId}
            onPick={pickWidget}
          />
          <HistoryPane
            history={history}
            error={historyError}
            onRestore={(row) => {
              setSelectedWidgetId(row.widget_id);
              setFilters(row.filters || {});
              setSize(row.size || DEFAULT_SIZE);
            }}
            onDelete={deleteHistoryRow}
          />
        </aside>

        <main style={styles.center}>
          <PreviewPane
            widget={selectedWidget}
            filters={filters}
            size={size}
            onSizeChange={setSize}
            previewUrl={previewUrl}
            previewLoading={previewLoading}
            previewError={previewError}
          />
        </main>

        <aside style={styles.rightRail}>
          <FilterBar
            widget={selectedWidget}
            filters={filters}
            onFiltersChange={setFilters}
            size={size}
            onSizeChange={setSize}
            sizePresets={(selectedWidget && selectedWidget.sizePresets) || DEFAULT_SIZE_PRESETS}
            onExport={handleExport}
            exportDisabled={!previewUrl || previewLoading || exporting}
            exporting={exporting}
          />
        </aside>
      </div>
    </div>
  );
}

const styles = {
  container: {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: colors.bg,
    color: colors.text,
    fontFamily,
  },
  header: {
    height: 52,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
    padding: `0 ${spacing.lg}px`,
    borderBottom: `1px solid ${colors.border}`,
    background: colors.bgRaised,
  },
  backBtn: {
    width: 32,
    height: 32,
    border: 'none',
    background: 'transparent',
    color: colors.textMuted,
    cursor: 'pointer',
    borderRadius: radii.sm,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.semibold,
    color: colors.text,
  },
  headerBadge: {
    marginLeft: 'auto',
    padding: `${spacing.xs}px ${spacing.md}px`,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.accentFg,
    background: colors.accentSoft,
    border: `1px solid ${colors.accentBorder}`,
    borderRadius: radii.pill,
  },
  body: {
    flex: 1,
    display: 'grid',
    gridTemplateColumns: '260px 1fr 320px',
    minHeight: 0,
  },
  leftRail: {
    display: 'flex',
    flexDirection: 'column',
    borderRight: `1px solid ${colors.border}`,
    background: colors.bgRaised,
    minHeight: 0,
  },
  center: {
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    background: colors.bg,
  },
  rightRail: {
    borderLeft: `1px solid ${colors.border}`,
    background: colors.bgRaised,
    overflowY: 'auto',
  },
};
