import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../supabaseClient';

const NOTE_COLORS = [
  { bg: '#fef08a', text: '#713f12', name: 'Yellow' },
  { bg: '#bbf7d0', text: '#14532d', name: 'Green' },
  { bg: '#bfdbfe', text: '#1e3a5f', name: 'Blue' },
  { bg: '#fecaca', text: '#7f1d1d', name: 'Red' },
  { bg: '#e9d5ff', text: '#581c87', name: 'Purple' },
  { bg: '#fed7aa', text: '#7c2d12', name: 'Orange' },
  { bg: '#f3f4f6', text: '#1f2937', name: 'Gray' },
  { bg: '#fce7f3', text: '#831843', name: 'Pink' },
];

export default function StickyBoard({ docId, title, docType, onBack, onSaveTemplate }) {
  const [notes, setNotes] = useState([]);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [selectedNote, setSelectedNote] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [resizing, setResizing] = useState(null);
  const boardRef = useRef(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });

  useEffect(() => { loadDoc(); }, [docId]);

  async function loadDoc() {
    const { data } = await supabase.from('concept_documents')
      .select('content').eq('id', docId).single();
    if (data?.content?.notes) setNotes(data.content.notes);
    setLoaded(true);
  }

  const save = useCallback(async (notesToSave) => {
    setSaving(true);
    await supabase.from('concept_documents')
      .update({ content: { notes: notesToSave || notes }, updated_at: new Date().toISOString() })
      .eq('id', docId);
    setSaving(false);
  }, [notes, docId]);

  // Auto-save debounced
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => save(notes), 2000);
    return () => clearTimeout(timer);
  }, [notes, loaded]);

  function addNote() {
    const newNote = {
      id: Date.now().toString(),
      x: 40 + Math.random() * 200,
      y: 40 + Math.random() * 200,
      width: 200,
      height: 180,
      colorIdx: Math.floor(Math.random() * NOTE_COLORS.length),
      text: '',
      bold: false,
      italic: false,
      fontSize: 14,
    };
    setNotes(prev => [...prev, newNote]);
    setSelectedNote(newNote.id);
  }

  function updateNote(id, updates) {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, ...updates } : n));
  }

  function deleteNote(id) {
    setNotes(prev => prev.filter(n => n.id !== id));
    if (selectedNote === id) setSelectedNote(null);
  }

  function duplicateNote(id) {
    const note = notes.find(n => n.id === id);
    if (!note) return;
    const newNote = {
      ...note,
      id: Date.now().toString(),
      x: note.x + 20,
      y: note.y + 20,
    };
    setNotes(prev => [...prev, newNote]);
    setSelectedNote(newNote.id);
  }

  // Drag handlers
  function handleMouseDown(e, noteId) {
    if (e.target.tagName === 'TEXTAREA' || e.target.closest('[data-resize]') || e.target.closest('[data-action]')) return;
    e.preventDefault();
    const note = notes.find(n => n.id === noteId);
    if (!note) return;
    const rect = boardRef.current.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left - note.x, y: e.clientY - rect.top - note.y };
    setDragging(noteId);
    setSelectedNote(noteId);
    // Bring to front
    setNotes(prev => {
      const idx = prev.findIndex(n => n.id === noteId);
      if (idx === -1) return prev;
      const note = prev[idx];
      return [...prev.slice(0, idx), ...prev.slice(idx + 1), note];
    });
  }

  function handleResizeStart(e, noteId) {
    e.preventDefault();
    e.stopPropagation();
    const note = notes.find(n => n.id === noteId);
    if (!note) return;
    resizeStart.current = { x: e.clientX, y: e.clientY, w: note.width, h: note.height };
    setResizing(noteId);
  }

  useEffect(() => {
    function handleMove(e) {
      if (dragging) {
        const rect = boardRef.current.getBoundingClientRect();
        const x = Math.max(0, e.clientX - rect.left - dragOffset.current.x);
        const y = Math.max(0, e.clientY - rect.top - dragOffset.current.y);
        updateNote(dragging, { x, y });
      }
      if (resizing) {
        const dx = e.clientX - resizeStart.current.x;
        const dy = e.clientY - resizeStart.current.y;
        updateNote(resizing, {
          width: Math.max(120, resizeStart.current.w + dx),
          height: Math.max(80, resizeStart.current.h + dy),
        });
      }
    }
    function handleUp() {
      setDragging(null);
      setResizing(null);
    }
    if (dragging || resizing) {
      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp);
      return () => {
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleUp);
      };
    }
  }, [dragging, resizing]);

  const selectedNoteData = notes.find(n => n.id === selectedNote);

  return (
    <div style={styles.page}>
      {/* Toolbar */}
      <div style={styles.toolbar}>
        <button onClick={onBack} style={styles.backBtn}>← Back</button>
        <span style={styles.titleText}>{title}</span>
        <button onClick={addNote} style={styles.addNoteBtn}>+ Add Note</button>

        {selectedNoteData && (
          <>
            <div style={styles.toolGroup}>
              {NOTE_COLORS.map((c, i) => (
                <button key={i} onClick={() => updateNote(selectedNote, { colorIdx: i })}
                  style={{
                    ...styles.colorBtn, background: c.bg,
                    outline: selectedNoteData.colorIdx === i ? `2px solid ${c.bg}` : 'none',
                    outlineOffset: '2px',
                  }}
                  title={c.name}
                />
              ))}
            </div>
            <div style={styles.toolGroup}>
              <button
                onClick={() => updateNote(selectedNote, { bold: !selectedNoteData.bold })}
                style={{ ...styles.formatBtn, ...(selectedNoteData.bold ? styles.formatBtnActive : {}), fontWeight: 700 }}
              >B</button>
              <button
                onClick={() => updateNote(selectedNote, { italic: !selectedNoteData.italic })}
                style={{ ...styles.formatBtn, ...(selectedNoteData.italic ? styles.formatBtnActive : {}), fontStyle: 'italic' }}
              >I</button>
              <button
                onClick={() => updateNote(selectedNote, { fontSize: Math.max(10, (selectedNoteData.fontSize || 14) - 2) })}
                style={styles.formatBtn}
              >A-</button>
              <button
                onClick={() => updateNote(selectedNote, { fontSize: Math.min(28, (selectedNoteData.fontSize || 14) + 2) })}
                style={styles.formatBtn}
              >A+</button>
            </div>
            <button onClick={() => duplicateNote(selectedNote)} style={styles.dupNoteBtn}>⧉ Duplicate</button>
            <button onClick={() => deleteNote(selectedNote)} style={styles.deleteNoteBtn}>🗑 Delete</button>
          </>
        )}

        <button onClick={() => save(notes)} style={styles.saveBtn}>
          {saving ? 'Saving...' : '💾 Save'}
        </button>
        <button onClick={() => {
          const name = prompt('Template name:');
          if (name) onSaveTemplate(name, 'stickyboard', { notes });
        }} style={styles.templateBtn}>📋 Save as Template</button>
      </div>

      {/* Board */}
      <div
        ref={boardRef}
        style={styles.board}
        onClick={() => setSelectedNote(null)}
      >
        {notes.length === 0 && (
          <div style={styles.emptyBoard}>
            <p style={styles.emptyText}>Click "Add Note" to start brainstorming</p>
          </div>
        )}

        {notes.map(note => {
          const noteColor = NOTE_COLORS[note.colorIdx] || NOTE_COLORS[0];
          const isSelected = selectedNote === note.id;
          return (
            <div
              key={note.id}
              style={{
                position: 'absolute',
                left: `${note.x}px`,
                top: `${note.y}px`,
                width: `${note.width}px`,
                height: `${note.height}px`,
                background: noteColor.bg,
                borderRadius: '4px',
                boxShadow: isSelected
                  ? '0 4px 20px rgba(0,0,0,0.4), 0 0 0 2px rgba(99,102,241,0.5)'
                  : '0 2px 8px rgba(0,0,0,0.3)',
                cursor: dragging === note.id ? 'grabbing' : 'grab',
                zIndex: isSelected ? 10 : 1,
                display: 'flex',
                flexDirection: 'column',
                userSelect: 'none',
                transition: dragging === note.id ? 'none' : 'box-shadow 0.15s',
              }}
              onMouseDown={(e) => handleMouseDown(e, note.id)}
              onClick={(e) => { e.stopPropagation(); setSelectedNote(note.id); }}
            >
              {/* Note header bar */}
              <div style={{
                height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                padding: '0 6px', flexShrink: 0, gap: '2px',
              }}>
                <button
                  data-action="duplicate"
                  onClick={(e) => { e.stopPropagation(); duplicateNote(note.id); }}
                  style={{ background: 'none', border: 'none', color: `${noteColor.text}50`, cursor: 'pointer', fontSize: '11px', padding: '2px' }}
                  title="Duplicate note"
                >⧉</button>
                <button
                  data-action="delete"
                  onClick={(e) => { e.stopPropagation(); deleteNote(note.id); }}
                  style={{ background: 'none', border: 'none', color: `${noteColor.text}50`, cursor: 'pointer', fontSize: '13px', padding: '2px' }}
                >✕</button>
              </div>

              {/* Text area */}
              <textarea
                value={note.text}
                onChange={(e) => updateNote(note.id, { text: e.target.value })}
                onClick={(e) => { e.stopPropagation(); setSelectedNote(note.id); }}
                placeholder="Type here..."
                style={{
                  flex: 1, resize: 'none', border: 'none', outline: 'none',
                  background: 'transparent', padding: '0 10px 10px',
                  color: noteColor.text, fontSize: `${note.fontSize || 14}px`,
                  fontWeight: note.bold ? 700 : 400,
                  fontStyle: note.italic ? 'italic' : 'normal',
                  fontFamily: "'DM Sans', sans-serif",
                  lineHeight: 1.4, cursor: 'text',
                }}
              />

              {/* Resize handle */}
              <div
                data-resize="true"
                onMouseDown={(e) => handleResizeStart(e, note.id)}
                style={{
                  position: 'absolute', bottom: 0, right: 0,
                  width: '16px', height: '16px', cursor: 'nwse-resize',
                }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" style={{ position: 'absolute', bottom: '3px', right: '3px' }}>
                  <path d="M9 1L1 9M9 5L5 9" stroke={`${noteColor.text}30`} strokeWidth="1.5" />
                </svg>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles = {
  page: { display: 'flex', flexDirection: 'column', height: '100%' },
  toolbar: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)', flexWrap: 'wrap' },
  backBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.45)', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500, padding: '6px 10px' },
  titleText: { fontSize: '15px', fontWeight: 600, color: '#e2e8f0', marginRight: 'auto' },
  addNoteBtn: { padding: '6px 14px', background: '#6366f1', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  toolGroup: { display: 'flex', alignItems: 'center', gap: '4px', padding: '0 8px', borderLeft: '1px solid rgba(255,255,255,0.06)' },
  colorBtn: { width: '20px', height: '20px', borderRadius: '5px', border: '1px solid rgba(0,0,0,0.1)', cursor: 'pointer' },
  formatBtn: { width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '5px', color: 'rgba(255,255,255,0.5)', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit' },
  formatBtnActive: { background: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.3)', color: '#a5b4fc' },
  deleteNoteBtn: { padding: '6px 10px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '6px', color: '#fca5a5', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit' },
  dupNoteBtn: { padding: '6px 10px', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '6px', color: '#a5b4fc', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit' },
  saveBtn: { padding: '6px 14px', background: '#22c55e', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', marginLeft: 'auto' },
  templateBtn: { padding: '6px 12px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: 'rgba(255,255,255,0.45)', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit' },
  board: { flex: 1, position: 'relative', overflow: 'auto', background: '#0a0a14', backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.03) 1px, transparent 1px)', backgroundSize: '24px 24px' },
  emptyBoard: { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' },
  emptyText: { color: 'rgba(255,255,255,0.2)', fontSize: '14px' },
};
