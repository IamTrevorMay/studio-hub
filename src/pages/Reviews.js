import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import { fetchAllRows } from './analytics/utils';

import { clickableKeyProps } from '../lib/styleRecipes';
import { colors } from '../lib/styleTokens';
import ReviewPlayer, { extractVideoId } from '../components/reviews/ReviewPlayer';

// ─── Review List ─────────────────────────────────────────────────────────────

const SOURCE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'studio', label: 'Studio' },
  { key: 'client', label: 'Client' },
];

export default function Reviews() {
  const { profile, isAdmin, refreshKey } = useAuth();
  const confirm = useConfirm();
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ title: '', url: '' });
  const [activeReview, setActiveReview] = useState(null);
  const [sourceFilter, setSourceFilter] = useState('all'); // all | studio | client

  const fetchReviews = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAllRows(
        supabase.from('reviews')
          .select('*, creator:profiles!reviews_created_by_fkey(full_name), thumbs:review_thumbnails(file_path, created_at), versions:review_versions(version_number, client_verdict), assignment:contractor_assignments!reviews_assignment_id_fkey(id, title, contractor_id, created_by, creator:profiles!freelancer_assignments_created_by_fkey(full_name))')
          .order('created_at', { ascending: false })
      );
      // For reviews with no video yet, surface an uploaded thumbnail (earliest) on the card.
      const enriched = (data || []).map(r => {
        const firstThumb = (r.thumbs || []).slice().sort((a, b) =>
          new Date(a.created_at) - new Date(b.created_at))[0];
        const thumbUrl = firstThumb
          ? supabase.storage.from('review-thumbnails').getPublicUrl(firstThumb.file_path).data?.publicUrl
          : null;
        // Latest version's client verdict, for the card mini chip.
        const latestVersion = (r.versions || []).slice().sort((a, b) =>
          b.version_number - a.version_number)[0];
        return { ...r, thumbUrl, latestVerdict: latestVersion?.client_verdict || null };
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

  const filteredReviews = reviews.filter(r => {
    if (sourceFilter === 'studio') return !r.assignment_id;
    if (sourceFilter === 'client') return !!r.assignment_id;
    return true;
  });

  return (
    <div style={styles.page}>
      <div style={styles.topBar}>
        <div>
          <h1 style={styles.pageTitle}>Reviews</h1>
          <p style={styles.pageSubtitle}>{filteredReviews.length} video{filteredReviews.length !== 1 ? 's' : ''} for review</p>
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

      {/* Source filter pills: All | Studio | Client */}
      <div style={styles.filterPills}>
        {SOURCE_FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setSourceFilter(f.key)}
            style={{
              ...styles.filterPill,
              ...(sourceFilter === f.key ? styles.filterPillActive : {}),
            }}
          >{f.label}</button>
        ))}
      </div>

      {loading ? (
        <p style={styles.emptyText}>Loading...</p>
      ) : filteredReviews.length === 0 ? (
        <div style={styles.emptyCard}>
          <p style={styles.emptyText}>
            {sourceFilter === 'all'
              ? 'No reviews yet. Paste a YouTube link to get started.'
              : sourceFilter === 'client' ? 'No client reviews yet.' : 'No studio reviews yet.'}
          </p>
        </div>
      ) : (
        <div style={styles.reviewGrid}>
          {filteredReviews.map(review => (
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
                {review.assignment_id && (
                  <div style={styles.cardChipRow}>
                    <span style={styles.clientChip}>Client</span>
                    {review.latestVerdict === 'approved' && (
                      <span style={{ ...styles.cardVerdictChip, ...styles.cardVerdictApproved }}>✓ Approved</span>
                    )}
                    {review.latestVerdict === 'changes_requested' && (
                      <span style={{ ...styles.cardVerdictChip, ...styles.cardVerdictChanges }}>↻ Changes requested</span>
                    )}
                  </div>
                )}
                <h3 style={styles.reviewCardTitle}>{review.title}</h3>
                <span style={styles.reviewCardMeta}>
                  {review.assignment_id
                    ? (review.assignment?.creator?.full_name || review.creator?.full_name)
                    : review.creator?.full_name}
                  {' · '}
                  {new Date(review.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
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

const styles = {
  page: { padding: '32px 40px' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexShrink: 0 },
  pageTitle: { fontSize: '28px', fontWeight: 700, color: '#ffffff', margin: '0 0 4px 0', letterSpacing: '-0.5px' },
  pageSubtitle: { fontSize: '14px', color: 'rgba(255,255,255,0.4)', margin: 0 },
  addBtn: { padding: '10px 20px', background: 'linear-gradient(135deg, #5b8fc7, #8fb4d8)', border: 'none', borderRadius: '10px', color: colors.white, fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  createForm: { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '20px', marginBottom: '24px', display: 'flex', flexDirection: 'column', gap: '12px' },
  input: { padding: '10px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '14px', fontFamily: 'inherit', outline: 'none' },
  previewThumb: { display: 'flex', alignItems: 'center', gap: '12px', padding: '10px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' },
  previewImg: { width: '120px', borderRadius: '6px' },
  previewLabel: { fontSize: '13px', color: '#22c55e', fontWeight: 500 },
  submitBtn: { padding: '10px 20px', background: colors.accent, border: 'none', borderRadius: '8px', color: colors.white, fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', alignSelf: 'flex-start' },

  // Source filter pills
  filterPills: { display: 'flex', gap: '6px', marginBottom: '16px' },
  filterPill: { padding: '5px 14px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', color: 'rgba(255,255,255,0.4)', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  filterPillActive: { background: colors.accentA12, borderColor: colors.accentA30, color: colors.accentFg },

  // Grid + cards
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

  // Client-review chips
  cardChipRow: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' },
  clientChip: { padding: '2px 8px', background: colors.accentA10, border: `1px solid ${colors.accentA30}`, borderRadius: '6px', color: colors.accentFg, fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' },
  cardVerdictChip: { padding: '2px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: 700 },
  cardVerdictApproved: { background: colors.success.bg, border: `1px solid ${colors.success.border}`, color: colors.success.fg },
  cardVerdictChanges: { background: colors.warning.bg, border: `1px solid ${colors.warning.border}`, color: colors.warning.fg },
};
