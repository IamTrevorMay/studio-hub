import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';

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

// ─── Review List ─────────────────────────────────────────────────────────────

export default function Reviews() {
  const { profile, isAdmin } = useAuth();
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ title: '', url: '' });
  const [activeReview, setActiveReview] = useState(null);

  useEffect(() => {
    if (profile?.id) fetchReviews();
  }, [profile?.id]);

  async function fetchReviews() {
    try {
      const { data, error } = await supabase.from('reviews')
        .select('*, creator:profiles!reviews_profile_fk(full_name)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setReviews(data || []);
    } catch (err) {
      console.error('Error fetching reviews:', err);
      setReviews([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    const videoId = extractVideoId(createForm.url);
    if (!videoId) { alert('Invalid YouTube URL.'); return; }
    if (!createForm.title.trim()) return;

    // Create review
    const { data: review, error } = await supabase.from('reviews').insert({
      title: createForm.title.trim(),
      youtube_url: createForm.url.trim(),
      youtube_video_id: videoId,
      created_by: profile.id,
    }).select().single();
    if (error) { console.error(error); return; }

    // Create initial version
    await supabase.from('review_versions').insert({
      review_id: review.id,
      version_number: 1,
      label: 'Cut 1',
      youtube_url: createForm.url.trim(),
      youtube_video_id: videoId,
      created_by: profile.id,
    });

    setCreateForm({ title: '', url: '' });
    setShowCreate(false);
    fetchReviews();
  }

  async function handleDeleteReview(reviewId) {
    if (!window.confirm('Delete this review and all its versions/comments?')) return;
    await supabase.from('reviews').delete().eq('id', reviewId);
    if (activeReview?.id === reviewId) setActiveReview(null);
    fetchReviews();
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
            placeholder="YouTube URL (unlisted or public)"
            required
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
                <img
                  src={`https://img.youtube.com/vi/${review.youtube_video_id}/mqdefault.jpg`}
                  alt={review.title}
                  style={styles.thumb}
                />
                <div style={styles.playOverlay}>▶</div>
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

  useEffect(() => {
    fetchVersions();
    return () => { if (timeInterval.current) clearInterval(timeInterval.current); };
  }, [review.id]);

  // When active version changes, reload player and comments
  useEffect(() => {
    if (activeVersion) {
      fetchComments();
      loadPlayer(activeVersion.youtube_video_id);
    }
  }, [activeVersion?.id]);

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
      window.onYouTubeIframeAPIReady = create;
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
        {/* Video Column */}
        <div style={styles.videoCol}>
          <div style={styles.videoWrap}>
            <div ref={playerRef} style={styles.videoEmbed} />
          </div>

          {/* Timeline */}
          <div style={styles.timeline}>
            {duration > 0 && (
              <div style={{ ...styles.timelineProgress, width: `${(currentTime / duration) * 100}%` }} />
            )}
            {markers.map(m => (
              <button
                key={m.id}
                onClick={() => seekTo(m.timestamp_seconds)}
                style={{ ...styles.timelineMarker, left: `${m.pct}%` }}
                title={`${formatTimestamp(m.timestamp_seconds)} — ${m.commenter?.full_name}: ${m.content.substring(0, 40)}`}
              />
            ))}
          </div>

          <div style={styles.timeDisplay}>
            <span>{formatTimestamp(currentTime)}</span>
            {duration > 0 && <span style={{ color: 'rgba(255,255,255,0.25)' }}> / {formatTimestamp(duration)}</span>}
          </div>

          {/* Comment Input */}
          <form onSubmit={handleAddComment} style={styles.commentForm}>
            <div style={styles.commentTimeTag}>
              {formatTimestamp(ytPlayerRef.current?.getCurrentTime?.() || 0)}
            </div>
            <input
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Add a note at current timestamp..."
              style={styles.commentInput}
            />
            <button type="submit" style={styles.commentSubmitBtn} disabled={!commentText.trim()}>Post</button>
          </form>
        </div>

        {/* Comments Column */}
        <div style={styles.commentsCol}>
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
          <div style={styles.commentsList}>
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
      <p style={styles.commentBody}>{c.content}</p>

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
              <p style={styles.replyBody}>{r.content}</p>
            </div>
          ))}
        </div>
      )}

      {/* Reply input */}
      {showReplyInput && (
        <form onSubmit={handleSubmitReply} style={styles.replyForm}>
          <input
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
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

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = {
  page: { padding: '32px 40px', height: '100%', display: 'flex', flexDirection: 'column' },
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
  playerLayout: { display: 'flex', gap: '24px', flex: 1, minHeight: 0 },
  videoCol: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 },
  videoWrap: { position: 'relative', width: '100%', aspectRatio: '16/9', background: '#000', borderRadius: '12px', overflow: 'hidden', flexShrink: 0 },
  videoEmbed: { width: '100%', height: '100%' },
  timeline: { position: 'relative', height: '12px', background: 'rgba(255,255,255,0.06)', borderRadius: '6px', marginTop: '8px', cursor: 'pointer', overflow: 'visible' },
  timelineProgress: { position: 'absolute', top: 0, left: 0, height: '100%', background: 'rgba(99,102,241,0.3)', borderRadius: '6px', transition: 'width 0.25s linear', pointerEvents: 'none' },
  timelineMarker: { position: 'absolute', top: '50%', transform: 'translate(-50%, -50%)', width: '10px', height: '10px', borderRadius: '50%', background: '#fbbf24', border: '2px solid #0f0f1a', cursor: 'pointer', zIndex: 2, padding: 0 },
  timeDisplay: { fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginTop: '4px', fontVariantNumeric: 'tabular-nums' },
  commentForm: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px' },
  commentTimeTag: { padding: '5px 10px', background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: '6px', color: '#fbbf24', fontSize: '12px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  commentInput: { flex: 1, padding: '10px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '13px', fontFamily: 'inherit', outline: 'none' },
  commentSubmitBtn: { padding: '10px 18px', background: '#6366f1', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },

  // Comments panel
  commentsCol: { width: '340px', minWidth: '340px', display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', overflow: 'hidden' },
  commentsPanelHeader: { padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 },
  commentsPanelTitle: { fontSize: '14px', fontWeight: 700, color: '#e2e8f0', margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: '8px' },
  commentCount: { background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '10px' },
  filterTabs: { display: 'flex', gap: '4px' },
  filterTab: { padding: '4px 10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px', color: 'rgba(255,255,255,0.35)', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  filterTabActive: { background: 'rgba(99,102,241,0.1)', borderColor: 'rgba(99,102,241,0.25)', color: '#a5b4fc' },
  commentsList: { flex: 1, overflow: 'auto', padding: '12px' },
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
};
