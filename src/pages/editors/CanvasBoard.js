import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  NodeToolbar,
  NodeResizer,
  Handle,
  Position,
  ConnectionMode,
  MarkerType,
  useReactFlow,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, FontFamily, FontSize } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import DOMPurify from 'dompurify';
import { supabase } from '../../supabaseClient';

// Obsidian-Canvas-style board: resizable shape cards with rich text (Tiptap,
// same engine as the doc editor) connected by recolorable edges on an
// infinite pannable canvas. Lives behind the Canvases view on Resources.
// Persistence mirrors Whiteboard.js: debounced autosave + flush on unmount.

const CARD_COLORS = [
  { key: 'default', border: 'rgba(255,255,255,0.14)', bg: '#1a1a2e' },
  { key: 'red',     border: '#ef4444', bg: 'rgba(239,68,68,0.10)' },
  { key: 'orange',  border: '#f59e0b', bg: 'rgba(245,158,11,0.10)' },
  { key: 'green',   border: '#22c55e', bg: 'rgba(34,197,94,0.10)' },
  { key: 'blue',    border: '#3b82f6', bg: 'rgba(59,130,246,0.10)' },
  { key: 'purple',  border: '#8b5cf6', bg: 'rgba(139,92,246,0.10)' },
  { key: 'pink',    border: '#ec4899', bg: 'rgba(236,72,153,0.10)' },
];
const COLOR_BY_KEY = Object.fromEntries(CARD_COLORS.map((c) => [c.key, c]));

const SHAPES = [
  { key: 'rect',     icon: '▭', title: 'Rectangle' },
  { key: 'ellipse',  icon: '◯', title: 'Ellipse' },
  { key: 'diamond',  icon: '◇', title: 'Diamond' },
  { key: 'triangle', icon: '△', title: 'Triangle' },
];
const STROKE_WIDTHS = [1, 2, 4];

const EDGE_COLORS = ['rgba(255,255,255,0.35)', '#6366f1', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899'];

const FONTS = [
  { label: 'DM Sans', value: 'DM Sans, sans-serif' },
  { label: 'Inter', value: 'Inter, sans-serif' },
  { label: 'Roboto Slab', value: '"Roboto Slab", serif' },
  { label: 'Playfair Display', value: '"Playfair Display", serif' },
  { label: 'Merriweather', value: 'Merriweather, serif' },
  { label: 'Bebas Neue', value: '"Bebas Neue", sans-serif' },
  { label: 'Caveat', value: 'Caveat, cursive' },
  { label: 'Permanent Marker', value: '"Permanent Marker", cursive' },
  { label: 'JetBrains Mono', value: '"JetBrains Mono", monospace' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Courier New', value: '"Courier New", monospace' },
  { label: 'Arial', value: 'Arial, sans-serif' },
];
const FONT_SIZES = [10, 12, 13, 14, 16, 18, 20, 24, 28, 32, 40, 48];
const HIGHLIGHT_COLORS = ['#fde047', '#86efac', '#93c5fd', '#f9a8d4', '#fdba74'];

const GOOGLE_FONTS_URL = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Roboto+Slab:wght@400;700&family=Playfair+Display:wght@400;700&family=Merriweather:wght@400;700&family=Bebas+Neue&family=Caveat:wght@400;700&family=Permanent+Marker&family=JetBrains+Mono:wght@400;700&display=swap';

const HANDLE_STYLE = {
  width: 8,
  height: 8,
  background: '#6366f1',
  border: '1px solid #0f0f1a',
};

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// Content inset per shape so text stays inside the drawn outline.
function contentInset(shape) {
  if (shape === 'diamond') return { top: '22%', left: '18%', right: '18%', bottom: '22%' };
  if (shape === 'triangle') return { top: '42%', left: '20%', right: '20%', bottom: '6%' };
  if (shape === 'ellipse') return { top: '12%', left: '14%', right: '14%', bottom: '12%' };
  return { top: 8, left: 12, right: 12, bottom: 8 };
}

// Rich-text editor mounted only while a card is being edited. Commits on
// deselect (click elsewhere) or Escape; the toolbar keeps the editor's
// stored selection because Tiptap restores it on chain().focus().
function CardEditor({ initialHtml, active, onCommit }) {
  const [, setTick] = useState(0);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, blockquote: false, horizontalRule: false }),
      TextStyle,
      FontFamily,
      FontSize,
      Highlight.configure({ multicolor: true }),
    ],
    content: initialHtml || '<p></p>',
    autofocus: 'end',
    editorProps: {
      handleKeyDown: (view, event) => {
        if (event.key === 'Escape') {
          commitRef.current();
          return true;
        }
        return false;
      },
    },
    onTransaction: () => setTick((t) => t + 1),
  });

  const commitRef = useRef(() => {});
  useEffect(() => {
    commitRef.current = () => { if (editor) onCommit(editor.getHTML()); };
  }, [editor, onCommit]);

  // Deselecting the node (clicking the pane or another card) commits.
  useEffect(() => {
    if (!active) commitRef.current();
  }, [active]);

  if (!editor) return null;

  const textStyleAttrs = editor.getAttributes('textStyle') || {};
  const currentFont = textStyleAttrs.fontFamily || 'DM Sans, sans-serif';
  const currentSize = parseInt(textStyleAttrs.fontSize, 10) || 13;

  const btn = (activeState) => ({
    ...styles.fmtBtn,
    ...(activeState ? styles.fmtBtnActive : {}),
  });

  return (
    <>
      <NodeToolbar isVisible position={Position.Top}>
        <div style={styles.fmtBar} onMouseDown={(e) => { if (e.target.tagName !== 'SELECT' && e.target.tagName !== 'OPTION') e.preventDefault(); }}>
          <select
            value={currentFont}
            onChange={(e) => editor.chain().focus().setFontFamily(e.target.value).run()}
            style={{ ...styles.fmtSelect, fontFamily: currentFont, maxWidth: 130 }}
            title="Font"
          >
            {FONTS.map((f) => <option key={f.label} value={f.value} style={{ fontFamily: f.value }}>{f.label}</option>)}
          </select>
          <select
            value={currentSize}
            onChange={(e) => editor.chain().focus().setFontSize(`${e.target.value}px`).run()}
            style={{ ...styles.fmtSelect, width: 52 }}
            title="Font size"
          >
            {FONT_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button style={btn(editor.isActive('bold'))} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold"><b>B</b></button>
          <button style={btn(editor.isActive('italic'))} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic"><i>I</i></button>
          <button style={btn(editor.isActive('underline'))} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline"><u>U</u></button>
          <span style={styles.fmtDivider} />
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c}
              style={{ ...styles.hlDot, background: c, outline: editor.isActive('highlight', { color: c }) ? '2px solid #fff' : 'none' }}
              onClick={() => editor.chain().focus().toggleHighlight({ color: c }).run()}
              title="Highlight"
            />
          ))}
          <button style={styles.fmtBtn} onClick={() => editor.chain().focus().unsetHighlight().run()} title="Remove highlight">✕</button>
          <span style={styles.fmtDivider} />
          <button style={{ ...styles.fmtBtn, color: '#4ade80' }} onClick={() => commitRef.current()} title="Done">✓</button>
        </div>
      </NodeToolbar>
      <EditorContent editor={editor} className="nodrag nowheel" style={styles.editorContent} />
    </>
  );
}

function CardNode({ id, data, selected }) {
  const { updateNodeData } = useReactFlow();
  const [editing, setEditing] = useState(data.html === '' && !data.label);

  const shape = data.shape || 'rect';
  const color = COLOR_BY_KEY[data.color] || CARD_COLORS[0];
  const strokeWidth = data.strokeWidth ?? 2;
  const rounded = data.rounded !== false;
  // Legacy cards stored plain text in data.label.
  const html = data.html != null ? data.html : `<p>${escapeHtml(data.label).replace(/\n/g, '<br/>')}</p>`;
  const isSvgShape = shape === 'diamond' || shape === 'triangle';
  const borderColor = selected ? '#6366f1' : color.border;

  const commit = useCallback((nextHtml) => {
    setEditing(false);
    updateNodeData(id, { html: nextHtml, label: undefined });
  }, [id, updateNodeData]);

  return (
    <div
      style={{ width: '100%', height: '100%', position: 'relative', minWidth: 60, minHeight: 40 }}
      onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
    >
      <NodeResizer
        isVisible={selected && !editing}
        minWidth={100}
        minHeight={50}
        lineStyle={{ borderColor: 'rgba(99,102,241,0.55)' }}
        handleStyle={{ background: '#6366f1', width: 8, height: 8, borderRadius: 2 }}
      />
      {/* Style toolbar (selected, not editing): colors · shapes · corners · stroke */}
      <NodeToolbar isVisible={selected && !editing} position={Position.Top}>
        <div style={styles.styleBar}>
          {CARD_COLORS.map((c) => (
            <button
              key={c.key}
              onClick={() => updateNodeData(id, { color: c.key })}
              title={c.key}
              style={{
                ...styles.colorDot,
                background: c.key === 'default' ? '#1a1a2e' : c.border,
                outline: (data.color || 'default') === c.key ? '2px solid #fff' : 'none',
              }}
            />
          ))}
          <span style={styles.fmtDivider} />
          {SHAPES.map((s) => (
            <button
              key={s.key}
              onClick={() => updateNodeData(id, { shape: s.key })}
              title={s.title}
              style={{ ...styles.fmtBtn, ...(shape === s.key ? styles.fmtBtnActive : {}) }}
            >
              {s.icon}
            </button>
          ))}
          {shape === 'rect' && (
            <button
              onClick={() => updateNodeData(id, { rounded: !rounded })}
              title="Toggle corners"
              style={{ ...styles.fmtBtn, fontSize: '10px', width: 'auto', padding: '0 6px' }}
            >
              {rounded ? 'Rounded' : 'Square'}
            </button>
          )}
          <span style={styles.fmtDivider} />
          {STROKE_WIDTHS.map((w) => (
            <button
              key={w}
              onClick={() => updateNodeData(id, { strokeWidth: w })}
              title={`Stroke ${w}px`}
              style={{ ...styles.fmtBtn, ...(strokeWidth === w ? styles.fmtBtnActive : {}) }}
            >
              <span style={{ display: 'block', width: 12, borderTop: `${w}px solid currentColor` }} />
            </button>
          ))}
        </div>
      </NodeToolbar>

      {isSvgShape ? (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={styles.shapeSvg}>
          <polygon
            points={shape === 'diamond' ? '50,1 99,50 50,99 1,50' : '50,2 98,98 2,98'}
            fill={color.bg}
            stroke={borderColor}
            strokeWidth={strokeWidth}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <div style={{
          position: 'absolute',
          inset: 0,
          background: color.bg,
          border: `${strokeWidth}px solid ${borderColor}`,
          borderRadius: shape === 'ellipse' ? '50%' : rounded ? 10 : 0,
          boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
          boxSizing: 'border-box',
        }} />
      )}

      <div
        className="canvas-card-content"
        style={{
          position: 'absolute',
          ...contentInset(shape),
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: shape === 'rect' ? 'flex-start' : 'center',
        }}
      >
        {editing ? (
          <CardEditor initialHtml={html} active={selected} onCommit={commit} />
        ) : (
          <div
            style={styles.cardText}
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) || '<p style="opacity:0.35">Double-click to edit</p>' }}
          />
        )}
      </div>

      {/* Loose handles on all four sides so edges can run anywhere. */}
      <Handle id="t" type="source" position={Position.Top} style={HANDLE_STYLE} />
      <Handle id="r" type="source" position={Position.Right} style={HANDLE_STYLE} />
      <Handle id="b" type="source" position={Position.Bottom} style={HANDLE_STYLE} />
      <Handle id="l" type="source" position={Position.Left} style={HANDLE_STYLE} />
    </div>
  );
}

const nodeTypes = { card: CardNode };

const DEFAULT_EDGE_OPTIONS = {
  style: { stroke: 'rgba(255,255,255,0.35)', strokeWidth: 2 },
  markerEnd: { type: MarkerType.ArrowClosed, color: 'rgba(255,255,255,0.35)' },
};

function CanvasInner({ canvasId, title, onBack }) {
  const { screenToFlowPosition } = useReactFlow();
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [menu, setMenu] = useState(null); // { kind: 'node' | 'edge', x, y, id }

  // Handle-reveal CSS, editor resets, and the canvas font set (loaded once).
  useEffect(() => {
    if (!document.getElementById('canvas-board-styles')) {
      const el = document.createElement('style');
      el.id = 'canvas-board-styles';
      el.textContent = `
        .react-flow__node .react-flow__handle { opacity: 0; transition: opacity 0.12s; }
        .react-flow__node:hover .react-flow__handle,
        .react-flow__node.selected .react-flow__handle { opacity: 1; }
        .canvas-card-content p { margin: 0; }
        .canvas-card-content .ProseMirror { outline: none; }
        .canvas-card-content mark { border-radius: 2px; padding: 0 1px; }
      `;
      document.head.appendChild(el);
    }
    if (!document.getElementById('canvas-board-fonts')) {
      const link = document.createElement('link');
      link.id = 'canvas-board-fonts';
      link.rel = 'stylesheet';
      link.href = GOOGLE_FONTS_URL;
      document.head.appendChild(link);
    }
  }, []);

  const dirtyRef = useRef(false);
  const loadedRef = useRef(false);
  const stateRef = useRef({ nodes: [], edges: [], viewport });
  useEffect(() => { loadedRef.current = loaded; }, [loaded]);
  useEffect(() => { stateRef.current = { nodes, edges, viewport }; }, [nodes, edges, viewport]);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    dirtyRef.current = false;
    (async () => {
      const { data, error } = await supabase.from('canvases')
        .select('content').eq('id', canvasId).single();
      if (cancelled) return;
      if (error) { console.error('Error loading canvas:', error); return; }
      setNodes(data?.content?.nodes || []);
      setEdges(data?.content?.edges || []);
      if (data?.content?.viewport) setViewport(data.content.viewport);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [canvasId]);

  const flush = useCallback(async () => {
    if (!loadedRef.current || !dirtyRef.current) return;
    dirtyRef.current = false;
    setSaving(true);
    const { nodes: n, edges: e, viewport: v } = stateRef.current;
    const { error } = await supabase.from('canvases').update({
      content: { nodes: n, edges: e, viewport: v },
      updated_at: new Date().toISOString(),
    }).eq('id', canvasId);
    setSaving(false);
    if (error) {
      // Leave dirty so the next change or unmount flush retries.
      dirtyRef.current = true;
      console.error('Canvas autosave failed:', error.message);
    }
  }, [canvasId]);

  // Debounced autosave + flush on unmount (Back within the debounce window).
  const flushRef = useRef(flush);
  useEffect(() => { flushRef.current = flush; }, [flush]);
  const markDirty = useCallback(() => {
    if (!loadedRef.current) return;
    dirtyRef.current = true;
  }, []);
  useEffect(() => {
    const interval = setInterval(() => flushRef.current(), 2000);
    return () => {
      clearInterval(interval);
      flushRef.current();
    };
  }, []);

  const onNodesChange = useCallback((changes) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
    markDirty();
  }, [markDirty]);
  const onEdgesChange = useCallback((changes) => {
    setEdges((eds) => applyEdgeChanges(changes, eds));
    markDirty();
  }, [markDirty]);
  const onConnect = useCallback((connection) => {
    setEdges((eds) => addEdge(connection, eds));
    markDirty();
  }, [markDirty]);

  function addCard(position) {
    const id = `card_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setNodes((nds) => [
      ...nds.map((n) => ({ ...n, selected: false })),
      {
        id,
        type: 'card',
        position,
        width: 220,
        height: 90,
        data: { html: '', color: 'default', shape: 'rect', rounded: true, strokeWidth: 2 },
        selected: true,
      },
    ]);
    markDirty();
  }

  function addCardAtCenter() {
    addCard(screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    }));
  }

  function duplicateNode(nodeId) {
    setNodes((nds) => {
      const src = nds.find((n) => n.id === nodeId);
      if (!src) return nds;
      const id = `card_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      return [
        ...nds.map((n) => ({ ...n, selected: false })),
        {
          ...src,
          id,
          position: { x: src.position.x + 28, y: src.position.y + 28 },
          data: { ...src.data },
          selected: true,
        },
      ];
    });
    markDirty();
  }

  function deleteNode(nodeId) {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    markDirty();
  }

  function setEdgeColor(edgeId, color) {
    setEdges((eds) => eds.map((e) => (e.id === edgeId ? {
      ...e,
      style: { ...(e.style || {}), stroke: color, strokeWidth: (e.style?.strokeWidth) || 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color },
    } : e)));
    markDirty();
  }

  function deleteEdge(edgeId) {
    setEdges((eds) => eds.filter((e) => e.id !== edgeId));
    markDirty();
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.toolbar}>
        <button onClick={onBack} style={styles.backBtn}>← Back</button>
        <span style={styles.title}>{title}</span>
        <span style={styles.saveState}>{saving ? 'Saving…' : ''}</span>
        <div style={{ flex: 1 }} />
        <span style={styles.hint}>Double-click canvas for a card · right-click cards & arrows for options</span>
        <button onClick={addCardAtCenter} style={styles.addBtn}>+ Card</button>
      </div>
      <div
        style={styles.canvas}
        onDoubleClick={(e) => {
          // Only on empty canvas — double-click on a card edits it instead.
          if (e.target.classList?.contains('react-flow__pane')) {
            addCard(screenToFlowPosition({ x: e.clientX, y: e.clientY }));
          }
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          connectionMode={ConnectionMode.Loose}
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          colorMode="dark"
          fitView={false}
          viewport={viewport}
          onViewportChange={(v) => { setViewport(v); markDirty(); }}
          onNodeContextMenu={(e, node) => {
            e.preventDefault();
            setMenu({ kind: 'node', x: e.clientX, y: e.clientY, id: node.id });
          }}
          onEdgeContextMenu={(e, edge) => {
            e.preventDefault();
            setMenu({ kind: 'edge', x: e.clientX, y: e.clientY, id: edge.id });
          }}
          deleteKeyCode={['Backspace', 'Delete']}
          zoomOnDoubleClick={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="rgba(255,255,255,0.12)" gap={22} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      {menu && (
        <>
          <div
            style={styles.ctxOverlay}
            onClick={() => setMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}
          />
          <div style={{ ...styles.ctxMenu, top: menu.y, left: menu.x }}>
            {menu.kind === 'node' ? (
              <>
                <button style={styles.ctxItem} onClick={() => { duplicateNode(menu.id); setMenu(null); }}>Duplicate</button>
                <button style={{ ...styles.ctxItem, color: '#f87171' }} onClick={() => { deleteNode(menu.id); setMenu(null); }}>Delete</button>
              </>
            ) : (
              <>
                <div style={styles.ctxLabel}>Arrow color</div>
                <div style={styles.ctxColorRow}>
                  {EDGE_COLORS.map((c) => (
                    <button
                      key={c}
                      style={{ ...styles.colorDot, background: c }}
                      onClick={() => { setEdgeColor(menu.id, c); setMenu(null); }}
                      title={c}
                    />
                  ))}
                </div>
                <button style={{ ...styles.ctxItem, color: '#f87171' }} onClick={() => { deleteEdge(menu.id); setMenu(null); }}>Delete</button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function CanvasBoard(props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

const styles = {
  wrap: {
    position: 'fixed',
    inset: 0,
    zIndex: 500,
    background: '#0f0f1a',
    display: 'flex',
    flexDirection: 'column',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    padding: '12px 20px',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    background: '#12121f',
  },
  backBtn: {
    padding: '6px 14px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#e2e8f0',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  title: { fontSize: '15px', fontWeight: 700, color: '#fff' },
  saveState: { fontSize: '11px', color: 'rgba(255,255,255,0.35)', minWidth: 50 },
  hint: { fontSize: '11px', color: 'rgba(255,255,255,0.25)' },
  addBtn: {
    padding: '6px 16px',
    background: '#6366f1',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  canvas: { flex: 1, minHeight: 0 },
  shapeSvg: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    overflow: 'visible',
    filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.35))',
  },
  cardText: {
    fontSize: '13px',
    color: '#e2e8f0',
    fontFamily: 'DM Sans, sans-serif',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    lineHeight: 1.45,
  },
  editorContent: {
    fontSize: '13px',
    color: '#fff',
    fontFamily: 'DM Sans, sans-serif',
    lineHeight: 1.45,
    minHeight: '100%',
    cursor: 'text',
  },
  styleBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    padding: '6px 8px',
    background: '#1e1e32',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '8px',
    boxShadow: '0 6px 18px rgba(0,0,0,0.4)',
  },
  fmtBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '6px 8px',
    background: '#1e1e32',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '8px',
    boxShadow: '0 6px 18px rgba(0,0,0,0.4)',
  },
  fmtBtn: {
    width: 24,
    height: 24,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    borderRadius: '5px',
    color: 'rgba(255,255,255,0.7)',
    fontSize: '13px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    padding: 0,
  },
  fmtBtnActive: {
    background: 'rgba(99,102,241,0.25)',
    color: '#a5b4fc',
  },
  fmtSelect: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '6px',
    color: '#e2e8f0',
    fontSize: '12px',
    padding: '3px 4px',
    outline: 'none',
  },
  fmtDivider: {
    width: 1,
    height: 16,
    background: 'rgba(255,255,255,0.12)',
    margin: '0 3px',
  },
  hlDot: {
    width: 14,
    height: 14,
    borderRadius: '3px',
    border: '1px solid rgba(0,0,0,0.3)',
    cursor: 'pointer',
    padding: 0,
  },
  colorDot: {
    width: 16,
    height: 16,
    borderRadius: '50%',
    border: '1px solid rgba(255,255,255,0.25)',
    cursor: 'pointer',
    padding: 0,
  },
  ctxOverlay: { position: 'fixed', inset: 0, zIndex: 10000 },
  ctxMenu: {
    position: 'fixed',
    zIndex: 10001,
    background: '#1e1e32',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '10px',
    padding: '4px',
    minWidth: '150px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  },
  ctxItem: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: 'none',
    border: 'none',
    borderRadius: '6px',
    padding: '8px 12px',
    color: '#e2e8f0',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  ctxLabel: {
    padding: '6px 12px 2px',
    fontSize: '10px',
    fontWeight: 700,
    color: 'rgba(255,255,255,0.35)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  ctxColorRow: {
    display: 'flex',
    gap: '6px',
    padding: '6px 12px 8px',
    flexWrap: 'wrap',
  },
};
