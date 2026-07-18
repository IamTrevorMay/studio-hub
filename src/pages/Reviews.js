import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import { fetchAllRows } from './analytics/utils';

import * as mammoth from 'mammoth';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { clickableKeyProps } from '../lib/styleRecipes';
import { colors } from '../lib/styleTokens';

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

  const fetchReviews = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAllRows(
        supabase.from('reviews')
          .select('*, creator:profiles!reviews_created_by_fkey(full_name), thumbs:review_thumbnails(file_path, created_at)')
          .order('created_at', { ascending: false })
      );
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

  useEffect(() => {
    if (!profile?.id) return;
    fetchReviews();
  }, [profile?.id, fetchReviews]);
  useVisibilityRefresh(useCallback(() => {
    fetchReviews();
  }, [fetchReviews]));

  if (activeReview) {
    return (
      <ReviewPlayer
        key={activeReview.id}
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
            <div key={review.id} {...clickableKeyProps(() => setActiveReview(review))} style={styles.reviewCard} onClick={() => setActiveReview(review)}>
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
  const createTimer = useRef(null); // pending player-create setTimeout
  const commentsListRef = useRef(null);
  const videoColRef = useRef(null);
  const [videoColHeight, setVideoColHeight] = useState(null);

  // Details section state (tied to review.id, not version)
  const [thumbnails, setThumbnails] = useState([]);
  const [titles, setTitles] = useState([]);
  const [description, setDescription] = useState(review.description || '');
  // Tracks unsaved description edits so a fetchDetails() refetch (fired by any
  // sibling mutation) can't clobber the textarea with the stale DB value.
  const descDirtyRef = useRef(false);
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
      if (createTimer.current) clearTimeout(createTimer.current);
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
      .select('*, creator:profiles!review_versions_created_by_fkey(full_name)')
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
      .select('*, commenter:profiles!review_comments_user_id_fkey(full_name)')
      .eq('version_id', activeVersion.id)
      .order('timestamp_seconds', { ascending: true });
    // Also fetch replies for each comment
    const commentsWithReplies = await Promise.all((data || []).map(async (c) => {
      const { data: replies } = await supabase.from('review_replies')
        .select('*, replier:profiles!review_replies_user_id_fkey(full_name)')
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
    // Cancel any pending create() from a previous loadPlayer so a stale timer
    // can't build a player for an old videoId and overwrite ytPlayerRef.
    if (createTimer.current) clearTimeout(createTimer.current);
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
      createTimer.current = setTimeout(create, 100);
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
      .select('*, creator:profiles!review_versions_created_by_fkey(full_name)')
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
    // Refresh description from DB — but never over an unsaved in-progress edit.
    const { data: rev } = await supabase.from('reviews').select('description').eq('id', review.id).single();
    if (rev && !descDirtyRef.current) setDescription(rev.description || '');
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
    const { error } = await supabase.from('reviews').update({ description }).eq('id', review.id);
    if (error) { console.error('Save description failed:', error.message); return; }
    descDirtyRef.current = false;
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
            title={`${formatTimestamp(m.timestamp_seconds)} — ${m.commenter?.full_name}: ${(m.content || '').substring(0, 40)}`}
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
            onChange={(e) => { descDirtyRef.current = true; setDescription(e.target.value); }}
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

const styles = {
  page: { padding: '32px 40px' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexShrink: 0 },
  pageTitle: { fontSize: '28px', fontWeight: 700, color: '#ffffff', margin: '0 0 4px 0', letterSpacing: '-0.5px' },
  pageSubtitle: { fontSize: '14px', color: 'rgba(255,255,255,0.4)', margin: 0 },
  backBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.45)', fontSize: '13px', cursor: 'pointer', padding: '0 0 8px 0', fontFamily: 'inherit', fontWeight: 500 },
  addBtn: { padding: '10px 20px', background: 'linear-gradient(135deg, #5b8fc7, #8fb4d8)', border: 'none', borderRadius: '10px', color: colors.white, fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  createForm: { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '20px', marginBottom: '24px', display: 'flex', flexDirection: 'column', gap: '12px' },
  input: { padding: '10px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '14px', fontFamily: 'inherit', outline: 'none' },
  previewThumb: { display: 'flex', alignItems: 'center', gap: '12px', padding: '10px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' },
  previewImg: { width: '120px', borderRadius: '6px' },
  previewLabel: { fontSize: '13px', color: '#22c55e', fontWeight: 500 },
  submitBtn: { padding: '10px 20px', background: colors.accent, border: 'none', borderRadius: '8px', color: colors.white, fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', alignSelf: 'flex-start' },
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
  versionTabActive: { background: colors.accentA12, borderColor: colors.accentA30, color: colors.accentFg },
  versionNum: { fontSize: '10px', fontWeight: 700, opacity: 0.5 },
  addVersionBtn: { padding: '6px 14px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: 'rgba(255,255,255,0.4)', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' },
  addVersionForm: { display: 'flex', gap: '8px', marginBottom: '12px', flexShrink: 0 },
  addVersionInput: { flex: 1, padding: '8px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff', fontSize: '12px', fontFamily: 'inherit', outline: 'none' },
  addVersionSubmit: { padding: '8px 16px', background: colors.accent, border: 'none', borderRadius: '6px', color: colors.white, fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },

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
  timelineProgress: { position: 'absolute', top: 0, left: 0, height: '100%', background: colors.accentA30, borderRadius: '6px', transition: 'width 0.25s linear', pointerEvents: 'none' },
  timelineMarker: { position: 'absolute', top: '50%', transform: 'translate(-50%, -50%)', width: '10px', height: '10px', borderRadius: '50%', background: colors.gold, border: '2px solid #0e1420', cursor: 'pointer', zIndex: 2, padding: 0 },
  timeDisplay: { fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginTop: '4px', fontVariantNumeric: 'tabular-nums' },
  commentForm: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px' },
  commentTimeTag: { padding: '5px 10px', background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: '6px', color: '#fbbf24', fontSize: '12px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  commentInput: { flex: 1, padding: '10px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '13px', fontFamily: 'inherit', outline: 'none' },
  commentSubmitBtn: { padding: '10px 18px', background: colors.accent, border: 'none', borderRadius: '8px', color: colors.white, fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  formatBtn: { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: 'rgba(255,255,255,0.5)', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit', padding: '2px 7px', lineHeight: 1 },

  // Comments panel
  commentsCol: { width: '340px', minWidth: '340px', display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', overflow: 'hidden', flexShrink: 0 },
  commentsPanelHeader: { padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 },
  commentsPanelTitle: { fontSize: '14px', fontWeight: 700, color: '#e2e8f0', margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: '8px' },
  commentCount: { background: colors.accentA15, color: colors.accentFg, fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '10px' },
  filterTabs: { display: 'flex', gap: '4px' },
  filterTab: { padding: '4px 10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px', color: 'rgba(255,255,255,0.35)', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  filterTabActive: { background: colors.accentA10, borderColor: colors.accentA25, color: colors.accentFg },
  commentsList: { flex: 1, overflow: 'auto', padding: '12px', minHeight: 0 },
  emptyComments: { color: 'rgba(255,255,255,0.25)', fontSize: '13px', textAlign: 'center', padding: '20px 0' },

  // Comment card
  commentCard: { padding: '10px 12px', background: 'rgba(255,255,255,0.02)', borderLeft: '3px solid rgba(251,191,36,0.3)', borderRadius: '0 8px 8px 0', marginBottom: '10px', transition: 'opacity 0.15s' },
  commentCardHeader: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' },
  commentTimestamp: { padding: '2px 8px', background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: '4px', color: '#fbbf24', fontSize: '11px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums' },
  commentAuthor: { fontSize: '12px', fontWeight: 600, color: colors.accentFg },
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
  replyAuthor: { fontSize: '11px', fontWeight: 600, color: colors.accentFg },
  replyDate: { fontSize: '9px', color: 'rgba(255,255,255,0.2)' },
  replyDeleteBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.15)', cursor: 'pointer', fontSize: '10px', padding: '0 2px', marginLeft: 'auto' },
  replyBody: { fontSize: '12px', color: 'rgba(255,255,255,0.55)', margin: 0, lineHeight: 1.4 },
  replyForm: { display: 'flex', gap: '6px', marginTop: '8px' },
  replyInput: { flex: 1, padding: '6px 10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: '#fff', fontSize: '12px', fontFamily: 'inherit', outline: 'none' },
  replySubmitBtn: { padding: '6px 12px', background: colors.accent, border: 'none', borderRadius: '6px', color: colors.white, fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },

  // Details section
  detailsSection: { marginTop: '32px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '24px' },
  detailsSectionTitle: { fontSize: '20px', fontWeight: 700, color: '#e2e8f0', margin: '0 0 20px', letterSpacing: '-0.3px' },
  detailsGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' },
  detailsBlock: { padding: '16px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', display: 'flex', flexDirection: 'column' },
  detailsBlockHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' },
  detailsBlockTitle: { fontSize: '14px', fontWeight: 700, color: colors.accentFg, margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' },
  detailsAddBtn: { padding: '5px 14px', background: colors.accentA15, border: '1px solid rgba(91, 143, 199,0.25)', borderRadius: '6px', color: colors.accentFg, fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
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
  detailsCommentAuthor: { fontWeight: 600, color: colors.accentFg, fontSize: '11px', flexShrink: 0 },
  detailsCommentText: { color: 'rgba(255,255,255,0.55)', fontSize: '12px' },
  detailsCommentDelete: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.15)', cursor: 'pointer', fontSize: '10px', padding: '0 2px', marginLeft: 'auto', flexShrink: 0 },
  detailsCommentForm: { marginTop: '6px' },
  detailsCommentInput: { width: '100%', padding: '6px 10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: '#fff', fontSize: '12px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' },
};

