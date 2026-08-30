import React, { useEffect, useRef, useState } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';

// The one control every number on the Breakdown page is typed into.
//
// Whether a value was measured or invented is as important as the value, so
// the badge is part of the field rather than a legend somewhere else:
//
//   auto      derived from real data — no badge, just the number
//   override  you typed over a derived value — amber dot, and the derived
//             value stays visible underneath so you can see what you overrode
//   manual    you typed it and there is nothing to derive — hollow dot
//   default   the workbook's starting assumption, nobody has confirmed it
//   empty     nothing anywhere. Renders as a placeholder, never as zero,
//             because a blank and a zero mean very different things here.
//
// Money is cents in and cents out. The dollars a user sees exist only inside
// this component.

const SOURCE_META = {
  auto:     { dot: null,      title: 'Auto — derived from real data' },
  override: { dot: colors.warning.fg, title: 'Overridden — you typed over the derived value' },
  manual:   { dot: colors.textDim,    title: 'Manual — no data source for this field' },
  default:  { dot: colors.textDim,    title: 'Default assumption — confirm it' },
  empty:    { dot: null,      title: 'Not set' },
};

function toDisplay(value, kind) {
  if (value === null || value === undefined || !isFinite(value)) return '';
  if (kind === 'money') return String(Math.round(value) / 100);
  if (kind === 'pct') return String(Number((value * 100).toFixed(4)));
  return String(value);
}

function fromDisplay(raw, kind) {
  const trimmed = String(raw).replace(/[$,%\s,]/g, '');
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!isFinite(n)) return null;
  if (kind === 'money') return Math.round(n * 100);
  if (kind === 'pct') return n / 100;
  return n;
}

export default function FieldInput({
  resolved,
  kind = 'money',
  onCommit,
  onReset,
  placeholder,
  align = 'right',
  width,
  disabled,
  title,
}) {
  const { value, source, autoValue } = resolved;
  const [draft, setDraft] = useState(() => toDisplay(value, kind));
  const [editing, setEditing] = useState(false);
  const inputRef = useRef(null);

  // Keep the field in step with recalculation / reloads, but never yank the
  // text out from under someone mid-type.
  useEffect(() => {
    if (!editing) setDraft(toDisplay(value, kind));
  }, [value, kind, editing]);

  const commit = () => {
    setEditing(false);
    const next = fromDisplay(draft, kind);
    const current = value === null || value === undefined ? null : value;
    // Committing an unchanged value would write a manual row that pins a
    // derived number in place — a silent override nobody asked for.
    if (next === current) { setDraft(toDisplay(value, kind)); return; }
    onCommit?.(next);
  };

  const meta = SOURCE_META[source] || SOURCE_META.empty;
  const overridden = source === 'override';

  return (
    <div style={{ ...styles.wrap, width }}>
      <div style={styles.inputRow}>
        {kind === 'money' && <span style={styles.affix}>$</span>}
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          disabled={disabled}
          value={draft}
          title={title || meta.title}
          placeholder={placeholder ?? (source === 'empty' ? '—' : '')}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setEditing(true)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.currentTarget.blur(); }
            if (e.key === 'Escape') { setDraft(toDisplay(value, kind)); setEditing(false); e.currentTarget.blur(); }
          }}
          style={{
            ...styles.input,
            textAlign: align,
            paddingLeft: kind === 'money' ? spacing.lg : spacing.sm,
            paddingRight: kind === 'pct' ? spacing.lg : spacing.sm,
            color: source === 'empty' ? colors.textPlaceholder : colors.text,
            borderColor: overridden ? colors.warning.border : colors.border,
            opacity: disabled ? 0.5 : 1,
          }}
        />
        {kind === 'pct' && <span style={styles.affixRight}>%</span>}
        {meta.dot && <span style={{ ...styles.dot, background: meta.dot }} title={meta.title} />}
      </div>

      {overridden && (
        <button type="button" style={styles.autoHint} onClick={onReset} title="Reset to the derived value">
          auto: {toDisplayLabel(autoValue, kind)} · reset
        </button>
      )}
    </div>
  );
}

function toDisplayLabel(v, kind) {
  if (v === null || v === undefined) return '—';
  if (kind === 'money') return `$${(v / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (kind === 'pct') return `${(v * 100).toFixed(1)}%`;
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

const styles = {
  wrap: { display: 'inline-flex', flexDirection: 'column', gap: spacing.xs, minWidth: 0 },
  inputRow: { position: 'relative', display: 'flex', alignItems: 'center' },
  input: {
    width: '100%', minWidth: 0,
    background: colors.bgInput,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.sm,
    padding: `${spacing.xs}px ${spacing.sm}px`,
    fontSize: fontSizes.md,
    fontFamily: 'inherit',
    fontVariantNumeric: 'tabular-nums',
    outline: 'none',
  },
  affix: {
    position: 'absolute', left: spacing.sm, fontSize: fontSizes.sm,
    color: colors.textSubtle, pointerEvents: 'none',
  },
  affixRight: {
    position: 'absolute', right: spacing.sm, fontSize: fontSizes.sm,
    color: colors.textSubtle, pointerEvents: 'none',
  },
  dot: {
    position: 'absolute', right: -spacing.sm, top: '50%', transform: 'translateY(-50%)',
    width: 5, height: 5, borderRadius: radii.pill,
  },
  autoHint: {
    background: 'none', border: 'none', padding: 0, textAlign: 'right',
    fontSize: fontSizes.xxs, color: colors.warning.fg, cursor: 'pointer',
    fontFamily: 'inherit', fontWeight: fontWeights.medium,
  },
};
