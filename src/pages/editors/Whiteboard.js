import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../supabaseClient';

const COLORS = ['#ffffff', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280'];
const WIDTHS = [2, 4, 8, 14];

export default function Whiteboard({ docId, title, docType, onBack, onSaveTemplate }) {
  const canvasRef = useRef(null);
  const [strokes, setStrokes] = useState([]);
  const [currentStroke, setCurrentStroke] = useState(null);
  const [color, setColor] = useState('#ffffff');
  const [width, setWidth] = useState(4);
  const [tool, setTool] = useState('pen'); // pen or eraser
  const [undoStack, setUndoStack] = useState([]);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const isDrawing = useRef(false);

  // Load
  useEffect(() => {
    loadDoc();
  }, [docId]);

  async function loadDoc() {
    const { data } = await supabase.from('concept_documents')
      .select('content').eq('id', docId).single();
    if (data?.content?.strokes) setStrokes(data.content.strokes);
    setLoaded(true);
  }

  // Redraw canvas whenever strokes change
  useEffect(() => {
    if (!loaded) return;
    redraw();
  }, [strokes, currentStroke, loaded]);

  // Resize canvas
  useEffect(() => {
    function resize() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const parent = canvas.parentElement;
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
      redraw();
    }
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [loaded]);

  function redraw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    [...strokes, ...(currentStroke ? [currentStroke] : [])].forEach(stroke => {
      if (stroke.points.length < 2) return;
      ctx.strokeStyle = stroke.eraser ? '#0f0f1a' : stroke.color;
      ctx.lineWidth = stroke.eraser ? stroke.width * 3 : stroke.width;
      ctx.globalCompositeOperation = stroke.eraser ? 'destination-out' : 'source-over';
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
    });
    ctx.globalCompositeOperation = 'source-over';
  }

  function getPos(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function startDraw(e) {
    e.preventDefault();
    isDrawing.current = true;
    const pos = getPos(e);
    setCurrentStroke({
      color, width, eraser: tool === 'eraser',
      points: [pos],
    });
  }

  function draw(e) {
    if (!isDrawing.current || !currentStroke) return;
    e.preventDefault();
    const pos = getPos(e);
    setCurrentStroke(prev => ({
      ...prev,
      points: [...prev.points, pos],
    }));
  }

  function endDraw() {
    if (!isDrawing.current || !currentStroke) return;
    isDrawing.current = false;
    if (currentStroke.points.length > 1) {
      setStrokes(prev => [...prev, currentStroke]);
      setUndoStack([]);
    }
    setCurrentStroke(null);
  }

  function handleUndo() {
    if (strokes.length === 0) return;
    setUndoStack(prev => [...prev, strokes[strokes.length - 1]]);
    setStrokes(prev => prev.slice(0, -1));
  }

  function handleRedo() {
    if (undoStack.length === 0) return;
    setStrokes(prev => [...prev, undoStack[undoStack.length - 1]]);
    setUndoStack(prev => prev.slice(0, -1));
  }

  function handleClear() {
    if (!window.confirm('Clear the entire canvas?')) return;
    setUndoStack([]);
    setStrokes([]);
  }

  const save = useCallback(async () => {
    setSaving(true);
    await supabase.from('concept_documents')
      .update({ content: { strokes }, updated_at: new Date().toISOString() })
      .eq('id', docId);
    setSaving(false);
  }, [strokes, docId]);

  // Auto-save on stroke changes (debounced)
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => { save(); }, 2000);
    return () => clearTimeout(timer);
  }, [strokes, loaded, save]);

  return (
    <div style={styles.page}>
      {/* Toolbar */}
      <div style={styles.toolbar}>
        <button onClick={onBack} style={styles.backBtn}>← Back</button>
        <span style={styles.titleText}>{title}</span>
        <div style={styles.toolGroup}>
          <button onClick={() => setTool('pen')}
            style={{ ...styles.toolBtn, ...(tool === 'pen' ? styles.toolBtnActive : {}) }}>
            ✏️ Pen
          </button>
          <button onClick={() => setTool('eraser')}
            style={{ ...styles.toolBtn, ...(tool === 'eraser' ? styles.toolBtnActive : {}) }}>
            🧹 Eraser
          </button>
        </div>
        <div style={styles.toolGroup}>
          {COLORS.map(c => (
            <button key={c} onClick={() => { setColor(c); setTool('pen'); }}
              style={{
                ...styles.colorBtn,
                background: c,
                outline: color === c && tool === 'pen' ? `2px solid ${c}` : 'none',
                outlineOffset: '2px',
              }} />
          ))}
        </div>
        <div style={styles.toolGroup}>
          {WIDTHS.map(w => (
            <button key={w} onClick={() => setWidth(w)}
              style={{ ...styles.widthBtn, ...(width === w ? styles.widthBtnActive : {}) }}>
              <div style={{ width: `${w + 4}px`, height: `${w + 4}px`, borderRadius: '50%', background: width === w ? '#fff' : 'rgba(255,255,255,0.4)' }} />
            </button>
          ))}
        </div>
        <div style={styles.toolGroup}>
          <button onClick={handleUndo} style={styles.toolBtn} disabled={strokes.length === 0}>↩ Undo</button>
          <button onClick={handleRedo} style={styles.toolBtn} disabled={undoStack.length === 0}>↪ Redo</button>
          <button onClick={handleClear} style={styles.toolBtn}>🗑 Clear</button>
        </div>
        <button onClick={save} style={styles.saveBtn}>
          {saving ? 'Saving...' : '💾 Save'}
        </button>
        <button onClick={() => {
          const name = prompt('Template name:');
          if (name) onSaveTemplate(name, 'whiteboard', { strokes });
        }} style={styles.templateBtn}>📋 Save as Template</button>
      </div>

      {/* Canvas */}
      <div style={styles.canvasWrap}>
        <canvas
          ref={canvasRef}
          style={styles.canvas}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
      </div>
    </div>
  );
}

const styles = {
  page: { display: 'flex', flexDirection: 'column', height: '100%' },
  toolbar: { display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)', flexWrap: 'wrap' },
  backBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.45)', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500, padding: '6px 10px' },
  titleText: { fontSize: '15px', fontWeight: 600, color: '#e2e8f0', marginRight: 'auto' },
  toolGroup: { display: 'flex', alignItems: 'center', gap: '4px', padding: '0 8px', borderLeft: '1px solid rgba(255,255,255,0.06)' },
  toolBtn: { padding: '6px 10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px', color: 'rgba(255,255,255,0.5)', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' },
  toolBtnActive: { background: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.3)', color: '#a5b4fc' },
  colorBtn: { width: '22px', height: '22px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' },
  widthBtn: { width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px', cursor: 'pointer' },
  widthBtnActive: { background: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.3)' },
  saveBtn: { padding: '6px 14px', background: '#22c55e', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  templateBtn: { padding: '6px 12px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: 'rgba(255,255,255,0.45)', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit' },
  canvasWrap: { flex: 1, position: 'relative', overflow: 'hidden', background: '#0f0f1a' },
  canvas: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', cursor: 'crosshair' },
};
