import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  NodeToolbar,
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
import { supabase } from '../../supabaseClient';

// Obsidian-Canvas-style board: draggable text cards connected by edges on an
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

const HANDLE_STYLE = {
  width: 8,
  height: 8,
  background: '#6366f1',
  border: '1px solid #0f0f1a',
};

function CardNode({ id, data, selected }) {
  const { updateNodeData } = useReactFlow();
  const [editing, setEditing] = useState(data.label === '');
  const [draft, setDraft] = useState(data.label || '');
  const color = COLOR_BY_KEY[data.color] || CARD_COLORS[0];

  function commit() {
    updateNodeData(id, { label: draft });
    setEditing(false);
  }

  return (
    <>
      <NodeToolbar isVisible={selected && !editing} position={Position.Top}>
        <div style={styles.colorBar}>
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
        </div>
      </NodeToolbar>
      <div
        onDoubleClick={() => { setDraft(data.label || ''); setEditing(true); }}
        style={{
          ...styles.card,
          borderColor: selected ? '#6366f1' : color.border,
          background: color.bg,
        }}
      >
        {editing ? (
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setDraft(data.label || ''); setEditing(false); }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit();
            }}
            placeholder="Type something…"
            className="nodrag nowheel"
            style={styles.cardTextarea}
          />
        ) : (
          <div style={styles.cardText}>
            {data.label || <span style={{ opacity: 0.35 }}>Double-click to edit</span>}
          </div>
        )}
      </div>
      {/* Loose handles on all four sides so edges can run anywhere. */}
      <Handle id="t" type="source" position={Position.Top} style={HANDLE_STYLE} />
      <Handle id="r" type="source" position={Position.Right} style={HANDLE_STYLE} />
      <Handle id="b" type="source" position={Position.Bottom} style={HANDLE_STYLE} />
      <Handle id="l" type="source" position={Position.Left} style={HANDLE_STYLE} />
    </>
  );
}

const nodeTypes = { card: CardNode };

const DEFAULT_EDGE_OPTIONS = {
  style: { stroke: 'rgba(255,255,255,0.35)', strokeWidth: 2 },
  markerEnd: { type: MarkerType.ArrowClosed, color: 'rgba(255,255,255,0.35)' },
};

function CanvasInner({ canvasId, title, onBack }) {
  const { screenToFlowPosition } = useReactFlow();

  // Connection handles hide until the card is hovered/selected (Obsidian-style).
  useEffect(() => {
    if (document.getElementById('canvas-board-styles')) return;
    const el = document.createElement('style');
    el.id = 'canvas-board-styles';
    el.textContent = `
      .react-flow__node .react-flow__handle { opacity: 0; transition: opacity 0.12s; }
      .react-flow__node:hover .react-flow__handle,
      .react-flow__node.selected .react-flow__handle { opacity: 1; }
    `;
    document.head.appendChild(el);
  }, []);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

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
    setNodes((nds) => [...nds, {
      id,
      type: 'card',
      position,
      data: { label: '', color: 'default' },
      selected: true,
    }].map((n) => (n.id === id ? n : { ...n, selected: false })));
    markDirty();
  }

  function addCardAtCenter() {
    addCard(screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    }));
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.toolbar}>
        <button onClick={onBack} style={styles.backBtn}>← Back</button>
        <span style={styles.title}>{title}</span>
        <span style={styles.saveState}>{saving ? 'Saving…' : ''}</span>
        <div style={{ flex: 1 }} />
        <span style={styles.hint}>Double-click canvas or card · drag edges from card borders</span>
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
          deleteKeyCode={['Backspace', 'Delete']}
          zoomOnDoubleClick={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="rgba(255,255,255,0.12)" gap={22} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
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
  card: {
    minWidth: 180,
    maxWidth: 320,
    minHeight: 44,
    border: '1.5px solid',
    borderRadius: '10px',
    padding: '10px 12px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
    fontFamily: 'DM Sans, sans-serif',
  },
  cardText: {
    fontSize: '13px',
    color: '#e2e8f0',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    lineHeight: 1.45,
  },
  cardTextarea: {
    width: '100%',
    minHeight: 60,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    resize: 'none',
    color: '#fff',
    fontSize: '13px',
    fontFamily: 'inherit',
    lineHeight: 1.45,
  },
  colorBar: {
    display: 'flex',
    gap: '6px',
    padding: '6px 8px',
    background: '#1e1e32',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '8px',
    boxShadow: '0 6px 18px rgba(0,0,0,0.4)',
  },
  colorDot: {
    width: 16,
    height: 16,
    borderRadius: '50%',
    border: '1px solid rgba(255,255,255,0.25)',
    cursor: 'pointer',
    padding: 0,
  },
};
