import React, { useState } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../../lib/styleTokens';
import PlayerSearchField from '../PlayerSearchField';
import { HEATMAP_OVERLAY_METRIC_OPTIONS } from '../registry/widgets/heatMapOverlays';

// 2H MVP port of Triton's HeatMapOverlaysPanel. Drops FilterEngine and
// keeps: 3-tab strip, two players (A and B) per overlay each with their
// own role + metric, color mode, optional caption titles. Card-title
// input above the tabs.

export default function HeatMapOverlaysPanel({
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
  const overlays = (filters && filters.overlays) || [];

  function updateOverlay(i, partial) {
    onChange((prev) => ({
      ...prev,
      overlays: prev.overlays.map((o, idx) => idx === i ? { ...o, ...partial } : o),
    }));
  }

  function toggleOverlay(i) {
    const willActivate = !overlays[i].active;
    updateOverlay(i, { active: willActivate });
    if (willActivate) setActiveTab(i);
  }

  const o = overlays[activeTab];

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

      <div style={styles.tabStrip}>
        {overlays.map((cfg, i) => {
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
                else toggleOverlay(i);
              }}
              style={{ ...styles.tabBtn, ...tabStyle }}
            >
              <span style={styles.tabRow}>
                {!isOn && i > 0 && <span style={styles.tabPlus}>+</span>}
                <span>Overlay {i + 1}</span>
              </span>
              {isOn && i > 0 && (
                <span
                  role="button"
                  onClick={(e) => { e.stopPropagation(); toggleOverlay(i); }}
                  style={styles.tabClose}
                  title="Disable this overlay"
                >×</span>
              )}
            </button>
          );
        })}
      </div>

      <div style={styles.editor}>
        {!o || !o.active ? (
          <div style={styles.dim}>
            Click <strong>+ Overlay {activeTab + 1}</strong> to enable.
          </div>
        ) : (
          <OverlayEditor
            overlay={o}
            onChange={(partial) => updateOverlay(activeTab, partial)}
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

function OverlayEditor({ overlay, onChange }) {
  const a = overlay.sideA || { role: 'pitcher', metric: 'whiff_pct', playerId: null, playerName: '' };
  const b = overlay.sideB || { role: 'hitter', metric: 'ba', playerId: null, playerName: '' };

  function setA(partial) { onChange({ sideA: { ...a, ...partial } }); }
  function setB(partial) { onChange({ sideB: { ...b, ...partial } }); }

  return (
    <div style={styles.editorBody}>
      <PlayerSection label="Player A" who={a} onChange={setA} />
      <PlayerSection label="Player B" who={b} onChange={setB} />

      <Section label="Color">
        <Seg
          options={[{ k: 'rainbow', label: 'Rainbow' }, { k: 'hotcold', label: 'Hot/Cold' }]}
          value={overlay.colorMode || 'rainbow'}
          onPick={(v) => onChange({ colorMode: v })}
        />
      </Section>

      <Section label="Caption">
        <div style={styles.fieldLabel}>Title (optional)</div>
        <input
          type="text"
          value={overlay.customTitle || ''}
          placeholder="Auto"
          onChange={(e) => onChange({ customTitle: e.target.value })}
          style={styles.input}
        />
        <div style={{ ...styles.fieldLabel, marginTop: spacing.sm }}>Subtitle (optional)</div>
        <input
          type="text"
          value={overlay.customSubtitle || ''}
          placeholder="Auto"
          onChange={(e) => onChange({ customSubtitle: e.target.value })}
          style={styles.input}
        />
      </Section>
    </div>
  );
}

function PlayerSection({ label, who, onChange }) {
  return (
    <Section label={label}>
      <Seg
        options={[{ k: 'pitcher', label: 'Pitcher' }, { k: 'hitter', label: 'Hitter' }]}
        value={who.role || 'pitcher'}
        onPick={(role) => onChange({ role, playerId: null, playerName: '' })}
      />
      <div style={{ marginTop: spacing.sm }}>
        <PlayerSearchField
          value={{ playerId: who.playerId, playerName: who.playerName }}
          playerType={who.role === 'hitter' ? 'batter' : 'pitcher'}
          placeholder={`Search ${who.role || 'pitcher'}s…`}
          onChange={(v) => onChange({ playerId: v.playerId, playerName: v.playerName })}
        />
      </div>
      <div style={{ ...styles.fieldLabel, marginTop: spacing.sm }}>Metric</div>
      <select
        value={who.metric || 'whiff_pct'}
        onChange={(e) => onChange({ metric: e.target.value })}
        style={styles.input}
      >
        {(HEATMAP_OVERLAY_METRIC_OPTIONS || []).map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </Section>
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
  container: { display: 'flex', flexDirection: 'column', height: '100%' },
  section: { padding: `${spacing.md}px ${spacing.lg}px`, borderBottom: `1px solid ${colors.border}` },
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
  tabRow: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  tabPlus: { fontSize: 14, lineHeight: 1 },
  tabActive: {
    color: colors.accentFg,
    background: colors.accentSoft,
    border: `1px solid ${colors.accentBorder}`,
  },
  tabOn: { color: colors.textMuted },
  tabOff: { color: colors.textPlaceholder },
  tabClose: {
    position: 'absolute',
    top: 2,
    right: 4,
    fontSize: fontSizes.xs,
    color: colors.textDim,
    cursor: 'pointer',
  },
  editor: { flex: 1, overflowY: 'auto', padding: `${spacing.md}px ${spacing.lg}px` },
  editorBody: { display: 'flex', flexDirection: 'column', gap: spacing.lg },
  editSection: {},
  sectionTitle: {
    fontSize: fontSizes.xxs,
    fontWeight: fontWeights.semibold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textDim,
    marginBottom: spacing.sm,
  },
  segGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.xs },
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
  dim: { fontSize: fontSizes.sm, color: colors.textPlaceholder, textAlign: 'center', padding: spacing.xl },
  footer: { padding: spacing.lg, borderTop: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column', gap: spacing.sm },
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
  exportBtnDisabled: { opacity: 0.4, cursor: 'not-allowed' },
  note: { fontSize: fontSizes.xxs, color: colors.textPlaceholder },
};
