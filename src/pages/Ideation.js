import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import { getDisplayName } from '../lib/displayName';

import Whiteboard from './editors/Whiteboard';
import StickyBoard from './editors/StickyBoard';
import DocEditor from './editors/DocEditor';
import Storyboard from './editors/Storyboard';
import ScriptEditor from './editors/screenplay-editor/components/editor/ScriptEditor';

const CONCEPT_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#22c55e', '#3b82f6', '#ef4444', '#14b8a6'];
const CONCEPT_CATEGORIES = [
  { value: 'articles', label: 'Articles' },
  { value: 'long_form_video', label: 'Long Form Video' },
  { value: 'short_form_video', label: 'Short Form Video' },
  { value: 'other', label: 'Other' },
];
const DOC_TYPES = {
  whiteboard: { label: 'Whiteboard', icon: '🎨', desc: 'Freehand drawing canvas' },
  stickyboard: { label: 'Sticky Board', icon: '📌', desc: 'Drag & drop sticky notes' },
  document: { label: 'Document', icon: '📝', desc: 'Rich text editor with export' },
  storyboard: { label: 'Storyboard', icon: '🎬', desc: 'Multi-page visual storyboard' },
  screenwriter: { label: 'Screenwriter', icon: '🎬', desc: 'Industry-standard screenplay editor' },
};

export default function Ideation({ initialConceptId, onConceptOpened }) {
  const { profile, isAdmin, refreshKey } = useAuth();
  const confirm = useConfirm();
  const [concepts, setConcepts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateConcept, setShowCreateConcept] = useState(false);
  const [conceptForm, setConceptForm] = useState({ name: '', description: '', color: '#6366f1', category: 'other' });
  const [activeConcept, setActiveConcept] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [activeDoc, setActiveDoc] = useState(null);
  const [showCreateDoc, setShowCreateDoc] = useState(false);
  const [docForm, setDocForm] = useState({ title: '', type: 'stickyboard', templateId: '' });
  const [templates, setTemplates] = useState([]);
  const mdUploadRef = useRef(null);

  // Context menu & editing state
  const [contextMenu, setContextMenu] = useState(null);
  const [editingConcept, setEditingConcept] = useState(null);
  const [mergingConcept, setMergingConcept] = useState(null);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [mergeName, setMergeName] = useState('');


  // Document context menu & rename state
  const [docContextMenu, setDocContextMenu] = useState(null); // { x, y, doc }
  const [renamingDoc, setRenamingDoc] = useState(null);
  const [renameDocValue, setRenameDocValue] = useState('');

  // All Documents section
  const [allDocs, setAllDocs] = useState([]);
  const [allDocsLoading, setAllDocsLoading] = useState(false);

  const fetchConcepts = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('concepts')
        .select('*, creator:profiles!concepts_created_by_fkey(full_name, nickname)')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      setConcepts(data || []);
    } catch (err) {
      console.error('Error fetching concepts:', err);
      setConcepts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTemplates = useCallback(async () => {
    try {
      const { data } = await supabase.from('concept_templates')
        .select('*').order('created_at', { ascending: false });
      setTemplates(data || []);
    } catch (err) {
      console.error('Error fetching templates:', err);
    }
  }, []);

  const fetchAllDocs = useCallback(async () => {
    setAllDocsLoading(true);
    try {
      const { data } = await supabase.from('concept_documents')
        .select('id, concept_id, type, title, created_at, updated_at')
        .order('updated_at', { ascending: false })
        .limit(100);
      setAllDocs(data || []);
    } catch (err) {
      console.error('Error fetching all docs:', err);
    } finally {
      setAllDocsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!profile?.id) return;
    Promise.all([fetchConcepts(), fetchTemplates(), fetchAllDocs()]);
  }, [profile?.id, fetchConcepts, fetchTemplates, fetchAllDocs]);
  useVisibilityRefresh(fetchConcepts);

  // Handle deep-link from Projects page (works even when already mounted)
  useEffect(() => {
    if (initialConceptId && concepts.length > 0) {
      const target = concepts.find(c => c.id === initialConceptId);
      if (target && target.id !== activeConcept?.id) {
        setActiveDoc(null);
        setActiveConcept(target);
        if (onConceptOpened) onConceptOpened();
      }
    }
  }, [initialConceptId, concepts]);

  useEffect(() => {
    if (activeConcept) fetchDocuments(activeConcept.id);
  }, [activeConcept]);

  async function fetchDocuments(conceptId) {
    try {
      const { data, error } = await supabase.from('concept_documents')
        .select('id, concept_id, type, title, created_at, updated_at, created_by')
        .eq('concept_id', conceptId)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      setDocuments(data || []);
    } catch (err) {
      console.error('Error fetching documents:', err);
      setDocuments([]);
    }
  }

  async function handleRenameDoc(docId, newTitle) {
    if (!newTitle.trim()) { setRenamingDoc(null); setRenameDocValue(''); return; }
    await supabase.from('concept_documents').update({ title: newTitle.trim() }).eq('id', docId);
    setRenamingDoc(null);
    setRenameDocValue('');
    if (activeConcept) fetchDocuments(activeConcept.id);
    fetchAllDocs();
  }

  const handleDocDragEnd = useCallback(async (result) => {
    if (!result.destination || result.source.index === result.destination.index) return;
    const prev = documents;
    const reordered = Array.from(documents);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    setDocuments(reordered);

    const results = await Promise.all(
      reordered.map((d, i) => supabase.from('concept_documents').update({ sort_order: i }).eq('id', d.id))
    );
    if (results.some(r => r.error)) setDocuments(prev); // roll back on partial failure
  }, [documents]);

  async function handleCreateConcept(e) {
    e.preventDefault();
    if (!conceptForm.name.trim()) return;
    const { error } = await supabase.from('concepts').insert({
      name: conceptForm.name.trim(),
      description: conceptForm.description.trim(),
      color: conceptForm.color,
      category: conceptForm.category,
      created_by: profile.id,
      sort_order: concepts.length,
    });
    if (error) { console.error(error); return; }
    setConceptForm({ name: '', description: '', color: '#6366f1', category: 'other' });
    setShowCreateConcept(false);
    fetchConcepts();
  }

  async function handleDeleteConcept(conceptId) {
    if (!(await confirm('Delete this concept and all its documents?'))) return;
    await supabase.from('concepts').delete().eq('id', conceptId);
    if (activeConcept?.id === conceptId) { setActiveConcept(null); setActiveDoc(null); }
    fetchConcepts();
  }

  async function handleCreateDoc(e) {
    e.preventDefault();
    if (!docForm.title.trim() || !activeConcept) return;

    let content;
    if (docForm.templateId) {
      const template = templates.find(t => t.id === docForm.templateId);
      content = template ? template.content : null;
    }
    if (!content) {
      content = docForm.type === 'whiteboard' ? { strokes: [] }
        : docForm.type === 'stickyboard' ? { notes: [] }
        : docForm.type === 'storyboard' ? { pageCount: 1 }
        : docForm.type === 'screenwriter' ? { titlePage: { title: '', writtenBy: '', basedOn: '', draft: '', date: '', contact: '' }, elements: [], notes: [] }
        : { html: '' };
    }

    const { error } = await supabase.from('concept_documents').insert({
      concept_id: activeConcept.id,
      type: docForm.type,
      title: docForm.title.trim(),
      content,
      created_by: profile.id,
      sort_order: documents.length,
    });
    if (error) { console.error(error); return; }
    setDocForm({ title: '', type: 'stickyboard', templateId: '' });
    setShowCreateDoc(false);
    fetchDocuments(activeConcept.id);
  }

  async function handleMdUpload(e) {
    const file = e.target.files?.[0];
    if (!file || !activeConcept) return;
    if (mdUploadRef.current) mdUploadRef.current.value = '';

    try {
      const text = await file.text();
      const html = text.split('\n').map(line => {
        if (!line.trim()) return '<p></p>';
        if (line.startsWith('### ')) return `<h3>${line.slice(4)}</h3>`;
        if (line.startsWith('## ')) return `<h2>${line.slice(3)}</h2>`;
        if (line.startsWith('# ')) return `<h1>${line.slice(2)}</h1>`;
        if (line.startsWith('- ')) return `<li>${line.slice(2)}</li>`;
        line = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        line = line.replace(/\*(.+?)\*/g, '<em>$1</em>');
        line = line.replace(/`(.+?)`/g, '<code>$1</code>');
        return `<p>${line}</p>`;
      }).join('');

      const title = file.name.replace(/\.md$/i, '');
      const { error } = await supabase.from('concept_documents').insert({
        concept_id: activeConcept.id,
        type: 'document',
        title,
        content: { html },
        created_by: profile.id,
      });
      if (error) throw error;
      setShowCreateDoc(false);
      fetchDocuments(activeConcept.id);
    } catch (err) {
      console.error('Error uploading markdown:', err);
    }
  }

  async function handleDeleteDoc(docId) {
    if (!(await confirm('Delete this document?'))) return;
    await supabase.from('concept_documents').delete().eq('id', docId);
    if (activeDoc?.id === docId) setActiveDoc(null);
    if (activeConcept) fetchDocuments(activeConcept.id);
  }

  async function handleSaveTemplate(name, type, content) {
    const { error } = await supabase.from('concept_templates').insert({
      name, type, content, created_by: profile.id,
    });
    if (error) { console.error(error); return; }
    fetchTemplates();
    alert(`Template "${name}" saved!`);
  }

  async function handleDeleteTemplate(templateId) {
    await supabase.from('concept_templates').delete().eq('id', templateId);
    fetchTemplates();
  }


  // ─── Close context menus on click outside or Escape ──────────────────
  useEffect(() => {
    if (!contextMenu && !docContextMenu) return;
    const handleClick = () => { setContextMenu(null); setDocContextMenu(null); };
    const handleKey = (e) => { if (e.key === 'Escape') { setContextMenu(null); setDocContextMenu(null); } };
    window.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleKey);
    return () => { window.removeEventListener('click', handleClick); window.removeEventListener('keydown', handleKey); };
  }, [contextMenu, docContextMenu]);

  // ─── Drag-and-Drop Handler ──────────────────────────────────────────
  const handleDragEnd = useCallback(async (result) => {
    if (!result.destination || result.source.index === result.destination.index) return;
    const prev = concepts;
    const reordered = Array.from(concepts);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    setConcepts(reordered);

    const results = await Promise.all(
      reordered.map((c, i) => supabase.from('concepts').update({ sort_order: i }).eq('id', c.id))
    );
    if (results.some(r => r.error)) setConcepts(prev); // roll back on partial failure
  }, [concepts]);

  // ─── Edit Concept Handler ──────────────────────────────────────────
  async function handleEditConcept(e) {
    e.preventDefault();
    if (!editingConcept) return;
    const { error } = await supabase.from('concepts').update({
      name: editingConcept.name.trim(),
      description: editingConcept.description.trim(),
      color: editingConcept.color,
      category: editingConcept.category || 'other',
    }).eq('id', editingConcept.id);
    if (error) { console.error(error); return; }
    setEditingConcept(null);
    fetchConcepts();
  }

  // ─── Merge Concept Handler ─────────────────────────────────────────
  async function handleMergeConcept() {
    if (!mergingConcept || !mergeTargetId) return;
    const targetId = mergeTargetId;
    const sourceId = mergingConcept.id;
    const finalName = mergeName.trim();

    // Move all documents from source to target
    await supabase.from('concept_documents').update({ concept_id: targetId }).eq('concept_id', sourceId);
    // Update target name if changed
    if (finalName) {
      await supabase.from('concepts').update({ name: finalName }).eq('id', targetId);
    }
    // Delete source concept
    await supabase.from('concepts').delete().eq('id', sourceId);

    // If active concept was the source, switch to target
    if (activeConcept?.id === sourceId) {
      setActiveDoc(null);
      // Will be resolved after fetchConcepts
    }

    setMergingConcept(null);
    setMergeTargetId('');
    setMergeName('');
    await fetchConcepts();

    if (activeConcept?.id === sourceId) {
      const { data } = await supabase.from('concepts')
        .select('*, creator:profiles!concepts_created_by_fkey(full_name, nickname)')
        .eq('id', targetId).single();
      if (data) setActiveConcept(data);
    }
  }

  // If a document is open, render its editor
  if (activeDoc) {
    // ─── Normal Editor View ──────────────────────────────────────────────
    const EditorComponent = activeDoc.type === 'whiteboard' ? Whiteboard
      : activeDoc.type === 'stickyboard' ? StickyBoard
      : activeDoc.type === 'storyboard' ? Storyboard
      : activeDoc.type === 'screenwriter' ? ScriptEditor
      : DocEditor;

    const editorProps = {
      docId: activeDoc.id,
      title: activeDoc.title,
      docType: activeDoc.type,
      onBack: () => { setActiveDoc(null); },
      onSaveTemplate: handleSaveTemplate,
    };


    return (
      <>
        {/* key by doc id → remount per document so a stale autosave/load can't
            clobber the newly-opened doc with the previous one's content */}
        <EditorComponent key={activeDoc.id} {...editorProps} />
      </>
    );
  }

  // If viewing a concept's documents
  if (activeConcept) {
    return (
      <div style={styles.page}>
        <div style={styles.topBar}>
          <div>
            <button onClick={() => { setActiveConcept(null); setDocuments([]); }} style={styles.backBtn}>← Back</button>
            <h1 style={styles.pageTitle}>
              <span style={{ ...styles.conceptDot, background: activeConcept.color }} />
              {activeConcept.name}
            </h1>
            {activeConcept.description && <p style={styles.pageSubtitle}>{activeConcept.description}</p>}
          </div>
          <button onClick={() => setShowCreateDoc(!showCreateDoc)} style={styles.addBtn}>
            {showCreateDoc ? '✕ Cancel' : '+ New Document'}
          </button>
        </div>

        {showCreateDoc && (
          <form onSubmit={handleCreateDoc} style={styles.createForm}>
            <input
              value={docForm.title}
              onChange={(e) => setDocForm({ ...docForm, title: e.target.value })}
              placeholder="Document title..."
              required
              style={styles.input}
            />
            <div style={styles.typeSelector}>
              {Object.entries(DOC_TYPES).map(([type, info]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setDocForm({ ...docForm, type })}
                  style={{
                    ...styles.typeOption,
                    ...(docForm.type === type ? styles.typeOptionActive : {}),
                  }}
                >
                  <span style={styles.typeIcon}>{info.icon}</span>
                  <span style={styles.typeLabel}>{info.label}</span>
                  <span style={styles.typeDesc}>{info.desc}</span>
                </button>
              ))}
            </div>
            {templates.filter(t => t.type === docForm.type).length > 0 && (
              <div style={styles.templateRow}>
                <span style={styles.templateLabel}>Start from template:</span>
                <select
                  value={docForm.templateId}
                  onChange={(e) => setDocForm({ ...docForm, templateId: e.target.value })}
                  style={styles.templateSelect}
                >
                  <option value="">Blank</option>
                  {templates.filter(t => t.type === docForm.type).map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="submit" style={{ ...styles.submitBtn, flex: 1 }}>Create Document</button>
              <button
                type="button"
                onClick={() => mdUploadRef.current?.click()}
                style={{
                  ...styles.submitBtn,
                  flex: 0, whiteSpace: 'nowrap',
                  background: 'rgba(139,92,246,0.15)', color: '#a78bfa',
                  border: '1px solid rgba(139,92,246,0.25)',
                }}
              >
                Upload .md
              </button>
            </div>
            <input
              ref={mdUploadRef}
              type="file"
              accept=".md,text/markdown"
              onChange={handleMdUpload}
              style={{ display: 'none' }}
            />
          </form>
        )}

        {documents.length === 0 ? (
          <div style={styles.emptyCard}>
            <p style={styles.emptyText}>No documents yet. Create one to start developing this idea.</p>
          </div>
        ) : (
          <DragDropContext onDragEnd={handleDocDragEnd}>
            <Droppable droppableId="concept-docs" direction="horizontal">
              {(provided) => (
                <div ref={provided.innerRef} {...provided.droppableProps} style={styles.docGrid}>
                  {documents.map((doc, index) => {
                    const typeInfo = DOC_TYPES[doc.type];
                    return (
                      <Draggable key={doc.id} draggableId={doc.id} index={index}>
                        {(dragProvided, dragSnapshot) => (
                          <div
                            ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                            {...dragProvided.dragHandleProps}
                            style={{
                              ...styles.docCard,
                              ...(dragSnapshot.isDragging ? { boxShadow: '0 8px 32px rgba(99,102,241,0.3)', borderColor: 'rgba(99,102,241,0.4)' } : {}),
                              ...dragProvided.draggableProps.style,
                            }}
                            onClick={() => { if (renamingDoc !== doc.id) setActiveDoc(doc); }}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDocContextMenu({ x: e.clientX, y: e.clientY, doc });
                            }}
                          >
                            <div style={styles.docCardIcon}>{typeInfo.icon}</div>
                            {renamingDoc === doc.id ? (
                              <input
                                autoFocus
                                value={renameDocValue}
                                onChange={(e) => setRenameDocValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleRenameDoc(doc.id, renameDocValue);
                                  if (e.key === 'Escape') { setRenamingDoc(null); setRenameDocValue(''); }
                                }}
                                onBlur={() => handleRenameDoc(doc.id, renameDocValue)}
                                onClick={(e) => e.stopPropagation()}
                                style={styles.renameInput}
                              />
                            ) : (
                              <div style={styles.docCardTitle}>{doc.title}</div>
                            )}
                            <div style={styles.docCardMeta}>{typeInfo.label}</div>
                            <div style={styles.docCardMeta}>
                              {new Date(doc.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                            </div>
                          </div>
                        )}
                      </Draggable>
                    );
                  })}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        )}

        {/* Document Right-Click Context Menu */}
        {docContextMenu && (
          <>
            <div style={styles.contextOverlay} onClick={() => setDocContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setDocContextMenu(null); }} />
            <div style={{ ...styles.ctxMenu, top: docContextMenu.y, left: docContextMenu.x }}>
              <button
                style={styles.ctxMenuItem}
                onClick={() => {
                  setRenamingDoc(docContextMenu.doc.id);
                  setRenameDocValue(docContextMenu.doc.title);
                  setDocContextMenu(null);
                }}
              >Rename</button>
              <button
                style={{ ...styles.ctxMenuItem, color: '#f87171' }}
                onClick={() => {
                  handleDeleteDoc(docContextMenu.doc.id);
                  setDocContextMenu(null);
                }}
              >Delete</button>
            </div>
          </>
        )}
      </div>
    );
  }

  // Main concepts list
  return (
    <div style={styles.page}>
      <div style={styles.topBar}>
        <div>
          <h1 style={styles.pageTitle}>Create</h1>
          <p style={styles.pageSubtitle}>{concepts.length} concepts</p>
        </div>
        <button onClick={() => setShowCreateConcept(!showCreateConcept)} style={styles.addBtn}>
          {showCreateConcept ? '✕ Cancel' : '+ New Concept'}
        </button>
      </div>

      {showCreateConcept && (
        <form onSubmit={handleCreateConcept} style={styles.createForm}>
          <input
            value={conceptForm.name}
            onChange={(e) => setConceptForm({ ...conceptForm, name: e.target.value })}
            placeholder="Concept name..."
            required
            style={styles.input}
          />
          <input
            value={conceptForm.description}
            onChange={(e) => setConceptForm({ ...conceptForm, description: e.target.value })}
            placeholder="Brief description (optional)"
            style={styles.input}
          />
          <select
            value={conceptForm.category}
            onChange={(e) => setConceptForm({ ...conceptForm, category: e.target.value })}
            style={styles.input}
          >
            {CONCEPT_CATEGORIES.map(cat => (
              <option key={cat.value} value={cat.value}>{cat.label}</option>
            ))}
          </select>
          <div style={styles.colorPicker}>
            {CONCEPT_COLORS.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setConceptForm({ ...conceptForm, color: c })}
                style={{
                  ...styles.colorDot,
                  background: c,
                  outline: conceptForm.color === c ? `2px solid ${c}` : 'none',
                  outlineOffset: '2px',
                }}
              />
            ))}
          </div>
          <button type="submit" style={styles.submitBtn}>Create Concept</button>
        </form>
      )}

      {loading ? (
        <p style={styles.emptyText}>Loading...</p>
      ) : concepts.length === 0 ? (
        <div style={styles.emptyCard}>
          <p style={styles.emptyText}>No concepts yet. Start brainstorming!</p>
        </div>
      ) : (
        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="concepts" direction="horizontal">
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps} style={styles.conceptGrid}>
                {concepts.map((concept, index) => (
                  <Draggable key={concept.id} draggableId={concept.id} index={index}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        {...provided.dragHandleProps}
                        style={{
                          ...styles.conceptCard,
                          ...(snapshot.isDragging ? { boxShadow: '0 8px 32px rgba(99,102,241,0.3)', borderColor: 'rgba(99,102,241,0.4)' } : {}),
                          ...provided.draggableProps.style,
                        }}
                        onClick={() => setActiveConcept(concept)}
                        onContextMenu={(e) => {
                          if (concept.created_by === profile?.id || isAdmin) {
                            e.preventDefault();
                            e.stopPropagation();
                            setContextMenu({ x: e.clientX, y: e.clientY, concept });
                          }
                        }}
                      >
                        <div style={{ ...styles.conceptCardStripe, background: concept.color }} />
                        <div style={styles.conceptCardBody}>
                          <h3 style={styles.conceptCardName}>{concept.name}</h3>
                          {concept.description && <p style={styles.conceptCardDesc}>{concept.description}</p>}
                          {concept.category && concept.category !== 'other' && (
                            <span style={styles.categoryBadge}>
                              {CONCEPT_CATEGORIES.find(c => c.value === concept.category)?.label || concept.category}
                            </span>
                          )}
                          <div style={styles.conceptCardFooter}>
                            <span style={styles.conceptCardMeta}>
                              {getDisplayName(concept.creator)} · {new Date(concept.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          style={{ ...styles.ctxMenu, top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            style={styles.ctxMenuItem}
            onClick={() => { setEditingConcept({ ...contextMenu.concept }); setContextMenu(null); }}
          >Edit</button>
          <button
            style={styles.ctxMenuItem}
            onClick={() => {
              setMergingConcept(contextMenu.concept);
              setMergeTargetId('');
              setMergeName('');
              setContextMenu(null);
            }}
          >Merge</button>
          <button
            style={{ ...styles.ctxMenuItem, color: '#f87171' }}
            onClick={() => { const id = contextMenu.concept.id; setContextMenu(null); handleDeleteConcept(id); }}
          >Delete</button>
        </div>
      )}

      {/* Edit Concept Modal */}
      {editingConcept && (
        <div style={styles.modalOverlay} onClick={() => setEditingConcept(null)}>
          <form onSubmit={handleEditConcept} style={styles.editModal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.editModalHeader}>
              <h2 style={styles.editModalTitle}>Edit Concept</h2>
              <button type="button" onClick={() => setEditingConcept(null)} style={styles.editModalClose}>✕</button>
            </div>
            <input
              value={editingConcept.name}
              onChange={(e) => setEditingConcept({ ...editingConcept, name: e.target.value })}
              placeholder="Concept name..."
              required
              style={styles.input}
            />
            <input
              value={editingConcept.description || ''}
              onChange={(e) => setEditingConcept({ ...editingConcept, description: e.target.value })}
              placeholder="Brief description (optional)"
              style={styles.input}
            />
            <select
              value={editingConcept.category || 'other'}
              onChange={(e) => setEditingConcept({ ...editingConcept, category: e.target.value })}
              style={styles.input}
            >
              {CONCEPT_CATEGORIES.map(cat => (
                <option key={cat.value} value={cat.value}>{cat.label}</option>
              ))}
            </select>
            <div style={styles.colorPicker}>
              {CONCEPT_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setEditingConcept({ ...editingConcept, color: c })}
                  style={{
                    ...styles.colorDot,
                    background: c,
                    outline: editingConcept.color === c ? `2px solid ${c}` : 'none',
                    outlineOffset: '2px',
                  }}
                />
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setEditingConcept(null)} style={styles.editCancelBtn}>Cancel</button>
              <button type="submit" style={styles.submitBtn}>Save Changes</button>
            </div>
          </form>
        </div>
      )}

      {/* Merge Concept Modal */}
      {mergingConcept && (
        <div style={styles.modalOverlay} onClick={() => setMergingConcept(null)}>
          <div style={styles.editModal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.editModalHeader}>
              <h2 style={styles.editModalTitle}>Merge "{mergingConcept.name}" into...</h2>
              <button onClick={() => setMergingConcept(null)} style={styles.editModalClose}>✕</button>
            </div>
            <div style={styles.mergeTargetList}>
              {concepts.filter(c => c.id !== mergingConcept.id).map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { setMergeTargetId(c.id); setMergeName(c.name); }}
                  style={{
                    ...styles.mergeTargetItem,
                    ...(mergeTargetId === c.id ? styles.mergeTargetItemActive : {}),
                  }}
                >
                  <span style={{ ...styles.conceptDot, background: c.color }} />
                  <span>{c.name}</span>
                </button>
              ))}
            </div>
            {mergeTargetId && (
              <>
                <label style={styles.mergeLabel}>Merged concept name:</label>
                <input
                  value={mergeName}
                  onChange={(e) => setMergeName(e.target.value)}
                  style={styles.input}
                />
              </>
            )}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}>
              <button onClick={() => setMergingConcept(null)} style={styles.editCancelBtn}>Cancel</button>
              <button
                onClick={handleMergeConcept}
                disabled={!mergeTargetId}
                style={mergeTargetId ? styles.submitBtn : { ...styles.submitBtn, opacity: 0.4, cursor: 'not-allowed' }}
              >Merge</button>
            </div>
          </div>
        </div>
      )}

      {/* All Documents Section */}
      {allDocs.length > 0 && (
        <div style={styles.allDocsSection}>
          <h2 style={styles.allDocsSectionTitle}>All Documents</h2>
          {allDocsLoading ? (
            <p style={styles.emptyText}>Loading...</p>
          ) : (
            <div style={styles.allDocsTable}>
              <div style={styles.allDocsHeader}>
                <span style={{ ...styles.allDocsCell, flex: 2 }}>Title</span>
                <span style={styles.allDocsCell}>Type</span>
                <span style={{ ...styles.allDocsCell, flex: 1.5 }}>Concept</span>
                <span style={styles.allDocsCell}>Updated</span>
              </div>
              {allDocs.map(doc => {
                const concept = concepts.find(c => c.id === doc.concept_id);
                const typeInfo = DOC_TYPES[doc.type] || { icon: '📄', label: doc.type };
                return (
                  <div key={doc.id} style={styles.allDocsRow}>
                    <span
                      style={{ ...styles.allDocsCell, flex: 2, color: '#a5b4fc', fontWeight: 500, cursor: 'pointer' }}
                      onClick={() => {
                        if (concept) {
                          setActiveConcept(concept);
                          // After documents load, the user can click the doc
                          setTimeout(() => setActiveDoc(doc), 100);
                        }
                      }}
                    >{typeInfo.icon} {doc.title}</span>
                    <span style={styles.allDocsCell}>{typeInfo.label}</span>
                    <span style={{ ...styles.allDocsCell, flex: 1.5 }}>
                      {concept ? (
                        <span
                          style={{ ...styles.allDocsConceptTag, cursor: 'pointer' }}
                          onClick={() => setActiveConcept(concept)}
                        >
                          <span style={{ ...styles.conceptDot, background: concept.color, width: '8px', height: '8px', borderRadius: '3px' }} />
                          {concept.name}
                        </span>
                      ) : (
                        <span style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>
                      )}
                    </span>
                    <span style={{ ...styles.allDocsCell, color: 'rgba(255,255,255,0.3)' }}>
                      {new Date(doc.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Templates Section */}
      {templates.length > 0 && (
        <div style={styles.templatesSection}>
          <h2 style={styles.templatesSectionTitle}>📋 Templates</h2>
          {['whiteboard', 'stickyboard', 'document', 'storyboard', 'screenwriter'].map(type => {
            const typeTemplates = templates.filter(t => t.type === type);
            if (typeTemplates.length === 0) return null;
            return (
              <div key={type} style={styles.templateGroup}>
                <h3 style={styles.templateGroupTitle}>
                  {DOC_TYPES[type]?.icon} {DOC_TYPES[type]?.label}
                </h3>
                <div style={styles.templateList}>
                  {typeTemplates.map(t => (
                    <div key={t.id} style={styles.templateItem}>
                      <span style={styles.templateItemName}>{t.name}</span>
                      <span style={styles.templateItemDate}>
                        {new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                      <button
                        onClick={() => handleDeleteTemplate(t.id)}
                        style={styles.templateDeleteBtn}
                        title="Delete template"
                      >✕</button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const styles = {
  page: { padding: '32px 40px' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' },
  pageTitle: { fontSize: '28px', fontWeight: 700, color: '#ffffff', margin: '0 0 4px 0', letterSpacing: '-0.5px', display: 'flex', alignItems: 'center', gap: '10px' },
  pageSubtitle: { fontSize: '14px', color: 'rgba(255,255,255,0.4)', margin: 0 },
  backBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.45)', fontSize: '13px', cursor: 'pointer', padding: '0 0 8px 0', fontFamily: 'inherit', fontWeight: 500 },
  addBtn: { padding: '10px 20px', background: 'linear-gradient(135deg, #6366f1, #818cf8)', border: 'none', borderRadius: '10px', color: '#fff', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  createForm: { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '20px', marginBottom: '24px', display: 'flex', flexDirection: 'column', gap: '12px' },
  input: { padding: '10px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '14px', fontFamily: 'inherit', outline: 'none' },
  colorPicker: { display: 'flex', gap: '8px' },
  colorDot: { width: '28px', height: '28px', borderRadius: '8px', border: 'none', cursor: 'pointer' },
  submitBtn: { padding: '10px 20px', background: '#6366f1', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', alignSelf: 'flex-start' },
  conceptDot: { width: '12px', height: '12px', borderRadius: '4px', display: 'inline-block' },
  conceptGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' },
  conceptCard: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', overflow: 'hidden', cursor: 'pointer', transition: 'border-color 0.15s' },
  conceptCardStripe: { height: '4px' },
  conceptCardBody: { padding: '16px' },
  conceptCardName: { fontSize: '16px', fontWeight: 700, color: '#ffffff', margin: '0 0 6px 0' },
  conceptCardDesc: { fontSize: '13px', color: 'rgba(255,255,255,0.4)', margin: '0 0 12px 0', lineHeight: 1.4 },
  conceptCardFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  conceptCardMeta: { fontSize: '11px', color: 'rgba(255,255,255,0.25)' },
  deleteBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)', cursor: 'pointer', fontSize: '14px', padding: '2px 6px' },
  ctxMenu: { position: 'fixed', zIndex: 1000, background: '#1e1e2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '4px 0', minWidth: '140px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' },
  ctxMenuItem: { display: 'block', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', fontSize: '13px', fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left' },
  modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' },
  editModal: { width: '460px', background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 24px 48px rgba(0,0,0,0.5)' },
  editModalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' },
  editModalTitle: { fontSize: '18px', fontWeight: 700, color: '#e2e8f0', margin: 0 },
  editModalClose: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: '18px', cursor: 'pointer', padding: '4px 8px', fontFamily: 'inherit' },
  editCancelBtn: { padding: '9px 20px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: 'rgba(255,255,255,0.5)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  mergeTargetList: { display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '240px', overflowY: 'auto' },
  mergeTargetItem: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit', color: 'rgba(255,255,255,0.6)', fontSize: '14px', fontWeight: 500 },
  mergeTargetItemActive: { background: 'rgba(99,102,241,0.1)', borderColor: 'rgba(99,102,241,0.3)', color: '#a5b4fc' },
  mergeLabel: { fontSize: '12px', color: 'rgba(255,255,255,0.4)', fontWeight: 600 },
  typeSelector: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px' },
  typeOption: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', padding: '16px 12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', cursor: 'pointer', fontFamily: 'inherit', color: 'rgba(255,255,255,0.5)', transition: 'all 0.15s' },
  typeOptionActive: { background: 'rgba(99,102,241,0.1)', borderColor: 'rgba(99,102,241,0.3)', color: '#a5b4fc' },
  typeIcon: { fontSize: '24px' },
  typeLabel: { fontSize: '13px', fontWeight: 600 },
  typeDesc: { fontSize: '10px', opacity: 0.6, textAlign: 'center' },
  docGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' },
  docCard: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '16px', cursor: 'pointer', transition: 'border-color 0.15s', position: 'relative' },
  docCardIcon: { fontSize: '28px', marginBottom: '8px' },
  docCardTitle: { fontSize: '14px', fontWeight: 600, color: '#e2e8f0', marginBottom: '4px' },
  docCardMeta: { fontSize: '11px', color: 'rgba(255,255,255,0.3)', marginBottom: '2px' },
  docDeleteBtn: { position: 'absolute', top: '8px', right: '8px', background: 'none', border: 'none', color: 'rgba(255,255,255,0.15)', cursor: 'pointer', fontSize: '14px', padding: '4px' },
  emptyCard: { background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '14px', padding: '40px', textAlign: 'center' },
  emptyText: { color: 'rgba(255,255,255,0.35)', fontSize: '14px', margin: 0 },
  templateRow: { display: 'flex', alignItems: 'center', gap: '10px' },
  templateLabel: { fontSize: '13px', color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' },
  templateSelect: { flex: 1, padding: '8px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff', fontSize: '13px', fontFamily: 'inherit', outline: 'none' },
  templatesSection: { marginTop: '40px', paddingTop: '24px', borderTop: '1px solid rgba(255,255,255,0.06)' },
  templatesSectionTitle: { fontSize: '18px', fontWeight: 700, color: '#ffffff', margin: '0 0 16px 0' },
  templateGroup: { marginBottom: '16px' },
  templateGroupTitle: { fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.4)', margin: '0 0 8px 0' },
  templateList: { display: 'flex', flexDirection: 'column', gap: '4px' },
  templateItem: { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px' },
  templateItemName: { flex: 1, fontSize: '13px', color: '#e2e8f0', fontWeight: 500 },
  templateItemDate: { fontSize: '11px', color: 'rgba(255,255,255,0.25)' },
  templateDeleteBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)', cursor: 'pointer', fontSize: '13px', padding: '2px 4px' },

  // Category badge
  categoryBadge: { display: 'inline-block', padding: '2px 8px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px', fontSize: '10px', color: 'rgba(255,255,255,0.4)', fontWeight: 600, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.3px' },

  // Rename input
  renameInput: { padding: '4px 8px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '4px', color: '#fff', fontSize: '13px', fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' },

  // Context overlay
  contextOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 },

  // All Documents section
  allDocsSection: { marginTop: '40px', paddingTop: '24px', borderTop: '1px solid rgba(255,255,255,0.06)' },
  allDocsSectionTitle: { fontSize: '18px', fontWeight: 700, color: '#ffffff', margin: '0 0 16px 0' },
  allDocsTable: { border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', overflow: 'hidden' },
  allDocsHeader: { display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', background: 'rgba(255,255,255,0.03)', fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  allDocsRow: { display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,0.04)', fontSize: '13px', color: 'rgba(255,255,255,0.5)' },
  allDocsCell: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  allDocsConceptTag: { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'rgba(255,255,255,0.5)', fontWeight: 500 },
};

// ─── Review Feedback Styles ──────────────────────────────────────────────────
