import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import Whiteboard from './editors/Whiteboard';
import StickyBoard from './editors/StickyBoard';
import DocEditor from './editors/DocEditor';
import Storyboard from './editors/Storyboard';
import ScreenplayEditor from './editors/ScreenplayEditor';

const CONCEPT_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#22c55e', '#3b82f6', '#ef4444', '#14b8a6'];
const DOC_TYPES = {
  whiteboard: { label: 'Whiteboard', icon: '🎨', desc: 'Freehand drawing canvas' },
  stickyboard: { label: 'Sticky Board', icon: '📌', desc: 'Drag & drop sticky notes' },
  document: { label: 'Document', icon: '📝', desc: 'Rich text editor with export' },
  storyboard: { label: 'Storyboard', icon: '🎬', desc: 'Multi-page visual storyboard' },
  screenplay: { label: 'Screenplay', icon: '🎭', desc: 'Industry-standard screenwriting' },
};

export default function Ideation({ initialConceptId, onConceptOpened }) {
  const { profile, isAdmin } = useAuth();
  const [concepts, setConcepts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateConcept, setShowCreateConcept] = useState(false);
  const [conceptForm, setConceptForm] = useState({ name: '', description: '', color: '#6366f1' });
  const [activeConcept, setActiveConcept] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [activeDoc, setActiveDoc] = useState(null);
  const [showCreateDoc, setShowCreateDoc] = useState(false);
  const [docForm, setDocForm] = useState({ title: '', type: 'stickyboard', templateId: '' });
  const [templates, setTemplates] = useState([]);

  useEffect(() => {
    if (!profile?.id) return;
    fetchConcepts();
    fetchTemplates();
  }, [profile?.id]);

  // Handle deep-link from Projects page
  useEffect(() => {
    if (initialConceptId && concepts.length > 0 && !activeConcept) {
      const target = concepts.find(c => c.id === initialConceptId);
      if (target) {
        setActiveConcept(target);
        if (onConceptOpened) onConceptOpened();
      }
    }
  }, [initialConceptId, concepts]);

  useEffect(() => {
    if (activeConcept) fetchDocuments(activeConcept.id);
  }, [activeConcept]);

  async function fetchConcepts() {
    try {
      const { data, error } = await supabase.from('concepts')
        .select('*, creator:profiles!concepts_profile_fk(full_name)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setConcepts(data || []);
    } catch (err) {
      console.error('Error fetching concepts:', err);
      setConcepts([]);
    } finally {
      setLoading(false);
    }
  }

  async function fetchDocuments(conceptId) {
    try {
      const { data, error } = await supabase.from('concept_documents')
        .select('id, concept_id, type, title, created_at, updated_at, created_by')
        .eq('concept_id', conceptId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setDocuments(data || []);
    } catch (err) {
      console.error('Error fetching documents:', err);
      setDocuments([]);
    }
  }

  async function fetchTemplates() {
    try {
      const { data } = await supabase.from('concept_templates')
        .select('*').order('created_at', { ascending: false });
      setTemplates(data || []);
    } catch (err) {
      console.error('Error fetching templates:', err);
    }
  }

  async function handleCreateConcept(e) {
    e.preventDefault();
    if (!conceptForm.name.trim()) return;
    const { error } = await supabase.from('concepts').insert({
      name: conceptForm.name.trim(),
      description: conceptForm.description.trim(),
      color: conceptForm.color,
      created_by: profile.id,
    });
    if (error) { console.error(error); return; }
    setConceptForm({ name: '', description: '', color: '#6366f1' });
    setShowCreateConcept(false);
    fetchConcepts();
  }

  async function handleDeleteConcept(conceptId) {
    if (!window.confirm('Delete this concept and all its documents?')) return;
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
        : docForm.type === 'screenplay' ? { titlePage: { title: '', writtenBy: '', basedOn: '', draft: '', date: '', contact: '' }, elements: [{ id: Date.now().toString(), type: 'sceneHeading', text: '' }], notes: [] }
        : { html: '' };
    }

    const { error } = await supabase.from('concept_documents').insert({
      concept_id: activeConcept.id,
      type: docForm.type,
      title: docForm.title.trim(),
      content,
      created_by: profile.id,
    });
    if (error) { console.error(error); return; }
    setDocForm({ title: '', type: 'stickyboard', templateId: '' });
    setShowCreateDoc(false);
    fetchDocuments(activeConcept.id);
  }

  async function handleDeleteDoc(docId) {
    if (!window.confirm('Delete this document?')) return;
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

  // If a document is open, render its editor
  if (activeDoc) {
    const EditorComponent = activeDoc.type === 'whiteboard' ? Whiteboard
      : activeDoc.type === 'stickyboard' ? StickyBoard
      : activeDoc.type === 'storyboard' ? Storyboard
      : activeDoc.type === 'screenplay' ? ScreenplayEditor
      : DocEditor;
    return (
      <EditorComponent
        docId={activeDoc.id}
        title={activeDoc.title}
        docType={activeDoc.type}
        onBack={() => setActiveDoc(null)}
        onSaveTemplate={handleSaveTemplate}
      />
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
            <button type="submit" style={styles.submitBtn}>Create Document</button>
          </form>
        )}

        {documents.length === 0 ? (
          <div style={styles.emptyCard}>
            <p style={styles.emptyText}>No documents yet. Create one to start developing this idea.</p>
          </div>
        ) : (
          <div style={styles.docGrid}>
            {documents.map(doc => {
              const typeInfo = DOC_TYPES[doc.type];
              return (
                <div key={doc.id} style={styles.docCard} onClick={() => setActiveDoc(doc)}>
                  <div style={styles.docCardIcon}>{typeInfo.icon}</div>
                  <div style={styles.docCardTitle}>{doc.title}</div>
                  <div style={styles.docCardMeta}>{typeInfo.label}</div>
                  <div style={styles.docCardMeta}>
                    {new Date(doc.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteDoc(doc.id); }}
                    style={styles.docDeleteBtn}
                  >✕</button>
                </div>
              );
            })}
          </div>
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
        <div style={styles.conceptGrid}>
          {concepts.map(concept => (
            <div
              key={concept.id}
              style={styles.conceptCard}
              onClick={() => setActiveConcept(concept)}
            >
              <div style={{ ...styles.conceptCardStripe, background: concept.color }} />
              <div style={styles.conceptCardBody}>
                <h3 style={styles.conceptCardName}>{concept.name}</h3>
                {concept.description && <p style={styles.conceptCardDesc}>{concept.description}</p>}
                <div style={styles.conceptCardFooter}>
                  <span style={styles.conceptCardMeta}>
                    {concept.creator?.full_name} · {new Date(concept.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                  {(concept.created_by === profile?.id || isAdmin) && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteConcept(concept.id); }}
                      style={styles.deleteBtn}
                    >✕</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Templates Section */}
      {templates.length > 0 && (
        <div style={styles.templatesSection}>
          <h2 style={styles.templatesSectionTitle}>📋 Templates</h2>
          {['whiteboard', 'stickyboard', 'document', 'storyboard', 'screenplay'].map(type => {
            const typeTemplates = templates.filter(t => t.type === type);
            if (typeTemplates.length === 0) return null;
            return (
              <div key={type} style={styles.templateGroup}>
                <h3 style={styles.templateGroupTitle}>
                  {DOC_TYPES[type].icon} {DOC_TYPES[type].label}
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
};
