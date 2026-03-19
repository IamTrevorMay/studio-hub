import React, { useState, useEffect, useRef } from 'react';
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
  const mdUploadRef = useRef(null);

  // Review feedback state
  const [pendingReview, setPendingReview] = useState(null);
  const [dismissedFeedbackId, setDismissedFeedbackId] = useState(null);
  const [showFeedbackView, setShowFeedbackView] = useState(false);
  const [feedbackAnnotations, setFeedbackAnnotations] = useState([]);
  const [feedbackHtml, setFeedbackHtml] = useState('');
  const [addressedIds, setAddressedIds] = useState(new Set());
  const [showSendRevisionModal, setShowSendRevisionModal] = useState(false);
  const [sendRevisionMessage, setSendRevisionMessage] = useState('');
  const [sendingRevision, setSendingRevision] = useState(false);
  const [revisionHtmlContent, setRevisionHtmlContent] = useState('');
  const [toast, setToast] = useState(null);
  const [feedbackFilter, setFeedbackFilter] = useState('all');

  useEffect(() => {
    if (!profile?.id) return;
    fetchConcepts();
    fetchTemplates();
  }, [profile?.id]);

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

  // ─── Review Feedback Detection ─────────────────────────────────────────
  async function fetchPendingReview(docId) {
    try {
      const { data: versions } = await supabase.from('concept_document_versions')
        .select('*')
        .eq('document_id', docId)
        .eq('source', 'script_review')
        .order('created_at', { ascending: false })
        .limit(1);
      if (!versions || versions.length === 0) { setPendingReview(null); return; }
      const feedbackVersion = versions[0];
      if (!feedbackVersion.review_id) { setPendingReview(null); return; }
      const { data: review } = await supabase.from('script_reviews')
        .select('*')
        .eq('id', feedbackVersion.review_id)
        .single();
      if (!review || review.status !== 'awaiting_writer') { setPendingReview(null); return; }
      const { data: reviewer } = await supabase.from('profiles')
        .select('full_name')
        .eq('id', review.created_by)
        .single();
      setPendingReview({
        review,
        feedbackVersion,
        reviewer: reviewer?.full_name || 'Reviewer',
      });
    } catch (err) {
      console.error('Error fetching pending review:', err);
      setPendingReview(null);
    }
  }

  useEffect(() => {
    if (activeDoc?.id) fetchPendingReview(activeDoc.id);
    else setPendingReview(null);
  }, [activeDoc?.id]);

  // ─── Load Feedback Data ────────────────────────────────────────────────
  async function loadFeedbackData() {
    if (!pendingReview?.feedbackVersion) return;
    const fv = pendingReview.feedbackVersion;
    try {
      if (fv.file_url) {
        const { data: urlData } = supabase.storage.from('script-reviews').getPublicUrl(fv.file_url);
        if (urlData?.publicUrl) {
          const resp = await fetch(urlData.publicUrl);
          const text = await resp.text();
          setFeedbackHtml(text);
        }
      }
      if (fv.annotation_json_url) {
        const { data: urlData } = supabase.storage.from('script-reviews').getPublicUrl(fv.annotation_json_url);
        if (urlData?.publicUrl) {
          const resp = await fetch(urlData.publicUrl);
          const json = await resp.json();
          setFeedbackAnnotations(json);
        }
      }
      // Load addressed IDs from localStorage
      const stored = localStorage.getItem(`feedback_addressed_${fv.id}`);
      if (stored) setAddressedIds(new Set(JSON.parse(stored)));
      else setAddressedIds(new Set());
    } catch (err) {
      console.error('Error loading feedback data:', err);
    }
  }

  function toggleAddressed(annotationId) {
    setAddressedIds(prev => {
      const next = new Set(prev);
      if (next.has(annotationId)) next.delete(annotationId);
      else next.add(annotationId);
      if (pendingReview?.feedbackVersion?.id) {
        localStorage.setItem(`feedback_addressed_${pendingReview.feedbackVersion.id}`, JSON.stringify([...next]));
      }
      return next;
    });
  }

  // ─── Send Revision Handler ─────────────────────────────────────────────
  async function handleSendRevision() {
    if (!pendingReview || !revisionHtmlContent || sendingRevision) return;
    setSendingRevision(true);
    try {
      const blob = new Blob([revisionHtmlContent], { type: 'text/html' });
      const path = `revisions/${profile.id}/${Date.now()}.html`;
      const { error: uploadErr } = await supabase.storage.from('script-reviews').upload(path, blob);
      if (uploadErr) throw uploadErr;

      const { data: maxVer } = await supabase.from('script_review_versions')
        .select('version_number')
        .eq('review_id', pendingReview.review.id)
        .order('version_number', { ascending: false })
        .limit(1);
      const nextNum = (maxVer?.[0]?.version_number || 0) + 1;

      const { error: insertErr } = await supabase.from('script_review_versions').insert({
        review_id: pendingReview.review.id,
        version_number: nextNum,
        file_url: path,
        file_type: 'html',
        uploaded_by: profile.id,
        source: 'writer',
        concept_document_id: activeDoc.id,
        writer_message: sendRevisionMessage.trim() || null,
      });
      if (insertErr) throw insertErr;

      await supabase.from('script_reviews')
        .update({ status: 'in_review', updated_at: new Date().toISOString() })
        .eq('id', pendingReview.review.id);

      await supabase.from('notifications').insert({
        user_id: pendingReview.review.created_by,
        type: 'script_revision',
        title: `✍️ ${profile.full_name} submitted a revision`,
        body: `v${nextNum} of "${pendingReview.review.title}" is ready for review`,
        link_tab: 'reviews',
        link_target: pendingReview.review.id,
      });

      setShowSendRevisionModal(false);
      setSendRevisionMessage('');
      setRevisionHtmlContent('');
      setShowFeedbackView(false);
      setPendingReview(null);
      setDismissedFeedbackId(null);
      setToast({ type: 'success', message: 'Revision sent — reviewer will be notified.' });
      setTimeout(() => setToast(null), 4000);
    } catch (err) {
      console.error('Send revision error:', err);
      setToast({ type: 'error', message: 'Failed to send revision: ' + (err.message || 'Unknown error') });
      setTimeout(() => setToast(null), 5000);
    } finally {
      setSendingRevision(false);
    }
  }

  // If a document is open, render its editor
  if (activeDoc) {
    // ─── Split-Panel Feedback View ─────────────────────────────────────
    if (showFeedbackView && pendingReview) {
      const filteredAnnotations = feedbackFilter === 'all'
        ? feedbackAnnotations
        : feedbackAnnotations.filter(a => a.type === feedbackFilter);
      const addressedCount = feedbackAnnotations.filter(a => addressedIds.has(a.id)).length;
      const totalCount = feedbackAnnotations.length;
      return (
        <div style={reviewStyles.splitContainer}>
          {/* Toast */}
          {toast && (
            <div style={toast.type === 'success' ? reviewStyles.toastSuccess : reviewStyles.toastError}>
              <span>{toast.type === 'success' ? '✓' : '✕'}</span>
              <span>{toast.message}</span>
            </div>
          )}
          {/* Top bar */}
          <div style={reviewStyles.splitTopBar}>
            <button onClick={() => { setShowFeedbackView(false); setFeedbackHtml(''); setFeedbackAnnotations([]); }} style={reviewStyles.splitBackBtn}>← Back to Editor</button>
            <span style={reviewStyles.splitTitle}>{pendingReview.review.title} — Feedback</span>
            {pendingReview.feedbackVersion.reviewer_message && (
              <span style={reviewStyles.splitMessage}>💬 {pendingReview.feedbackVersion.reviewer_message}</span>
            )}
            <div style={{ flex: 1 }} />
            <button
              onClick={() => {
                // Capture current doc HTML from DB for revision
                (async () => {
                  const { data } = await supabase.from('concept_documents').select('content').eq('id', activeDoc.id).single();
                  setRevisionHtmlContent(data?.content?.html || '');
                  setShowSendRevisionModal(true);
                })();
              }}
              style={reviewStyles.sendRevisionTopBtn}
            >Send Revision →</button>
          </div>
          {/* Main panels */}
          <div style={reviewStyles.splitPanels}>
            {/* LEFT: Annotated document */}
            <div style={reviewStyles.splitLeft}>
              <style>{`
                .ann-mark { cursor: default; border-radius: 2px; padding: 0 1px; }
                .ann-redline { text-decoration: line-through; text-decoration-color: #ff4444; color: #ff4444; background: rgba(255,68,68,0.1); }
                .ann-highlight[data-color="yellow"] { background: rgba(250,204,21,0.35); }
                .ann-highlight[data-color="cyan"] { background: rgba(34,211,238,0.3); }
                .ann-highlight[data-color="green"] { background: rgba(74,222,128,0.3); }
                .ann-highlight[data-color="pink"] { background: rgba(244,114,182,0.3); }
                .ann-highlight[data-color="orange"] { background: rgba(251,146,60,0.3); }
                .ann-highlight[data-color="purple"] { background: rgba(167,139,250,0.3); }
                .ann-highlight:not([data-color]) { background: rgba(250,204,21,0.35); }
                .ann-note { border-bottom: 2px dashed rgba(99,102,241,0.4); }
              `}</style>
              <div style={reviewStyles.docPage} dangerouslySetInnerHTML={{ __html: feedbackHtml }} />
            </div>
            {/* RIGHT: Annotation sidebar */}
            <div style={reviewStyles.splitRight}>
              <div style={reviewStyles.sidebarHeader}>
                <h3 style={reviewStyles.sidebarTitle}>
                  Annotations
                  <span style={reviewStyles.sidebarCount}>{feedbackAnnotations.length}</span>
                </h3>
                <span style={reviewStyles.progressText}>{addressedCount} of {totalCount} addressed</span>
              </div>
              {totalCount > 0 && (
                <div style={reviewStyles.progressBarWrap}>
                  <div style={{ ...reviewStyles.progressBar, width: `${totalCount > 0 ? (addressedCount / totalCount) * 100 : 0}%` }} />
                </div>
              )}
              <div style={reviewStyles.filterRow}>
                {['all', 'redline', 'highlight', 'note'].map(f => (
                  <button key={f} onClick={() => setFeedbackFilter(f)} style={{ ...reviewStyles.filterBtn, ...(feedbackFilter === f ? reviewStyles.filterBtnActive : {}) }}>
                    {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1) + 's'}
                  </button>
                ))}
              </div>
              <div style={reviewStyles.annotationList}>
                {filteredAnnotations.length === 0 ? (
                  <p style={reviewStyles.emptyAnns}>No annotations to show.</p>
                ) : filteredAnnotations.map(a => {
                  const typeColors = { redline: '#ff4444', highlight: '#facc15', note: '#a5b4fc' };
                  return (
                    <div key={a.id} style={{ ...reviewStyles.annCard, ...(addressedIds.has(a.id) ? reviewStyles.annCardAddressed : {}) }}>
                      <div style={reviewStyles.annCardHeader}>
                        <span style={{ ...reviewStyles.annDot, background: typeColors[a.type] || '#888' }} />
                        <span style={reviewStyles.annType}>{a.type === 'redline' ? 'Redline' : a.type === 'highlight' ? 'Highlight' : 'Note'}</span>
                      </div>
                      {a.selected_text && (
                        <div style={{ ...reviewStyles.annQuote, borderLeftColor: typeColors[a.type] || 'rgba(255,255,255,0.1)' }}>
                          "{a.selected_text.length > 120 ? a.selected_text.slice(0, 120) + '…' : a.selected_text}"
                        </div>
                      )}
                      {a.comment_text && <p style={reviewStyles.annComment}>{a.comment_text}</p>}
                      {a.replies && a.replies.length > 0 && (
                        <div style={reviewStyles.repliesWrap}>
                          {a.replies.map((r, i) => (
                            <div key={i} style={reviewStyles.replyItem}>
                              <span style={reviewStyles.replyAuthor}>{r.author || 'Reply'}</span>
                              <span style={reviewStyles.replyText}>{r.text}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <label style={reviewStyles.checkboxRow}>
                        <input
                          type="checkbox"
                          checked={addressedIds.has(a.id)}
                          onChange={() => toggleAddressed(a.id)}
                          style={reviewStyles.checkbox}
                        />
                        <span style={reviewStyles.checkboxLabel}>Mark as Addressed</span>
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          {/* Send Revision Modal */}
          {showSendRevisionModal && (
            <div style={reviewStyles.modalOverlay} onClick={() => !sendingRevision && setShowSendRevisionModal(false)}>
              <div style={reviewStyles.modal} onClick={e => e.stopPropagation()}>
                <div style={reviewStyles.modalHeader}>
                  <h2 style={reviewStyles.modalTitle}>Send Revision for Review</h2>
                  <button onClick={() => !sendingRevision && setShowSendRevisionModal(false)} style={reviewStyles.modalCloseBtn}>✕</button>
                </div>
                <div style={reviewStyles.modalBody}>
                  <div style={reviewStyles.modalInfoRow}>Sending to Review: <strong>{pendingReview.review.title}</strong></div>
                  <div style={reviewStyles.modalVersionBadge}>
                    This will become Version {((pendingReview.feedbackVersion.version_number || 0) + 1)} in the review
                  </div>
                  <textarea
                    value={sendRevisionMessage}
                    onChange={e => setSendRevisionMessage(e.target.value)}
                    placeholder="Add a note for the reviewer..."
                    rows={4}
                    style={reviewStyles.modalTextarea}
                  />
                </div>
                <div style={reviewStyles.modalFooter}>
                  <button onClick={() => { setShowSendRevisionModal(false); setSendRevisionMessage(''); }} style={reviewStyles.modalCancelBtn} disabled={sendingRevision}>Cancel</button>
                  <button onClick={handleSendRevision} style={sendingRevision ? reviewStyles.modalSendBtnDisabled : reviewStyles.modalSendBtn} disabled={sendingRevision}>
                    {sendingRevision ? 'Sending...' : 'Send Revision →'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    // ─── Normal Editor View ──────────────────────────────────────────────
    const EditorComponent = activeDoc.type === 'whiteboard' ? Whiteboard
      : activeDoc.type === 'stickyboard' ? StickyBoard
      : activeDoc.type === 'storyboard' ? Storyboard
      : activeDoc.type === 'screenplay' ? ScreenplayEditor
      : DocEditor;

    const editorProps = {
      docId: activeDoc.id,
      title: activeDoc.title,
      docType: activeDoc.type,
      onBack: () => { setActiveDoc(null); setPendingReview(null); setShowFeedbackView(false); },
      onSaveTemplate: handleSaveTemplate,
    };

    if (activeDoc.type === 'document' && pendingReview) {
      editorProps.reviewData = pendingReview;
      editorProps.onSendForReview = (htmlContent) => {
        setRevisionHtmlContent(htmlContent);
        setShowSendRevisionModal(true);
      };
    }

    return (
      <>
        {/* Toast */}
        {toast && (
          <div style={toast.type === 'success' ? reviewStyles.toastSuccess : reviewStyles.toastError}>
            <span>{toast.type === 'success' ? '✓' : '✕'}</span>
            <span>{toast.message}</span>
          </div>
        )}
        {/* Feedback Banner */}
        {pendingReview && dismissedFeedbackId !== pendingReview.feedbackVersion.id && (
          <div style={reviewStyles.banner}>
            <span style={reviewStyles.bannerIcon}>📋</span>
            <span style={reviewStyles.bannerText}>
              Review Feedback Received — <strong>{pendingReview.reviewer}</strong> sent notes on this script.
            </span>
            <button
              onClick={() => { setShowFeedbackView(true); loadFeedbackData(); }}
              style={reviewStyles.bannerViewBtn}
            >View Annotated Version →</button>
            <button
              onClick={() => setDismissedFeedbackId(pendingReview.feedbackVersion.id)}
              style={reviewStyles.bannerDismissBtn}
            >Dismiss</button>
          </div>
        )}
        <EditorComponent {...editorProps} />
        {/* Send Revision Modal (from editor "Send for Review" button) */}
        {showSendRevisionModal && pendingReview && (
          <div style={reviewStyles.modalOverlay} onClick={() => !sendingRevision && setShowSendRevisionModal(false)}>
            <div style={reviewStyles.modal} onClick={e => e.stopPropagation()}>
              <div style={reviewStyles.modalHeader}>
                <h2 style={reviewStyles.modalTitle}>Send Revision for Review</h2>
                <button onClick={() => !sendingRevision && setShowSendRevisionModal(false)} style={reviewStyles.modalCloseBtn}>✕</button>
              </div>
              <div style={reviewStyles.modalBody}>
                <div style={reviewStyles.modalInfoRow}>Sending to Review: <strong>{pendingReview.review.title}</strong></div>
                <div style={reviewStyles.modalVersionBadge}>
                  This will become Version {((pendingReview.feedbackVersion.version_number || 0) + 1)} in the review
                </div>
                <textarea
                  value={sendRevisionMessage}
                  onChange={e => setSendRevisionMessage(e.target.value)}
                  placeholder="Add a note for the reviewer..."
                  rows={4}
                  style={reviewStyles.modalTextarea}
                />
              </div>
              <div style={reviewStyles.modalFooter}>
                <button onClick={() => { setShowSendRevisionModal(false); setSendRevisionMessage(''); }} style={reviewStyles.modalCancelBtn} disabled={sendingRevision}>Cancel</button>
                <button onClick={handleSendRevision} style={sendingRevision ? reviewStyles.modalSendBtnDisabled : reviewStyles.modalSendBtn} disabled={sendingRevision}>
                  {sendingRevision ? 'Sending...' : 'Send Revision →'}
                </button>
              </div>
            </div>
          </div>
        )}
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

// ─── Review Feedback Styles ──────────────────────────────────────────────────
const reviewStyles = {
  // Banner
  banner: { position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 24px', background: 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.15))', borderBottom: '1px solid rgba(99,102,241,0.2)', backdropFilter: 'blur(12px)' },
  bannerIcon: { fontSize: '18px' },
  bannerText: { flex: 1, fontSize: '13px', color: '#c4b5fd', fontWeight: 500 },
  bannerViewBtn: { padding: '6px 16px', background: 'linear-gradient(135deg, #6366f1, #818cf8)', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' },
  bannerDismissBtn: { padding: '6px 12px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'rgba(255,255,255,0.5)', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },

  // Split panel
  splitContainer: { display: 'flex', flexDirection: 'column', height: '100vh', background: '#0f0f1a' },
  splitTopBar: { display: 'flex', alignItems: 'center', gap: '16px', padding: '10px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.3)', flexShrink: 0 },
  splitBackBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500, padding: '4px 0' },
  splitTitle: { fontSize: '14px', fontWeight: 700, color: '#e2e8f0' },
  splitMessage: { fontSize: '12px', color: 'rgba(255,255,255,0.4)', fontStyle: 'italic', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  sendRevisionTopBtn: { marginLeft: 'auto', padding: '7px 18px', background: 'linear-gradient(135deg, #c5d600, #e8ff47)', border: 'none', borderRadius: '8px', color: '#0f0f1a', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  splitPanels: { display: 'flex', flex: 1, overflow: 'hidden' },
  splitLeft: { flex: 1, overflow: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center' },
  docPage: { width: '100%', maxWidth: '816px', minHeight: '600px', background: '#fefefe', borderRadius: '4px', boxShadow: '0 2px 12px rgba(0,0,0,0.3)', padding: '48px 56px', boxSizing: 'border-box', color: '#1a1a2e', fontSize: '14px', lineHeight: 1.7 },
  splitRight: { width: '320px', flexShrink: 0, borderLeft: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', overflow: 'hidden' },

  // Sidebar
  sidebarHeader: { padding: '14px 16px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 },
  sidebarTitle: { fontSize: '14px', fontWeight: 700, color: '#e2e8f0', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' },
  sidebarCount: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 20, height: 20, padding: '0 6px', borderRadius: '10px', background: 'rgba(232,255,71,0.1)', color: '#e8ff47', fontSize: '11px', fontWeight: 700 },
  progressText: { fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginTop: '4px' },
  progressBarWrap: { height: '3px', background: 'rgba(255,255,255,0.06)', margin: '0 16px 0', borderRadius: '2px', overflow: 'hidden' },
  progressBar: { height: '100%', background: 'linear-gradient(90deg, #22c55e, #4ade80)', borderRadius: '2px', transition: 'width 0.3s' },
  filterRow: { display: 'flex', gap: '4px', padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)', flexShrink: 0 },
  filterBtn: { padding: '4px 10px', background: 'none', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '5px', color: 'rgba(255,255,255,0.35)', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s' },
  filterBtnActive: { background: 'rgba(232,255,71,0.08)', borderColor: 'rgba(232,255,71,0.2)', color: '#e8ff47' },
  annotationList: { flex: 1, overflow: 'auto', padding: '8px' },
  emptyAnns: { fontSize: '12px', color: 'rgba(255,255,255,0.2)', textAlign: 'center', padding: '24px 12px', margin: 0 },

  // Annotation cards
  annCard: { padding: '10px 12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', marginBottom: '6px' },
  annCardAddressed: { opacity: 0.5, borderStyle: 'dashed' },
  annCardHeader: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' },
  annDot: { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0 },
  annType: { fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.3px' },
  annQuote: { fontSize: '11px', color: 'rgba(255,255,255,0.45)', fontStyle: 'italic', padding: '6px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: '4px', borderLeft: '3px solid rgba(255,255,255,0.1)', marginBottom: '6px', lineHeight: 1.5 },
  annComment: { fontSize: '12px', color: 'rgba(255,255,255,0.55)', margin: '0 0 6px 0', lineHeight: 1.5 },
  repliesWrap: { paddingLeft: '10px', borderLeft: '2px solid rgba(255,255,255,0.04)', marginBottom: '6px' },
  replyItem: { padding: '4px 0' },
  replyAuthor: { fontSize: '10px', color: 'rgba(255,255,255,0.4)', fontWeight: 600, marginRight: '6px' },
  replyText: { fontSize: '11px', color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 },
  checkboxRow: { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', marginTop: '4px' },
  checkbox: { accentColor: '#22c55e', width: '14px', height: '14px', cursor: 'pointer' },
  checkboxLabel: { fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontWeight: 600 },

  // Modal
  modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' },
  modal: { width: '560px', maxHeight: '85vh', background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 48px rgba(0,0,0,0.5)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 },
  modalTitle: { fontSize: '18px', fontWeight: 700, color: '#e2e8f0', margin: 0 },
  modalCloseBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: '18px', cursor: 'pointer', padding: '4px 8px', fontFamily: 'inherit' },
  modalBody: { flex: 1, overflow: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' },
  modalInfoRow: { fontSize: '13px', color: 'rgba(255,255,255,0.5)' },
  modalVersionBadge: { padding: '8px 14px', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.15)', borderRadius: '8px', fontSize: '12px', color: '#a5b4fc', fontWeight: 600 },
  modalTextarea: { width: '100%', padding: '10px 14px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: '#e2e8f0', fontSize: '13px', fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.5 },
  modalFooter: { display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '16px 24px', borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 },
  modalCancelBtn: { padding: '9px 20px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: 'rgba(255,255,255,0.5)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  modalSendBtn: { padding: '9px 24px', background: 'linear-gradient(135deg, #c5d600, #e8ff47)', border: 'none', borderRadius: '8px', color: '#0f0f1a', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  modalSendBtnDisabled: { padding: '9px 24px', background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '8px', color: 'rgba(255,255,255,0.3)', fontSize: '13px', fontWeight: 600, cursor: 'not-allowed', fontFamily: 'inherit' },

  // Toast
  toastSuccess: { position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)', padding: '10px 24px', background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '10px', color: '#4ade80', fontSize: '13px', fontWeight: 600, zIndex: 2000, display: 'flex', alignItems: 'center', gap: '8px', backdropFilter: 'blur(12px)', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' },
  toastError: { position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)', padding: '10px 24px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '10px', color: '#f87171', fontSize: '13px', fontWeight: 600, zIndex: 2000, display: 'flex', alignItems: 'center', gap: '8px', backdropFilter: 'blur(12px)', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' },
};
