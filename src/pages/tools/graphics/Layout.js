import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights, fontFamily } from '../../../lib/styleTokens';
import { supabase } from '../../../supabaseClient';
import WidgetList from './WidgetList';
import HistoryPane from './HistoryPane';
import FilterBar from './FilterBar';
import PreviewPane from './PreviewPane';
import { IMAGINE_WIDGETS } from './registry/registry';

// Categories are inferred from widget id so WidgetList can group. Widgets
// themselves don't carry a category in the Triton schema.
const CATEGORY_BY_ID = {
  topFiveLeaderboard:    'Comparisons',
  playerStats:           'Players',
  teamStats:             'Teams',
  'heat-maps':           'Charts',
  'heat-map-overlays':   'Charts',
};

const DEFAULT_SIZE = { width: 1080, height: 1080, label: '1:1 Square' };
const DEFAULT_SIZE_PRESETS = [
  { width: 1080, height: 1080, label: '1:1 Square' },
  { width: 1080, height: 1920, label: '9:16 Story' },
  { width: 1920, height: 1080, label: '16:9 Landscape' },
  { width: 1200, height: 630,  label: '1200x630 OG' },
];

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
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [previewIsStub, setPreviewIsStub] = useState(false);

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

  // Debounced render: 300ms after filters/size/widget settle, POST to
  // imagine-render and swap the preview blob. Revokes the previous blob URL
  // to avoid leaks. The fetch is gated on a per-effect token so a stale
  // response from a slow render doesn't clobber a newer one.
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
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Not authenticated');

        // 2F.6: run the widget's fetchData + buildScene in the browser so
        // the Vercel renderer fn stays a pure Scene → PNG translator.
        // Widget fetchData targets Triton's Next routes (scene-stats /
        // league-baseline / heatmap-data) — those are the system of record
        // for player stats; we proxy at the data layer rather than copy
        // the schemas. The renderer fn ignores widget_id when a `scene`
        // is present in the body and just renders it.
        const tritonOrigin = process.env.REACT_APP_TRITON_ORIGIN
          || 'https://www.tritonapex.io';
        let scene = null;
        if (typeof selectedWidget.fetchData === 'function'
          && typeof selectedWidget.buildScene === 'function') {
          let data;
          try {
            data = await selectedWidget.fetchData(filters, tritonOrigin);
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
        // If buildScene didn't run (widget shape doesn't match), the renderer
        // will fall back to its built-in demo scene so the UI still shows
        // something.
        const res = await fetch('/api/imagine-render', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            widget_id: selectedWidget.id,
            filters,
            size,
            scene,
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Render ${res.status}: ${text.slice(0, 300)}`);
        }
        const renderer = res.headers.get('x-imagine-renderer') || '';
        const isStub = renderer.includes('spike') || res.headers.get('x-imagine-stub') === '1';
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(blobUrl);
          return;
        }
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return blobUrl;
        });
        setPreviewIsStub(isStub);
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

  async function deleteHistoryRow(row) {
    setHistory((h) => h.filter((r) => r.id !== row.id));  // optimistic
    const { error } = await supabase.functions.invoke(
      `imagine-history?id=${encodeURIComponent(row.id)}`,
      { method: 'DELETE' },
    );
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
        <span style={styles.headerBadge}>Phase 2H — player search + heatmap panels</span>
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
            previewIsStub={previewIsStub}
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
            onExport={() => {
              // 2I wires this to imagine-history POST + thumbnail upload +
              // showSaveFilePicker. Stub today.
              window.alert('Export — lands in step 2I.');
            }}
            exportDisabled={!previewUrl || previewLoading}
            exporting={false}
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
