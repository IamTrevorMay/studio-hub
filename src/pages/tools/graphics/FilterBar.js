import React from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';
import { getPanelFor } from './registry/panelRegistry';
import PlayerSearchField from './PlayerSearchField';

// Schema-driven FilterBar. Each widget's filterSchema is a list of
// controls grouped by column (1..4). Controls within a column stack
// top-to-bottom in declaration order. `visibleWhen` lets a control
// disappear based on sibling filter values.
//
// If a widget defines a custom right-panel renderer (renderPanel), we'd
// use that instead — but the per-widget panel components are stubbed
// until step 2H, so we fall through to schema-driven for heat-maps too.
// The fallback renders the schema controls that DO exist (the heat-map
// widgets have minimal schemas; their richness lives in the panel
// component we'll port in 2H).

export default function FilterBar({
  widget,
  filters,
  onFiltersChange,
  size,
  onSizeChange,
  sizePresets,
  onExport,
  exportDisabled,
  exporting,
}) {
  if (!widget) {
    return (
      <div style={styles.container}>
        <div style={styles.empty}>Pick a widget to see its filters.</div>
      </div>
    );
  }

  const Panel = getPanelFor(widget.id);
  if (Panel) {
    return (
      <Panel
        filters={filters}
        onChange={onFiltersChange}
        size={size}
        onSizeChange={onSizeChange}
        sizePresets={sizePresets || widget.sizePresets || []}
        onExport={onExport || (() => {})}
        exportDisabled={exportDisabled}
        exporting={!!exporting}
      />
    );
  }

  const schema = widget.filterSchema || [];
  const visible = schema.filter((c) => (c.visibleWhen ? c.visibleWhen(filters) : true));

  function setKey(key, value) {
    const next = { ...filters, [key]: value };
    const final = widget.normalizeFilters ? widget.normalizeFilters(next, filters) : next;
    onFiltersChange(final);
  }

  return (
    <div style={styles.container}>
      <div style={styles.headerRow}>
        <div>
          <div style={styles.label}>Filters</div>
          <div style={styles.widgetTitle}>{widget.name}</div>
        </div>
      </div>
      {widget.description && (
        <div style={styles.widgetDesc}>{widget.description}</div>
      )}

      <div style={styles.controls}>
        {visible.length === 0 ? (
          <div style={styles.placeholder}>
            This widget uses a custom panel that lands in step 2H.
          </div>
        ) : (
          visible.map((control) => (
            <ControlField
              key={control.key}
              control={control}
              value={filters[control.key]}
              filters={filters}
              onChange={(v) => setKey(control.key, v)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ControlField({ control, value, filters, onChange }) {
  return (
    <div style={styles.field}>
      <label style={styles.fieldLabel}>{control.label}</label>
      <Control control={control} value={value} filters={filters} onChange={onChange} />
    </div>
  );
}

function Control({ control, value, filters, onChange }) {
  switch (control.type) {
    case 'segmented':
      return <Segmented options={control.options} value={value} onChange={onChange} />;
    case 'select':
      return <Select options={control.options} value={value} placeholder={control.placeholder} onChange={onChange} />;
    case 'number':
      return (
        <input
          type="number"
          value={value ?? ''}
          min={control.min}
          max={control.max}
          step={control.step ?? 1}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          style={styles.input}
        />
      );
    case 'text': {
      const ph = control.dynamicPlaceholder
        ? control.dynamicPlaceholder(filters) || control.placeholder || ''
        : control.placeholder || '';
      return (
        <input
          type="text"
          value={value ?? ''}
          placeholder={ph}
          onChange={(e) => onChange(e.target.value)}
          style={styles.input}
        />
      );
    }
    case 'toggle-select':
      return <ToggleSelect options={control.options} value={value} onChange={onChange} />;
    case 'date-range-season-or-custom':
      return (
        <DateRangePlaceholder
          years={control.years}
          value={value}
          onChange={onChange}
        />
      );
    case 'player-search': {
      const playerType = control.playerTypeKey
        ? (filters[control.playerTypeKey] || 'all')
        : 'all';
      return (
        <PlayerSearchField
          value={value || { playerId: null, playerName: '' }}
          playerType={playerType}
          placeholder={control.placeholder}
          onChange={onChange}
        />
      );
    }
    default:
      return <div style={styles.unsupported}>Unsupported control: {control.type}</div>;
  }
}

function Segmented({ options, value, onChange }) {
  return (
    <div style={styles.segmented}>
      {(options || []).map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{ ...styles.segBtn, ...(active ? styles.segBtnActive : {}) }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function Select({ options, value, placeholder, onChange }) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
      style={styles.input}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {(options || []).map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function ToggleSelect({ options, value, onChange }) {
  const arr = Array.isArray(value) ? value : [];
  function toggle(v) {
    onChange(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  }
  return (
    <div style={styles.segmented}>
      {(options || []).map((opt) => {
        const active = arr.includes(opt.value);
        return (
          <button
            key={opt.value}
            onClick={() => toggle(opt.value)}
            style={{ ...styles.segBtn, ...(active ? styles.segBtnActive : {}) }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function DateRangePlaceholder({ years, value, onChange }) {
  const mode = value?.mode || 'season';
  return (
    <div>
      <div style={styles.segmented}>
        {['season', 'custom'].map((m) => (
          <button
            key={m}
            onClick={() => onChange({ ...(value || {}), mode: m })}
            style={{ ...styles.segBtn, ...(mode === m ? styles.segBtnActive : {}) }}
          >
            {m === 'season' ? 'Season' : 'Custom'}
          </button>
        ))}
      </div>
      {mode === 'season' ? (
        <select
          value={value?.year ?? ''}
          onChange={(e) => onChange({ ...(value || {}), mode: 'season', year: Number(e.target.value) })}
          style={{ ...styles.input, marginTop: spacing.xs }}
        >
          <option value="">Select season</option>
          {(years || []).map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.xs, marginTop: spacing.xs }}>
          <input
            type="date"
            value={value?.start || ''}
            onChange={(e) => onChange({ ...(value || {}), mode: 'custom', start: e.target.value })}
            style={styles.input}
          />
          <input
            type="date"
            value={value?.end || ''}
            onChange={(e) => onChange({ ...(value || {}), mode: 'custom', end: e.target.value })}
            style={styles.input}
          />
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    padding: `${spacing.md}px ${spacing.lg}px`,
  },
  empty: {
    padding: spacing.md,
    fontSize: fontSizes.sm,
    color: colors.textPlaceholder,
  },
  headerRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textDim,
  },
  widgetTitle: {
    marginTop: spacing.xs,
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.semibold,
    color: colors.text,
  },
  widgetDesc: {
    marginTop: spacing.xs,
    fontSize: fontSizes.sm,
    color: colors.textMuted,
    lineHeight: 1.5,
  },
  controls: {
    marginTop: spacing.lg,
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.md,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.xs,
  },
  fieldLabel: {
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.medium,
    color: colors.textMuted,
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
  segmented: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  segBtn: {
    padding: `${spacing.xs}px ${spacing.md}px`,
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
  placeholder: {
    padding: spacing.md,
    fontSize: fontSizes.sm,
    color: colors.textMuted,
    background: colors.bgInput,
    border: `1px dashed ${colors.borderStrong}`,
    borderRadius: radii.md,
  },
  unsupported: {
    padding: spacing.sm,
    fontSize: fontSizes.xs,
    color: colors.textPlaceholder,
    background: colors.bgInput,
    border: `1px dashed ${colors.border}`,
    borderRadius: radii.sm,
  },
};
