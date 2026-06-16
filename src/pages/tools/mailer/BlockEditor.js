import React, { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Trash2 } from 'lucide-react';
import { getBlockDef, SOCIAL_PLATFORMS } from './blockRegistry';
import BlockPalette from './BlockPalette';
import BlockProperties from './BlockProperties';
import RichTextBlockEditor from './RichTextBlockEditor';

// Block list editor. Drag handle reorders via @dnd-kit; per-type fields
// rendered inline. Each block needs a stable id to play nicely with
// SortableContext — backfill one if the campaign was saved before id was
// part of the schema.

function ensureIds(blocks) {
  let changed = false;
  const out = (blocks || []).map((b) => {
    if (b && b.id) return b;
    changed = true;
    return { ...b, id: `b_${Math.random().toString(36).slice(2, 10)}` };
  });
  return { blocks: out, changed };
}

export default function BlockEditor({ blocks, onChange }) {
  const [adding, setAdding] = useState(false);

  // Backfill ids on first render of a legacy campaign.
  React.useEffect(() => {
    const { blocks: next, changed } = ensureIds(blocks);
    if (changed) onChange(next);
  }, []); // eslint-disable-line

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function updateBlock(id, patch) {
    onChange(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }
  function removeBlock(id) {
    onChange(blocks.filter((b) => b.id !== id));
  }
  function addBlock(type) {
    const def = getBlockDef(type);
    if (!def) return;
    const next = {
      id: `b_${Math.random().toString(36).slice(2, 10)}`,
      type,
      ...def.defaults,
    };
    onChange([...(blocks || []), next]);
    setAdding(false);
  }
  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = blocks.findIndex((b) => b.id === active.id);
    const newIdx = blocks.findIndex((b) => b.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    onChange(arrayMove(blocks, oldIdx, newIdx));
  }

  const ids = (blocks || []).map((b) => b.id);

  return (
    <div style={styles.wrap}>
      {(blocks || []).length === 0 && (
        <div style={styles.empty}>No blocks yet. Pick one below to start.</div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {(blocks || []).map((b) => (
            <SortableBlockCard
              key={b.id}
              block={b}
              onChange={(patch) => updateBlock(b.id, patch)}
              onRemove={() => removeBlock(b.id)}
            />
          ))}
        </SortableContext>
      </DndContext>

      <div style={styles.addRow}>
        {adding ? (
          <BlockPalette onAdd={addBlock} onCancel={() => setAdding(false)} />
        ) : (
          <button onClick={() => setAdding(true)} style={styles.addBtn}>+ Add block</button>
        )}
      </div>
    </div>
  );
}

function SortableBlockCard({ block, onChange, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={{ ...styles.card, ...style }}>
      <div style={styles.cardHeader}>
        <button
          {...attributes}
          {...listeners}
          style={styles.dragHandle}
          title="Drag to reorder"
        >
          <GripVertical size={14} />
        </button>
        <span style={styles.cardType}>{block.type}</span>
        <span style={{ flex: 1 }} />
        <button title="Delete" onClick={onRemove} style={{ ...styles.iconBtn, color: '#f87171' }}>
          <Trash2 size={13} />
        </button>
      </div>
      <div style={styles.cardBody}>
        <BlockFields block={block} onChange={onChange} />
        <BlockProperties block={block} onChange={onChange} />
      </div>
    </div>
  );
}

function BlockFields({ block, onChange }) {
  switch (block.type) {
    case 'heading':
      return (
        <>
          <Row>
            <Field label="Text"><Input value={block.text} onChange={(v) => onChange({ text: v })} /></Field>
          </Row>
          <Row>
            <Field label="Level">
              <Select value={String(block.level || 2)} onChange={(v) => onChange({ level: Number(v) })} options={[['1', 'H1'], ['2', 'H2'], ['3', 'H3']]} />
            </Field>
            <Field label="Align">
              <Select value={block.align || 'left'} onChange={(v) => onChange({ align: v })} options={[['left', 'Left'], ['center', 'Center'], ['right', 'Right']]} />
            </Field>
          </Row>
        </>
      );
    case 'paragraph':
      return (
        <>
          <Field label="Text">
            <textarea value={block.text || ''} onChange={(e) => onChange({ text: e.target.value })} style={{ ...styles.input, minHeight: 90 }} />
          </Field>
          <Field label="Align">
            <Select value={block.align || 'left'} onChange={(v) => onChange({ align: v })} options={[['left', 'Left'], ['center', 'Center'], ['right', 'Right']]} />
          </Field>
        </>
      );
    case 'image':
      return (
        <>
          <Field label="Image URL"><Input value={block.src} onChange={(v) => onChange({ src: v })} placeholder="https://…/image.jpg" /></Field>
          <Row>
            <Field label="Alt text"><Input value={block.alt} onChange={(v) => onChange({ alt: v })} /></Field>
            <Field label="Width"><Input type="number" value={block.width} onChange={(v) => onChange({ width: Number(v) || null })} placeholder="600" /></Field>
          </Row>
          <Field label="Link URL (optional)"><Input value={block.href} onChange={(v) => onChange({ href: v })} placeholder="https://…" /></Field>
        </>
      );
    case 'button':
      return (
        <>
          <Row>
            <Field label="Label"><Input value={block.text} onChange={(v) => onChange({ text: v })} /></Field>
            <Field label="Align">
              <Select value={block.align || 'center'} onChange={(v) => onChange({ align: v })} options={[['left', 'Left'], ['center', 'Center'], ['right', 'Right']]} />
            </Field>
          </Row>
          <Field label="URL"><Input value={block.href} onChange={(v) => onChange({ href: v })} placeholder="https://…" /></Field>
        </>
      );
    case 'divider':
      return <div style={styles.note}>Renders a horizontal rule. No fields.</div>;
    case 'spacer':
      return (
        <Field label="Height (px)">
          <Input type="number" value={block.size || 16} onChange={(v) => onChange({ size: Number(v) || 16 })} />
        </Field>
      );
    case 'html':
      return (
        <Field label="Raw HTML">
          <textarea
            value={block.html || ''}
            onChange={(e) => onChange({ html: e.target.value })}
            style={{ ...styles.input, minHeight: 120, fontFamily: 'monospace', fontSize: 12 }}
            spellCheck={false}
          />
        </Field>
      );
    case 'rich-text':
      return (
        <Field label="Content">
          <RichTextBlockEditor html={block.html} onChange={(html) => onChange({ html })} />
        </Field>
      );
    case 'personalization':
      return (
        <>
          <Field label="Template (use {{name}} / {{email}} / {{any_custom_field}})">
            <Input value={block.template} onChange={(v) => onChange({ template: v })} placeholder="Hey {{name}}," />
          </Field>
          <Row>
            <Field label="Primary field"><Input value={block.field} onChange={(v) => onChange({ field: v })} placeholder="name" /></Field>
            <Field label="Fallback value"><Input value={block.fallback} onChange={(v) => onChange({ fallback: v })} placeholder="there" /></Field>
          </Row>
          <div style={styles.note}>
            At send time, {'{{token}}'} is replaced from the subscriber's name/email/custom_fields.
            If the primary field is missing, the fallback is substituted.
          </div>
        </>
      );
    case 'header':
      return (
        <>
          <Field label="Style">
            <Select
              value={block.style || 'logo'}
              onChange={(v) => onChange({ style: v })}
              options={[['logo', 'Logo'], ['banner', 'Banner image'], ['text', 'Text only']]}
            />
          </Field>
          {block.style === 'banner' && (
            <Field label="Banner image URL">
              <Input value={block.bannerUrl} onChange={(v) => onChange({ bannerUrl: v })} placeholder="https://…/banner.jpg" />
            </Field>
          )}
          {(block.style === 'logo' || block.style === 'text') && (
            <Field label="Logo image URL (optional)">
              <Input value={block.logoUrl} onChange={(v) => onChange({ logoUrl: v })} placeholder="https://…/logo.png" />
            </Field>
          )}
          <Row>
            <Field label="Title"><Input value={block.title} onChange={(v) => onChange({ title: v })} /></Field>
            <Field label="Subtitle"><Input value={block.subtitle} onChange={(v) => onChange({ subtitle: v })} /></Field>
          </Row>
          <Row>
            <Field label="Background"><Input value={block.bg} onChange={(v) => onChange({ bg: v })} placeholder="#0f0f1a" /></Field>
            <Field label="Text color"><Input value={block.fg} onChange={(v) => onChange({ fg: v })} placeholder="#ffffff" /></Field>
          </Row>
        </>
      );
    case 'social-links':
      return <SocialLinksFields block={block} onChange={onChange} />;
    case 'columns':
      return <ColumnsFields block={block} onChange={onChange} />;
    case 'section':
      return <SectionFields block={block} onChange={onChange} />;
    case 'footer':
      return (
        <>
          <Field label="Footer text (optional)">
            <textarea
              value={block.text || ''}
              onChange={(e) => onChange({ text: e.target.value })}
              style={{ ...styles.input, minHeight: 60 }}
              placeholder="© 2026 Mayday Studio. All rights reserved."
            />
          </Field>
          <Row>
            <Field label="Background"><Input value={block.bg} onChange={(v) => onChange({ bg: v })} placeholder="#f5f5f7" /></Field>
            <Field label="Text color"><Input value={block.fg} onChange={(v) => onChange({ fg: v })} placeholder="#666666" /></Field>
          </Row>
          <Row>
            <label style={{ ...styles.fieldWrap, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={block.showUnsubscribe !== false}
                onChange={(e) => onChange({ showUnsubscribe: e.target.checked })}
              />
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)' }}>Show unsubscribe link</span>
            </label>
            <label style={{ ...styles.fieldWrap, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={block.showBranding !== false}
                onChange={(e) => onChange({ showBranding: e.target.checked })}
              />
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)' }}>Show "sent via Mayday Studio"</span>
            </label>
          </Row>
        </>
      );
    default:
      return <div style={styles.note}>Unknown block type: {block.type}</div>;
  }
}

function ColumnsFields({ block, onChange }) {
  const cols = Array.isArray(block.children) ? block.children : [[], []];
  const colCount = Number(block.columnCount) || cols.length || 2;
  // Reshape children to match colCount if user toggled
  React.useEffect(() => {
    if (cols.length === colCount) return;
    const next = Array.from({ length: colCount }, (_, i) => cols[i] || []);
    onChange({ children: next });
    // eslint-disable-next-line
  }, [colCount]);

  function updateCol(idx, nextBlocks) {
    const nextCols = cols.map((c, i) => (i === idx ? nextBlocks : c));
    onChange({ children: nextCols });
  }

  return (
    <>
      <Row>
        <Field label="Column count">
          <Select
            value={String(colCount)}
            onChange={(v) => onChange({ columnCount: Number(v) })}
            options={[['2', '2'], ['3', '3']]}
          />
        </Field>
        <Field label="Gap (px)">
          <Input type="number" value={block.gap || 16} onChange={(v) => onChange({ gap: Number(v) || 0 })} />
        </Field>
      </Row>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${colCount}, 1fr)`, gap: 8 }}>
        {Array.from({ length: colCount }).map((_, idx) => (
          <div key={idx} style={styles.colWrap}>
            <div style={styles.colLabel}>Column {idx + 1}</div>
            <ChildList blocks={cols[idx] || []} onChange={(b) => updateCol(idx, b)} />
          </div>
        ))}
      </div>
    </>
  );
}

function SectionFields({ block, onChange }) {
  const children = Array.isArray(block.children) ? block.children : [];
  return (
    <>
      <Row>
        <Field label="Title (optional)"><Input value={block.title} onChange={(v) => onChange({ title: v })} /></Field>
        <label style={{ ...styles.fieldWrap, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={block.showTitle !== false}
            onChange={(e) => onChange({ showTitle: e.target.checked })}
          />
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)' }}>Show title</span>
        </label>
      </Row>
      <div style={styles.colWrap}>
        <div style={styles.colLabel}>Children</div>
        <ChildList blocks={children} onChange={(b) => onChange({ children: b })} />
      </div>
    </>
  );
}

// Nested list of child blocks with arrow reorder + delete + add menu.
// Drag isn't supported inside nested lists — keeps things simple and
// avoids @dnd-kit nested-context overlap headaches.
function ChildList({ blocks, onChange }) {
  const [adding, setAdding] = React.useState(false);

  function backfillIds(list) {
    return list.map((b) => (b && b.id ? b : { ...b, id: `b_${Math.random().toString(36).slice(2, 10)}` }));
  }
  const items = backfillIds(blocks);

  function updateChild(id, patch) {
    onChange(items.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }
  function removeChild(id) {
    onChange(items.filter((b) => b.id !== id));
  }
  function moveChild(id, dir) {
    const idx = items.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= items.length) return;
    const next = items.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  }
  function addChild(type) {
    const def = getBlockDef(type);
    if (!def) return;
    onChange([...items, { id: `b_${Math.random().toString(36).slice(2, 10)}`, type, ...def.defaults }]);
    setAdding(false);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.length === 0 && (
        <div style={{ ...styles.empty, padding: 12, fontSize: 11 }}>Empty</div>
      )}
      {items.map((b, i) => (
        <div key={b.id} style={styles.card}>
          <div style={styles.cardHeader}>
            <span style={styles.cardType}>{b.type}</span>
            <span style={{ flex: 1 }} />
            <button disabled={i === 0} onClick={() => moveChild(b.id, -1)} style={styles.iconBtn} title="Up">↑</button>
            <button disabled={i === items.length - 1} onClick={() => moveChild(b.id, 1)} style={styles.iconBtn} title="Down">↓</button>
            <button onClick={() => removeChild(b.id)} style={{ ...styles.iconBtn, color: '#f87171' }} title="Delete">×</button>
          </div>
          <div style={styles.cardBody}>
            <BlockFields block={b} onChange={(patch) => updateChild(b.id, patch)} />
          </div>
        </div>
      ))}
      {adding ? (
        <BlockPalette onAdd={addChild} onCancel={() => setAdding(false)} />
      ) : (
        <button onClick={() => setAdding(true)} style={{ ...styles.addBtn, padding: 8, fontSize: 11 }}>+ Add child block</button>
      )}
    </div>
  );
}

function SocialLinksFields({ block, onChange }) {
  const links = Array.isArray(block.links) ? block.links : [];
  function update(i, patch) {
    onChange({ links: links.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) });
  }
  function remove(i) {
    onChange({ links: links.filter((_, idx) => idx !== i) });
  }
  function add() {
    onChange({ links: [...links, { platform: 'instagram', url: '' }] });
  }
  return (
    <>
      <Row>
        <Field label="Align">
          <Select value={block.align || 'center'} onChange={(v) => onChange({ align: v })} options={[['left', 'Left'], ['center', 'Center'], ['right', 'Right']]} />
        </Field>
        <Field label="Icon size (px)">
          <Input type="number" value={block.iconSize || 28} onChange={(v) => onChange({ iconSize: Number(v) || 28 })} />
        </Field>
        <Field label="Color"><Input value={block.color} onChange={(v) => onChange({ color: v })} placeholder="#6366f1" /></Field>
      </Row>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {links.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <select
              value={l.platform}
              onChange={(e) => update(i, { platform: e.target.value })}
              style={{ ...styles.input, width: 140 }}
            >
              {SOCIAL_PLATFORMS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
            <input
              value={l.url || ''}
              onChange={(e) => update(i, { url: e.target.value })}
              placeholder="https://…"
              style={{ ...styles.input, flex: 1 }}
            />
            <button onClick={() => remove(i)} style={{ ...styles.iconBtn, color: '#f87171' }}>×</button>
          </div>
        ))}
        <button onClick={add} style={{ ...styles.addBtn, padding: '6px', fontSize: 11 }}>+ Add link</button>
      </div>
    </>
  );
}

function Row({ children }) { return <div style={{ display: 'flex', gap: 8 }}>{children}</div>; }
function Field({ label, children }) {
  return (
    <label style={styles.fieldWrap}>
      <span style={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}
function Input({ value, onChange, type, placeholder }) {
  return <input type={type || 'text'} value={value == null ? '' : value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={styles.input} />;
}
function Select({ value, onChange, options }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={styles.input}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

const styles = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 10 },
  empty: { padding: 24, textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: 13, border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 8 },
  card: { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 },
  cardHeader: { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' },
  cardType: { fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: '#a5b4fc' },
  dragHandle: {
    background: 'transparent', border: 'none',
    color: 'rgba(255,255,255,0.4)',
    width: 22, height: 22, cursor: 'grab', display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 0,
  },
  iconBtn: { background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)', borderRadius: 4, width: 24, height: 24, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  cardBody: { padding: 12, display: 'flex', flexDirection: 'column', gap: 10 },
  fieldWrap: { display: 'flex', flexDirection: 'column', gap: 3, flex: 1 },
  fieldLabel: { fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.45)', letterSpacing: 0.4, textTransform: 'uppercase' },
  input: { background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '7px 10px', color: '#fff', fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', width: '100%', resize: 'vertical' },
  note: { fontSize: 12, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' },
  addRow: { paddingTop: 4 },
  addBtn: { width: '100%', padding: '10px', background: 'transparent', border: '1px dashed rgba(255,255,255,0.15)', borderRadius: 8, color: 'rgba(255,255,255,0.55)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  colWrap: { background: 'rgba(0,0,0,0.15)', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 },
  colLabel: { fontSize: 10, color: 'rgba(255,255,255,0.45)', fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase' },
};
