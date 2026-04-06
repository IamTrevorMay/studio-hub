import React, { useCallback, useRef, useEffect } from 'react';
import { CANVAS_FONT_OPTIONS, CANVAS_FONT_SIZES } from './reportBuilderConstants';

// Inline toolbar that appears below the selected block on the canvas.
// Controls vary per block type.

export default function BlockStyleEditor({ block, onUpdate }) {
  const editorRef = useRef(null);

  // Find the Tiptap editor instance for text/heading blocks
  useEffect(() => {
    const timer = setTimeout(() => {
      const el = document.querySelector('[data-canvas-editor="true"]');
      editorRef.current = el?.__tiptapEditor || null;
    }, 100);
    return () => clearTimeout(timer);
  }, [block.id]);

  const updateStyle = useCallback((updates) => {
    onUpdate({ ...block, style: { ...block.style, ...updates } });
  }, [block, onUpdate]);

  const updateField = useCallback((field, value) => {
    onUpdate({ ...block, [field]: value });
  }, [block, onUpdate]);

  const tiptapCommand = useCallback((cmd) => {
    const ed = editorRef.current;
    if (!ed) return;
    cmd(ed);
    ed.commands.focus();
  }, []);

  const isTextBlock = block.type === 'text' || block.type === 'heading';
  const style = block.style || {};

  return (
    <div style={styles.bar} onClick={e => e.stopPropagation()}>
      {/* Font family + size (text/heading) */}
      {isTextBlock && (
        <>
          <select
            style={styles.select}
            value={style.fontFamily || 'DM Sans'}
            onChange={e => updateStyle({ fontFamily: e.target.value })}
          >
            {CANVAS_FONT_OPTIONS.map(f => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>

          <select
            style={{ ...styles.select, width: '62px' }}
            value={style.fontSize || '14px'}
            onChange={e => updateStyle({ fontSize: e.target.value })}
          >
            {CANVAS_FONT_SIZES.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <div style={styles.sep} />
        </>
      )}

      {/* Heading level */}
      {block.type === 'heading' && (
        <>
          <select
            style={{ ...styles.select, width: '52px' }}
            value={block.level || 1}
            onChange={e => {
              const lvl = Number(e.target.value);
              const sizes = { 1: '28px', 2: '22px', 3: '18px' };
              onUpdate({ ...block, level: lvl, style: { ...block.style, fontSize: sizes[lvl] || '24px' } });
            }}
          >
            <option value={1}>H1</option>
            <option value={2}>H2</option>
            <option value={3}>H3</option>
          </select>
          <div style={styles.sep} />
        </>
      )}

      {/* Bold / Italic / Underline (text blocks with Tiptap) */}
      {block.type === 'text' && (
        <>
          <button style={styles.btn} title="Bold" onClick={() => tiptapCommand(ed => ed.chain().toggleBold().run())}>
            <strong>B</strong>
          </button>
          <button style={styles.btn} title="Italic" onClick={() => tiptapCommand(ed => ed.chain().toggleItalic().run())}>
            <em>I</em>
          </button>
          <button style={styles.btn} title="Underline" onClick={() => tiptapCommand(ed => ed.chain().toggleUnderline().run())}>
            <span style={{ textDecoration: 'underline' }}>U</span>
          </button>
          <div style={styles.sep} />
        </>
      )}

      {/* Color (text/heading) */}
      {isTextBlock && (
        <>
          <label style={styles.colorLabel} title="Text color">
            <span style={{ fontSize: '11px', fontWeight: 600, color: style.color || '#333' }}>A</span>
            <input
              type="color"
              value={style.color || '#333333'}
              onChange={e => updateStyle({ color: e.target.value })}
              style={styles.colorInput}
            />
          </label>
          <div style={styles.sep} />
        </>
      )}

      {/* Alignment (text/heading) */}
      {isTextBlock && (
        <>
          {['left', 'center', 'right'].map(align => (
            <button
              key={align}
              onClick={() => updateStyle({ textAlign: align })}
              style={{
                ...styles.btn,
                ...(style.textAlign === align ? styles.btnActive : {}),
              }}
              title={`Align ${align}`}
            >
              {align === 'left' && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>}
              {align === 'center' && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>}
              {align === 'right' && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></svg>}
            </button>
          ))}
        </>
      )}

      {/* Image controls */}
      {block.type === 'image' && (
        <>
          <input
            style={{ ...styles.textInput, flex: 1 }}
            value={block.src || ''}
            onChange={e => updateField('src', e.target.value)}
            placeholder="Image URL"
          />
          <input
            style={{ ...styles.textInput, width: '80px' }}
            value={block.alt || ''}
            onChange={e => updateField('alt', e.target.value)}
            placeholder="Alt text"
          />
          <select
            style={{ ...styles.select, width: '70px' }}
            value={style.width || '100%'}
            onChange={e => updateStyle({ width: e.target.value })}
          >
            <option value="100%">100%</option>
            <option value="75%">75%</option>
            <option value="50%">50%</option>
            <option value="auto">Auto</option>
          </select>
        </>
      )}

      {/* Divider color */}
      {block.type === 'divider' && (
        <label style={styles.colorLabel} title="Divider color">
          <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>Color</span>
          <input
            type="color"
            value={style.borderColor || '#e2e8f0'}
            onChange={e => updateStyle({ borderColor: e.target.value })}
            style={styles.colorInput}
          />
        </label>
      )}

      {/* Spacer height */}
      {block.type === 'spacer' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
          <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap' }}>Height</span>
          <input
            type="range"
            min="8"
            max="80"
            value={parseInt(style.height) || 24}
            onChange={e => updateStyle({ height: `${e.target.value}px` })}
            style={{ flex: 1, accentColor: '#6366f1' }}
          />
          <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', width: '32px' }}>{style.height || '24px'}</span>
        </div>
      )}
    </div>
  );
}

const styles = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '6px 8px',
    background: '#1e1e32',
    borderRadius: '6px',
    marginTop: '6px',
    flexWrap: 'wrap',
  },
  select: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '4px',
    color: '#e2e8f0',
    fontSize: '11px',
    padding: '3px 4px',
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  btn: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '4px',
    color: 'rgba(255,255,255,0.6)',
    fontSize: '12px',
    fontFamily: 'inherit',
    padding: '3px 7px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '26px',
    height: '26px',
  },
  btnActive: {
    background: 'rgba(99,102,241,0.2)',
    borderColor: 'rgba(99,102,241,0.4)',
    color: '#a5b4fc',
  },
  sep: {
    width: '1px',
    height: '18px',
    background: 'rgba(255,255,255,0.08)',
    margin: '0 2px',
  },
  colorLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    cursor: 'pointer',
    position: 'relative',
  },
  colorInput: {
    width: '20px',
    height: '20px',
    border: 'none',
    borderRadius: '3px',
    cursor: 'pointer',
    padding: 0,
    background: 'transparent',
  },
  textInput: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '4px',
    color: '#e2e8f0',
    fontSize: '11px',
    padding: '4px 6px',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
};
