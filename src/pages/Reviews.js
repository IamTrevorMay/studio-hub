import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';

import * as mammoth from 'mammoth';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

function extractVideoId(url) {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const p of patterns) {
    const match = url.match(p);
    if (match) return match[1];
  }
  return null;
}

function formatTimestamp(seconds) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Rich text helpers (bold/italic via markdown-style **bold** and *italic*) ─

function renderFormattedText(text) {
  if (!text) return text;
  // Split into segments: **bold**, *italic*, and plain text
  const parts = [];
  let remaining = text;
  let key = 0;
  // Regex matches **bold** or *italic* (non-greedy)
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*)/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    // Push plain text before match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[2]) {
      // **bold**
      parts.push(<strong key={key++} style={{ fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>{match[2]}</strong>);
    } else if (match[3]) {
      // *italic*
      parts.push(<em key={key++}>{match[3]}</em>);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts.length > 0 ? parts : text;
}

function FormattedCommentInput({ value, onChange, onSubmit, placeholder, style, autoFocus }) {
  const ref = useRef(null);

  function wrapSelection(before, after) {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const text = value;
    const selected = text.slice(start, end);
    const newText = text.slice(0, start) + before + selected + after + text.slice(end);
    onChange(newText);
    // Restore cursor after the wrapped text
    setTimeout(() => {
      el.selectionStart = start + before.length;
      el.selectionEnd = end + before.length;
      el.focus();
    }, 0);
  }

  function handleKeyDown(e) {
    if (e.key === 'b' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      wrapSelection('**', '**');
    } else if (e.key === 'i' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      wrapSelection('*', '*');
    } else if (e.key === 'Enter' && !e.shiftKey && onSubmit) {
      e.preventDefault();
      onSubmit(e);
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div style={{ display: 'flex', gap: '2px' }}>
        <button
          type="button"
          onClick={() => wrapSelection('**', '**')}
          style={styles.formatBtn}
          title="Bold (Ctrl+B)"
        ><strong>B</strong></button>
        <button
          type="button"
          onClick={() => wrapSelection('*', '*')}
          style={styles.formatBtn}
          title="Italic (Ctrl+I)"
        ><em>I</em></button>
      </div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        style={{ ...style, resize: 'none', minHeight: '36px', maxHeight: '100px' }}
        autoFocus={autoFocus}
        rows={1}
      />
    </div>
  );
}

// ─── Review List ─────────────────────────────────────────────────────────────

export default function Reviews() {
  const { profile, isAdmin, refreshKey } = useAuth();
  const confirm = useConfirm();
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ title: '', url: '' });
  const [activeReview, setActiveReview] = useState(null);

  // Script Reviews state
  const [scriptReviews, setScriptReviews] = useState([]);
  const [scriptReviewsLoading, setScriptReviewsLoading] = useState(true);
  const [showScriptCreate, setShowScriptCreate] = useState(false);
  const [scriptCreateTab, setScriptCreateTab] = useState('concept'); // 'concept' | 'upload'
  const [readyExpanded, setReadyExpanded] = useState(false);
  const [activeScriptReview, setActiveScriptReview] = useState(null);
  const [concepts, setConcepts] = useState([]);
  const [selectedConceptId, setSelectedConceptId] = useState('');
  const [conceptDocs, setConceptDocs] = useState([]);
  const [selectedDocId, setSelectedDocId] = useState('');
  const [scriptTitle, setScriptTitle] = useState('');
  const [scriptFile, setScriptFile] = useState(null);
  const [scriptUploadTitle, setScriptUploadTitle] = useState('');
  const [linkedConceptId, setLinkedConceptId] = useState('');
  const [scriptUploading, setScriptUploading] = useState(false);
  const scriptFileInputRef = useRef(null);
  const [newVersionReviewIds, setNewVersionReviewIds] = useState(new Set());

  const fetchReviews = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('reviews')
        .select('*, creator:profiles!reviews_profile_fk(full_name), thumbs:review_thumbnails(file_path, created_at)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      // For reviews with no video yet, surface an uploaded thumbnail (earliest) on the card.
      const enriched = (data || []).map(r => {
        const firstThumb = (r.thumbs || []).slice().sort((a, b) =>
          new Date(a.created_at) - new Date(b.created_at))[0];
        const thumbUrl = firstThumb
          ? supabase.storage.from('review-thumbnails').getPublicUrl(firstThumb.file_path).data?.publicUrl
          : null;
        return { ...r, thumbUrl };
      });
      setReviews(enriched);
    } catch (err) {
      console.error('Error fetching reviews:', err);
      setReviews([]);
    } finally {
      setLoading(false);
    }
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!createForm.title.trim()) return;

    // YouTube link is optional at creation — you can pre-set title/description/
    // thumbnails and add the video later (the first version backfills the URL).
    const hasUrl = createForm.url.trim().length > 0;
    const videoId = hasUrl ? extractVideoId(createForm.url) : null;
    if (hasUrl && !videoId) { alert('Invalid YouTube URL.'); return; }

    // Create review
    const { data: review, error } = await supabase.from('reviews').insert({
      title: createForm.title.trim(),
      youtube_url: hasUrl ? createForm.url.trim() : null,
      youtube_video_id: videoId,
      created_by: profile.id,
    }).select().single();
    if (error) { console.error(error); return; }

    // Create initial version only when a video link was provided
    if (hasUrl) {
      await supabase.from('review_versions').insert({
        review_id: review.id,
        version_number: 1,
        label: 'Cut 1',
        youtube_url: createForm.url.trim(),
        youtube_video_id: videoId,
        created_by: profile.id,
      });
    }

    setCreateForm({ title: '', url: '' });
    setShowCreate(false);
    fetchReviews();
  }

  async function handleDeleteReview(reviewId) {
    if (!(await confirm('Delete this review and all its versions/comments?'))) return;
    await supabase.from('reviews').delete().eq('id', reviewId);
    if (activeReview?.id === reviewId) setActiveReview(null);
    fetchReviews();
  }

  // ─── Script Review Functions ──────────────────────────────────────────────

  const fetchScriptReviews = useCallback(async () => {
    setScriptReviewsLoading(true);
    try {
      const { data, error } = await supabase.from('script_reviews')
        .select('*, creator:profiles!script_reviews_created_by_fkey(full_name), concept:concepts!script_reviews_concept_id_fkey(name)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      // Fetch latest version number per review
      const enriched = await Promise.all((data || []).map(async (sr) => {
        const { data: vers } = await supabase.from('script_review_versions')
          .select('version_number')
          .eq('review_id', sr.id)
          .order('version_number', { ascending: false })
          .limit(1);
        return { ...sr, latestVersion: vers?.[0]?.version_number || 0 };
      }));
      setScriptReviews(enriched);
    } catch (err) {
      console.error('Error fetching script reviews:', err);
      setScriptReviews([]);
    } finally {
      setScriptReviewsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!profile?.id) return;
    Promise.all([fetchReviews(), fetchScriptReviews()]);
  }, [profile?.id, fetchReviews, fetchScriptReviews]);
  useVisibilityRefresh(useCallback(() => {
    fetchReviews();
    fetchScriptReviews();
  }, [fetchReviews, fetchScriptReviews]));

  // Realtime subscription for new writer versions on script review cards
  useEffect(() => {
    const channel = supabase.channel('script-version-alerts')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'script_review_versions',
      }, (payload) => {
        if (payload.new.source === 'writer') {
          setNewVersionReviewIds(prev => new Set([...prev, payload.new.review_id]));
          fetchScriptReviews();
        }
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [fetchScriptReviews, refreshKey]);

  async function fetchConceptsForScript() {
    const { data } = await supabase.from('concepts')
      .select('id, name')
      .order('created_at', { ascending: false });
    setConcepts(data || []);
  }

  async function fetchConceptDocs(conceptId) {
    setSelectedDocId('');
    if (!conceptId) { setConceptDocs([]); return; }
    const { data } = await supabase.from('concept_documents')
      .select('id, title, type')
      .eq('concept_id', conceptId)
      .in('type', ['document', 'screenplay', 'screenwriter'])
      .order('created_at', { ascending: false });
    setConceptDocs(data || []);
  }

  async function handleCreateScriptFromConcept(e) {
    e.preventDefault();
    if (!scriptTitle.trim() || !selectedConceptId || !selectedDocId) return;
    setScriptUploading(true);
    try {
      const { data: sr, error } = await supabase.from('script_reviews').insert({
        title: scriptTitle.trim(),
        source_type: 'concept',
        concept_id: selectedConceptId,
        created_by: profile.id,
      }).select().single();
      if (error) throw error;
      await supabase.from('script_review_versions').insert({
        review_id: sr.id,
        version_number: 1,
        uploaded_by: profile.id,
        source: 'reviewer',
        concept_document_id: selectedDocId,
      });
      setShowScriptCreate(false);
      setScriptTitle('');
      setSelectedConceptId('');
      setSelectedDocId('');
      setConceptDocs([]);
      fetchScriptReviews();
    } catch (err) {
      console.error('Error creating script review from concept:', err);
    } finally {
      setScriptUploading(false);
    }
  }

  async function handleCreateScriptFromUpload(e) {
    e.preventDefault();
    if (!scriptFile || !scriptUploadTitle.trim()) return;
    setScriptUploading(true);
    try {
      const ext = scriptFile.name.split('.').pop();
      const path = `${profile.id}/${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage.from('script-reviews').upload(path, scriptFile);
      if (uploadErr) throw uploadErr;
      const { data: sr, error } = await supabase.from('script_reviews').insert({
        title: scriptUploadTitle.trim(),
        source_type: 'upload',
        concept_id: linkedConceptId || null,
        created_by: profile.id,
      }).select().single();
      if (error) throw error;
      await supabase.from('script_review_versions').insert({
        review_id: sr.id,
        version_number: 1,
        file_url: path,
        file_type: ext,
        uploaded_by: profile.id,
        source: 'reviewer',
      });
      setShowScriptCreate(false);
      setScriptFile(null);
      setScriptUploadTitle('');
      setLinkedConceptId('');
      fetchScriptReviews();
    } catch (err) {
      console.error('Error creating script review from upload:', err);
    } finally {
      setScriptUploading(false);
    }
  }

  function handleScriptFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowed = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/markdown'];
    const allowedExt = ['pdf', 'docx', 'md'];
    const ext = file.name.split('.').pop().toLowerCase();
    if (!allowed.includes(file.type) && !allowedExt.includes(ext)) {
      alert('Only .pdf, .docx, and .md files are allowed.');
      return;
    }
    setScriptFile(file);
    if (!scriptUploadTitle) {
      setScriptUploadTitle(file.name.replace(/\.[^/.]+$/, ''));
    }
  }

  async function handleDeleteScriptReview(id) {
    if (!(await confirm('Delete this script review and all its versions?'))) return;
    // Delete storage files first
    const { data: versions } = await supabase.from('script_review_versions')
      .select('file_url').eq('review_id', id);
    const filePaths = (versions || []).filter(v => v.file_url).map(v => v.file_url);
    if (filePaths.length > 0) {
      await supabase.storage.from('script-reviews').remove(filePaths);
    }
    await supabase.from('script_reviews').delete().eq('id', id);
    if (activeScriptReview?.id === id) setActiveScriptReview(null);
    fetchScriptReviews();
  }

  // ─── Script Review Detail Early Return ────────────────────────────────────

  if (activeScriptReview) {
    return (
      <ScriptReviewDetail
        review={activeScriptReview}
        onBack={() => { setActiveScriptReview(null); fetchScriptReviews(); }}
        profile={profile}
        isAdmin={isAdmin}
        refreshKey={refreshKey}
      />
    );
  }

  if (activeReview) {
    return (
      <ReviewPlayer
        review={activeReview}
        onBack={() => setActiveReview(null)}
        profile={profile}
        isAdmin={isAdmin}
      />
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.topBar}>
        <div>
          <h1 style={styles.pageTitle}>Reviews</h1>
          <p style={styles.pageSubtitle}>{reviews.length} video{reviews.length !== 1 ? 's' : ''} for review</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)} style={styles.addBtn}>
          {showCreate ? '✕ Cancel' : '+ New Review'}
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} style={styles.createForm}>
          <input
            value={createForm.title}
            onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })}
            placeholder="Review title (e.g. 'Q1 Promo - Cut 2')"
            required
            style={styles.input}
          />
          <input
            value={createForm.url}
            onChange={(e) => setCreateForm({ ...createForm, url: e.target.value })}
            placeholder="YouTube URL (optional — add after the video is uploaded)"
            style={styles.input}
          />
          {createForm.url && extractVideoId(createForm.url) && (
            <div style={styles.previewThumb}>
              <img
                src={`https://img.youtube.com/vi/${extractVideoId(createForm.url)}/mqdefault.jpg`}
                alt="Preview"
                style={styles.previewImg}
              />
              <span style={styles.previewLabel}>✓ Valid YouTube link detected</span>
            </div>
          )}
          <button type="submit" style={styles.submitBtn}>Create Review</button>
        </form>
      )}

      {loading ? (
        <p style={styles.emptyText}>Loading...</p>
      ) : reviews.length === 0 ? (
        <div style={styles.emptyCard}>
          <p style={styles.emptyText}>No reviews yet. Paste a YouTube link to get started.</p>
        </div>
      ) : (
        <div style={styles.reviewGrid}>
          {reviews.map(review => (
            <div key={review.id} style={styles.reviewCard} onClick={() => setActiveReview(review)}>
              <div style={styles.thumbWrap}>
                {review.youtube_video_id ? (
                  <>
                    <img
                      src={`https://img.youtube.com/vi/${review.youtube_video_id}/mqdefault.jpg`}
                      alt={review.title}
                      style={styles.thumb}
                    />
                    <div style={styles.playOverlay}>▶</div>
                  </>
                ) : review.thumbUrl ? (
                  <>
                    <img src={review.thumbUrl} alt={review.title} style={styles.thumb} />
                    <div style={styles.noVideoBadge}>No video yet</div>
                  </>
                ) : (
                  <div style={styles.thumbPlaceholder}>No video yet</div>
                )}
              </div>
              <div style={styles.reviewCardBody}>
                <h3 style={styles.reviewCardTitle}>{review.title}</h3>
                <span style={styles.reviewCardMeta}>
                  {review.creator?.full_name} · {new Date(review.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              </div>
              {(review.created_by === profile?.id || isAdmin) && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteReview(review.id); }}
                  style={styles.reviewDeleteBtn}
                >✕</button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ─── Scripts Section ─────────────────────────────────────────────── */}
      <div style={styles.scriptsDivider} />
      <div style={styles.scriptsHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h2 style={styles.scriptsTitle}>Scripts</h2>
          <span style={styles.scriptsCount}>
            {scriptReviews.filter(s => s.status !== 'ready').length} active
          </span>
        </div>
        <button
          onClick={() => { setShowScriptCreate(true); setScriptCreateTab('concept'); fetchConceptsForScript(); }}
          style={styles.scriptAddBtn}
        >+ Add Script Review</button>
      </div>

      {scriptReviewsLoading ? (
        <p style={styles.emptyText}>Loading scripts...</p>
      ) : (
        <>
          {/* Active script cards */}
          {scriptReviews.filter(s => s.status !== 'ready').length === 0 ? (
            <div style={styles.emptyCard}>
              <p style={styles.emptyText}>No script reviews yet. Create one from a concept or upload a file.</p>
            </div>
          ) : (
            <div style={styles.scriptGrid}>
              {scriptReviews.filter(s => s.status !== 'ready').map(sr => (
                <div key={sr.id} style={styles.scriptCard} onClick={() => { setActiveScriptReview(sr); setNewVersionReviewIds(prev => { const next = new Set(prev); next.delete(sr.id); return next; }); }}>
                  <div style={{ position: 'relative' }}>
                    <div style={styles.scriptCardIcon}>📄</div>
                    {newVersionReviewIds.has(sr.id) && (
                      <span style={{ position: 'absolute', top: '-2px', right: '-2px', width: '8px', height: '8px', borderRadius: '50%', background: '#e8ff47', boxShadow: '0 0 6px rgba(232,255,71,0.5)', animation: 'pulse 2s infinite' }} />
                    )}
                  </div>
                  <div style={styles.scriptCardBody}>
                    <h3 style={styles.scriptCardTitle}>{sr.title}</h3>
                    <div style={styles.scriptCardRow}>
                      <span style={styles.scriptSourceLabel}>
                        {sr.source_type === 'concept' ? '📎 From Concept' : '📁 Uploaded'}
                      </span>
                      {sr.latestVersion > 0 && (
                        <span style={styles.scriptVersionBadge}>v{sr.latestVersion}</span>
                      )}
                      <span style={{
                        ...styles.scriptStatusPill,
                        ...(sr.status === 'awaiting_writer' ? styles.scriptStatusAwaiting : {}),
                      }}>
                        {sr.status === 'in_review' ? 'In Review' : 'Awaiting Writer'}
                      </span>
                    </div>
                    <div style={styles.scriptCardFooter}>
                      <span style={styles.scriptCardTime}>{timeAgo(sr.updated_at)}</span>
                      <span style={styles.scriptCardCreator}>{sr.creator?.full_name}</span>
                    </div>
                  </div>
                  {(sr.created_by === profile?.id || isAdmin) && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteScriptReview(sr.id); }}
                      style={styles.scriptDeleteBtn}
                    >✕</button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Ready section (collapsible) */}
          {scriptReviews.filter(s => s.status === 'ready').length > 0 && (
            <div style={styles.readySection}>
              <button
                onClick={() => setReadyExpanded(!readyExpanded)}
                style={styles.readyToggle}
              >
                <span style={styles.readyToggleIcon}>{readyExpanded ? '▾' : '▸'}</span>
                Ready
                <span style={styles.readyCount}>
                  {scriptReviews.filter(s => s.status === 'ready').length}
                </span>
              </button>
              {readyExpanded && (
                <div style={styles.scriptGrid}>
                  {scriptReviews.filter(s => s.status === 'ready').map(sr => (
                    <div key={sr.id} style={styles.scriptCardReady} onClick={() => setActiveScriptReview(sr)}>
                      <div style={styles.scriptCardIcon}>✅</div>
                      <div style={styles.scriptCardBody}>
                        <h3 style={styles.scriptCardTitle}>{sr.title}</h3>
                        <div style={styles.scriptCardRow}>
                          <span style={styles.scriptStatusReady}>Ready</span>
                          {sr.latestVersion > 0 && (
                            <span style={styles.scriptVersionBadge}>v{sr.latestVersion}</span>
                          )}
                          {sr.marked_ready_at && (
                            <span style={styles.scriptCardTime}>
                              {new Date(sr.marked_ready_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </span>
                          )}
                        </div>
                        <div style={styles.scriptCardFooter}>
                          <span style={styles.readyViewLabel}>View Final Version</span>
                          <span style={styles.scriptCardCreator}>{sr.creator?.full_name}</span>
                        </div>
                      </div>
                      {(sr.created_by === profile?.id || isAdmin) && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteScriptReview(sr.id); }}
                          style={styles.scriptDeleteBtn}
                        >✕</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ─── Create Script Modal ─────────────────────────────────────────── */}
      {showScriptCreate && (
        <div style={styles.scriptModalOverlay} onClick={() => setShowScriptCreate(false)}>
          <div style={styles.scriptModal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.scriptModalHeader}>
              <h3 style={styles.scriptModalTitle}>New Script Review</h3>
              <button onClick={() => setShowScriptCreate(false)} style={styles.scriptModalClose}>✕</button>
            </div>
            <div style={styles.scriptModalTabs}>
              <button
                onClick={() => setScriptCreateTab('concept')}
                style={{
                  ...styles.scriptModalTab,
                  ...(scriptCreateTab === 'concept' ? styles.scriptModalTabActive : {}),
                }}
              >From Concept</button>
              <button
                onClick={() => setScriptCreateTab('upload')}
                style={{
                  ...styles.scriptModalTab,
                  ...(scriptCreateTab === 'upload' ? styles.scriptModalTabActive : {}),
                }}
              >Upload File</button>
            </div>

            {scriptCreateTab === 'concept' ? (
              <form onSubmit={handleCreateScriptFromConcept} style={styles.scriptModalForm}>
                <label style={styles.scriptModalLabel}>Concept</label>
                <select
                  value={selectedConceptId}
                  onChange={(e) => { setSelectedConceptId(e.target.value); fetchConceptDocs(e.target.value); }}
                  style={styles.scriptModalSelect}
                >
                  <option value="">Select a concept...</option>
                  {concepts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>

                {conceptDocs.length > 0 && (
                  <>
                    <label style={styles.scriptModalLabel}>Document</label>
                    <select
                      value={selectedDocId}
                      onChange={(e) => setSelectedDocId(e.target.value)}
                      style={styles.scriptModalSelect}
                    >
                      <option value="">Select a document...</option>
                      {conceptDocs.map(d => (
                        <option key={d.id} value={d.id}>{d.title} ({d.type})</option>
                      ))}
                    </select>
                  </>
                )}

                <label style={styles.scriptModalLabel}>Title</label>
                <input
                  value={scriptTitle}
                  onChange={(e) => setScriptTitle(e.target.value)}
                  placeholder="Script review title"
                  required
                  style={styles.scriptModalInput}
                />
                <button
                  type="submit"
                  style={styles.scriptModalSubmit}
                  disabled={!scriptTitle.trim() || !selectedConceptId || !selectedDocId || scriptUploading}
                >
                  {scriptUploading ? 'Creating...' : 'Create Script Review'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleCreateScriptFromUpload} style={styles.scriptModalForm}>
                <div
                  style={styles.scriptDropZone}
                  onClick={() => scriptFileInputRef.current?.click()}
                >
                  {scriptFile ? (
                    <span style={styles.scriptDropZoneFile}>📄 {scriptFile.name}</span>
                  ) : (
                    <span style={styles.scriptDropZoneText}>Click to select a file (.pdf, .docx, .md)</span>
                  )}
                  <input
                    ref={scriptFileInputRef}
                    type="file"
                    accept=".pdf,.docx,.md"
                    onChange={handleScriptFileSelect}
                    style={{ display: 'none' }}
                  />
                </div>

                <label style={styles.scriptModalLabel}>Title</label>
                <input
                  value={scriptUploadTitle}
                  onChange={(e) => setScriptUploadTitle(e.target.value)}
                  placeholder="Script review title"
                  required
                  style={styles.scriptModalInput}
                />

                <label style={styles.scriptModalLabel}>Link to Concept (optional)</label>
                <select
                  value={linkedConceptId}
                  onChange={(e) => setLinkedConceptId(e.target.value)}
                  style={styles.scriptModalSelect}
                >
                  <option value="">None</option>
                  {concepts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>

                <button
                  type="submit"
                  style={styles.scriptModalSubmit}
                  disabled={!scriptFile || !scriptUploadTitle.trim() || scriptUploading}
                >
                  {scriptUploading ? 'Uploading...' : 'Upload & Create Review'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Review Player ───────────────────────────────────────────────────────────

function ReviewPlayer({ review, onBack, profile, isAdmin }) {
  const playerRef = useRef(null);
  const ytPlayerRef = useRef(null);
  const [versions, setVersions] = useState([]);
  const [activeVersion, setActiveVersion] = useState(null);
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [showAddVersion, setShowAddVersion] = useState(false);
  const [newVersionUrl, setNewVersionUrl] = useState('');
  const [newVersionLabel, setNewVersionLabel] = useState('');
  const [filterResolved, setFilterResolved] = useState('all'); // all, open, resolved
  const timeInterval = useRef(null);
  const commentsListRef = useRef(null);
  const videoColRef = useRef(null);
  const [videoColHeight, setVideoColHeight] = useState(null);

  // Details section state (tied to review.id, not version)
  const [thumbnails, setThumbnails] = useState([]);
  const [titles, setTitles] = useState([]);
  const [description, setDescription] = useState(review.description || '');
  const [detailsComments, setDetailsComments] = useState([]);
  const [newTitleText, setNewTitleText] = useState('');
  const [showDetailComments, setShowDetailComments] = useState({}); // { 'thumbnail-id': true, ... }
  const [detailCommentText, setDetailCommentText] = useState({});
  const thumbnailInputRef = useRef(null);

  useEffect(() => {
    fetchVersions();
    fetchDetails();
    return () => {
      if (timeInterval.current) clearInterval(timeInterval.current);
      if (ytPlayerRef.current?.destroy) {
        ytPlayerRef.current.destroy();
        ytPlayerRef.current = null;
      }
    };
  }, [review.id]);

  // When active version changes, reload player and comments
  useEffect(() => {
    if (activeVersion) {
      fetchComments();
      loadPlayer(activeVersion.youtube_video_id);
    }
  }, [activeVersion?.id]);

  // Measure video column height so comments panel matches it exactly
  useEffect(() => {
    const el = videoColRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setVideoColHeight(entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Auto-scroll comments list to bottom only when new comments are added
  const prevCommentsLengthRef = useRef(0);
  useEffect(() => {
    const el = commentsListRef.current;
    if (el && comments.length > prevCommentsLengthRef.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevCommentsLengthRef.current = comments.length;
  }, [comments]);

  async function fetchVersions() {
    const { data } = await supabase.from('review_versions')
      .select('*, creator:profiles!review_versions_profile_fk(full_name)')
      .eq('review_id', review.id)
      .order('version_number', { ascending: true });
    const vers = data || [];
    setVersions(vers);
    if (vers.length > 0 && !activeVersion) {
      setActiveVersion(vers[vers.length - 1]); // default to latest
    }
  }

  async function fetchComments() {
    if (!activeVersion) return;
    const { data } = await supabase.from('review_comments')
      .select('*, commenter:profiles!review_comments_profile_fk(full_name)')
      .eq('version_id', activeVersion.id)
      .order('timestamp_seconds', { ascending: true });
    // Also fetch replies for each comment
    const commentsWithReplies = await Promise.all((data || []).map(async (c) => {
      const { data: replies } = await supabase.from('review_replies')
        .select('*, replier:profiles!review_replies_profile_fk(full_name)')
        .eq('comment_id', c.id)
        .order('created_at', { ascending: true });
      return { ...c, replies: replies || [] };
    }));
    setComments(commentsWithReplies);
  }

  function loadPlayer(videoId) {
    // Destroy old player
    if (ytPlayerRef.current?.destroy) {
      ytPlayerRef.current.destroy();
      ytPlayerRef.current = null;
    }
    if (timeInterval.current) clearInterval(timeInterval.current);
    setIsReady(false);
    setCurrentTime(0);
    setDuration(0);

    function create() {
      // Guard: if the DOM ref is gone (component unmounted), bail out
      if (!playerRef.current) return;
      ytPlayerRef.current = new window.YT.Player(playerRef.current, {
        videoId,
        playerVars: { autoplay: 0, modestbranding: 1, rel: 0, fs: 1 },
        events: {
          onReady: (e) => {
            setDuration(e.target.getDuration());
            setIsReady(true);
            timeInterval.current = setInterval(() => {
              if (e.target.getCurrentTime) setCurrentTime(e.target.getCurrentTime());
            }, 250);
          },
        },
      });
    }

    if (window.YT && window.YT.Player) {
      // Small delay to let DOM settle after destroy
      setTimeout(create, 100);
    } else {
      const existing = document.getElementById('youtube-iframe-api');
      if (!existing) {
        const tag = document.createElement('script');
        tag.id = 'youtube-iframe-api';
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);
      }
      // Use a polling approach instead of one-shot callback, since
      // onYouTubeIframeAPIReady only fires once per page load
      const poll = setInterval(() => {
        if (window.YT && window.YT.Player) {
          clearInterval(poll);
          create();
        }
      }, 100);
      // Store poll interval so cleanup can clear it
      timeInterval.current = poll;
    }
  }

  async function handleAddComment(e) {
    e.preventDefault();
    if (!commentText.trim() || !profile?.id || !activeVersion) return;
    const ts = ytPlayerRef.current?.getCurrentTime?.() || 0;
    await supabase.from('review_comments').insert({
      review_id: review.id,
      version_id: activeVersion.id,
      user_id: profile.id,
      timestamp_seconds: Math.floor(ts),
      content: commentText.trim(),
    });
    setCommentText('');
    fetchComments();
  }

  async function handleDeleteComment(commentId) {
    await supabase.from('review_comments').delete().eq('id', commentId);
    fetchComments();
  }

  async function handleResolve(commentId, resolved) {
    await supabase.from('review_comments').update({
      is_resolved: !resolved,
      resolved_by: !resolved ? profile.id : null,
      resolved_at: !resolved ? new Date().toISOString() : null,
    }).eq('id', commentId);
    fetchComments();
  }

  async function handleAddReply(commentId, replyText) {
    if (!replyText.trim() || !profile?.id) return;
    await supabase.from('review_replies').insert({
      comment_id: commentId,
      user_id: profile.id,
      content: replyText.trim(),
    });
    fetchComments();
  }

  async function handleDeleteReply(replyId) {
    await supabase.from('review_replies').delete().eq('id', replyId);
    fetchComments();
  }

  async function handleAddVersion(e) {
    e.preventDefault();
    const videoId = extractVideoId(newVersionUrl);
    if (!videoId) { alert('Invalid YouTube URL.'); return; }
    const nextNum = versions.length + 1;
    await supabase.from('review_versions').insert({
      review_id: review.id,
      version_number: nextNum,
      label: newVersionLabel.trim() || `Cut ${nextNum}`,
      youtube_url: newVersionUrl.trim(),
      youtube_video_id: videoId,
      created_by: profile.id,
    });
    // First video added to a review created without one — backfill the parent row
    // so cards/links point at the video.
    if (nextNum === 1) {
      await supabase.from('reviews')
        .update({ youtube_url: newVersionUrl.trim(), youtube_video_id: videoId })
        .eq('id', review.id);
    }
    setNewVersionUrl('');
    setNewVersionLabel('');
    setShowAddVersion(false);
    const { data } = await supabase.from('review_versions')
      .select('*, creator:profiles!review_versions_profile_fk(full_name)')
      .eq('review_id', review.id)
      .order('version_number', { ascending: true });
    const vers = data || [];
    setVersions(vers);
    setActiveVersion(vers[vers.length - 1]);
  }

  function seekTo(seconds) {
    if (ytPlayerRef.current?.seekTo) ytPlayerRef.current.seekTo(seconds, true);
  }

  // ─── Details CRUD ──────────────────────────────────────────────────────────
  async function fetchDetails() {
    const [thumbRes, titleRes, commentRes] = await Promise.all([
      supabase.from('review_thumbnails')
        .select('*, uploader:profiles!review_thumbnails_uploaded_by_fkey(full_name)')
        .eq('review_id', review.id).order('created_at', { ascending: true }),
      supabase.from('review_titles')
        .select('*, creator:profiles!review_titles_created_by_fkey(full_name)')
        .eq('review_id', review.id).order('created_at', { ascending: true }),
      supabase.from('review_details_comments')
        .select('*, commenter:profiles!review_details_comments_user_id_fkey(full_name)')
        .eq('review_id', review.id).order('created_at', { ascending: true }),
    ]);
    setThumbnails(thumbRes.data || []);
    setTitles(titleRes.data || []);
    setDetailsComments(commentRes.data || []);
    // Refresh description from DB
    const { data: rev } = await supabase.from('reviews').select('description').eq('id', review.id).single();
    if (rev) setDescription(rev.description || '');
  }

  async function handleUploadThumbnail(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop();
    const path = `${review.id}/${Date.now()}.${ext}`;
    const { error: uploadErr } = await supabase.storage.from('review-thumbnails').upload(path, file);
    if (uploadErr) { console.error('Upload error:', uploadErr); return; }
    await supabase.from('review_thumbnails').insert({
      review_id: review.id, file_path: path, file_name: file.name, uploaded_by: profile.id,
    });
    fetchDetails();
  }

  async function handleDeleteThumbnail(thumb) {
    await supabase.storage.from('review-thumbnails').remove([thumb.file_path]);
    await supabase.from('review_thumbnails').delete().eq('id', thumb.id);
    fetchDetails();
  }

  async function handleAddTitle() {
    if (!newTitleText.trim()) return;
    await supabase.from('review_titles').insert({
      review_id: review.id, title: newTitleText.trim(), created_by: profile.id,
    });
    setNewTitleText('');
    fetchDetails();
  }

  async function handleDeleteTitle(titleId) {
    await supabase.from('review_titles').delete().eq('id', titleId);
    fetchDetails();
  }

  async function handleSaveDescription() {
    await supabase.from('reviews').update({ description }).eq('id', review.id);
  }

  async function handleAddDetailComment(targetType, targetId) {
    const key = targetId || targetType;
    const text = detailCommentText[key];
    if (!text?.trim()) return;
    await supabase.from('review_details_comments').insert({
      review_id: review.id, target_type: targetType, target_id: targetId || null,
      user_id: profile.id, content: text.trim(),
    });
    setDetailCommentText(prev => ({ ...prev, [key]: '' }));
    fetchDetails();
  }

  async function handleDeleteDetailComment(commentId) {
    await supabase.from('review_details_comments').delete().eq('id', commentId);
    fetchDetails();
  }

  function toggleDetailComments(key) {
    setShowDetailComments(prev => ({ ...prev, [key]: !prev[key] }));
  }

  function getCommentsFor(targetType, targetId) {
    return detailsComments.filter(c => c.target_type === targetType && (targetId ? c.target_id === targetId : !c.target_id));
  }

  function getThumbnailUrl(filePath) {
    const { data } = supabase.storage.from('review-thumbnails').getPublicUrl(filePath);
    return data?.publicUrl;
  }

  // Filter comments
  const filteredComments = comments.filter(c => {
    if (filterResolved === 'open') return !c.is_resolved;
    if (filterResolved === 'resolved') return c.is_resolved;
    return true;
  });

  const openCount = comments.filter(c => !c.is_resolved).length;
  const resolvedCount = comments.filter(c => c.is_resolved).length;

  const markers = duration > 0
    ? comments.filter(c => !c.is_resolved).map(c => ({ ...c, pct: (c.timestamp_seconds / duration) * 100 }))
    : [];

  return (
    <div style={styles.page}>
      <div style={styles.topBar}>
        <div>
          <button onClick={onBack} style={styles.backBtn}>← Back to Reviews</button>
          <h1 style={styles.pageTitle}>{review.title}</h1>
        </div>
      </div>

      {/* Version Tabs */}
      {versions.length > 0 && (
      <div style={styles.versionBar}>
        <div style={styles.versionTabs}>
          {versions.map(v => (
            <button
              key={v.id}
              onClick={() => setActiveVersion(v)}
              style={{
                ...styles.versionTab,
                ...(activeVersion?.id === v.id ? styles.versionTabActive : {}),
              }}
            >
              <span style={styles.versionNum}>v{v.version_number}</span>
              {v.label}
            </button>
          ))}
        </div>
        <button onClick={() => setShowAddVersion(!showAddVersion)} style={styles.addVersionBtn}>
          {showAddVersion ? '✕' : '+ New Version'}
        </button>
      </div>
      )}

      {showAddVersion && (
        <form onSubmit={handleAddVersion} style={styles.addVersionForm}>
          <input
            value={newVersionLabel}
            onChange={(e) => setNewVersionLabel(e.target.value)}
            placeholder={`Label (e.g. Cut ${versions.length + 1})`}
            style={styles.addVersionInput}
          />
          <input
            value={newVersionUrl}
            onChange={(e) => setNewVersionUrl(e.target.value)}
            placeholder="YouTube URL for new version"
            required
            style={{ ...styles.addVersionInput, flex: 2 }}
          />
          <button type="submit" style={styles.addVersionSubmit}>Add</button>
        </form>
      )}

      <div style={styles.playerLayout}>
        {/* Video */}
        <div ref={videoColRef} style={styles.videoCol}>
          {versions.length === 0 ? (
            <div style={styles.noVideoPrompt}>
              <div style={styles.noVideoIcon}>🎬</div>
              <p style={styles.noVideoTitle}>No video yet</p>
              <p style={styles.noVideoSub}>Set up titles, description, and thumbnails below. Paste the YouTube link here once the video is uploaded.</p>
              <form onSubmit={handleAddVersion} style={styles.noVideoForm}>
                <input
                  value={newVersionUrl}
                  onChange={(e) => setNewVersionUrl(e.target.value)}
                  placeholder="Paste YouTube URL"
                  required
                  style={styles.noVideoInput}
                />
                <button type="submit" style={styles.addVersionSubmit}>Add video</button>
              </form>
            </div>
          ) : (
            <div style={styles.videoWrap}>
              <div ref={playerRef} style={styles.videoEmbed} />
            </div>
          )}
        </div>

        {/* Comments Column */}
        <div style={{ ...styles.commentsCol, ...(videoColHeight ? { height: videoColHeight } : {}) }}>
          <div style={styles.commentsPanelHeader}>
            <h3 style={styles.commentsPanelTitle}>
              Notes
              <span style={styles.commentCount}>{comments.length}</span>
            </h3>
            <div style={styles.filterTabs}>
              <button
                onClick={() => setFilterResolved('all')}
                style={{ ...styles.filterTab, ...(filterResolved === 'all' ? styles.filterTabActive : {}) }}
              >All</button>
              <button
                onClick={() => setFilterResolved('open')}
                style={{ ...styles.filterTab, ...(filterResolved === 'open' ? styles.filterTabActive : {}) }}
              >Open{openCount > 0 && ` (${openCount})`}</button>
              <button
                onClick={() => setFilterResolved('resolved')}
                style={{ ...styles.filterTab, ...(filterResolved === 'resolved' ? styles.filterTabActive : {}) }}
              >Resolved{resolvedCount > 0 && ` (${resolvedCount})`}</button>
            </div>
          </div>
          <div ref={commentsListRef} style={styles.commentsList}>
            {filteredComments.length === 0 ? (
              <p style={styles.emptyComments}>
                {filterResolved === 'all' ? 'No comments yet. Play the video and add your first note.' :
                  filterResolved === 'open' ? 'No open notes.' : 'No resolved notes.'}
              </p>
            ) : (
              filteredComments.map(c => (
                <CommentCard
                  key={c.id}
                  comment={c}
                  profile={profile}
                  isAdmin={isAdmin}
                  onSeek={seekTo}
                  onResolve={handleResolve}
                  onDelete={handleDeleteComment}
                  onAddReply={handleAddReply}
                  onDeleteReply={handleDeleteReply}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Timeline + Comment Input (below video+notes row) */}
      <div
        style={styles.timeline}
        onClick={(e) => {
          if (duration > 0) {
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            seekTo(pct * duration);
          }
        }}
      >
        {duration > 0 && (
          <div style={{ ...styles.timelineProgress, width: `${(currentTime / duration) * 100}%` }} />
        )}
        {markers.map(m => (
          <button
            key={m.id}
            onClick={(e) => { e.stopPropagation(); seekTo(m.timestamp_seconds); }}
            style={{ ...styles.timelineMarker, left: `${m.pct}%` }}
            title={`${formatTimestamp(m.timestamp_seconds)} — ${m.commenter?.full_name}: ${m.content.substring(0, 40)}`}
          />
        ))}
      </div>
      <div style={styles.timeDisplay}>
        <span>{formatTimestamp(currentTime)}</span>
        {duration > 0 && <span style={{ color: 'rgba(255,255,255,0.25)' }}> / {formatTimestamp(duration)}</span>}
      </div>
      <form onSubmit={handleAddComment} style={styles.commentForm}>
        <div style={styles.commentTimeTag}>
          {formatTimestamp(ytPlayerRef.current?.getCurrentTime?.() || 0)}
        </div>
        <FormattedCommentInput
          value={commentText}
          onChange={setCommentText}
          onSubmit={handleAddComment}
          placeholder="Add a note at current timestamp..."
          style={styles.commentInput}
        />
        <button type="submit" style={styles.commentSubmitBtn} disabled={!commentText.trim()}>Post</button>
      </form>

      {/* ─── Details Section (tied to review.id, static across versions) ─── */}
      <div style={styles.detailsSection}>
        <h2 style={styles.detailsSectionTitle}>Details</h2>
        <div style={styles.detailsGrid}>

        {/* Thumbnails */}
        <div style={styles.detailsBlock}>
          <div style={styles.detailsBlockHeader}>
            <h3 style={styles.detailsBlockTitle}>Thumbnails</h3>
            <button onClick={() => thumbnailInputRef.current?.click()} style={styles.detailsAddBtn}>+ Upload</button>
            <input ref={thumbnailInputRef} type="file" accept="image/*" onChange={handleUploadThumbnail} style={{ display: 'none' }} />
          </div>
          {thumbnails.length === 0 ? (
            <p style={styles.detailsEmpty}>No thumbnails uploaded yet.</p>
          ) : (
            <div style={styles.thumbnailGrid}>
              {thumbnails.map(t => {
                const tComments = getCommentsFor('thumbnail', t.id);
                const commentKey = `thumbnail-${t.id}`;
                return (
                  <div key={t.id} style={styles.thumbnailCard}>
                    <img src={getThumbnailUrl(t.file_path)} alt={t.file_name} style={styles.thumbnailImg} />
                    <div style={styles.thumbnailMeta}>
                      <span style={styles.thumbnailUploader}>{t.uploader?.full_name}</span>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button onClick={() => toggleDetailComments(commentKey)} style={styles.detailsCommentToggle}>
                          💬 {tComments.length > 0 ? tComments.length : ''}
                        </button>
                        {(t.uploaded_by === profile?.id || isAdmin) && (
                          <button onClick={() => handleDeleteThumbnail(t)} style={styles.detailsDeleteBtn}>✕</button>
                        )}
                      </div>
                    </div>
                    {showDetailComments[commentKey] && (
                      <div style={styles.detailsCommentThread}>
                        {tComments.map(dc => (
                          <div key={dc.id} style={styles.detailsComment}>
                            <span style={styles.detailsCommentAuthor}>{dc.commenter?.full_name}</span>
                            <span style={styles.detailsCommentText}>{dc.content}</span>
                            {(dc.user_id === profile?.id || isAdmin) && (
                              <button onClick={() => handleDeleteDetailComment(dc.id)} style={styles.detailsCommentDelete}>✕</button>
                            )}
                          </div>
                        ))}
                        <div style={styles.detailsCommentForm}>
                          <input
                            value={detailCommentText[t.id] || ''}
                            onChange={(e) => setDetailCommentText(prev => ({ ...prev, [t.id]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleAddDetailComment('thumbnail', t.id); }}
                            placeholder="Comment..."
                            style={styles.detailsCommentInput}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Titles */}
        <div style={styles.detailsBlock}>
          <div style={styles.detailsBlockHeader}>
            <h3 style={styles.detailsBlockTitle}>Title Suggestions</h3>
          </div>
          <div style={styles.titlesList}>
            {titles.map(t => {
              const tComments = getCommentsFor('title', t.id);
              const commentKey = `title-${t.id}`;
              return (
                <div key={t.id} style={styles.titleItem}>
                  <div style={styles.titleItemMain}>
                    <span style={styles.titleText}>{t.title}</span>
                    <span style={styles.titleCreator}>{t.creator?.full_name}</span>
                    <button onClick={() => toggleDetailComments(commentKey)} style={styles.detailsCommentToggle}>
                      💬 {tComments.length > 0 ? tComments.length : ''}
                    </button>
                    {(t.created_by === profile?.id || isAdmin) && (
                      <button onClick={() => handleDeleteTitle(t.id)} style={styles.detailsDeleteBtn}>✕</button>
                    )}
                  </div>
                  {showDetailComments[commentKey] && (
                    <div style={styles.detailsCommentThread}>
                      {tComments.map(dc => (
                        <div key={dc.id} style={styles.detailsComment}>
                          <span style={styles.detailsCommentAuthor}>{dc.commenter?.full_name}</span>
                          <span style={styles.detailsCommentText}>{dc.content}</span>
                          {(dc.user_id === profile?.id || isAdmin) && (
                            <button onClick={() => handleDeleteDetailComment(dc.id)} style={styles.detailsCommentDelete}>✕</button>
                          )}
                        </div>
                      ))}
                      <div style={styles.detailsCommentForm}>
                        <input
                          value={detailCommentText[t.id] || ''}
                          onChange={(e) => setDetailCommentText(prev => ({ ...prev, [t.id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleAddDetailComment('title', t.id); }}
                          placeholder="Comment..."
                          style={styles.detailsCommentInput}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={styles.titleAddForm}>
            <input
              value={newTitleText}
              onChange={(e) => setNewTitleText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddTitle(); }}
              placeholder="Suggest a title..."
              style={styles.detailsCommentInput}
            />
            <button onClick={handleAddTitle} style={styles.detailsAddBtn} disabled={!newTitleText.trim()}>Add</button>
          </div>
        </div>

        {/* Description */}
        <div style={styles.detailsBlock}>
          <div style={styles.detailsBlockHeader}>
            <h3 style={styles.detailsBlockTitle}>Description</h3>
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={handleSaveDescription}
            placeholder="Write the video description..."
            style={styles.descriptionTextarea}
          />
          <div style={{ marginTop: '8px' }}>
            <button onClick={() => toggleDetailComments('description')} style={styles.detailsCommentToggle}>
              💬 Comments {getCommentsFor('description').length > 0 ? `(${getCommentsFor('description').length})` : ''}
            </button>
          </div>
          {showDetailComments['description'] && (
            <div style={styles.detailsCommentThread}>
              {getCommentsFor('description').map(dc => (
                <div key={dc.id} style={styles.detailsComment}>
                  <span style={styles.detailsCommentAuthor}>{dc.commenter?.full_name}</span>
                  <span style={styles.detailsCommentText}>{dc.content}</span>
                  {(dc.user_id === profile?.id || isAdmin) && (
                    <button onClick={() => handleDeleteDetailComment(dc.id)} style={styles.detailsCommentDelete}>✕</button>
                  )}
                </div>
              ))}
              <div style={styles.detailsCommentForm}>
                <input
                  value={detailCommentText['description'] || ''}
                  onChange={(e) => setDetailCommentText(prev => ({ ...prev, description: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddDetailComment('description', null); }}
                  placeholder="Comment on description..."
                  style={styles.detailsCommentInput}
                />
              </div>
            </div>
          )}
        </div>

        </div>{/* end detailsGrid */}
      </div>
    </div>
  );
}

// ─── Comment Card with replies ───────────────────────────────────────────────

function CommentCard({ comment: c, profile, isAdmin, onSeek, onResolve, onDelete, onAddReply, onDeleteReply }) {
  const [showReplies, setShowReplies] = useState(c.replies.length > 0);
  const [replyText, setReplyText] = useState('');
  const [showReplyInput, setShowReplyInput] = useState(false);

  function handleSubmitReply(e) {
    e.preventDefault();
    if (!replyText.trim()) return;
    onAddReply(c.id, replyText);
    setReplyText('');
    setShowReplyInput(false);
    setShowReplies(true);
  }

  return (
    <div style={{
      ...styles.commentCard,
      opacity: c.is_resolved ? 0.55 : 1,
      borderLeftColor: c.is_resolved ? 'rgba(34,197,94,0.3)' : 'rgba(251,191,36,0.3)',
    }}>
      <div style={styles.commentCardHeader}>
        <button onClick={() => onSeek(c.timestamp_seconds)} style={styles.commentTimestamp}>
          {formatTimestamp(c.timestamp_seconds)}
        </button>
        <span style={styles.commentAuthor}>{c.commenter?.full_name}</span>
        <span style={styles.commentDate}>
          {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </span>
      </div>
      <p style={styles.commentBody}>{renderFormattedText(c.content)}</p>

      {/* Action bar */}
      <div style={styles.commentActions}>
        <button
          onClick={() => onResolve(c.id, c.is_resolved)}
          style={{
            ...styles.resolveBtn,
            color: c.is_resolved ? '#22c55e' : 'rgba(255,255,255,0.3)',
          }}
        >
          {c.is_resolved ? '✓ Resolved' : '○ Resolve'}
        </button>
        <button
          onClick={() => { setShowReplyInput(!showReplyInput); setShowReplies(true); }}
          style={styles.replyBtn}
        >
          💬 Reply{c.replies.length > 0 ? ` (${c.replies.length})` : ''}
        </button>
        {(c.user_id === profile?.id || isAdmin) && (
          <button onClick={() => onDelete(c.id)} style={styles.commentDeleteBtn}>✕</button>
        )}
      </div>

      {/* Replies */}
      {showReplies && c.replies.length > 0 && (
        <div style={styles.repliesWrap}>
          {c.replies.map(r => (
            <div key={r.id} style={styles.replyCard}>
              <div style={styles.replyHeader}>
                <span style={styles.replyAuthor}>{r.replier?.full_name}</span>
                <span style={styles.replyDate}>
                  {new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
                {(r.user_id === profile?.id || isAdmin) && (
                  <button onClick={() => onDeleteReply(r.id)} style={styles.replyDeleteBtn}>✕</button>
                )}
              </div>
              <p style={styles.replyBody}>{renderFormattedText(r.content)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Reply input */}
      {showReplyInput && (
        <form onSubmit={handleSubmitReply} style={styles.replyForm}>
          <FormattedCommentInput
            value={replyText}
            onChange={setReplyText}
            onSubmit={handleSubmitReply}
            placeholder="Write a reply..."
            style={styles.replyInput}
            autoFocus
          />
          <button type="submit" style={styles.replySubmitBtn} disabled={!replyText.trim()}>Reply</button>
        </form>
      )}
    </div>
  );
}

// ─── Annotation Constants ─────────────────────────────────────────────────────

const HIGHLIGHT_COLORS = {
  yellow: 'rgba(250,204,21,0.35)',
  cyan: 'rgba(34,211,238,0.3)',
  green: 'rgba(74,222,128,0.3)',
  pink: 'rgba(244,114,182,0.3)',
  orange: 'rgba(251,146,60,0.3)',
  purple: 'rgba(167,139,250,0.3)',
};

const HIGHLIGHT_COLOR_OPTIONS = [
  { key: 'yellow', hex: '#facc15', label: 'Yellow' },
  { key: 'cyan', hex: '#22d3ee', label: 'Cyan' },
  { key: 'green', hex: '#4ade80', label: 'Green' },
  { key: 'pink', hex: '#f472b6', label: 'Pink' },
  { key: 'orange', hex: '#fb923c', label: 'Orange' },
  { key: 'purple', hex: '#a78bfa', label: 'Purple' },
];

// ─── Document Viewer ──────────────────────────────────────────────────────────

function DocumentViewer({ version, fileUrl, conceptDocHtml, isLatest, onSwitchToCurrent, onTextSelect, annotations, activeAnnotationId, onAnnotationClick }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // PDF state
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pdfPages, setPdfPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState('fit'); // 'fit' | number (scale)
  const pdfContainerRef = useRef(null);
  const pageRefs = useRef([]);
  const renderTasksRef = useRef([]);

  // DOCX / MD state
  const [htmlContent, setHtmlContent] = useState('');
  const docContentRef = useRef(null);

  const fileType = version?.file_type?.toLowerCase();
  const fileName = version?.file_url?.split('/').pop() || `document.${fileType || 'file'}`;

  // ─── Load PDF.js from CDN ──────────────────────────────────────────────
  const loadPdfJs = useCallback(() => {
    return new Promise((resolve, reject) => {
      if (window.pdfjsLib) { resolve(window.pdfjsLib); return; }
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      script.onerror = () => reject(new Error('Failed to load PDF.js'));
      document.head.appendChild(script);
    });
  }, []);

  // ─── Load document when version changes ────────────────────────────────
  useEffect(() => {
    if (!version) return;
    setError(null);
    setHtmlContent('');
    setPdfDoc(null);
    setPdfPages(0);
    setCurrentPage(1);

    // Concept-linked doc: content passed directly as HTML
    if (!fileUrl && conceptDocHtml) {
      setHtmlContent(conceptDocHtml);
      return;
    }

    if (!fileUrl) return;

    if (fileType === 'pdf') loadPdf();
    else if (fileType === 'docx') loadDocx();
    else if (fileType === 'html') loadHtml();
    else if (fileType === 'md') loadMarkdown();
  }, [version?.id, fileUrl, conceptDocHtml]);

  // ─── PDF loading ───────────────────────────────────────────────────────
  async function loadPdf() {
    setLoading(true);
    try {
      const pdfjsLib = await loadPdfJs();
      const doc = await pdfjsLib.getDocument(fileUrl).promise;
      setPdfDoc(doc);
      setPdfPages(doc.numPages);
      pageRefs.current = new Array(doc.numPages).fill(null);
    } catch (err) {
      console.error('PDF load error:', err);
      setError('Failed to load PDF document.');
    } finally {
      setLoading(false);
    }
  }

  // ─── Render PDF pages when doc or zoom changes ─────────────────────────
  useEffect(() => {
    if (!pdfDoc) return;
    // Cancel any pending renders
    renderTasksRef.current.forEach(t => { if (t?.cancel) t.cancel(); });
    renderTasksRef.current = [];
    renderAllPages();
  }, [pdfDoc, zoom]);

  async function renderAllPages() {
    if (!pdfDoc || !pdfContainerRef.current) return;
    const container = pdfContainerRef.current;
    const containerWidth = container.clientWidth - 48; // padding

    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const baseViewport = page.getViewport({ scale: 1 });

      let scale;
      if (zoom === 'fit') {
        scale = containerWidth / baseViewport.width;
      } else {
        scale = zoom;
      }
      const viewport = page.getViewport({ scale });

      const wrapper = pageRefs.current[i - 1];
      if (!wrapper) continue;

      // Canvas
      let canvas = wrapper.querySelector('canvas');
      if (!canvas) {
        canvas = document.createElement('canvas');
        wrapper.appendChild(canvas);
      }
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      canvas.style.display = 'block';

      const ctx = canvas.getContext('2d');
      const renderTask = page.render({ canvasContext: ctx, viewport });
      renderTasksRef.current.push(renderTask);
      try { await renderTask.promise; } catch (e) { if (e.name !== 'RenderingCancelledException') console.error(e); }

      // Text layer
      let textDiv = wrapper.querySelector('.pdf-text-layer');
      if (!textDiv) {
        textDiv = document.createElement('div');
        textDiv.className = 'pdf-text-layer';
        wrapper.appendChild(textDiv);
      }
      textDiv.innerHTML = '';
      textDiv.style.width = `${viewport.width}px`;
      textDiv.style.height = `${viewport.height}px`;

      const textContent = await page.getTextContent();
      textContent.items.forEach(item => {
        const tx = window.pdfjsLib.Util.transform(viewport.transform, item.transform);
        const span = document.createElement('span');
        span.textContent = item.str;
        span.style.position = 'absolute';
        span.style.left = `${tx[4]}px`;
        span.style.top = `${tx[5] - item.height * scale}px`;
        span.style.fontSize = `${item.height * scale}px`;
        span.style.fontFamily = item.fontName || 'sans-serif';
        span.style.transformOrigin = '0% 0%';
        span.style.whiteSpace = 'pre';
        span.style.color = 'transparent';
        span.style.lineHeight = '1';
        textDiv.appendChild(span);
      });

      // Set wrapper dimensions
      wrapper.style.width = `${viewport.width}px`;
      wrapper.style.height = `${viewport.height}px`;
    }
  }

  // ─── PDF scroll tracking for current page ──────────────────────────────
  useEffect(() => {
    if (!pdfDoc || !pdfContainerRef.current) return;
    const container = pdfContainerRef.current;
    function handleScroll() {
      const scrollTop = container.scrollTop;
      const containerMid = scrollTop + container.clientHeight / 3;
      let page = 1;
      for (let i = 0; i < pageRefs.current.length; i++) {
        const el = pageRefs.current[i];
        if (el && el.offsetTop <= containerMid) page = i + 1;
      }
      setCurrentPage(page);
    }
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [pdfDoc]);

  // ─── DOCX loading ─────────────────────────────────────────────────────
  async function loadDocx() {
    setLoading(true);
    try {
      const resp = await fetch(fileUrl);
      const arrayBuffer = await resp.arrayBuffer();
      const result = await mammoth.convertToHtml({ arrayBuffer });
      setHtmlContent(result.value);
    } catch (err) {
      console.error('DOCX load error:', err);
      setError('Failed to load DOCX document.');
    } finally {
      setLoading(false);
    }
  }

  // ─── Markdown loading ─────────────────────────────────────────────────
  async function loadHtml() {
    setLoading(true);
    try {
      const resp = await fetch(fileUrl);
      const text = await resp.text();
      setHtmlContent(text);
    } catch (err) {
      console.error('HTML load error:', err);
      setError('Failed to load HTML document.');
    } finally {
      setLoading(false);
    }
  }

  async function loadMarkdown() {
    setLoading(true);
    try {
      const resp = await fetch(fileUrl);
      const text = await resp.text();
      const html = marked(text, { breaks: true, gfm: true });
      setHtmlContent(html);
    } catch (err) {
      console.error('Markdown load error:', err);
      setError('Failed to load Markdown document.');
    } finally {
      setLoading(false);
    }
  }

  // ─── Apply annotation overlays for DOCX/MD ──────────────────────────────
  useEffect(() => {
    if (!docContentRef.current || !annotations || fileType === 'pdf') return;
    // Clear old annotation marks
    const el = docContentRef.current;
    el.querySelectorAll('[data-annotation-id]').forEach(mark => {
      const parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
    });
    // Sort annotations by range_start so we apply from end to start (avoid offset shifts)
    const sorted = [...(annotations || [])].filter(a => !a.is_resolved).sort((a, b) => b.range_start - a.range_start);
    sorted.forEach((ann, idx) => {
      try {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
        let charCount = 0;
        let startNode = null, startOffset = 0, endNode = null, endOffset = 0;
        while (walker.nextNode()) {
          const node = walker.currentNode;
          const nodeLen = node.textContent.length;
          if (!startNode && charCount + nodeLen > ann.range_start) {
            startNode = node;
            startOffset = ann.range_start - charCount;
          }
          if (charCount + nodeLen >= ann.range_end) {
            endNode = node;
            endOffset = ann.range_end - charCount;
            break;
          }
          charCount += nodeLen;
        }
        if (startNode && endNode) {
          const range = document.createRange();
          range.setStart(startNode, Math.min(startOffset, startNode.textContent.length));
          range.setEnd(endNode, Math.min(endOffset, endNode.textContent.length));
          const mark = document.createElement('mark');
          mark.dataset.annotationId = ann.id;
          mark.className = `ann-mark ann-${ann.type}`;
          if (ann.type === 'highlight') mark.dataset.color = ann.highlight_color || 'yellow';
          mark.onclick = () => onAnnotationClick?.(ann.id);
          range.surroundContents(mark);
        }
      } catch (e) { /* Range may not be valid across elements */ }
    });
  }, [annotations, htmlContent, fileType]);

  // ─── Text selection handler ────────────────────────────────────────────
  useEffect(() => {
    function handleMouseUp() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      // Compute character offsets relative to the document content root
      let rangeStart = 0, rangeEnd = 0;
      const root = docContentRef.current || document.body;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
      let charCount = 0;
      let foundStart = false;
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node === range.startContainer) { rangeStart = charCount + range.startOffset; foundStart = true; }
        if (node === range.endContainer) { rangeEnd = charCount + range.endOffset; break; }
        charCount += node.textContent.length;
      }

      // Determine page number for PDF
      let pageNumber = null;
      if (fileType === 'pdf') {
        let node = range.startContainer;
        while (node && node !== document) {
          if (node.dataset?.pageNumber) { pageNumber = parseInt(node.dataset.pageNumber); break; }
          node = node.parentNode;
        }
      }

      onTextSelect?.({
        selectedText: sel.toString(),
        rangeStart,
        rangeEnd,
        boundingRect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        pageNumber,
      });
    }
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, [fileType, onTextSelect]);

  // ─── Zoom helpers ──────────────────────────────────────────────────────
  const zoomPercent = zoom === 'fit' ? 'Fit' : `${Math.round(zoom * 100)}%`;

  function zoomIn() {
    const current = zoom === 'fit' ? 1 : zoom;
    setZoom(Math.min(current + 0.25, 2));
  }
  function zoomOut() {
    const current = zoom === 'fit' ? 1 : zoom;
    setZoom(Math.max(current - 0.25, 0.5));
  }
  function handleZoomSlider(e) {
    setZoom(parseFloat(e.target.value));
  }

  // File type icon
  const fileIcon = fileType === 'pdf' ? '📕' : fileType === 'docx' ? '📘' : '📝';

  // ─── No version selected ──────────────────────────────────────────────
  if (!version) {
    return (
      <div style={dv.container}>
        <div style={dv.emptyState}>
          <span style={dv.emptyIcon}>📄</span>
          <p style={dv.emptyText}>No versions uploaded yet</p>
          <p style={dv.emptyHint}>Upload a script file to begin the review</p>
        </div>
      </div>
    );
  }

  // No file attached (concept-only version)
  if (!fileUrl && !htmlContent) {
    return (
      <div style={dv.container}>
        {!isLatest && (
          <div style={dv.pastBanner}>
            You are viewing Version {version.version_number} — this is not the current version.{' '}
            <button onClick={onSwitchToCurrent} style={dv.pastBannerBtn}>Switch to Current →</button>
          </div>
        )}
        <div style={dv.emptyState}>
          <span style={dv.emptyIcon}>📎</span>
          <p style={dv.emptyText}>
            {version.concept_document_id
              ? 'Loading concept document...'
              : 'No file attached to this version'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={dv.container}>
      {/* Past version banner */}
      {!isLatest && (
        <div style={dv.pastBanner}>
          You are viewing Version {version.version_number} — this is not the current version.{' '}
          <button onClick={onSwitchToCurrent} style={dv.pastBannerBtn}>Switch to Current →</button>
        </div>
      )}

      {/* Toolbar */}
      <div style={dv.toolbar}>
        <div style={dv.toolbarLeft}>
          <span style={dv.fileIcon}>{fileIcon}</span>
          <span style={dv.fileName}>{fileName}</span>
          <div style={dv.toolbarDivider} />
          <button onClick={zoomOut} style={dv.zoomBtn} title="Zoom out">−</button>
          <span style={dv.zoomLabel}>{zoomPercent}</span>
          <button onClick={zoomIn} style={dv.zoomBtn} title="Zoom in">+</button>
          {fileType === 'pdf' && (
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.05"
              value={zoom === 'fit' ? 1 : zoom}
              onChange={handleZoomSlider}
              style={dv.zoomSlider}
            />
          )}
          <button onClick={() => setZoom('fit')} style={{
            ...dv.fitBtn,
            ...(zoom === 'fit' ? dv.fitBtnActive : {}),
          }}>Fit</button>
          {fileType === 'pdf' && pdfPages > 0 && (
            <>
              <div style={dv.toolbarDivider} />
              <span style={dv.pageIndicator}>Page {currentPage} of {pdfPages}</span>
            </>
          )}
        </div>
        {fileUrl && (
          <a
            href={fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={dv.downloadBtn}
          >
            ↓ Download
          </a>
        )}
      </div>

      {/* Document area */}
      {loading ? (
        <div style={dv.loadingState}>
          <div style={dv.spinner} />
          <p style={dv.loadingText}>Loading document...</p>
        </div>
      ) : error ? (
        <div style={dv.errorState}>
          <p style={dv.errorText}>{error}</p>
          <a href={fileUrl} target="_blank" rel="noopener noreferrer" style={dv.errorLink}>
            Download the original file instead
          </a>
        </div>
      ) : fileType === 'pdf' ? (
        /* ─── PDF Renderer ─── */
        <div ref={pdfContainerRef} style={dv.scrollArea}>
          {Array.from({ length: pdfPages }, (_, i) => {
            const pageAnns = (annotations || []).filter(a => a.page_number === i + 1 && !a.is_resolved);
            return (
              <div key={i} style={{ position: 'relative' }}>
                {/* Annotation margin badges */}
                <div style={dv.marginBadgeCol}>
                  {pageAnns.map((ann, ai) => {
                    const order = (annotations || []).filter(a => !a.is_resolved).indexOf(ann) + 1;
                    const topPct = ann.bounding_rect_json?.topPct || 10;
                    return (
                      <button
                        key={ann.id}
                        onClick={() => onAnnotationClick?.(ann.id)}
                        style={{
                          ...dv.marginBadge,
                          top: `${topPct}%`,
                          ...(activeAnnotationId === ann.id ? dv.marginBadgeActive : {}),
                          background: ann.type === 'redline' ? 'rgba(255,68,68,0.15)' : ann.type === 'highlight' ? 'rgba(232,255,71,0.15)' : 'rgba(99,102,241,0.15)',
                          color: ann.type === 'redline' ? '#ff4444' : ann.type === 'highlight' ? '#e8ff47' : '#a5b4fc',
                          borderColor: ann.type === 'redline' ? 'rgba(255,68,68,0.3)' : ann.type === 'highlight' ? 'rgba(232,255,71,0.3)' : 'rgba(99,102,241,0.3)',
                        }}
                        title={ann.selected_text.substring(0, 40)}
                      >{order}</button>
                    );
                  })}
                </div>
                {/* PDF page */}
                <div
                  data-page-number={i + 1}
                  ref={el => { pageRefs.current[i] = el; }}
                  style={dv.pdfPageWrapper}
                />
                {/* PDF annotation overlay */}
                {pageAnns.length > 0 && (
                  <div style={dv.pdfAnnotationOverlay}>
                    {pageAnns.map(ann => {
                      const r = ann.bounding_rect_json || {};
                      return (
                        <div
                          key={ann.id}
                          onClick={() => onAnnotationClick?.(ann.id)}
                          style={{
                            position: 'absolute',
                            left: `${r.leftPct || 0}%`, top: `${r.topPct || 0}%`,
                            width: `${r.widthPct || 10}%`, height: `${r.heightPct || 2}%`,
                            ...(ann.type === 'redline' ? { background: 'rgba(255,68,68,0.1)', borderBottom: '2px solid rgba(255,68,68,0.6)' } : {}),
                            ...(ann.type === 'highlight' ? { background: HIGHLIGHT_COLORS[ann.highlight_color] || HIGHLIGHT_COLORS.yellow } : {}),
                            ...(ann.type === 'note' ? { borderBottom: '2px dashed rgba(99,102,241,0.4)' } : {}),
                            cursor: 'pointer', borderRadius: '1px',
                            ...(activeAnnotationId === ann.id ? { outline: '2px solid #e8ff47', outlineOffset: '1px' } : {}),
                          }}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* ─── DOCX / Markdown HTML Renderer ─── */
        <div style={dv.scrollArea}>
          <div style={{ position: 'relative', display: 'flex' }}>
            {/* Annotation margin badges for HTML docs */}
            <div style={dv.marginBadgeColHtml}>
              {(annotations || []).filter(a => !a.is_resolved).map((ann, i) => (
                <button
                  key={ann.id}
                  onClick={() => onAnnotationClick?.(ann.id)}
                  style={{
                    ...dv.marginBadgeHtml,
                    ...(activeAnnotationId === ann.id ? dv.marginBadgeActive : {}),
                    background: ann.type === 'redline' ? 'rgba(255,68,68,0.15)' : ann.type === 'highlight' ? 'rgba(232,255,71,0.15)' : 'rgba(99,102,241,0.15)',
                    color: ann.type === 'redline' ? '#ff4444' : ann.type === 'highlight' ? '#e8ff47' : '#a5b4fc',
                    borderColor: ann.type === 'redline' ? 'rgba(255,68,68,0.3)' : ann.type === 'highlight' ? 'rgba(232,255,71,0.3)' : 'rgba(99,102,241,0.3)',
                  }}
                  title={ann.selected_text.substring(0, 40)}
                >{i + 1}</button>
              ))}
            </div>
            <div style={dv.docPage}>
              <div
                ref={docContentRef}
                className="script-doc-content"
                style={dv.docHtmlContent}
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(htmlContent)}}
              />
            </div>
          </div>
        </div>
      )}

      {/* Injected stylesheet for rendered HTML content */}
      <style>{`
        .script-doc-content {
          font-family: Georgia, 'Courier Prime', 'Courier New', serif;
          font-size: 15px;
          line-height: 1.8;
          color: #1a1a2e;
        }
        .script-doc-content h1 { font-size: 28px; font-weight: 700; margin: 0 0 16px; color: #0f0f1a; border-bottom: 1px solid #e5e5e5; padding-bottom: 8px; }
        .script-doc-content h2 { font-size: 22px; font-weight: 700; margin: 24px 0 12px; color: #1a1a2e; }
        .script-doc-content h3 { font-size: 18px; font-weight: 600; margin: 20px 0 10px; color: #1a1a2e; }
        .script-doc-content h4 { font-size: 16px; font-weight: 600; margin: 16px 0 8px; color: #333; }
        .script-doc-content p { margin: 0 0 12px; }
        .script-doc-content strong { font-weight: 700; }
        .script-doc-content em { font-style: italic; }
        .script-doc-content ul, .script-doc-content ol { margin: 0 0 12px; padding-left: 28px; }
        .script-doc-content li { margin-bottom: 4px; }
        .script-doc-content blockquote { margin: 12px 0; padding: 12px 20px; border-left: 4px solid #d1d5db; background: #f9fafb; color: #374151; font-style: italic; border-radius: 0 4px 4px 0; }
        .script-doc-content pre { background: #1e1e2e; color: #e2e8f0; padding: 16px; border-radius: 8px; overflow-x: auto; margin: 12px 0; font-size: 13px; line-height: 1.5; font-family: 'SF Mono', Monaco, 'Courier New', monospace; }
        .script-doc-content code { background: #f1f5f9; color: #6366f1; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; font-family: 'SF Mono', Monaco, 'Courier New', monospace; }
        .script-doc-content pre code { background: none; color: inherit; padding: 0; border-radius: 0; }
        .script-doc-content a { color: #6366f1; text-decoration: underline; }
        .script-doc-content table { border-collapse: collapse; width: 100%; margin: 12px 0; }
        .script-doc-content th, .script-doc-content td { border: 1px solid #e5e7eb; padding: 8px 12px; text-align: left; }
        .script-doc-content th { background: #f9fafb; font-weight: 600; }
        .script-doc-content img { max-width: 100%; border-radius: 4px; }

        .pdf-text-layer {
          position: absolute;
          top: 0;
          left: 0;
          overflow: hidden;
          opacity: 0.3;
          line-height: 1;
        }
        .pdf-text-layer span {
          cursor: text;
        }
        .pdf-text-layer span::selection {
          background: rgba(99, 102, 241, 0.35);
        }
        @keyframes dv-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        /* Annotation marks on DOCX/MD content */
        .ann-mark { cursor: pointer; border-radius: 2px; padding: 0 1px; transition: outline 0.15s; }
        .ann-mark:hover { outline: 2px solid rgba(232,255,71,0.4); outline-offset: 1px; }
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
    </div>
  );
}

// ─── Annotation Toolbar ───────────────────────────────────────────────────────

function AnnotationToolbar({ activeTool, onToolChange, highlightColor, onColorChange, disabled }) {
  const [showColors, setShowColors] = useState(false);

  if (disabled) return null;

  return (
    <div style={at.bar}>
      <button
        onClick={() => onToolChange(activeTool === 'redline' ? null : 'redline')}
        style={{ ...at.toolBtn, ...(activeTool === 'redline' ? at.toolBtnActiveRedline : {}) }}
        title="Redline (Strikethrough)"
      >
        <span style={at.toolIcon}>🖊</span> Redline
      </button>
      <button
        onClick={() => { onToolChange(activeTool === 'highlight' ? null : 'highlight'); setShowColors(activeTool !== 'highlight'); }}
        style={{ ...at.toolBtn, ...(activeTool === 'highlight' ? at.toolBtnActiveHighlight : {}) }}
        title="Highlight"
      >
        <span style={at.toolIcon}>🖍</span> Highlight
        <span style={{ ...at.colorDot, background: HIGHLIGHT_COLOR_OPTIONS.find(c => c.key === highlightColor)?.hex || '#facc15' }} />
      </button>
      <button
        onClick={() => onToolChange(activeTool === 'note' ? null : 'note')}
        style={{ ...at.toolBtn, ...(activeTool === 'note' ? at.toolBtnActiveNote : {}) }}
        title="Note"
      >
        <span style={at.toolIcon}>💬</span> Note
      </button>

      {activeTool === 'highlight' && showColors && (
        <div style={at.colorPicker}>
          {HIGHLIGHT_COLOR_OPTIONS.map(c => (
            <button
              key={c.key}
              onClick={() => { onColorChange(c.key); setShowColors(false); }}
              style={{
                ...at.colorSwatch,
                background: c.hex,
                ...(highlightColor === c.key ? at.colorSwatchActive : {}),
              }}
              title={c.label}
            />
          ))}
        </div>
      )}

      {activeTool && (
        <span style={at.hint}>Select text in the document to annotate</span>
      )}
    </div>
  );
}

// ─── Annotations Sidebar ──────────────────────────────────────────────────────

function AnnotationsSidebar({ annotations, activeAnnotationId, onAnnotationClick, onResolve, onDelete, onReply, onDeleteReply, onEditComment, profile, isAdmin, disabled }) {
  const [filter, setFilter] = useState('all');
  const [showResolved, setShowResolved] = useState(false);
  const [replyText, setReplyText] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const activeCardRef = useRef(null);

  const unresolved = (annotations || []).filter(a => !a.is_resolved);
  const resolved = (annotations || []).filter(a => a.is_resolved);

  const filtered = unresolved.filter(a => {
    if (filter === 'redlines') return a.type === 'redline';
    if (filter === 'highlights') return a.type === 'highlight';
    if (filter === 'notes') return a.type === 'note';
    return true;
  });

  useEffect(() => {
    if (activeAnnotationId && activeCardRef.current) {
      activeCardRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [activeAnnotationId]);

  function handleReplySubmit(annotationId) {
    const text = replyText[annotationId];
    if (!text?.trim()) return;
    onReply(annotationId, text.trim());
    setReplyText(prev => ({ ...prev, [annotationId]: '' }));
  }

  function startEdit(ann) {
    setEditingId(ann.id);
    setEditText(ann.comment_text);
  }

  function submitEdit(annId) {
    onEditComment(annId, editText);
    setEditingId(null);
    setEditText('');
  }

  const typeIcon = { redline: '🖊', highlight: '🖍', note: '💬' };

  function renderCard(ann, index, isResolved) {
    const isActive = activeAnnotationId === ann.id;
    return (
      <div
        key={ann.id}
        ref={isActive ? activeCardRef : null}
        onClick={() => onAnnotationClick?.(ann.id)}
        style={{
          ...as.card,
          ...(isActive ? as.cardActive : {}),
          ...(isResolved ? as.cardResolved : {}),
        }}
      >
        <div style={as.cardHeader}>
          <span style={{
            ...as.numBadge,
            background: ann.type === 'redline' ? 'rgba(255,68,68,0.15)' : ann.type === 'highlight' ? 'rgba(250,204,21,0.15)' : 'rgba(99,102,241,0.15)',
            color: ann.type === 'redline' ? '#ff4444' : ann.type === 'highlight' ? '#facc15' : '#a5b4fc',
          }}>
            {!isResolved ? index + 1 : '—'}
          </span>
          <span style={as.typeIcon}>{typeIcon[ann.type]}</span>
          <span style={as.annotatorAvatar}>
            {(ann.annotator?.full_name || '?')[0].toUpperCase()}
          </span>
          <span style={as.annotatorName}>{ann.annotator?.full_name || 'Unknown'}</span>
          <span style={as.cardTime}>{timeAgo(ann.created_at)}</span>
        </div>

        <div style={{
          ...as.quotedText,
          ...(ann.type === 'redline' ? as.quotedRedline : {}),
          ...(ann.type === 'highlight' ? { borderLeftColor: HIGHLIGHT_COLOR_OPTIONS.find(c => c.key === ann.highlight_color)?.hex || '#facc15' } : {}),
          ...(ann.type === 'note' ? { borderLeftColor: '#a5b4fc' } : {}),
        }}>
          "{ann.selected_text.length > 80 ? ann.selected_text.substring(0, 80) + '…' : ann.selected_text}"
        </div>

        {editingId === ann.id ? (
          <div style={as.editRow}>
            <input
              value={editText}
              onChange={e => setEditText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitEdit(ann.id); if (e.key === 'Escape') setEditingId(null); }}
              style={as.editInput}
              autoFocus
              onClick={e => e.stopPropagation()}
            />
            <button onClick={(e) => { e.stopPropagation(); submitEdit(ann.id); }} style={as.editSaveBtn}>Save</button>
          </div>
        ) : ann.comment_text ? (
          <p
            style={as.commentText}
            onDoubleClick={() => { if (ann.annotator_id === profile?.id) startEdit(ann); }}
          >{ann.comment_text}</p>
        ) : null}

        {isResolved && (
          <div style={as.resolvedBadge}>
            ✓ Resolved {ann.resolved_by_profile?.full_name ? `by ${ann.resolved_by_profile.full_name}` : ''}
          </div>
        )}

        {ann.replies?.length > 0 && (
          <div style={as.repliesWrap}>
            {ann.replies.map(r => (
              <div key={r.id} style={as.replyCard}>
                <div style={as.replyHeader}>
                  <span style={as.replyAvatar}>{(r.author?.full_name || '?')[0].toUpperCase()}</span>
                  <span style={as.replyAuthor}>{r.author?.full_name}</span>
                  <span style={as.replyTime}>{timeAgo(r.created_at)}</span>
                  {(r.author_id === profile?.id || isAdmin) && (
                    <button onClick={(e) => { e.stopPropagation(); onDeleteReply(r.id); }} style={as.replyDeleteBtn}>✕</button>
                  )}
                </div>
                <p style={as.replyText}>{r.text}</p>
              </div>
            ))}
          </div>
        )}

        {!disabled && !isResolved && (
          <div style={as.cardActions}>
            <button onClick={(e) => { e.stopPropagation(); onResolve(ann.id); }} style={as.resolveBtn}>○ Resolve</button>
            {(ann.annotator_id === profile?.id || isAdmin) && (
              <button onClick={(e) => { e.stopPropagation(); onDelete(ann.id); }} style={as.deleteBtn}>✕</button>
            )}
          </div>
        )}
        {!disabled && isResolved && (
          <div style={as.cardActions}>
            <button onClick={(e) => { e.stopPropagation(); onResolve(ann.id); }} style={as.unresolveBtn}>↩ Unresolve</button>
          </div>
        )}

        {!disabled && !isResolved && (
          <div style={as.replyInputRow}>
            <input
              value={replyText[ann.id] || ''}
              onChange={e => setReplyText(prev => ({ ...prev, [ann.id]: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') handleReplySubmit(ann.id); }}
              placeholder="Reply..."
              style={as.replyInput}
              onClick={e => e.stopPropagation()}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={as.container}>
      <div style={as.header}>
        <h3 style={as.title}>Annotations <span style={as.count}>{unresolved.length}</span></h3>
      </div>
      <div style={as.filterRow}>
        {['all', 'redlines', 'highlights', 'notes'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{ ...as.filterBtn, ...(filter === f ? as.filterBtnActive : {}) }}
          >{f.charAt(0).toUpperCase() + f.slice(1)}</button>
        ))}
      </div>
      <div style={as.list}>
        {filtered.length === 0 ? (
          <p style={as.emptyText}>
            {unresolved.length === 0 ? 'No annotations yet. Select text in the document to begin.' : 'No matching annotations.'}
          </p>
        ) : (
          filtered.map((ann, i) => renderCard(ann, i, false))
        )}
        {resolved.length > 0 && (
          <div style={as.resolvedSection}>
            <button onClick={() => setShowResolved(!showResolved)} style={as.resolvedToggle}>
              {showResolved ? '▾' : '▸'} Show Resolved ({resolved.length})
            </button>
            {showResolved && resolved.map((ann, i) => renderCard(ann, i, true))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Script Review Instance (3-Panel Layout) ─────────────────────────────────

function ScriptReviewDetail({ review, onBack, profile, isAdmin, refreshKey }) {
  const [versions, setVersions] = useState([]);
  const [activeVersion, setActiveVersion] = useState(null);
  const [status, setStatus] = useState(review.status);
  const [uploading, setUploading] = useState(false);
  const [shareUrl, setShareUrl] = useState(null);
  const uploadRef = useRef(null);
  const [newVersionAlert, setNewVersionAlert] = useState(false);
  const [conceptDocHtml, setConceptDocHtml] = useState('');

  // Fetch concept document content when version is concept-linked (no file_url)
  useEffect(() => {
    if (!activeVersion) { setConceptDocHtml(''); return; }
    if (activeVersion.file_url || !activeVersion.concept_document_id) { setConceptDocHtml(''); return; }
    (async () => {
      const { data } = await supabase.from('concept_documents')
        .select('content')
        .eq('id', activeVersion.concept_document_id)
        .single();
      setConceptDocHtml(data?.content?.html || '');
    })();
  }, [activeVersion?.id]);

  // Annotation state
  const [annotations, setAnnotations] = useState([]);
  const [activeTool, setActiveTool] = useState(null);
  const [highlightColor, setHighlightColor] = useState('yellow');
  const [activeAnnotationId, setActiveAnnotationId] = useState(null);
  const [pendingSelection, setPendingSelection] = useState(null);

  // Send for Updates state
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendMessage, setSendMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [showAllAnns, setShowAllAnns] = useState(false);
  const [toast, setToast] = useState(null); // { type: 'success'|'error', message }
  const [lastSentAt, setLastSentAt] = useState(review.last_sent_at || null);

  // Mark as Ready state
  const [showReadyModal, setShowReadyModal] = useState(false);
  const [markingReady, setMarkingReady] = useState(false);
  const [readyInfo, setReadyInfo] = useState(review.marked_ready_at ? {
    at: review.marked_ready_at,
    byName: null, // loaded below
  } : null);

  // Load the reviewer name for ready banner if already ready
  useEffect(() => {
    if (review.marked_ready_by && review.status === 'ready') {
      (async () => {
        const { data } = await supabase.from('profiles').select('full_name').eq('id', review.marked_ready_by).single();
        if (data) setReadyInfo(prev => prev ? { ...prev, byName: data.full_name } : null);
      })();
    }
  }, [review.marked_ready_by]);

  useEffect(() => { fetchVersions(); }, [review.id]);

  // Realtime subscription for new writer versions
  useEffect(() => {
    const channel = supabase.channel(`review-versions-${review.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'script_review_versions',
        filter: `review_id=eq.${review.id}`,
      }, (payload) => {
        if (payload.new.source === 'writer') {
          setNewVersionAlert(true);
          fetchVersions();
          setStatus('in_review');
        }
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [review.id, refreshKey]);

  async function fetchVersions() {
    const { data } = await supabase.from('script_review_versions')
      .select('*, uploader:profiles!script_review_versions_uploaded_by_fkey(full_name)')
      .eq('review_id', review.id)
      .order('version_number', { ascending: false });
    const vers = data || [];
    setVersions(vers);
    // Default to latest (first item since sorted desc)
    if (vers.length > 0 && !activeVersion) setActiveVersion(vers[0]);
  }

  async function handleMarkAsReady() {
    if (markingReady) return;
    setMarkingReady(true);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase.from('script_reviews')
        .update({
          status: 'ready',
          marked_ready_at: now,
          marked_ready_by: profile.id,
          updated_at: now,
        })
        .eq('id', review.id);
      if (error) throw error;

      setStatus('ready');
      setReadyInfo({ at: now, byName: profile.full_name });
      setShowReadyModal(false);
      setActiveTool(null);
      setToast({ type: 'success', message: `"${review.title}" has been marked as Ready.` });
      setTimeout(() => setToast(null), 4000);

      // Send notification to concept document owner if linked
      if (review.concept_id) {
        // Find the concept doc owner
        const { data: conceptDocs } = await supabase.from('concept_documents')
          .select('created_by')
          .eq('concept_id', review.concept_id)
          .limit(1);
        const writerId = conceptDocs?.[0]?.created_by;
        if (writerId && writerId !== profile.id) {
          await supabase.from('notifications').insert({
            user_id: writerId,
            type: 'script_ready',
            title: `✅ ${review.title} has been marked Ready`,
            body: `Marked Ready by ${profile.full_name} at v${versions.length || 1}`,
            link_tab: 'reviews',
            link_target: review.id,
          });
        }
      }
    } catch (err) {
      console.error('Mark as Ready error:', err);
      setToast({ type: 'error', message: 'Failed to mark as ready: ' + (err.message || 'Unknown error') });
      setTimeout(() => setToast(null), 5000);
    } finally {
      setMarkingReady(false);
    }
  }

  async function handleReopenReview() {
    if (!(await confirm('Reopen this review? It will return to "In Review" status and re-enable annotation tools.'))) return;
    try {
      const now = new Date().toISOString();
      const { error } = await supabase.from('script_reviews')
        .update({
          status: 'in_review',
          marked_ready_at: null,
          marked_ready_by: null,
          updated_at: now,
        })
        .eq('id', review.id);
      if (error) throw error;
      setStatus('in_review');
      setReadyInfo(null);
      setToast({ type: 'success', message: 'Review reopened — annotation tools are active again.' });
      setTimeout(() => setToast(null), 4000);
    } catch (err) {
      console.error('Reopen review error:', err);
      setToast({ type: 'error', message: 'Failed to reopen: ' + (err.message || 'Unknown error') });
      setTimeout(() => setToast(null), 5000);
    }
  }

  async function handleUploadNewVersion(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowedExt = ['pdf', 'docx', 'md'];
    const ext = file.name.split('.').pop().toLowerCase();
    if (!allowedExt.includes(ext)) { alert('Only .pdf, .docx, and .md files are allowed.'); return; }
    setUploading(true);
    try {
      const path = `${profile.id}/${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage.from('script-reviews').upload(path, file);
      if (uploadErr) throw uploadErr;
      const nextNum = versions.length + 1;
      const { data: newVer } = await supabase.from('script_review_versions').insert({
        review_id: review.id,
        version_number: nextNum,
        file_url: path,
        file_type: ext,
        uploaded_by: profile.id,
        source: 'reviewer',
      }).select('*, uploader:profiles!script_review_versions_uploaded_by_fkey(full_name)').single();
      await supabase.from('script_reviews')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', review.id);
      // Refresh and select new version
      const { data: allVers } = await supabase.from('script_review_versions')
        .select('*, uploader:profiles!script_review_versions_uploaded_by_fkey(full_name)')
        .eq('review_id', review.id)
        .order('version_number', { ascending: false });
      const refreshed = allVers || [];
      setVersions(refreshed);
      if (refreshed.length > 0) setActiveVersion(refreshed[0]);
    } catch (err) {
      console.error('Error uploading version:', err);
    } finally {
      setUploading(false);
    }
  }

  function getDownloadUrl(filePath) {
    if (!filePath) return null;
    const { data } = supabase.storage.from('script-reviews').getPublicUrl(filePath);
    return data?.publicUrl;
  }

  function handleShare() {
    const url = `${window.location.origin}/reviews/scripts/${review.id}`;
    navigator.clipboard.writeText(url).then(() => {
      setShareUrl(url);
      setTimeout(() => setShareUrl(null), 2000);
    }).catch(() => {
      setShareUrl(url);
    });
  }

  // ─── Annotation CRUD ────────────────────────────────────────────────────

  useEffect(() => {
    if (activeVersion?.id) fetchAnnotations();
  }, [activeVersion?.id]);

  async function fetchAnnotations() {
    const { data } = await supabase.from('script_annotations')
      .select('*, annotator:profiles!script_annotations_annotator_id_fkey(full_name), resolved_by_profile:profiles!script_annotations_resolved_by_fkey(full_name)')
      .eq('version_id', activeVersion.id)
      .order('range_start', { ascending: true });
    // Fetch replies for each
    const withReplies = await Promise.all((data || []).map(async (ann) => {
      const { data: replies } = await supabase.from('script_annotation_replies')
        .select('*, author:profiles!script_annotation_replies_author_id_fkey(full_name)')
        .eq('annotation_id', ann.id)
        .order('created_at', { ascending: true });
      return { ...ann, replies: replies || [] };
    }));
    setAnnotations(withReplies);
  }

  function handleTextSelect(selectionData) {
    if (!activeTool || !isLatest) return;
    setPendingSelection(selectionData);
    // Auto-create annotation with empty comment (user can fill in sidebar)
    createAnnotation(selectionData);
  }

  async function createAnnotation(sel) {
    if (!sel || !activeVersion || !profile?.id) return;
    const { error } = await supabase.from('script_annotations').insert({
      review_id: review.id,
      version_id: activeVersion.id,
      type: activeTool,
      annotator_id: profile.id,
      selected_text: sel.selectedText,
      range_start: sel.rangeStart,
      range_end: sel.rangeEnd,
      page_number: sel.pageNumber,
      bounding_rect_json: sel.boundingRect ? {
        topPct: sel.boundingRect.top,
        leftPct: sel.boundingRect.left,
        widthPct: sel.boundingRect.width,
        heightPct: sel.boundingRect.height,
      } : null,
      highlight_color: activeTool === 'highlight' ? highlightColor : null,
      comment_text: '',
    });
    if (!error) {
      window.getSelection()?.removeAllRanges();
      setPendingSelection(null);
      fetchAnnotations();
    }
  }

  async function handleResolveAnnotation(annotationId) {
    const ann = annotations.find(a => a.id === annotationId);
    if (!ann) return;
    if (ann.is_resolved) {
      await supabase.from('script_annotations').update({
        is_resolved: false, resolved_by: null, resolved_at: null,
      }).eq('id', annotationId);
    } else {
      await supabase.from('script_annotations').update({
        is_resolved: true, resolved_by: profile.id, resolved_at: new Date().toISOString(),
      }).eq('id', annotationId);
    }
    fetchAnnotations();
  }

  async function handleDeleteAnnotation(annotationId) {
    await supabase.from('script_annotations').delete().eq('id', annotationId);
    if (activeAnnotationId === annotationId) setActiveAnnotationId(null);
    fetchAnnotations();
  }

  async function handleAnnotationReply(annotationId, text) {
    await supabase.from('script_annotation_replies').insert({
      annotation_id: annotationId,
      author_id: profile.id,
      text,
    });
    fetchAnnotations();
  }

  async function handleDeleteReply(replyId) {
    await supabase.from('script_annotation_replies').delete().eq('id', replyId);
    fetchAnnotations();
  }

  async function handleEditComment(annotationId, newText) {
    await supabase.from('script_annotations').update({ comment_text: newText }).eq('id', annotationId);
    fetchAnnotations();
  }

  // ─── Send for Updates Helpers ──────────────────────────────────────────

  function generateAnnotationSummary() {
    const unresolved = annotations.filter(a => !a.is_resolved);
    const redlines = unresolved.filter(a => a.type === 'redline').length;
    const highlights = unresolved.filter(a => a.type === 'highlight').length;
    const notes = unresolved.filter(a => a.type === 'note').length;
    return { total: unresolved.length, redlines, highlights, notes, items: unresolved };
  }

  function generateAnnotatedHtml() {
    const ext = activeVersion?.file_type;
    if (ext === 'pdf') return null;
    const docEl = document.querySelector('.script-doc-content');
    if (!docEl) return null;
    const clone = docEl.cloneNode(true);
    const css = `
      body { font-family: Georgia, serif; max-width: 800px; margin: 40px auto; padding: 20px; color: #1a1a2e; line-height: 1.7; }
      .annotation-highlight { padding: 2px 0; border-radius: 2px; }
      .annotation-redline { text-decoration: line-through; text-decoration-color: #ff4444; background: rgba(255,68,68,0.08); }
      .annotation-note-marker { display: inline-block; width: 16px; height: 16px; background: #6366f1; color: #fff; border-radius: 50%; font-size: 9px; font-weight: 700; text-align: center; line-height: 16px; vertical-align: super; margin-left: 2px; }
    `;
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${review.title} — Annotated</title><style>${css}</style></head>
<body>
<h1 style="font-size:22px;border-bottom:2px solid #e8ff47;padding-bottom:8px;">${review.title}</h1>
<p style="color:#666;font-size:13px;">Review sent ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} · Version ${activeVersion?.version_number || '?'}</p>
<hr style="border:none;border-top:1px solid #ddd;margin:20px 0;">
${clone.innerHTML}
</body></html>`;
  }

  async function handleSendForUpdates() {
    setSending(true);
    try {
      const unresolved = annotations.filter(a => !a.is_resolved);
      const ts = Date.now();

      // 1. Generate + upload annotation JSON sidecar
      const jsonPayload = unresolved.map(a => ({
        id: a.id,
        type: a.type,
        selected_text: a.selected_text,
        comment_text: a.comment_text,
        range_start: a.range_start,
        range_end: a.range_end,
        page_number: a.page_number,
        highlight_color: a.highlight_color,
        annotator: a.annotator?.full_name,
        created_at: a.created_at,
        replies: (a.replies || []).map(r => ({
          text: r.text,
          author: r.author?.full_name,
          created_at: r.created_at,
        })),
      }));
      const jsonBlob = new Blob([JSON.stringify(jsonPayload, null, 2)], { type: 'application/json' });
      const jsonPath = `exports/${profile.id}/${ts}_annotations.json`;
      const { error: jsonErr } = await supabase.storage.from('script-reviews').upload(jsonPath, jsonBlob);
      if (jsonErr) throw jsonErr;

      // 2. For DOCX/MD: generate + upload annotated HTML
      let htmlPath = null;
      const annotatedHtml = generateAnnotatedHtml();
      if (annotatedHtml) {
        htmlPath = `exports/${profile.id}/${ts}_annotated.html`;
        const htmlBlob = new Blob([annotatedHtml], { type: 'text/html' });
        const { error: htmlErr } = await supabase.storage.from('script-reviews').upload(htmlPath, htmlBlob);
        if (htmlErr) throw htmlErr;
      }

      // 3. If concept-linked + has concept_document_id → insert version row
      if (review.concept_id && review.concept_document_id) {
        // Get current max version
        const { data: existingVers } = await supabase.from('concept_document_versions')
          .select('version_number')
          .eq('document_id', review.concept_document_id)
          .order('version_number', { ascending: false })
          .limit(1);
        const nextVer = (existingVers?.[0]?.version_number || 0) + 1;

        const { data: jsonUrl } = supabase.storage.from('script-reviews').getPublicUrl(jsonPath);
        const { data: htmlUrl } = htmlPath ? supabase.storage.from('script-reviews').getPublicUrl(htmlPath) : { data: null };

        await supabase.from('concept_document_versions').insert({
          concept_id: review.concept_id,
          document_id: review.concept_document_id,
          version_number: nextVer,
          file_url: htmlUrl?.publicUrl || null,
          annotation_json_url: jsonUrl?.publicUrl || null,
          source: 'script_review',
          review_id: review.id,
          message: sendMessage.trim() || null,
          created_by: profile.id,
        });
      }

      // 4. Update script_reviews
      const now = new Date().toISOString();
      const { error: updateErr } = await supabase.from('script_reviews')
        .update({
          status: 'awaiting_writer',
          last_sent_at: now,
          reviewer_message: sendMessage.trim() || null,
          updated_at: now,
        })
        .eq('id', review.id);
      if (updateErr) throw updateErr;

      // 5. Update local state
      setStatus('awaiting_writer');
      setLastSentAt(now);
      setShowSendModal(false);
      setSendMessage('');
      setToast({ type: 'success', message: 'Sent for updates — writer will see your annotations.' });
      setTimeout(() => setToast(null), 4000);
    } catch (err) {
      console.error('Send for updates error:', err);
      setToast({ type: 'error', message: 'Failed to send: ' + (err.message || 'Unknown error') });
      setTimeout(() => setToast(null), 5000);
    } finally {
      setSending(false);
    }
  }

  const statusLabels = { in_review: 'In Review', awaiting_writer: 'Awaiting Writer', ready: 'Ready' };
  const canEdit = review.created_by === profile?.id || isAdmin;
  const isLatest = activeVersion && versions.length > 0 && activeVersion.id === versions[0].id;

  return (
    <div style={sri.container}>
      {/* ─── Toast ──────────────────────────────────────────────────────── */}
      {toast && (
        <div style={toast.type === 'success' ? sfuStyles.toastSuccess : sfuStyles.toastError}>
          <span>{toast.type === 'success' ? '✓' : '✕'}</span>
          <span>{toast.message}</span>
        </div>
      )}

      {/* ─── Top Action Bar ─────────────────────────────────────────────── */}
      <div style={sri.topBar}>
        <div style={sri.breadcrumb}>
          <button onClick={onBack} style={sri.breadcrumbLink}>Reviews</button>
          <span style={sri.breadcrumbSep}>›</span>
          <span style={sri.breadcrumbLink} onClick={onBack}>Scripts</span>
          <span style={sri.breadcrumbSep}>›</span>
          <span style={sri.breadcrumbCurrent}>{review.title}</span>
        </div>
        <div style={sri.topBarActions}>
          {canEdit && status !== 'ready' && (
            status === 'awaiting_writer' ? (
              <button style={{ ...sri.sendBtn, ...sri.sendBtnDisabled }} disabled>
                Awaiting Writer...
              </button>
            ) : (
              <button
                onClick={() => setShowSendModal(true)}
                style={sri.sendBtn}
              >
                Send for Updates
              </button>
            )
          )}
          {canEdit && status !== 'ready' && (
            <button
              onClick={() => setShowReadyModal(true)}
              style={sri.readyBtn}
            >
              Mark as Ready
            </button>
          )}
          {status === 'ready' && (
            <span style={sri.readyBadge}>✓ Ready</span>
          )}
          <button onClick={handleShare} style={sri.shareBtn}>
            {shareUrl ? '✓ Copied!' : 'Share'}
          </button>
          {canEdit && status === 'ready' && (
            <button
              onClick={handleReopenReview}
              style={sri.reopenLink}
            >
              Reopen Review
            </button>
          )}
        </div>
      </div>

      {/* ─── Ready Banner ─────────────────────────────────────────────── */}
      {status === 'ready' && readyInfo && (
        <div style={sri.readyBanner}>
          <span style={sri.readyBannerIcon}>✓</span>
          <span style={sri.readyBannerText}>
            This script was marked Ready on {new Date(readyInfo.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            {versions.length > 0 && ` at v${versions[0].version_number}`}
            {readyInfo.byName && ` by ${readyInfo.byName}`}
          </span>
        </div>
      )}

      {/* ─── Status Bar ────────────────────────────────────────────────── */}
      <div style={sri.statusBar}>
        <div style={sri.statusItem}>
          <span style={sri.statusLabel}>Status</span>
          <span style={{
            ...sri.statusPill,
            ...(status === 'ready' ? sri.statusPillReady : {}),
            ...(status === 'awaiting_writer' ? sri.statusPillAwaiting : {}),
          }}>
            {statusLabels[status]}
          </span>
        </div>
        <div style={sri.statusDivider} />
        <div style={sri.statusItem}>
          <span style={sri.statusLabel}>Version</span>
          <span style={sri.statusValue}>{versions.length}</span>
        </div>
        <div style={sri.statusDivider} />
        <div style={sri.statusItem}>
          <span style={sri.statusLabel}>Last updated</span>
          <span style={sri.statusValue}>{timeAgo(review.updated_at)}</span>
        </div>
        {review.concept?.name && (
          <>
            <div style={sri.statusDivider} />
            <div style={sri.statusItem}>
              <span style={sri.statusLabel}>Concept</span>
              <span style={sri.statusValue}>{review.concept.name}</span>
            </div>
          </>
        )}
        {lastSentAt && (
          <>
            <div style={sri.statusDivider} />
            <div style={sri.statusItem}>
              <span style={sri.statusLabel}>Last sent</span>
              <span style={sri.statusValue}>{timeAgo(lastSentAt)}</span>
            </div>
          </>
        )}
      </div>

      {/* ─── 3-Panel Layout ────────────────────────────────────────────── */}
      <div style={sri.panels}>

        {/* LEFT SIDEBAR — Version History */}
        <div style={sri.leftSidebar}>
          <div style={sri.sidebarHeader}>
            <h3 style={sri.sidebarTitle}>{review.title}</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {activeVersion && (
                <span style={sri.sidebarVersionBadge}>v{activeVersion.version_number}</span>
              )}
              {newVersionAlert && (
                <span style={{ padding: '2px 8px', background: 'rgba(197,214,0,0.15)', border: '1px solid rgba(197,214,0,0.3)', borderRadius: '8px', color: '#e8ff47', fontSize: '10px', fontWeight: 700, animation: 'pulse 2s infinite' }}>New Version</span>
              )}
            </div>
          </div>

          <div style={sri.versionTimeline}>
            {versions.map((v, i) => {
              const isCurrent = v.id === versions[0].id;
              const isActive = activeVersion?.id === v.id;
              return (
                <button
                  key={v.id}
                  onClick={() => { setActiveVersion(v); if (isCurrent) setNewVersionAlert(false); }}
                  style={{
                    ...sri.versionEntry,
                    ...(isActive ? sri.versionEntryActive : {}),
                  }}
                >
                  {/* Timeline connector */}
                  <div style={sri.timelineTrack}>
                    <div style={{
                      ...sri.timelineDot,
                      ...(isActive ? sri.timelineDotActive : {}),
                      ...(isCurrent ? sri.timelineDotCurrent : {}),
                    }} />
                    {i < versions.length - 1 && <div style={sri.timelineLine} />}
                  </div>

                  <div style={sri.versionContent}>
                    <div style={sri.versionTopRow}>
                      <span style={{
                        ...sri.versionBadge,
                        ...(isActive ? sri.versionBadgeActive : {}),
                      }}>v{v.version_number}</span>
                      <span style={sri.versionTime}>{timeAgo(v.uploaded_at)}</span>
                    </div>
                    <div style={sri.versionUploader}>
                      <span style={sri.uploaderAvatar}>
                        {(v.uploader?.full_name || '?')[0].toUpperCase()}
                      </span>
                      <span style={sri.uploaderName}>{v.uploader?.full_name || 'Unknown'}</span>
                    </div>
                    <div style={sri.versionTags}>
                      <span style={v.source === 'writer' ? sri.sourceTagWriter : sri.sourceTagReviewer}>
                        {v.source === 'writer' ? 'Writer' : 'Reviewer'}
                      </span>
                      <span style={isCurrent ? sri.statusTagCurrent : sri.statusTagSuperseded}>
                        {isCurrent ? 'Current' : 'Superseded'}
                      </span>
                    </div>
                    {v.file_url && (
                      <a
                        href={getDownloadUrl(v.file_url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={sri.versionDownload}
                        onClick={(e) => e.stopPropagation()}
                      >
                        ↓ .{v.file_type}
                      </a>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Upload button for reviewer */}
          {canEdit && (
            <div style={sri.sidebarFooter}>
              <button
                onClick={() => uploadRef.current?.click()}
                style={sri.uploadBtn}
                disabled={uploading}
              >
                {uploading ? 'Uploading...' : '+ Upload New Version'}
              </button>
              <input
                ref={uploadRef}
                type="file"
                accept=".pdf,.docx,.md"
                onChange={handleUploadNewVersion}
                style={{ display: 'none' }}
              />
            </div>
          )}
        </div>

        {/* CENTER — Document Viewer + Annotation Toolbar */}
        <div style={sri.centerPanel}>
          <AnnotationToolbar
            activeTool={activeTool}
            onToolChange={setActiveTool}
            highlightColor={highlightColor}
            onColorChange={setHighlightColor}
            disabled={!isLatest || status === 'ready'}
          />
          <DocumentViewer
            version={activeVersion}
            fileUrl={activeVersion?.file_url ? getDownloadUrl(activeVersion.file_url) : null}
            conceptDocHtml={conceptDocHtml}
            isLatest={isLatest}
            onSwitchToCurrent={() => { if (versions.length > 0) setActiveVersion(versions[0]); }}
            onTextSelect={status === 'ready' ? null : handleTextSelect}
            annotations={annotations}
            activeAnnotationId={activeAnnotationId}
            onAnnotationClick={setActiveAnnotationId}
          />
        </div>

        {/* RIGHT SIDEBAR — Annotations Panel */}
        <div style={sri.rightSidebar}>
          <AnnotationsSidebar
            annotations={annotations}
            activeAnnotationId={activeAnnotationId}
            onAnnotationClick={setActiveAnnotationId}
            onResolve={handleResolveAnnotation}
            onDelete={handleDeleteAnnotation}
            onReply={handleAnnotationReply}
            onDeleteReply={handleDeleteReply}
            onEditComment={handleEditComment}
            profile={profile}
            isAdmin={isAdmin}
            disabled={!isLatest || status === 'ready'}
          />
        </div>

      </div>

      {/* ─── Send for Updates Modal ─────────────────────────────────────── */}
      {showSendModal && (() => {
        const summary = generateAnnotationSummary();
        const visibleAnns = showAllAnns ? summary.items : summary.items.slice(0, 5);
        const typeColor = { redline: '#ff4444', highlight: '#facc15', note: '#6366f1' };
        const typeLabel = { redline: 'Redline', highlight: 'Highlight', note: 'Note' };
        return (
          <div style={sfuStyles.overlay} onClick={() => !sending && setShowSendModal(false)}>
            <div style={sfuStyles.modal} onClick={e => e.stopPropagation()}>
              <div style={sfuStyles.header}>
                <h2 style={sfuStyles.headerTitle}>Send for Updates</h2>
                <button onClick={() => !sending && setShowSendModal(false)} style={sfuStyles.closeBtn}>✕</button>
              </div>

              <div style={sfuStyles.body}>
                {/* Section 1: Annotation Summary */}
                <div style={sfuStyles.section}>
                  <h3 style={sfuStyles.sectionTitle}>Annotation Summary</h3>
                  <div style={sfuStyles.statRow}>
                    <span style={sfuStyles.statBadgeTotal}>{summary.total} unresolved</span>
                    {summary.redlines > 0 && <span style={{ ...sfuStyles.statBadge, background: 'rgba(255,68,68,0.1)', color: '#ff6666', borderColor: 'rgba(255,68,68,0.2)' }}>{summary.redlines} redline{summary.redlines !== 1 ? 's' : ''}</span>}
                    {summary.highlights > 0 && <span style={{ ...sfuStyles.statBadge, background: 'rgba(250,204,21,0.1)', color: '#facc15', borderColor: 'rgba(250,204,21,0.2)' }}>{summary.highlights} highlight{summary.highlights !== 1 ? 's' : ''}</span>}
                    {summary.notes > 0 && <span style={{ ...sfuStyles.statBadge, background: 'rgba(99,102,241,0.1)', color: '#a5b4fc', borderColor: 'rgba(99,102,241,0.2)' }}>{summary.notes} note{summary.notes !== 1 ? 's' : ''}</span>}
                  </div>
                  {summary.total > 0 ? (
                    <div style={sfuStyles.annList}>
                      {visibleAnns.map(a => (
                        <div key={a.id} style={sfuStyles.annItem}>
                          <span style={{ ...sfuStyles.annDot, background: typeColor[a.type] || '#888' }} />
                          <div style={sfuStyles.annContent}>
                            <span style={sfuStyles.annType}>{typeLabel[a.type] || a.type}</span>
                            {a.selected_text && (
                              <span style={sfuStyles.annQuote}>"{a.selected_text.length > 80 ? a.selected_text.slice(0, 80) + '…' : a.selected_text}"</span>
                            )}
                            {a.comment_text && <span style={sfuStyles.annComment}>{a.comment_text}</span>}
                          </div>
                        </div>
                      ))}
                      {summary.total > 5 && (
                        <button onClick={() => setShowAllAnns(!showAllAnns)} style={sfuStyles.showAllBtn}>
                          {showAllAnns ? 'Show less' : `Show all ${summary.total} annotations`}
                        </button>
                      )}
                    </div>
                  ) : (
                    <p style={sfuStyles.noAnns}>No unresolved annotations — the writer will receive a status update only.</p>
                  )}
                </div>

                {/* Section 2: Message to Writer */}
                <div style={sfuStyles.section}>
                  <h3 style={sfuStyles.sectionTitle}>Message to Writer <span style={sfuStyles.optional}>(optional)</span></h3>
                  <textarea
                    value={sendMessage}
                    onChange={e => setSendMessage(e.target.value)}
                    placeholder="Add context, priorities, or instructions for the writer..."
                    style={sfuStyles.textarea}
                    rows={3}
                  />
                </div>

                {/* Section 3: Destination */}
                <div style={sfuStyles.section}>
                  <h3 style={sfuStyles.sectionTitle}>Destination</h3>
                  {review.concept_id && review.concept_document_id ? (
                    <div style={sfuStyles.destLinked}>
                      <span style={sfuStyles.destIcon}>✓</span>
                      <div>
                        <div style={sfuStyles.destTitle}>Linked to Concept</div>
                        <div style={sfuStyles.destSub}>Annotations will be saved to the concept document version history{review.concept?.name ? ` for "${review.concept.name}"` : ''}.</div>
                      </div>
                    </div>
                  ) : (
                    <div style={sfuStyles.destWarning}>
                      <span style={sfuStyles.destIcon}>!</span>
                      <div>
                        <div style={sfuStyles.destTitle}>Not linked to a concept document</div>
                        <div style={sfuStyles.destSub}>Annotations will be exported to storage but won't appear in any concept's version history.</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div style={sfuStyles.footer}>
                <button onClick={() => { setShowSendModal(false); setSendMessage(''); }} style={sfuStyles.cancelBtn} disabled={sending}>Cancel</button>
                <button onClick={handleSendForUpdates} style={sending ? sfuStyles.sendBtnDisabled : sfuStyles.sendBtnActive} disabled={sending}>
                  {sending ? 'Sending...' : 'Send for Updates →'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ─── Mark as Ready Confirmation Modal ─────────────────────────────── */}
      {showReadyModal && (() => {
        const totalAnnotations = annotations.length;
        return (
          <div style={sfuStyles.overlay} onClick={() => !markingReady && setShowReadyModal(false)}>
            <div style={{ ...sfuStyles.modal, maxWidth: '480px' }} onClick={e => e.stopPropagation()}>
              <div style={sfuStyles.header}>
                <h2 style={sfuStyles.headerTitle}>Mark Script as Ready?</h2>
                <button onClick={() => !markingReady && setShowReadyModal(false)} style={sfuStyles.closeBtn}>✕</button>
              </div>

              <div style={sfuStyles.body}>
                <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', lineHeight: 1.6, margin: '0 0 16px' }}>
                  This will close the review loop and move <strong style={{ color: '#e2e8f0' }}>{review.title}</strong> to the Ready section. No further annotations or revisions can be sent from this review instance.
                </p>

                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '4px' }}>
                  <span style={{ padding: '5px 12px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '8px', color: '#22c55e', fontSize: '12px', fontWeight: 600 }}>
                    Current Version: v{versions.length > 0 ? versions[0].version_number : 0}
                  </span>
                  <span style={{ padding: '5px 12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: 'rgba(255,255,255,0.5)', fontSize: '12px', fontWeight: 600 }}>
                    {versions.length} version{versions.length !== 1 ? 's' : ''} reviewed
                  </span>
                  <span style={{ padding: '5px 12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: 'rgba(255,255,255,0.5)', fontSize: '12px', fontWeight: 600 }}>
                    {totalAnnotations} annotation{totalAnnotations !== 1 ? 's' : ''} made
                  </span>
                </div>
              </div>

              <div style={sfuStyles.footer}>
                <button onClick={() => setShowReadyModal(false)} style={sfuStyles.cancelBtn} disabled={markingReady}>Cancel</button>
                <button
                  onClick={handleMarkAsReady}
                  style={markingReady ? { ...sri.readyConfirmBtn, opacity: 0.5, cursor: 'not-allowed' } : sri.readyConfirmBtn}
                  disabled={markingReady}
                >
                  {markingReady ? 'Marking...' : 'Mark as Ready ✓'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = {
  page: { padding: '32px 40px' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexShrink: 0 },
  pageTitle: { fontSize: '28px', fontWeight: 700, color: '#ffffff', margin: '0 0 4px 0', letterSpacing: '-0.5px' },
  pageSubtitle: { fontSize: '14px', color: 'rgba(255,255,255,0.4)', margin: 0 },
  backBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.45)', fontSize: '13px', cursor: 'pointer', padding: '0 0 8px 0', fontFamily: 'inherit', fontWeight: 500 },
  addBtn: { padding: '10px 20px', background: 'linear-gradient(135deg, #6366f1, #818cf8)', border: 'none', borderRadius: '10px', color: '#fff', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  createForm: { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '20px', marginBottom: '24px', display: 'flex', flexDirection: 'column', gap: '12px' },
  input: { padding: '10px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '14px', fontFamily: 'inherit', outline: 'none' },
  previewThumb: { display: 'flex', alignItems: 'center', gap: '12px', padding: '10px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' },
  previewImg: { width: '120px', borderRadius: '6px' },
  previewLabel: { fontSize: '13px', color: '#22c55e', fontWeight: 500 },
  submitBtn: { padding: '10px 20px', background: '#6366f1', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', alignSelf: 'flex-start' },
  reviewGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' },
  reviewCard: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', overflow: 'hidden', cursor: 'pointer', transition: 'border-color 0.15s', position: 'relative' },
  thumbWrap: { position: 'relative', width: '100%', aspectRatio: '16/9', overflow: 'hidden', background: '#000' },
  thumb: { width: '100%', height: '100%', objectFit: 'cover' },
  playOverlay: { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '18px', pointerEvents: 'none' },
  thumbPlaceholder: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.35)', fontSize: '13px', fontWeight: 500 },
  noVideoBadge: { position: 'absolute', top: '8px', left: '8px', padding: '3px 8px', borderRadius: '6px', background: 'rgba(0,0,0,0.7)', color: 'rgba(255,255,255,0.85)', fontSize: '11px', fontWeight: 600 },
  reviewCardBody: { padding: '12px 14px' },
  reviewCardTitle: { fontSize: '15px', fontWeight: 700, color: '#e2e8f0', margin: '0 0 4px' },
  reviewCardMeta: { fontSize: '11px', color: 'rgba(255,255,255,0.3)' },
  reviewDeleteBtn: { position: 'absolute', top: '8px', right: '8px', background: 'rgba(0,0,0,0.5)', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: '14px', padding: '4px 8px', borderRadius: '6px', zIndex: 2 },
  emptyCard: { background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '14px', padding: '40px', textAlign: 'center' },
  emptyText: { color: 'rgba(255,255,255,0.35)', fontSize: '14px', margin: 0 },

  // Version bar
  versionBar: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', flexShrink: 0 },
  versionTabs: { display: 'flex', gap: '4px', flex: 1, overflow: 'auto' },
  versionTab: { padding: '6px 14px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', color: 'rgba(255,255,255,0.4)', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '6px' },
  versionTabActive: { background: 'rgba(99,102,241,0.12)', borderColor: 'rgba(99,102,241,0.3)', color: '#a5b4fc' },
  versionNum: { fontSize: '10px', fontWeight: 700, opacity: 0.5 },
  addVersionBtn: { padding: '6px 14px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: 'rgba(255,255,255,0.4)', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' },
  addVersionForm: { display: 'flex', gap: '8px', marginBottom: '12px', flexShrink: 0 },
  addVersionInput: { flex: 1, padding: '8px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff', fontSize: '12px', fontFamily: 'inherit', outline: 'none' },
  addVersionSubmit: { padding: '8px 16px', background: '#6366f1', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },

  // Player layout
  playerLayout: { display: 'flex', gap: '24px', position: 'relative' },
  videoCol: { flex: 1, minWidth: 0 },
  videoWrap: { position: 'relative', width: '100%', aspectRatio: '16/9', background: '#000', borderRadius: '12px', overflow: 'hidden' },
  videoEmbed: { width: '100%', height: '100%' },
  noVideoPrompt: { width: '100%', aspectRatio: '16/9', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: '8px', padding: '24px', background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.12)', borderRadius: '12px' },
  noVideoIcon: { fontSize: '32px', opacity: 0.7 },
  noVideoTitle: { margin: 0, fontSize: '16px', fontWeight: 600, color: 'rgba(255,255,255,0.9)' },
  noVideoSub: { margin: 0, fontSize: '13px', color: 'rgba(255,255,255,0.45)', maxWidth: '380px', lineHeight: 1.5 },
  noVideoForm: { display: 'flex', gap: '8px', marginTop: '8px', width: '100%', maxWidth: '420px' },
  noVideoInput: { flex: 1, padding: '8px 12px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff', fontSize: '13px', fontFamily: 'inherit' },
  timeline: { position: 'relative', height: '12px', background: 'rgba(255,255,255,0.06)', borderRadius: '6px', marginTop: '8px', cursor: 'pointer', overflow: 'visible' },
  timelineProgress: { position: 'absolute', top: 0, left: 0, height: '100%', background: 'rgba(99,102,241,0.3)', borderRadius: '6px', transition: 'width 0.25s linear', pointerEvents: 'none' },
  timelineMarker: { position: 'absolute', top: '50%', transform: 'translate(-50%, -50%)', width: '10px', height: '10px', borderRadius: '50%', background: '#fbbf24', border: '2px solid #0f0f1a', cursor: 'pointer', zIndex: 2, padding: 0 },
  timeDisplay: { fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginTop: '4px', fontVariantNumeric: 'tabular-nums' },
  commentForm: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px' },
  commentTimeTag: { padding: '5px 10px', background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: '6px', color: '#fbbf24', fontSize: '12px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  commentInput: { flex: 1, padding: '10px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '13px', fontFamily: 'inherit', outline: 'none' },
  commentSubmitBtn: { padding: '10px 18px', background: '#6366f1', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  formatBtn: { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: 'rgba(255,255,255,0.5)', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit', padding: '2px 7px', lineHeight: 1 },

  // Comments panel
  commentsCol: { width: '340px', minWidth: '340px', display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', overflow: 'hidden', flexShrink: 0 },
  commentsPanelHeader: { padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 },
  commentsPanelTitle: { fontSize: '14px', fontWeight: 700, color: '#e2e8f0', margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: '8px' },
  commentCount: { background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '10px' },
  filterTabs: { display: 'flex', gap: '4px' },
  filterTab: { padding: '4px 10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px', color: 'rgba(255,255,255,0.35)', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  filterTabActive: { background: 'rgba(99,102,241,0.1)', borderColor: 'rgba(99,102,241,0.25)', color: '#a5b4fc' },
  commentsList: { flex: 1, overflow: 'auto', padding: '12px', minHeight: 0 },
  emptyComments: { color: 'rgba(255,255,255,0.25)', fontSize: '13px', textAlign: 'center', padding: '20px 0' },

  // Comment card
  commentCard: { padding: '10px 12px', background: 'rgba(255,255,255,0.02)', borderLeft: '3px solid rgba(251,191,36,0.3)', borderRadius: '0 8px 8px 0', marginBottom: '10px', transition: 'opacity 0.15s' },
  commentCardHeader: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' },
  commentTimestamp: { padding: '2px 8px', background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: '4px', color: '#fbbf24', fontSize: '11px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums' },
  commentAuthor: { fontSize: '12px', fontWeight: 600, color: '#a5b4fc' },
  commentDate: { fontSize: '10px', color: 'rgba(255,255,255,0.2)', marginLeft: 'auto' },
  commentBody: { fontSize: '13px', color: 'rgba(255,255,255,0.7)', margin: '0 0 8px', lineHeight: 1.5 },
  commentActions: { display: 'flex', alignItems: 'center', gap: '6px' },
  resolveBtn: { background: 'none', border: 'none', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: '3px 0' },
  replyBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit', padding: '3px 0' },
  commentDeleteBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.15)', cursor: 'pointer', fontSize: '12px', padding: '2px 4px', marginLeft: 'auto' },

  // Replies
  repliesWrap: { marginTop: '8px', paddingLeft: '12px', borderLeft: '1px solid rgba(255,255,255,0.06)' },
  replyCard: { padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' },
  replyHeader: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' },
  replyAuthor: { fontSize: '11px', fontWeight: 600, color: '#818cf8' },
  replyDate: { fontSize: '9px', color: 'rgba(255,255,255,0.2)' },
  replyDeleteBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.15)', cursor: 'pointer', fontSize: '10px', padding: '0 2px', marginLeft: 'auto' },
  replyBody: { fontSize: '12px', color: 'rgba(255,255,255,0.55)', margin: 0, lineHeight: 1.4 },
  replyForm: { display: 'flex', gap: '6px', marginTop: '8px' },
  replyInput: { flex: 1, padding: '6px 10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: '#fff', fontSize: '12px', fontFamily: 'inherit', outline: 'none' },
  replySubmitBtn: { padding: '6px 12px', background: '#6366f1', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },

  // Details section
  detailsSection: { marginTop: '32px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '24px' },
  detailsSectionTitle: { fontSize: '20px', fontWeight: 700, color: '#e2e8f0', margin: '0 0 20px', letterSpacing: '-0.3px' },
  detailsGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' },
  detailsBlock: { padding: '16px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', display: 'flex', flexDirection: 'column' },
  detailsBlockHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' },
  detailsBlockTitle: { fontSize: '14px', fontWeight: 700, color: '#a5b4fc', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' },
  detailsAddBtn: { padding: '5px 14px', background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: '6px', color: '#a5b4fc', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  detailsEmpty: { color: 'rgba(255,255,255,0.25)', fontSize: '13px', margin: '4px 0' },
  thumbnailGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' },
  thumbnailCard: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', overflow: 'hidden' },
  thumbnailImg: { width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' },
  thumbnailMeta: { padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  thumbnailUploader: { fontSize: '11px', color: 'rgba(255,255,255,0.4)' },
  titlesList: { display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px' },
  titleItem: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', padding: '8px 12px' },
  titleItemMain: { display: 'flex', alignItems: 'center', gap: '10px' },
  titleText: { flex: 1, fontSize: '14px', color: '#e2e8f0', fontWeight: 500 },
  titleCreator: { fontSize: '11px', color: 'rgba(255,255,255,0.3)' },
  titleAddForm: { display: 'flex', gap: '8px' },
  descriptionTextarea: { width: '100%', minHeight: '100px', padding: '12px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: '#fff', fontSize: '14px', fontFamily: 'inherit', outline: 'none', resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box' },
  detailsCommentToggle: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit', padding: '2px 4px' },
  detailsDeleteBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)', cursor: 'pointer', fontSize: '12px', padding: '2px 4px' },
  detailsCommentThread: { marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.04)' },
  detailsComment: { display: 'flex', alignItems: 'baseline', gap: '6px', padding: '4px 0', fontSize: '12px' },
  detailsCommentAuthor: { fontWeight: 600, color: '#818cf8', fontSize: '11px', flexShrink: 0 },
  detailsCommentText: { color: 'rgba(255,255,255,0.55)', fontSize: '12px' },
  detailsCommentDelete: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.15)', cursor: 'pointer', fontSize: '10px', padding: '0 2px', marginLeft: 'auto', flexShrink: 0 },
  detailsCommentForm: { marginTop: '6px' },
  detailsCommentInput: { width: '100%', padding: '6px 10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: '#fff', fontSize: '12px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' },

  // ─── Script Review Styles ──────────────────────────────────────────────────
  scriptsDivider: { height: '1px', background: 'linear-gradient(90deg, transparent, rgba(232,255,71,0.2), transparent)', margin: '40px 0 32px' },
  scriptsHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  scriptsTitle: { fontSize: '22px', fontWeight: 700, color: '#e8ff47', margin: 0, letterSpacing: '-0.3px' },
  scriptsCount: { padding: '3px 10px', background: 'rgba(232,255,71,0.1)', border: '1px solid rgba(232,255,71,0.2)', borderRadius: '10px', color: '#e8ff47', fontSize: '12px', fontWeight: 600 },
  scriptAddBtn: { padding: '10px 20px', background: 'linear-gradient(135deg, #c5d600, #e8ff47)', border: 'none', borderRadius: '10px', color: '#0f0f1a', fontSize: '14px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  scriptGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' },
  scriptCard: { display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '14px 16px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderLeft: '3px solid rgba(232,255,71,0.3)', borderRadius: '10px', cursor: 'pointer', position: 'relative', transition: 'border-color 0.15s' },
  scriptCardReady: { display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '14px 16px', background: 'rgba(34,197,94,0.02)', border: '1px solid rgba(34,197,94,0.15)', borderLeft: '3px solid #22c55e', borderRadius: '10px', cursor: 'pointer', position: 'relative', transition: 'border-color 0.15s' },
  readyViewLabel: { fontSize: '11px', color: '#22c55e', fontWeight: 600 },
  scriptCardIcon: { fontSize: '24px', flexShrink: 0, marginTop: '2px' },
  scriptCardBody: { flex: 1, minWidth: 0 },
  scriptCardTitle: { fontSize: '15px', fontWeight: 700, color: '#e2e8f0', margin: '0 0 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  scriptCardRow: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' },
  scriptSourceLabel: { fontSize: '11px', color: 'rgba(255,255,255,0.35)' },
  scriptVersionBadge: { padding: '1px 6px', background: 'rgba(232,255,71,0.1)', border: '1px solid rgba(232,255,71,0.2)', borderRadius: '4px', color: '#e8ff47', fontSize: '10px', fontWeight: 700 },
  scriptStatusPill: { padding: '2px 8px', background: 'rgba(232,255,71,0.1)', border: '1px solid rgba(232,255,71,0.2)', borderRadius: '10px', color: '#e8ff47', fontSize: '10px', fontWeight: 600 },
  scriptStatusAwaiting: { background: 'rgba(251,191,36,0.1)', borderColor: 'rgba(251,191,36,0.25)', color: '#fbbf24' },
  scriptStatusReady: { padding: '2px 8px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: '10px', color: '#22c55e', fontSize: '10px', fontWeight: 600 },
  scriptCardFooter: { display: 'flex', alignItems: 'center', gap: '8px' },
  scriptCardTime: { fontSize: '11px', color: 'rgba(255,255,255,0.25)' },
  scriptCardCreator: { fontSize: '11px', color: 'rgba(255,255,255,0.3)' },
  scriptDeleteBtn: { position: 'absolute', top: '8px', right: '8px', background: 'rgba(0,0,0,0.3)', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '12px', padding: '4px 8px', borderRadius: '6px' },

  // Ready section
  readySection: { marginTop: '20px', border: '1px solid rgba(34,197,94,0.15)', borderRadius: '12px', padding: '12px 16px' },
  readyToggle: { background: 'none', border: 'none', color: '#22c55e', fontSize: '15px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', marginBottom: '8px' },
  readyToggleIcon: { fontSize: '12px', color: 'rgba(34,197,94,0.6)' },
  readyCount: { padding: '2px 8px', background: 'rgba(34,197,94,0.1)', borderRadius: '10px', color: '#22c55e', fontSize: '11px', fontWeight: 600 },

  // Script Create Modal
  scriptModalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  scriptModal: { background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px', width: '480px', maxWidth: '90vw', maxHeight: '80vh', overflow: 'auto' },
  scriptModalHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px 12px' },
  scriptModalTitle: { fontSize: '18px', fontWeight: 700, color: '#e8ff47', margin: 0 },
  scriptModalClose: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: '18px', cursor: 'pointer', padding: '4px' },
  scriptModalTabs: { display: 'flex', gap: '4px', padding: '0 24px', marginBottom: '16px' },
  scriptModalTab: { flex: 1, padding: '8px 12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', color: 'rgba(255,255,255,0.4)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center' },
  scriptModalTabActive: { background: 'rgba(232,255,71,0.08)', borderColor: 'rgba(232,255,71,0.25)', color: '#e8ff47' },
  scriptModalForm: { padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: '12px' },
  scriptModalLabel: { fontSize: '12px', fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '4px 0 -4px' },
  scriptModalInput: { padding: '10px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '14px', fontFamily: 'inherit', outline: 'none' },
  scriptModalSelect: { padding: '10px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '14px', fontFamily: 'inherit', outline: 'none', appearance: 'none' },
  scriptModalSubmit: { padding: '12px 20px', background: 'linear-gradient(135deg, #c5d600, #e8ff47)', border: 'none', borderRadius: '8px', color: '#0f0f1a', fontSize: '14px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', marginTop: '4px' },
  scriptDropZone: { padding: '32px 20px', background: 'rgba(255,255,255,0.02)', border: '2px dashed rgba(232,255,71,0.2)', borderRadius: '12px', textAlign: 'center', cursor: 'pointer', transition: 'border-color 0.15s' },
  scriptDropZoneText: { fontSize: '14px', color: 'rgba(255,255,255,0.3)' },
  scriptDropZoneFile: { fontSize: '14px', color: '#e8ff47', fontWeight: 600 },

};

// ─── Script Review Instance (3-Panel) Styles ──────────────────────────────────

const sri = {
  // Container — full-height, no padding (panels handle their own)
  container: { display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: '#0f0f1a' },

  // Top action bar
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0, background: 'rgba(255,255,255,0.02)' },
  breadcrumb: { display: 'flex', alignItems: 'center', gap: '6px' },
  breadcrumbLink: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500, padding: 0 },
  breadcrumbSep: { color: 'rgba(255,255,255,0.15)', fontSize: '12px' },
  breadcrumbCurrent: { color: '#e8ff47', fontSize: '13px', fontWeight: 600 },
  topBarActions: { display: 'flex', alignItems: 'center', gap: '8px' },
  sendBtn: { padding: '8px 18px', background: 'linear-gradient(135deg, #c5d600, #e8ff47)', border: 'none', borderRadius: '8px', color: '#0f0f1a', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  sendBtnDisabled: { opacity: 0.45, cursor: 'not-allowed', background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.35)' },
  readyBtn: { padding: '8px 18px', background: 'transparent', border: '1px solid rgba(34,197,94,0.4)', borderRadius: '8px', color: '#22c55e', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  reopenBtn: { padding: '8px 18px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'rgba(255,255,255,0.5)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  reopenLink: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.25)', fontSize: '11px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', padding: '4px 0', marginLeft: '4px', textDecoration: 'underline', textUnderlineOffset: '2px' },
  shareBtn: { padding: '8px 18px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: 'rgba(255,255,255,0.45)', fontSize: '13px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' },

  // Status bar
  statusBar: { display: 'flex', alignItems: 'center', gap: '16px', padding: '10px 20px', borderBottom: '1px solid rgba(255,255,255,0.04)', flexShrink: 0, background: 'rgba(255,255,255,0.01)' },
  statusItem: { display: 'flex', alignItems: 'center', gap: '8px' },
  statusLabel: { fontSize: '11px', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 },
  statusValue: { fontSize: '13px', color: 'rgba(255,255,255,0.6)', fontWeight: 500 },
  statusDivider: { width: '1px', height: '16px', background: 'rgba(255,255,255,0.06)' },
  statusPill: { padding: '3px 10px', background: 'rgba(232,255,71,0.1)', border: '1px solid rgba(232,255,71,0.2)', borderRadius: '10px', color: '#e8ff47', fontSize: '11px', fontWeight: 600 },
  statusPillReady: { background: 'rgba(34,197,94,0.1)', borderColor: 'rgba(34,197,94,0.25)', color: '#22c55e' },
  statusPillAwaiting: { background: 'rgba(251,191,36,0.1)', borderColor: 'rgba(251,191,36,0.25)', color: '#fbbf24' },

  // 3-panel layout
  panels: { display: 'flex', flex: 1, overflow: 'hidden' },

  // Left sidebar — Version History
  leftSidebar: { width: '240px', minWidth: '240px', display: 'flex', flexDirection: 'column', borderRight: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.01)' },
  sidebarHeader: { padding: '16px 16px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 },
  sidebarTitle: { fontSize: '14px', fontWeight: 700, color: '#e2e8f0', margin: '0 0 6px', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' },
  sidebarVersionBadge: { display: 'inline-block', padding: '2px 8px', background: 'rgba(232,255,71,0.12)', border: '1px solid rgba(232,255,71,0.2)', borderRadius: '4px', color: '#e8ff47', fontSize: '11px', fontWeight: 700 },
  versionTimeline: { flex: 1, overflow: 'auto', padding: '8px 0' },

  // Version entries
  versionEntry: { display: 'flex', gap: '0', padding: '0 12px 0 0', background: 'none', border: 'none', width: '100%', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', transition: 'background 0.1s' },
  versionEntryActive: { background: 'rgba(232,255,71,0.04)' },

  // Timeline track (left edge)
  timelineTrack: { width: '32px', minWidth: '32px', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '14px', position: 'relative' },
  timelineDot: { width: '8px', height: '8px', borderRadius: '50%', background: 'rgba(255,255,255,0.15)', flexShrink: 0, zIndex: 1 },
  timelineDotActive: { background: '#e8ff47', boxShadow: '0 0 8px rgba(232,255,71,0.3)' },
  timelineDotCurrent: { width: '10px', height: '10px' },
  timelineLine: { width: '1px', flex: 1, background: 'rgba(255,255,255,0.06)', marginTop: '4px' },

  // Version content
  versionContent: { flex: 1, padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.03)', minWidth: 0 },
  versionTopRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' },
  versionBadge: { padding: '2px 7px', background: 'rgba(255,255,255,0.06)', borderRadius: '4px', color: 'rgba(255,255,255,0.5)', fontSize: '11px', fontWeight: 700 },
  versionBadgeActive: { background: 'rgba(232,255,71,0.12)', color: '#e8ff47' },
  versionTime: { fontSize: '10px', color: 'rgba(255,255,255,0.25)' },
  versionUploader: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' },
  uploaderAvatar: { width: '18px', height: '18px', borderRadius: '50%', background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', fontWeight: 700, color: 'rgba(255,255,255,0.5)', flexShrink: 0 },
  uploaderName: { fontSize: '11px', color: 'rgba(255,255,255,0.45)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  versionTags: { display: 'flex', gap: '4px', flexWrap: 'wrap' },
  sourceTagReviewer: { padding: '1px 6px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '4px', color: '#f87171', fontSize: '10px', fontWeight: 600 },
  sourceTagWriter: { padding: '1px 6px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: '4px', color: '#60a5fa', fontSize: '10px', fontWeight: 600 },
  statusTagCurrent: { padding: '1px 6px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '4px', color: '#4ade80', fontSize: '10px', fontWeight: 600 },
  statusTagSuperseded: { padding: '1px 6px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '4px', color: 'rgba(255,255,255,0.25)', fontSize: '10px', fontWeight: 600 },
  versionDownload: { display: 'inline-block', marginTop: '4px', padding: '2px 6px', background: 'rgba(99,102,241,0.08)', borderRadius: '3px', color: '#a5b4fc', fontSize: '10px', fontWeight: 600, textDecoration: 'none' },

  // Sidebar footer
  sidebarFooter: { padding: '12px', borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 },
  uploadBtn: { width: '100%', padding: '9px 12px', background: 'rgba(232,255,71,0.08)', border: '1px solid rgba(232,255,71,0.2)', borderRadius: '8px', color: '#e8ff47', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },

  // Center panel — now rendered by DocumentViewer component
  centerPanel: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#141418' },

  // Right sidebar — Annotations/Comments
  rightSidebar: { width: '300px', minWidth: '300px', display: 'flex', flexDirection: 'column', borderLeft: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.01)' },

  // Ready state
  readyBadge: { padding: '6px 16px', background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '8px', color: '#22c55e', fontSize: '13px', fontWeight: 700 },
  readyBanner: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 20px', background: 'rgba(34,197,94,0.06)', borderBottom: '1px solid rgba(34,197,94,0.15)', flexShrink: 0 },
  readyBannerIcon: { width: '22px', height: '22px', borderRadius: '50%', background: 'rgba(34,197,94,0.15)', color: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, flexShrink: 0 },
  readyBannerText: { fontSize: '13px', color: '#4ade80', fontWeight: 500 },
  readyConfirmBtn: { padding: '9px 24px', background: '#22c55e', border: 'none', borderRadius: '8px', color: '#0f0f1a', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
};

// ─── Document Viewer Styles ───────────────────────────────────────────────────

const dv = {
  // Container fills the center panel
  container: { display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' },

  // Empty state
  emptyState: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px' },
  emptyIcon: { fontSize: '48px', opacity: 0.3 },
  emptyText: { fontSize: '15px', color: 'rgba(255,255,255,0.3)', margin: 0 },
  emptyHint: { fontSize: '13px', color: 'rgba(255,255,255,0.15)', margin: 0 },

  // Past version banner
  pastBanner: { padding: '10px 20px', background: 'rgba(251,191,36,0.08)', borderBottom: '1px solid rgba(251,191,36,0.15)', color: '#fbbf24', fontSize: '13px', fontWeight: 500, flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px' },
  pastBannerBtn: { background: 'none', border: 'none', color: '#e8ff47', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', padding: 0, textDecoration: 'underline' },

  // Toolbar
  toolbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0, background: 'rgba(0,0,0,0.2)' },
  toolbarLeft: { display: 'flex', alignItems: 'center', gap: '8px' },
  fileIcon: { fontSize: '16px' },
  fileName: { fontSize: '12px', color: 'rgba(255,255,255,0.45)', fontWeight: 500, maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  toolbarDivider: { width: '1px', height: '16px', background: 'rgba(255,255,255,0.08)', margin: '0 4px' },
  zoomBtn: { width: '26px', height: '26px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '5px', color: 'rgba(255,255,255,0.5)', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit', padding: 0 },
  zoomLabel: { fontSize: '11px', color: 'rgba(255,255,255,0.45)', fontWeight: 600, minWidth: '32px', textAlign: 'center', fontVariantNumeric: 'tabular-nums' },
  zoomSlider: { width: '80px', height: '4px', cursor: 'pointer', accentColor: '#e8ff47' },
  fitBtn: { padding: '4px 10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '5px', color: 'rgba(255,255,255,0.4)', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  fitBtnActive: { background: 'rgba(232,255,71,0.08)', borderColor: 'rgba(232,255,71,0.2)', color: '#e8ff47' },
  pageIndicator: { fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontWeight: 500, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  downloadBtn: { padding: '5px 12px', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.15)', borderRadius: '6px', color: '#a5b4fc', fontSize: '11px', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' },

  // Loading
  loadingState: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px' },
  spinner: { width: '28px', height: '28px', border: '3px solid rgba(255,255,255,0.08)', borderTopColor: '#e8ff47', borderRadius: '50%', animation: 'dv-spin 0.8s linear infinite' },
  loadingText: { fontSize: '13px', color: 'rgba(255,255,255,0.3)', margin: 0 },

  // Error
  errorState: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px' },
  errorText: { fontSize: '14px', color: '#f87171', margin: 0 },
  errorLink: { fontSize: '13px', color: '#a5b4fc', textDecoration: 'underline' },

  // Scroll area
  scrollArea: { flex: 1, overflow: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' },

  // PDF page wrapper
  pdfPageWrapper: { position: 'relative', background: '#fff', boxShadow: '0 2px 12px rgba(0,0,0,0.3)', borderRadius: '2px', overflow: 'hidden', flexShrink: 0 },

  // DOCX / Markdown document page
  docPage: { width: '100%', maxWidth: '816px', minHeight: '600px', background: '#fefefe', borderRadius: '4px', boxShadow: '0 2px 12px rgba(0,0,0,0.3)', padding: '48px 56px', boxSizing: 'border-box' },
  docHtmlContent: {},

  // Margin badge column (PDF)
  marginBadgeCol: { position: 'absolute', top: 0, right: -36, width: 28, display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 4, zIndex: 5 },
  marginBadge: { width: 24, height: 24, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'transform 0.15s, box-shadow 0.15s', flexShrink: 0 },
  marginBadgeActive: { transform: 'scale(1.25)', boxShadow: '0 0 0 3px rgba(232,255,71,0.25)' },

  // Margin badge column (DOCX / MD)
  marginBadgeColHtml: { position: 'absolute', top: 0, right: -44, width: 32, display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 8, zIndex: 5 },
  marginBadgeHtml: { width: 24, height: 24, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'transform 0.15s, box-shadow 0.15s', flexShrink: 0, background: '#1a1a2e' },

  // PDF annotation overlay
  pdfAnnotationOverlay: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 3 },
};

// ─── Annotation Toolbar Styles ────────────────────────────────────────────────

const at = {
  bar: { display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: 'rgba(0,0,0,0.35)', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0, flexWrap: 'wrap' },
  toolBtn: { display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 12px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: 'rgba(255,255,255,0.5)', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s', whiteSpace: 'nowrap' },
  toolBtnActiveRedline: { background: 'rgba(255,68,68,0.12)', borderColor: 'rgba(255,68,68,0.3)', color: '#ff6666' },
  toolBtnActiveHighlight: { background: 'rgba(250,204,21,0.12)', borderColor: 'rgba(250,204,21,0.3)', color: '#facc15' },
  toolBtnActiveNote: { background: 'rgba(99,102,241,0.12)', borderColor: 'rgba(99,102,241,0.3)', color: '#a5b4fc' },
  toolIcon: { fontSize: '13px', lineHeight: 1 },
  colorDot: { width: 8, height: 8, borderRadius: '50%', marginLeft: 2, flexShrink: 0, border: '1px solid rgba(255,255,255,0.15)' },
  colorPicker: { display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px', background: 'rgba(0,0,0,0.6)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' },
  colorSwatch: { width: 18, height: 18, borderRadius: '50%', border: '2px solid transparent', cursor: 'pointer', transition: 'transform 0.12s', padding: 0 },
  colorSwatchActive: { borderColor: '#fff', transform: 'scale(1.2)' },
  hint: { fontSize: '11px', color: 'rgba(255,255,255,0.25)', fontStyle: 'italic', marginLeft: '8px' },
};

// ─── Send for Updates Modal Styles ────────────────────────────────────────────

const sfuStyles = {
  overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' },
  modal: { width: '560px', maxHeight: '85vh', background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 48px rgba(0,0,0,0.5)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 },
  headerTitle: { fontSize: '18px', fontWeight: 700, color: '#e2e8f0', margin: 0 },
  closeBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: '18px', cursor: 'pointer', padding: '4px 8px', fontFamily: 'inherit' },
  body: { flex: 1, overflow: 'auto', padding: '20px 24px' },
  section: { marginBottom: '24px' },
  sectionTitle: { fontSize: '13px', fontWeight: 700, color: 'rgba(255,255,255,0.6)', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.5px' },
  optional: { fontWeight: 400, color: 'rgba(255,255,255,0.25)', textTransform: 'none', letterSpacing: 0 },
  statRow: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' },
  statBadgeTotal: { padding: '4px 12px', background: 'rgba(232,255,71,0.1)', border: '1px solid rgba(232,255,71,0.2)', borderRadius: '12px', color: '#e8ff47', fontSize: '12px', fontWeight: 700 },
  statBadge: { padding: '4px 10px', border: '1px solid', borderRadius: '12px', fontSize: '12px', fontWeight: 600 },
  annList: { maxHeight: '240px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' },
  annItem: { display: 'flex', gap: '10px', padding: '8px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)' },
  annDot: { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0, marginTop: '4px' },
  annContent: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' },
  annType: { fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.3px' },
  annQuote: { fontSize: '12px', color: 'rgba(255,255,255,0.5)', fontStyle: 'italic', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  annComment: { fontSize: '12px', color: 'rgba(255,255,255,0.6)', lineHeight: 1.4 },
  showAllBtn: { background: 'none', border: 'none', color: '#a5b4fc', fontSize: '12px', fontWeight: 600, cursor: 'pointer', padding: '6px 0', fontFamily: 'inherit', textAlign: 'left' },
  noAnns: { fontSize: '13px', color: 'rgba(255,255,255,0.3)', fontStyle: 'italic', margin: 0 },
  textarea: { width: '100%', padding: '10px 14px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: '#e2e8f0', fontSize: '13px', fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.5 },
  destLinked: { display: 'flex', gap: '12px', padding: '12px 14px', background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.15)', borderRadius: '10px' },
  destWarning: { display: 'flex', gap: '12px', padding: '12px 14px', background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.15)', borderRadius: '10px' },
  destIcon: { fontSize: '16px', fontWeight: 700, flexShrink: 0, marginTop: '1px' },
  destTitle: { fontSize: '13px', fontWeight: 700, color: '#e2e8f0', marginBottom: '2px' },
  destSub: { fontSize: '12px', color: 'rgba(255,255,255,0.4)', lineHeight: 1.4 },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '16px 24px', borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 },
  cancelBtn: { padding: '9px 20px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: 'rgba(255,255,255,0.5)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  sendBtnActive: { padding: '9px 24px', background: 'linear-gradient(135deg, #c5d600, #e8ff47)', border: 'none', borderRadius: '8px', color: '#0f0f1a', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  sendBtnDisabled: { padding: '9px 24px', background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '8px', color: 'rgba(255,255,255,0.3)', fontSize: '13px', fontWeight: 600, cursor: 'not-allowed', fontFamily: 'inherit' },
  toastSuccess: { position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)', padding: '10px 24px', background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '10px', color: '#4ade80', fontSize: '13px', fontWeight: 600, zIndex: 2000, display: 'flex', alignItems: 'center', gap: '8px', backdropFilter: 'blur(12px)', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' },
  toastError: { position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)', padding: '10px 24px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '10px', color: '#f87171', fontSize: '13px', fontWeight: 600, zIndex: 2000, display: 'flex', alignItems: 'center', gap: '8px', backdropFilter: 'blur(12px)', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' },
};

// ─── Annotations Sidebar Styles ───────────────────────────────────────────────

const as = {
  container: { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' },
  header: { padding: '14px 16px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 },
  title: { fontSize: '14px', fontWeight: 700, color: '#e2e8f0', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' },
  count: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 20, height: 20, padding: '0 6px', borderRadius: '10px', background: 'rgba(232,255,71,0.1)', color: '#e8ff47', fontSize: '11px', fontWeight: 700 },
  filterRow: { display: 'flex', gap: '4px', padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)', flexShrink: 0 },
  filterBtn: { padding: '4px 10px', background: 'none', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '5px', color: 'rgba(255,255,255,0.35)', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s' },
  filterBtnActive: { background: 'rgba(232,255,71,0.08)', borderColor: 'rgba(232,255,71,0.2)', color: '#e8ff47' },
  list: { flex: 1, overflow: 'auto', padding: '8px' },
  emptyText: { fontSize: '12px', color: 'rgba(255,255,255,0.2)', textAlign: 'center', padding: '24px 12px', margin: 0, lineHeight: 1.6 },
  card: { padding: '10px 12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', marginBottom: '6px', cursor: 'pointer', transition: 'all 0.15s' },
  cardActive: { background: 'rgba(232,255,71,0.04)', borderColor: 'rgba(232,255,71,0.15)' },
  cardResolved: { opacity: 0.55, borderStyle: 'dashed' },
  cardHeader: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' },
  numBadge: { width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 800, flexShrink: 0 },
  typeIcon: { fontSize: '12px', lineHeight: 1 },
  annotatorAvatar: { width: 20, height: 20, borderRadius: '50%', background: 'rgba(232,255,71,0.12)', color: '#e8ff47', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700, flexShrink: 0 },
  annotatorName: { fontSize: '11px', color: 'rgba(255,255,255,0.5)', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cardTime: { fontSize: '10px', color: 'rgba(255,255,255,0.2)', whiteSpace: 'nowrap' },
  quotedText: { fontSize: '11px', color: 'rgba(255,255,255,0.45)', fontStyle: 'italic', padding: '6px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: '4px', borderLeft: '3px solid rgba(255,255,255,0.1)', marginBottom: '6px', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' },
  quotedRedline: { textDecoration: 'line-through', color: 'rgba(255,68,68,0.6)', borderLeftColor: '#ff4444' },
  editRow: { display: 'flex', gap: '6px', marginBottom: '6px' },
  editInput: { flex: 1, padding: '5px 8px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '5px', color: '#e2e8f0', fontSize: '11px', fontFamily: 'inherit', outline: 'none' },
  editSaveBtn: { padding: '4px 10px', background: 'rgba(232,255,71,0.12)', border: '1px solid rgba(232,255,71,0.2)', borderRadius: '5px', color: '#e8ff47', fontSize: '11px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  commentText: { fontSize: '12px', color: 'rgba(255,255,255,0.55)', margin: '0 0 6px 0', lineHeight: 1.5 },
  resolvedBadge: { fontSize: '10px', color: '#22c55e', fontWeight: 600, padding: '4px 8px', background: 'rgba(34,197,94,0.08)', borderRadius: '4px', marginBottom: '4px' },
  repliesWrap: { paddingLeft: '10px', borderLeft: '2px solid rgba(255,255,255,0.04)', marginBottom: '6px' },
  replyCard: { padding: '6px 0' },
  replyHeader: { display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '3px' },
  replyAvatar: { width: 16, height: 16, borderRadius: '50%', background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', fontWeight: 700, flexShrink: 0 },
  replyAuthor: { fontSize: '10px', color: 'rgba(255,255,255,0.4)', fontWeight: 600 },
  replyTime: { fontSize: '9px', color: 'rgba(255,255,255,0.15)', flex: 1 },
  replyDeleteBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.15)', fontSize: '10px', cursor: 'pointer', padding: '2px 4px', fontFamily: 'inherit' },
  replyText: { fontSize: '11px', color: 'rgba(255,255,255,0.45)', margin: 0, lineHeight: 1.5 },
  cardActions: { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' },
  resolveBtn: { background: 'none', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '5px', color: '#22c55e', fontSize: '10px', fontWeight: 600, cursor: 'pointer', padding: '3px 8px', fontFamily: 'inherit', transition: 'all 0.15s' },
  deleteBtn: { background: 'none', border: '1px solid rgba(248,113,113,0.15)', borderRadius: '5px', color: 'rgba(248,113,113,0.5)', fontSize: '10px', fontWeight: 600, cursor: 'pointer', padding: '3px 8px', fontFamily: 'inherit', marginLeft: 'auto' },
  unresolveBtn: { background: 'none', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '5px', color: 'rgba(255,255,255,0.35)', fontSize: '10px', fontWeight: 600, cursor: 'pointer', padding: '3px 8px', fontFamily: 'inherit' },
  replyInputRow: { marginTop: '6px' },
  replyInput: { width: '100%', padding: '6px 8px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '5px', color: '#e2e8f0', fontSize: '11px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' },
  resolvedSection: { marginTop: '12px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.04)' },
  resolvedToggle: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.25)', fontSize: '11px', fontWeight: 600, cursor: 'pointer', padding: '4px 0', fontFamily: 'inherit', width: '100%', textAlign: 'left' },
};
