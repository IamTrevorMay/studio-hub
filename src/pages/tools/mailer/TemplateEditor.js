import React, { useEffect, useRef, useState } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights, fontFamily } from '../../../lib/styleTokens';
import { updateTemplate } from './api';
import { getBlockDef } from '../../../lib/emails/blockRegistry';
import BlockPalette from './BlockPalette';
import BlockCanvas from './BlockCanvas';
import BlockProperties from './BlockProperties';
import PreviewFrame from './PreviewFrame';
import SendDialog from './SendDialog';

// Full-screen template editor. Replaces Layout while a template is open.
// Auto-saves debounced on every change. "Send…" opens SendDialog.

export default function TemplateEditor({ product, template, onClose }) {
  const [name, setName] = useState(template.name || 'Untitled');
  const [subject, setSubject] = useState(template.subject || '');
  const [preheader, setPreheader] = useState(template.preheader || '');
  const [blocks, setBlocks] = useState(Array.isArray(template.blocks) ? template.blocks : []);
  const [selectedId, setSelectedId] = useState(null);
  const [saving, setSaving] = useState('idle');   // idle | saving | saved | error
  const [error, setError] = useState(null);
  const [showSend, setShowSend] = useState(false);
  const saveTimer = useRef();
  const skipFirstSave = useRef(true);

  // Debounced auto-save
  useEffect(() => {
    if (skipFirstSave.current) { skipFirstSave.current = false; return; }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving('saving'); setError(null);
      try {
        await updateTemplate(template.id, { name, subject, preheader, blocks });
        setSaving('saved');
      } catch (e) { setError(e.message); setSaving('error'); }
    }, 600);
    return () => clearTimeout(saveTimer.current);
  }, [name, subject, preheader, blocks, template.id]);

  const selected = blocks.find((b) => b.id === selectedId) || null;

  function addBlock(type) {
    const def = getBlockDef(type);
    if (!def) return;
    const block = {
      id: cryptoId(),
      type,
      config: JSON.parse(JSON.stringify(def.defaultConfig || {})),
    };
    if (def.defaultBinding) block.binding = { ...def.defaultBinding };
    setBlocks([...blocks, block]);
    setSelectedId(block.id);
  }

  function move(from, to) {
    if (to < 0 || to >= blocks.length) return;
    const next = blocks.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setBlocks(next);
  }

  function deleteBlock(id) {
    setBlocks(blocks.filter((b) => b.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function updateBlockConfig(newConfig) {
    setBlocks(blocks.map((b) => (b.id === selectedId ? { ...b, config: newConfig } : b)));
  }
  function updateBlockBinding(newBinding) {
    setBlocks(blocks.map((b) => (b.id === selectedId ? { ...b, binding: newBinding } : b)));
  }

  const settings = (product.settings && product.settings.template) || {};
  const branding = (product.settings && product.settings.branding) || {};

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <button onClick={onClose} style={styles.backBtn} title="Back to templates">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <input value={name} onChange={(e) => setName(e.target.value)} style={styles.nameInput} placeholder="Untitled" />
        <input
          value={subject} onChange={(e) => setSubject(e.target.value)}
          style={styles.subjectInput} placeholder="Subject line"
        />
        <span style={styles.saveBadge(saving)}>
          {saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Saved' : saving === 'error' ? 'Save failed' : ''}
        </span>
        <button onClick={() => setShowSend(true)} style={styles.sendBtn}>Send…</button>
      </header>

      {error && <div style={styles.errorBar}>{error}</div>}

      <div style={styles.body}>
        <BlockPalette onAdd={addBlock} />
        <BlockCanvas
          blocks={blocks}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onMove={move}
          onDelete={deleteBlock}
        />
        <BlockProperties
          block={selected}
          onChange={updateBlockConfig}
          onChangeBinding={updateBlockBinding}
        />
        <PreviewFrame
          blocks={blocks}
          subject={subject}
          settings={settings}
          branding={branding}
          productName={product.name}
        />
      </div>

      {showSend && (
        <SendDialog
          product={product}
          template={{ ...template, name, subject, preheader, blocks }}
          onClose={() => setShowSend(false)}
          onSent={() => { setShowSend(false); }}
        />
      )}
    </div>
  );
}

function cryptoId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const styles = {
  container: { height: '100vh', display: 'flex', flexDirection: 'column', background: colors.bg, color: colors.text, fontFamily },
  header: {
    height: 52, flexShrink: 0, display: 'flex', alignItems: 'center',
    gap: spacing.md, padding: `0 ${spacing.lg}px`,
    borderBottom: `1px solid ${colors.border}`, background: colors.bgRaised,
  },
  backBtn: {
    width: 32, height: 32, border: 'none', background: 'transparent',
    color: colors.textMuted, cursor: 'pointer', borderRadius: radii.sm,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  nameInput: {
    background: 'transparent', border: 'none', color: colors.text,
    fontSize: fontSizes.lg, fontWeight: fontWeights.semibold, outline: 'none',
    fontFamily: 'inherit', width: 180,
  },
  subjectInput: {
    flex: 1, background: colors.bgInput, color: colors.text,
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    padding: `${spacing.xs}px ${spacing.md}px`,
    fontSize: fontSizes.sm, outline: 'none', fontFamily: 'inherit',
  },
  saveBadge: (s) => ({
    fontSize: fontSizes.xs,
    color: s === 'error' ? colors.danger.fg : colors.textSubtle,
    minWidth: 80,
    textAlign: 'right',
  }),
  sendBtn: {
    padding: `${spacing.xs}px ${spacing.md}px`, background: colors.accent,
    color: colors.text, border: 'none', borderRadius: radii.sm, cursor: 'pointer',
    fontSize: fontSizes.sm, fontWeight: fontWeights.medium, fontFamily: 'inherit',
  },
  errorBar: {
    padding: spacing.sm, background: colors.danger.bg, color: colors.danger.fg,
    fontSize: fontSizes.xs, textAlign: 'center',
  },
  body: { flex: 1, minHeight: 0, display: 'flex' },
};
