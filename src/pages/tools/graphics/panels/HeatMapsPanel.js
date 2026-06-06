import React, { useState } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../../lib/styleTokens';
import PlayerSearchField from '../PlayerSearchField';
import { HEATMAP_METRIC_OPTIONS } from '../registry/widgets/heatMaps';

// 2H MVP port of Triton's HeatMapsPanel. Drops the FilterEngine (a 1000+
// LOC Reports filter UI we're not porting in this phase) and keeps the
// essentials: 3-tab strip, per-map scope (player/team), heatmap metric,
// color mode, optional caption titles. Card-title input above the tabs.
//
// WidgetPanelProps shape mirrors Triton: filters, onChange, size,
// onSizeChange, sizePresets, onExport, exportDisabled, exporting.

const TEAMS = [
  'AZ','ATL','BAL','BOS','CHC','CWS','CIN','CLE','COL','DET','HOU','KC',
  'LAA','LAD','MIA','MIL','MIN','NYM','NYY','OAK','PHI','PIT','SD','SF',
  'SEA','STL','TB','TEX','TOR','WSH',
];

const CURRENT_YEAR = new Date().getFullYear();
const SEASON_YEARS = (() => {
  const arr = [];
  for (let y = CURRENT_YEAR; y >= CURRENT_YEAR - 7; y--) arr.push(y);
  return arr;
})();

export default function HeatMapsPanel({
  filters,
  onChange,
  size,
  onSizeChange,
  sizePresets,
  onExport,
  exportDisabled,
  exporting,
}) {
  const [activeTab, setActiveTab] = useState(0);
  const maps = (filters && filters.maps) || [];

  function updateMap(i, partial) {
    onChange((prev) => ({
      ...prev,
      maps: prev.maps.map((m, idx) => idx === i ? { ...m, ...partial } : m),
    }));
  }

  function toggleMap(i) {
    const willActivate = !maps[i].active;
    updateMap(i, { active: willActivate });
    if (willActivate) setActiveTab(i);
  }

  const m = maps[activeTab];

  const dateRange = filters.dateRange || { mode: 'season', year: CURRENT_YEAR };

  function setDateRange(next) {
    onChange((prev) => ({ ...prev, dateRange: next }));
  }

  return (
    <div style={styles.container}>
      <div style={styles.section}>
        <div style={styles.fieldLabel}>Card title (optional)</div>
        <input
          type="text"
          value={filters.title || ''}
          placeholder="Auto-generated"
          onChange={(e) => onChange((prev) => ({ ...prev, title: e.target.value }))}
          style={styles.input}
        />
      </div>

      <div style={styles.section}>
        <div style={styles.fieldLabel}>Date range</div>
        <div style={styles.segGrid}>
          {['season', 'custom'].map((m) => {
            const active = dateRange.mode === m;
            return (
              <button
                key={m}
                onClick={() => {
                  if (m === 'season') {
                    setDateRange({ mode: 'season', year: dateRange.mode === 'season' ? dateRange.year : CURRENT_YEAR });
                  } else {
                    setDateRange({ mode: 'custom', start: dateRange.start || '', end: dateRange.end || '' });
                  }
                }}
                style={{ ...styles.segBtn, ...(active ? styles.segBtnActive : {}) }}
              >
                {m === 'season' ? 'Season' : 'Custom'}
              </button>
            );
          })}
        </div>
        {dateRange.mode === 'season' ? (
          <select
            value={dateRange.year}
            onChange={(e) => setDateRange({ mode: 'season', year: Number(e.target.value) })}
            style={{ ...styles.input, marginTop: spacing.sm }}
          >
            {SEASON_YEARS.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.xs, marginTop: spacing.sm }}>
            <input
              type="date"
              value={dateRange.start || ''}
              onChange={(e) => setDateRange({ mode: 'custom', start: e.target.value, end: dateRange.end || '' })}
              style={styles.input}
            />
            <input
              type="date"
              value={dateRange.end || ''}
              onChange={(e) => setDateRange({ mode: 'custom', start: dateRange.start || '', end: e.target.value })}
              style={styles.input}
            />
          </div>
        )}
      </div>

      <div style={styles.tabStrip}>
        {maps.map((cfg, i) => {
          const isSelected = activeTab === i;
          const isOn = cfg.active;
          const tabStyle = !isOn && i > 0
            ? styles.tabOff
            : isSelected ? styles.tabActive : styles.tabOn;
          return (
            <button
              key={i}
              onClick={() => {
                if (i === 0) { setActiveTab(0); return; }
                if (cfg.active) setActiveTab(i);
                else toggleMap(i);
              }}
              style={{ ...styles.tabBtn, ...tabStyle }}
            >
              <span style={styles.tabRow}>
                {!isOn && i > 0 && <span style={styles.tabPlus}>+</span>}
                <span>Map {i + 1}</span>
              </span>
              {isOn && i > 0 && (
                <span
                  role="button"
                  onClick={(e) => { e.stopPropagation(); toggleMap(i); }}
                  style={styles.tabClose}
                  title="Disable this map"
                >×</span>
              )}
            </button>
          );
        })}
      </div>

      <div style={styles.editor}>
        {!m || !m.active ? (
          <div style={styles.dim}>
            Click <strong>+ Map {activeTab + 1}</strong> to enable.
          </div>
        ) : (
          <MapEditor
            map={m}
            onChange={(partial) => updateMap(activeTab, partial)}
          />
        )}
      </div>

      <div style={styles.footer}>
        <div style={styles.fieldLabel}>Size / aspect</div>
        <select
          value={`${size.width}x${size.height}`}
          onChange={(e) => {
            const found = (sizePresets || []).find((p) => `${p.width}x${p.height}` === e.target.value);
            if (found) onSizeChange(found);
          }}
          style={styles.input}
        >
          {(sizePresets || []).map((p) => (
            <option key={`${p.width}x${p.height}`} value={`${p.width}x${p.height}`}>{p.label}</option>
          ))}
        </select>
        <button
          onClick={onExport}
          disabled={exportDisabled}
          style={{ ...styles.exportBtn, ...(exportDisabled ? styles.exportBtnDisabled : {}) }}
        >
          {exporting ? 'Exporting…' : 'Export PNG'}
        </button>
        <div style={styles.note}>
          FilterEngine (Statcast filter catalog) ships in a later pass.
        </div>
      </div>
    </div>
  );
}

function MapEditor({ map, onChange }) {
  const scope = map.scope || { type: 'player', col: 'pitcher', playerId: null, playerName: '' };

  function setScopeType(t) {
    if (t === scope.type) return;
    if (t === 'player') {
      onChange({ scope: { type: 'player', col: 'pitcher', playerId: null, playerName: '' } });
    } else {
      onChange({ scope: { type: 'team', teamCode: '', side: 'pitching' } });
    }
  }

  return (
    <div style={styles.editorBody}>
      <Section label="Scope">
        <Seg
          options={[{ k: 'player', label: 'Player' }, { k: 'team', label: 'Team' }]}
          value={scope.type}
          onPick={(t) => setScopeType(t)}
        />
        {scope.type === 'player' ? (
          <>
            <div style={{ marginTop: spacing.sm }}>
              <Seg
                options={[{ k: 'pitcher', label: 'Pitcher' }, { k: 'batter', label: 'Batter' }]}
                value={scope.col}
                onPick={(col) => onChange({ scope: { ...scope, col, playerId: null, playerName: '' } })}
              />
            </div>
            <div style={{ marginTop: spacing.sm }}>
              <PlayerSearchField
                value={{ playerId: scope.playerId, playerName: scope.playerName }}
                playerType={scope.col || 'pitcher'}
                placeholder={`Search ${scope.col || 'pitcher'}s…`}
                onChange={(v) => onChange({ scope: { ...scope, playerId: v.playerId, playerName: v.playerName } })}
              />
            </div>
          </>
        ) : (
          <>
            <select
              value={scope.teamCode || ''}
              onChange={(e) => onChange({ scope: { ...scope, teamCode: e.target.value } })}
              style={{ ...styles.input, marginTop: spacing.sm }}
            >
              <option value="">Select team…</option>
              {TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <div style={{ marginTop: spacing.sm }}>
              <Seg
                options={[{ k: 'pitching', label: 'Pitching' }, { k: 'hitting', label: 'Hitting' }]}
                value={scope.side || 'pitching'}
                onPick={(side) => onChange({ scope: { ...scope, side } })}
              />
            </div>
          </>
        )}
      </Section>

      <Section label="Heatmap">
        <div style={styles.fieldLabel}>Metric</div>
        <select
          value={map.metric}
          onChange={(e) => onChange({ metric: e.target.value })}
          style={styles.input}
        >
          {(HEATMAP_METRIC_OPTIONS || []).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <div style={{ ...styles.fieldLabel, marginTop: spacing.sm }}>Color mode</div>
        <Seg
          options={[{ k: 'rainbow', label: 'Rainbow' }, { k: 'hotcold', label: 'Hot/Cold' }]}
          value={map.colorMode || 'rainbow'}
          onPick={(v) => onChange({ colorMode: v })}
        />
      </Section>

      <Section label="Caption">
        <div style={styles.fieldLabel}>Title (optional)</div>
        <input
          type="text"
          value={map.customTitle || ''}
          placeholder="Auto"
          onChange={(e) => onChange({ customTitle: e.target.value })}
          style={styles.input}
        />
        <div style={{ ...styles.fieldLabel, marginTop: spacing.sm }}>Subtitle (optional)</div>
        <input
          type="text"
          value={map.customSubtitle || ''}
          placeholder="Auto"
          onChange={(e) => onChange({ customSubtitle: e.target.value })}
          style={styles.input}
        />
      </Section>
    </div>
  );
}

function Section({ label, children }) {
  return (
    <section style={styles.editSection}>
      <div style={styles.sectionTitle}>{label}</div>
      {children}
    </section>
  );
}

function Seg({ options, value, onPick }) {
  return (
    <div style={styles.segGrid}>
      {options.map((o) => {
        const active = o.k === value;
        return (
          <button
            key={o.k}
            onClick={() => onPick(o.k)}
            style={{ ...styles.segBtn, ...(active ? styles.segBtnActive : {}) }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
  },
  section: {
    padding: `${spacing.md}px ${spacing.lg}px`,
    borderBottom: `1px solid ${colors.border}`,
  },
  fieldLabel: {
    fontSize: fontSizes.xxs,
    fontWeight: fontWeights.semibold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textDim,
    marginBottom: spacing.xs,
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
  tabStrip: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: spacing.xs,
    padding: spacing.md,
    borderBottom: `1px solid ${colors.border}`,
  },
  tabBtn: {
    position: 'relative',
    padding: `${spacing.sm}px ${spacing.xs}px`,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
    background: 'transparent',
    border: `1px solid ${colors.border}`,
    borderRadius: radii.sm,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  tabRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  tabPlus: {
    fontSize: 14,
    lineHeight: 1,
  },
  tabActive: {
    color: colors.accentFg,
    background: colors.accentSoft,
    border: `1px solid ${colors.accentBorder}`,
  },
  tabOn: {
    color: colors.textMuted,
  },
  tabOff: {
    color: colors.textPlaceholder,
  },
  tabClose: {
    position: 'absolute',
    top: 2,
    right: 4,
    fontSize: fontSizes.xs,
    color: colors.textDim,
    cursor: 'pointer',
  },
  editor: {
    flex: 1,
    overflowY: 'auto',
    padding: `${spacing.md}px ${spacing.lg}px`,
  },
  editorBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.lg,
  },
  editSection: {},
  sectionTitle: {
    fontSize: fontSizes.xxs,
    fontWeight: fontWeights.semibold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textDim,
    marginBottom: spacing.sm,
  },
  segGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: spacing.xs,
  },
  segBtn: {
    padding: `${spacing.sm}px ${spacing.md}px`,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.medium,
    color: colors.textMuted,
    background: 'transparent',
    border: `1px solid ${colors.border}`,
    borderRadius: radii.sm,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  segBtnActive: {
    color: colors.accentFg,
    background: colors.accentSoft,
    border: `1px solid ${colors.accentBorder}`,
  },
  dim: {
    fontSize: fontSizes.sm,
    color: colors.textPlaceholder,
    textAlign: 'center',
    padding: spacing.xl,
  },
  footer: {
    padding: spacing.lg,
    borderTop: `1px solid ${colors.border}`,
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.sm,
  },
  exportBtn: {
    padding: `${spacing.sm}px ${spacing.lg}px`,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text,
    background: colors.accent,
    border: 'none',
    borderRadius: radii.sm,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  exportBtnDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
  note: {
    fontSize: fontSizes.xxs,
    color: colors.textPlaceholder,
  },
};
