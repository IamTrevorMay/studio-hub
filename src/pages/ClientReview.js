import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../supabaseClient';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import { getDisplayName } from '../lib/displayName';
import { colors } from '../lib/styleTokens';
import ReviewPlayer from '../components/reviews/ReviewPlayer';

// Client portal — Review tab. Read-only list of the cuts editors have
// submitted on this client's assignments. Opening a card renders the shared
// ReviewPlayer in client mode (timestamped comments + per-version verdict via
// the submit_review_verdict RPC — the player owns that write path; this page
// never inserts notifications).

function verdictChipFor(review) {
  if (review.latestVerdict === 'approved') {
    return { label: '✓ Approved', style: 'approved' };
  }
  if (review.latestVerdict === 'changes_requested') {
    return { label: '↻ Changes requested', style: 'changes' };
  }
  return { label: 'Awaiting your review', style: 'awaiting' };
}

export default function ClientReview({ initialReviewId, onOpened }) {
  const { profile } = useAuth();

  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeReview, setActiveReview] = useState(null);

  // Consume the deep-link prop exactly once per incoming id.
  const openedInitialRef = useRef(null);

  const fetchReviews = useCallback(async () => {
    if (!profile?.id) return;
    try {
      // 1. Own assignments (RLS: created_by = self)
      const { data: assigns, error: assignErr } = await supabase
        .from('contractor_assignments')
        .select('id, title, contractor_id')
        .eq('created_by', profile.id);
      if (assignErr) throw assignErr;
      const assignRows = assigns || [];
      if (assignRows.length === 0) {
        setReviews([]);
        return;
      }

      // 2. Reviews on those assignments, with their versions embedded
      const { data: revs, error: revErr } = await supabase
        .from('reviews')
        .select('*, versions:review_versions(id, version_number, label, client_verdict, youtube_video_id, created_at)')
        .in('assignment_id', assignRows.map(a => a.id))
        .order('created_at', { ascending: false });
      if (revErr) throw revErr;

      // 3. Editor names — stitched by id (robust vs. FK-hint embeds)
      const editorIds = [...new Set(assignRows.map(a => a.contractor_id).filter(Boolean))];
      const editorsById = {};
      if (editorIds.length > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, full_name, nickname')
          .in('id', editorIds);
        (profs || []).forEach(p => { editorsById[p.id] = p; });
      }

      const assignById = {};
      assignRows.forEach(a => { assignById[a.id] = a; });

      const enriched = (revs || []).map(r => {
        const assignment = assignById[r.assignment_id] || null;
        const versions = (r.versions || []).slice().sort((a, b) => a.version_number - b.version_number);
        const latest = versions[versions.length - 1] || null;
        return {
          ...r,
          assignment,
          editor: assignment ? (editorsById[assignment.contractor_id] || null) : null,
          versionCount: versions.length,
          latestVerdict: latest?.client_verdict || null,
          thumbVideoId: r.youtube_video_id || latest?.youtube_video_id || null,
        };
      });
      setReviews(enriched);
    } catch (err) {
      console.error('ClientReview fetch failed:', err);
      setReviews([]);
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  useEffect(() => { fetchReviews(); }, [fetchReviews]);
  useVisibilityRefresh(useCallback(() => { fetchReviews(); }, [fetchReviews]));

  // Deep-link from AppLayout (notification click: cl_review + review id)
  useEffect(() => {
    if (!initialReviewId) { openedInitialRef.current = null; return; }
    if (loading) return;
    if (openedInitialRef.current === initialReviewId) return;
    const target = reviews.find(r => r.id === initialReviewId);
    if (target) {
      openedInitialRef.current = initialReviewId;
      setActiveReview(target);
      if (onOpened) onOpened();
    }
  }, [loading, initialReviewId, reviews, onOpened]);

  if (activeReview) {
    return (
      <ReviewPlayer
        key={activeReview.id}
        review={activeReview}
        onBack={() => { setActiveReview(null); fetchReviews(); }}
        profile={profile}
        isAdmin={false}
        mode="client"
      />
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Review</h1>
        <p style={styles.subtitle}>
          {reviews.length} cut{reviews.length !== 1 ? 's' : ''} from your editors
        </p>
      </div>

      {loading ? (
        <p style={styles.emptyText}>Loading...</p>
      ) : reviews.length === 0 ? (
        <div style={styles.emptyCard}>
          <p style={styles.emptyText}>
            No cuts to review yet — your editor will submit review links here.
          </p>
        </div>
      ) : (
        <div style={styles.reviewGrid}>
          {reviews.map(review => {
            const chip = verdictChipFor(review);
            return (
              <div
                key={review.id}
                role="button"
                tabIndex={0}
                style={styles.reviewCard}
                onClick={() => setActiveReview(review)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveReview(review); }
                }}
              >
                <div style={styles.thumbWrap}>
                  {review.thumbVideoId ? (
                    <>
                      <img
                        src={`https://img.youtube.com/vi/${review.thumbVideoId}/mqdefault.jpg`}
                        alt={review.title}
                        style={styles.thumb}
                      />
                      <div style={styles.playOverlay}>▶</div>
                    </>
                  ) : (
                    <div style={styles.thumbPlaceholder}>No video yet</div>
                  )}
                  {review.versionCount > 0 && (
                    <span style={styles.versionBadge}>v{review.versionCount}</span>
                  )}
                </div>
                <div style={styles.reviewCardBody}>
                  <span style={{
                    ...styles.statusChip,
                    ...(chip.style === 'approved' ? styles.statusChipApproved
                      : chip.style === 'changes' ? styles.statusChipChanges
                      : styles.statusChipAwaiting),
                  }}>
                    {chip.label}
                  </span>
                  <h3 style={styles.reviewCardTitle}>
                    {review.assignment?.title || review.title}
                  </h3>
                  <span style={styles.reviewCardMeta}>
                    {review.editor ? `Edited by ${getDisplayName(review.editor)}` : 'Your editor'}
                    {' · '}
                    {new Date(review.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
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
  page: {
    minHeight: '100vh',
    background: colors.bg,
    padding: '32px 24px',
    fontFamily: 'DM Sans, sans-serif',
    color: 'rgba(255,255,255,0.9)',
    maxWidth: 960,
    margin: '0 auto',
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
    color: '#fff',
    margin: 0,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.45)',
    margin: '6px 0 0',
  },
  emptyCard: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px dashed rgba(255,255,255,0.08)',
    borderRadius: 14,
    padding: 40,
    textAlign: 'center',
  },
  emptyText: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 14,
    margin: 0,
    textAlign: 'center',
  },

  // Card grid (mirrors staff Reviews.js)
  reviewGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 16,
  },
  reviewCard: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 12,
    overflow: 'hidden',
    cursor: 'pointer',
    transition: 'border-color 0.15s',
    position: 'relative',
  },
  thumbWrap: {
    position: 'relative',
    width: '100%',
    aspectRatio: '16/9',
    overflow: 'hidden',
    background: '#000',
  },
  thumb: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  playOverlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 48,
    height: 48,
    borderRadius: '50%',
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontSize: 18,
    pointerEvents: 'none',
  },
  thumbPlaceholder: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(255,255,255,0.03)',
    color: 'rgba(255,255,255,0.35)',
    fontSize: 13,
    fontWeight: 500,
  },
  versionBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    padding: '2px 8px',
    borderRadius: 6,
    background: 'rgba(0,0,0,0.7)',
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontWeight: 700,
  },
  reviewCardBody: {
    padding: '12px 14px',
  },
  statusChip: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 6,
    fontSize: 10,
    fontWeight: 700,
    marginBottom: 6,
  },
  statusChipAwaiting: {
    background: colors.accentA12,
    border: `1px solid ${colors.accentA30}`,
    color: colors.accentFg,
  },
  statusChipChanges: {
    background: colors.warning.bg,
    border: `1px solid ${colors.warning.border}`,
    color: colors.warning.fg,
  },
  statusChipApproved: {
    background: colors.success.bg,
    border: `1px solid ${colors.success.border}`,
    color: colors.success.fg,
  },
  reviewCardTitle: {
    fontSize: 15,
    fontWeight: 700,
    color: colors.textBright,
    margin: '0 0 4px',
  },
  reviewCardMeta: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.3)',
  },
};
