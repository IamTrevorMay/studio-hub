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
        <span style={styles.headerBadge}>Phase 2D — history wired</span>
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
          />
        </main>

        <aside style={styles.rightRail}>
          <FilterBar
            widget={selectedWidget}
            filters={filters}
            onFiltersChange={setFilters}
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
