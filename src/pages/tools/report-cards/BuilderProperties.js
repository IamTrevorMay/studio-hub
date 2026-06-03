import React from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';

// Right rail. Edits the selected element's geometry (x/y/w/h/zIndex/opacity/
// rotation) plus a free-form props JSON editor. Per-type pretty forms are a
// later pass — for MVP the JSON editor lets the user tweak anything the
// renderer reads, and the geometry inputs handle the common case.

export default function BuilderProperties({ element, scene, onUpdate, onDelete, onUpdateScene }) {
  if (!element) {
    return (
      <div style={styles.wrap}>
        <div style={styles.sectionLabel}>Scene</div>
        <NumberField label="Width" value={scene.width}
          onChange={(v) => onUpdateScene({ width: Math.max(64, Math.round(v)) })} />
        <NumberField label="Height" value={scene.height}
          onChange={(v) => onUpdateScene({ height: Math.max(64, Math.round(v)) })} />
        <TextField label="Background" value={scene.background || '#09090b'}
          onChange={(v) => onUpdateScene({ background: v })} />
        <div style={styles.empty}>Click an element to edit its properties.</div>
      </div>
    );
  }

  function setGeo(partial) { onUpdate(element.id, partial); }
  function setProps(partial) {
    onUpdate(element.id, { props: { ...(element.props || {}), ...partial } });
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.headerRow}>
        <div style={styles.elTitle}>
          <span style={styles.typeBadge}>{element.type}</span>
          <span style={styles.elId}>{element.id}</span>
        </div>
        <button onClick={() => onDelete(element.id)} style={styles.deleteBtn} title="Delete element">
          ×
        </button>
      </div>

      <div style={styles.sectionLabel}>Position</div>
      <div style={styles.grid2}>
        <NumberField label="X" value={element.x}
          onChange={(v) => setGeo({ x: Math.round(v) })} />
        <NumberField label="Y" value={element.y}
          onChange={(v) => setGeo({ y: Math.round(v) })} />
        <NumberField label="W" value={element.width}
          onChange={(v) => setGeo({ width: Math.max(20, Math.round(v)) })} />
        <NumberField label="H" value={element.height}
          onChange={(v) => setGeo({ height: Math.max(20, Math.round(v)) })} />
      </div>

      <div style={styles.sectionLabel}>Layer</div>
      <div style={styles.grid2}>
        <NumberField label="zIndex" value={element.zIndex || 0}
          onChange={(v) => setGeo({ zIndex: Math.round(v) })} />
        <NumberField label="Opacity" value={element.opacity != null ? element.opacity : 1} step={0.05} min={0} max={1}
          onChange={(v) => setGeo({ opacity: Math.max(0, Math.min(1, v)) })} />
        <NumberField label="Rotation" value={element.rotation || 0}
          onChange={(v) => setGeo({ rotation: Math.round(v) })} />
      </div>

      <PerTypeFields element={element} setProps={setProps} />

      <div style={styles.sectionLabel}>Raw props</div>
      <JsonEditor
        value={element.props || {}}
        onChange={(obj) => onUpdate(element.id, { props: obj })}
      />
    </div>
  );
}

function PerTypeFields({ element, setProps }) {
  const p = element.props || {};
  switch (element.type) {
    case 'text':
      return (
        <>
          <div style={styles.sectionLabel}>Text</div>
          <TextArea label="Content" value={p.text || ''}
            onChange={(v) => setProps({ text: v })} />
          <div style={styles.grid2}>
            <NumberField label="Font size" value={p.fontSize || 16}
              onChange={(v) => setProps({ fontSize: Math.round(v) })} />
            <NumberField label="Weight" value={p.fontWeight || 400} step={100} min={100} max={900}
              onChange={(v) => setProps({ fontWeight: Math.round(v) })} />
          </div>
          <TextField label="Color" value={p.color || '#ffffff'}
            onChange={(v) => setProps({ color: v })} />
          <TextField label="Align (left/center/right)" value={p.textAlign || 'left'}
            onChange={(v) => setProps({ textAlign: v })} />
        </>
      );
    case 'shape':
      return (
        <>
          <div style={styles.sectionLabel}>Shape</div>
          <TextField label="Background" value={p.bgColor || ''}
            onChange={(v) => setProps({ bgColor: v })} />
          <NumberField label="Border radius" value={p.borderRadius || 0}
            onChange={(v) => setProps({ borderRadius: Math.round(v) })} />
          <NumberField label="Border width" value={p.borderWidth || 0}
            onChange={(v) => setProps({ borderWidth: Math.round(v) })} />
          <TextField label="Border color" value={p.borderColor || ''}
            onChange={(v) => setProps({ borderColor: v })} />
        </>
      );
    case 'rc-stat-box':
      return (
        <>
          <div style={styles.sectionLabel}>Stat box</div>
          <TextField label="Label" value={p.label || ''}
            onChange={(v) => setProps({ label: v })} />
          <TextField label="Value" value={String(p.value != null ? p.value : '')}
            onChange={(v) => setProps({ value: v })} />
          <TextField label="Color" value={p.color || ''}
            onChange={(v) => setProps({ color: v })} />
          <NumberField label="Font size" value={p.fontSize || 44}
            onChange={(v) => setProps({ fontSize: Math.round(v) })} />
        </>
      );
    default:
      return null;
  }
}

function NumberField({ label, value, onChange, step, min, max }) {
  return (
    <label style={styles.field}>
      <span style={styles.fieldLabel}>{label}</span>
      <input
        type="number"
        value={value}
        step={step || 1}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        style={styles.input}
      />
    </label>
  );
}

function TextField({ label, value, onChange }) {
  return (
    <label style={styles.field}>
      <span style={styles.fieldLabel}>{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={styles.input}
      />
    </label>
  );
}

function TextArea({ label, value, onChange }) {
  return (
    <label style={styles.field}>
      <span style={styles.fieldLabel}>{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...styles.input, minHeight: 60, fontFamily: 'inherit' }}
      />
    </label>
  );
}

function JsonEditor({ value, onChange }) {
  const [text, setText] = React.useState(() => JSON.stringify(value, null, 2));
  const [err, setErr] = React.useState(null);
  React.useEffect(() => {
    setText(JSON.stringify(value, null, 2));
    setErr(null);
  }, [value]);
  function commit() {
    try {
      const parsed = JSON.parse(text);
      setErr(null);
      onChange(parsed);
    } catch (e) {
      setErr(e.message);
    }
  }
  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        style={{
          ...styles.input,
          minHeight: 160,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: fontSizes.xs,
        }}
      />
      {err && <div style={styles.err}>JSON parse error: {err}</div>}
    </div>
  );
}

const styles = {
  wrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.md,
    padding: `${spacing.md}px ${spacing.lg}px`,
    overflowY: 'auto',
    height: '100%',
    boxSizing: 'border-box',
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  elTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    minWidth: 0,
  },
  typeBadge: {
    padding: '2px 8px',
    fontSize: fontSizes.xxs,
    fontWeight: fontWeights.semibold,
    color: colors.accentFg,
    background: colors.accentSoft,
    border: `1px solid ${colors.accentBorder}`,
    borderRadius: radii.sm,
  },
  elId: {
    fontSize: fontSizes.xxs,
    color: colors.textDim,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  deleteBtn: {
    width: 28,
    height: 28,
    border: `1px solid ${colors.danger?.border || 'rgba(239,68,68,0.35)'}`,
    background: 'transparent',
    color: colors.danger?.fg || '#ef4444',
    borderRadius: radii.sm,
    cursor: 'pointer',
    fontSize: fontSizes.md,
    lineHeight: '24px',
    padding: 0,
  },
  sectionLabel: {
    fontSize: fontSizes.xxs,
    fontWeight: fontWeights.semibold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textDim,
    marginTop: spacing.sm,
  },
  grid2: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: spacing.sm,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.xs,
  },
  fieldLabel: {
    fontSize: fontSizes.xxs,
    fontWeight: fontWeights.medium,
    color: colors.textMuted,
  },
  input: {
    width: '100%',
    padding: `${spacing.xs}px ${spacing.sm}px`,
    fontSize: fontSizes.sm,
    color: colors.text,
    background: colors.bgInput,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.sm,
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  empty: {
    marginTop: spacing.lg,
    padding: spacing.md,
    fontSize: fontSizes.sm,
    color: colors.textPlaceholder,
    background: colors.bgInput,
    border: `1px dashed ${colors.border}`,
    borderRadius: radii.md,
    textAlign: 'center',
  },
  err: {
    marginTop: spacing.xs,
    fontSize: fontSizes.xs,
    color: colors.danger?.fg || '#ef4444',
  },
};
