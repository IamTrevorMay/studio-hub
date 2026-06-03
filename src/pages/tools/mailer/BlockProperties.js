import React from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';

// Right pane: edits the selected block's config. Renders a per-type form.
// Generic field components are below the switch so each type's form is a
// flat list of <Field …/> calls.

export default function BlockProperties({ block, onChange, onChangeBinding }) {
  if (!block) {
    return (
      <div style={styles.wrap}>
        <div style={styles.empty}>Select a block to edit its properties.</div>
      </div>
    );
  }
  const c = block.config || {};
  const set = (patch) => onChange({ ...c, ...patch });

  return (
    <div style={styles.wrap}>
      <div style={styles.heading}>{block.type}</div>
      {renderFields(block.type, c, set)}
      {(block.binding || ['rss-card'].includes(block.type)) && (
        <BindingFields block={block} onChangeBinding={onChangeBinding} />
      )}
    </div>
  );
}

function renderFields(type, c, set) {
  switch (type) {
    case 'header':
      return (
        <>
          <Field label="Style"><Select value={c.style || 'text'} onChange={(v) => set({ style: v })} options={['text', 'logo', 'banner']} /></Field>
          <Field label="Title"><Text value={c.title} onChange={(v) => set({ title: v })} /></Field>
          <Field label="Subtitle"><Text value={c.subtitle} onChange={(v) => set({ subtitle: v })} /></Field>
          <Field label="Logo URL"><Text value={c.logoUrl} onChange={(v) => set({ logoUrl: v })} /></Field>
          <Field label="Banner URL"><Text value={c.bannerUrl} onChange={(v) => set({ bannerUrl: v })} /></Field>
          <Field label="Show date"><Bool value={c.showDate !== false} onChange={(v) => set({ showDate: v })} /></Field>
        </>
      );
    case 'footer':
      return (
        <>
          <Field label="Text"><Text value={c.text} onChange={(v) => set({ text: v })} /></Field>
          <Field label="Show branding"><Bool value={c.showBranding !== false} onChange={(v) => set({ showBranding: v })} /></Field>
          <Field label="Show unsubscribe"><Bool value={c.showUnsubscribe !== false} onChange={(v) => set({ showUnsubscribe: v })} /></Field>
        </>
      );
    case 'rich-text':
      return (
        <Field label="HTML"><Textarea value={c.html} onChange={(v) => set({ html: v })} rows={10} /></Field>
      );
    case 'image':
      return (
        <>
          <Field label="Image URL"><Text value={c.src} onChange={(v) => set({ src: v })} /></Field>
          <Field label="Alt text"><Text value={c.alt} onChange={(v) => set({ alt: v })} /></Field>
          <Field label="Width"><Text value={c.width || '100%'} onChange={(v) => set({ width: v })} /></Field>
          <Field label="Link URL"><Text value={c.linkUrl} onChange={(v) => set({ linkUrl: v })} /></Field>
          <Field label="Border radius (px)"><Num value={c.borderRadius || 0} onChange={(v) => set({ borderRadius: v })} /></Field>
        </>
      );
    case 'button':
      return (
        <>
          <Field label="Text"><Text value={c.text} onChange={(v) => set({ text: v })} /></Field>
          <Field label="URL"><Text value={c.url} onChange={(v) => set({ url: v })} /></Field>
          <Field label="Background"><Text value={c.bgColor} onChange={(v) => set({ bgColor: v })} /></Field>
          <Field label="Text color"><Text value={c.textColor} onChange={(v) => set({ textColor: v })} /></Field>
          <Field label="Align"><Select value={c.align || 'center'} onChange={(v) => set({ align: v })} options={['left', 'center', 'right']} /></Field>
          <Field label="Radius (px)"><Num value={c.borderRadius || 6} onChange={(v) => set({ borderRadius: v })} /></Field>
          <Field label="Full width"><Bool value={!!c.fullWidth} onChange={(v) => set({ fullWidth: v })} /></Field>
        </>
      );
    case 'divider':
      return (
        <>
          <Field label="Color"><Text value={c.color} onChange={(v) => set({ color: v })} /></Field>
          <Field label="Thickness (px)"><Num value={c.thickness || 1} onChange={(v) => set({ thickness: v })} /></Field>
          <Field label="Style"><Select value={c.style || 'solid'} onChange={(v) => set({ style: v })} options={['solid', 'dashed', 'dotted']} /></Field>
        </>
      );
    case 'spacer':
      return <Field label="Height (px)"><Num value={c.height || 24} onChange={(v) => set({ height: v })} /></Field>;
    case 'social-links':
      return (
        <>
          <Field label="Align"><Select value={c.align || 'center'} onChange={(v) => set({ align: v })} options={['left', 'center', 'right']} /></Field>
          <Field label="Icon size"><Num value={c.iconSize || 24} onChange={(v) => set({ iconSize: v })} /></Field>
          <Field label="Links">
            <LinksEditor value={c.links || []} onChange={(v) => set({ links: v })} fields={['platform', 'url']} />
          </Field>
        </>
      );
    case 'custom-html':
      return <Field label="HTML"><Textarea value={c.html} onChange={(v) => set({ html: v })} rows={12} /></Field>;
    case 'rss-card':
      return (
        <>
          <Field label="CTA text"><Text value={c.ctaText} onChange={(v) => set({ ctaText: v })} /></Field>
          <Field label="Show image"><Bool value={c.showImage !== false} onChange={(v) => set({ showImage: v })} /></Field>
          <Field label="Show author"><Bool value={c.showAuthor !== false} onChange={(v) => set({ showAuthor: v })} /></Field>
          <Field label="Show description"><Bool value={c.showDescription !== false} onChange={(v) => set({ showDescription: v })} /></Field>
        </>
      );
    case 'poll':
      return (
        <>
          <Field label="Question"><Text value={c.question} onChange={(v) => set({ question: v })} /></Field>
          <Field label="Options">
            <LinksEditor value={c.options || []} onChange={(v) => set({ options: v })} fields={['label', 'url']} />
          </Field>
        </>
      );
    case 'countdown':
      return (
        <>
          <Field label="Label"><Text value={c.label} onChange={(v) => set({ label: v })} /></Field>
          <Field label="Target date (ISO)"><Text value={c.targetDate} onChange={(v) => set({ targetDate: v })} /></Field>
        </>
      );
    case 'personalization':
      return (
        <>
          <Field label="Template"><Text value={c.template} onChange={(v) => set({ template: v })} /></Field>
          <Field label="Field name"><Text value={c.field} onChange={(v) => set({ field: v })} /></Field>
          <Field label="Fallback"><Text value={c.fallback} onChange={(v) => set({ fallback: v })} /></Field>
        </>
      );
    case 'columns':
      return (
        <>
          <Field label="Columns"><Num value={c.columnCount || 2} onChange={(v) => set({ columnCount: Math.max(1, Math.min(4, v)) })} /></Field>
          <Field label="Gap (px)"><Num value={c.gap || 16} onChange={(v) => set({ gap: v })} /></Field>
          <div style={styles.note}>
            Child blocks edited by inserting them into <code>children</code>. v1 keeps it simple: use Section for grouping instead.
          </div>
        </>
      );
    case 'section':
      return (
        <>
          <Field label="Title"><Text value={c.title} onChange={(v) => set({ title: v })} /></Field>
          <Field label="Show title"><Bool value={c.showTitle !== false} onChange={(v) => set({ showTitle: v })} /></Field>
          <Field label="Background"><Text value={c.background} onChange={(v) => set({ background: v })} /></Field>
        </>
      );
    default:
      return <div style={styles.note}>No editable props for this block type.</div>;
  }
}

function BindingFields({ block, onChangeBinding }) {
  const b = block.binding || {};
  return (
    <>
      <div style={{ ...styles.heading, marginTop: spacing.lg }}>Data binding</div>
      <Field label="Source">
        <Select
          value={b.source || 'static'}
          onChange={(v) => onChangeBinding({ ...b, source: v })}
          options={['static', 'rss']}
        />
      </Field>
      {b.source === 'rss' && (
        <Field label="RSS feed URL">
          <Text value={b.rssUrl} onChange={(v) => onChangeBinding({ ...b, rssUrl: v })} />
        </Field>
      )}
    </>
  );
}

// ─── Field primitives ──────────────────────────────────────────────

function Field({ label, children }) {
  return (
    <label style={styles.field}>
      <div style={styles.label}>{label}</div>
      {children}
    </label>
  );
}
function Text({ value, onChange }) {
  return <input value={value || ''} onChange={(e) => onChange(e.target.value)} style={styles.input} />;
}
function Textarea({ value, onChange, rows = 4 }) {
  return <textarea value={value || ''} onChange={(e) => onChange(e.target.value)} rows={rows} style={{ ...styles.input, fontFamily: 'monospace', fontSize: fontSizes.sm }} />;
}
function Num({ value, onChange }) {
  return <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} style={styles.input} />;
}
function Bool({ value, onChange }) {
  return <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} style={{ width: 16, height: 16 }} />;
}
function Select({ value, onChange, options }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={styles.input}>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
function LinksEditor({ value, onChange, fields }) {
  const rows = value || [];
  function setRow(i, patch) {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    onChange(next);
  }
  function add() { onChange([...rows, fields.reduce((a, f) => ({ ...a, [f]: '' }), {})]); }
  function remove(i) { onChange(rows.filter((_, idx) => idx !== i)); }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.xs }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: spacing.xs, alignItems: 'center' }}>
          {fields.map((f) => (
            <input key={f} placeholder={f} value={r[f] || ''} onChange={(e) => setRow(i, { [f]: e.target.value })} style={{ ...styles.input, flex: 1 }} />
          ))}
          <button onClick={(e) => { e.preventDefault(); remove(i); }} style={{ ...styles.input, width: 28, height: 30, padding: 0, cursor: 'pointer' }}>×</button>
        </div>
      ))}
      <button onClick={(e) => { e.preventDefault(); add(); }} style={{ ...styles.addBtn }}>+ Add</button>
    </div>
  );
}

const styles = {
  wrap: {
    width: 320, flexShrink: 0, overflow: 'auto',
    padding: spacing.md, borderLeft: `1px solid ${colors.border}`,
    background: colors.bgRaised,
    display: 'flex', flexDirection: 'column', gap: spacing.sm,
  },
  empty: { padding: spacing.xxl, textAlign: 'center', color: colors.textSubtle, fontSize: fontSizes.sm },
  heading: {
    fontSize: fontSizes.xs, fontWeight: fontWeights.bold,
    color: colors.textSubtle, letterSpacing: '0.08em', textTransform: 'uppercase',
    paddingBottom: spacing.xs, borderBottom: `1px solid ${colors.border}`,
  },
  field: { display: 'flex', flexDirection: 'column', gap: spacing.xs, marginTop: spacing.xs },
  label: { fontSize: fontSizes.xs, color: colors.textMuted, fontWeight: fontWeights.medium },
  input: {
    padding: `${spacing.xs}px ${spacing.sm}px`, background: colors.bgInput,
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    color: colors.text, fontSize: fontSizes.sm, fontFamily: 'inherit', outline: 'none',
    width: '100%',
  },
  note: { fontSize: fontSizes.xs, color: colors.textSubtle, padding: spacing.sm, background: colors.bgInput, borderRadius: radii.sm },
  addBtn: {
    padding: `${spacing.xs}px ${spacing.sm}px`, background: 'transparent',
    border: `1px dashed ${colors.border}`, color: colors.textMuted,
    borderRadius: radii.sm, fontSize: fontSizes.xs, cursor: 'pointer', fontFamily: 'inherit',
  },
};
