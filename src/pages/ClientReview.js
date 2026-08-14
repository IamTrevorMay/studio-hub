import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../supabaseClient';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import { getDisplayName } from '../lib/displayName';
import { colors } from '../lib/styleTokens';
import ReviewPlayer from '../components/reviews/ReviewPlayer';

// Client portal — Review tab. Lists the cuts editors submitted on this client's
// assignments plus any review the studio shared directly with this client
// (review_client_shares). Opening a card renders the shared
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

// Sample cuts for the admin "View as… Client Portal (simulated)" preview.
// A real client login runs the RLS-scoped queries below; the sim has no client
// data, so opening the Review tab would otherwise be empty. These use public
// YouTube ids so the shared ReviewPlayer renders a real video (demo mode skips
// every DB read/write — see ReviewPlayer's `demo` branch).
function buildDemoReviews() {
  const iso = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString();
  };
  const v = (id, n, label, verdict, videoId, comments) => ({
    id, version_number: n, label, client_verdict: verdict,
    youtube_video_id: videoId, youtube_url: `https://youtu.be/${videoId}`,
    created_at: iso(-n), demoComments: comments || [],
  });
  return [
    {
      id: 'demo-r1', title: 'Podcast Ep. 42 — Edit', created_at: iso(-3),
      assignment: { title: 'Podcast Ep. 42 — Edit' }, editor: { full_name: 'Jordan Lee' },
      versionCount: 2, latestVerdict: null, thumbVideoId: 'aqz-KE-bpKQ',
      demoVersions: [
        v('demo-r1-v1', 1, 'v1', 'changes_requested', 'aqz-KE-bpKQ'),
        v('demo-r1-v2', 2, 'v2', null, 'aqz-KE-bpKQ', [
          { id: 'demo-c1', version_id: 'demo-r1-v2', timestamp_seconds: 42, content: 'Tighten this transition a touch.', commenter: { full_name: 'You' }, is_resolved: false, replies: [] },
          { id: 'demo-c2', version_id: 'demo-r1-v2', timestamp_seconds: 128, content: 'Love the intro music choice here.', commenter: { full_name: 'You' }, is_resolved: false, replies: [] },
        ]),
      ],
    },
    {
      id: 'demo-r2', title: 'YouTube Long-Form Cut', created_at: iso(-1),
      assignment: { title: 'YouTube Long-Form Cut' }, editor: { full_name: 'Jordan Lee' },
      versionCount: 1, latestVerdict: null, thumbVideoId: 'ScMzIvxBSi4',
      demoVersions: [v('demo-r2-v1', 1, 'v1', null, 'ScMzIvxBSi4')],
    },
    {
      id: 'demo-r3', title: 'Instagram Reel Pack', created_at: iso(-6),
      assignment: { title: 'Instagram Reel Pack' }, editor: { full_name: 'Sam Rivera' },
      versionCount: 1, latestVerdict: 'approved', thumbVideoId: 'ysz5S6PUM-U',
      demoVersions: [v('demo-r3-v1', 1, 'v1', 'approved', 'ysz5S6PUM-U')],
    },
  ];
}

export default function ClientReview({ initialReviewId, onOpened, demo = false }) {
  const { profile } = useAuth();

  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeReview, setActiveReview] = useState(null);

  // Consume the deep-link prop exactly once per incoming id.
  const openedInitialRef = useRef(null);

  const fetchReviews = useCallback(async () => {
    if (demo) {
      setReviews(buildDemoReviews());
      setLoading(false);
      return;
    }
    if (!profile?.id) return;
    try {
      // 1. Two sources: reviews on this client's own assignments (RLS:
      //    created_by = self) and reviews staff shared straight to this client
      //    (review_client_shares — those may have no assignment at all).
      const [assignRes, shareRes] = await Promise.all([
        supabase.from('contractor_assignments')
          .select('id, title, contractor_id')
          .eq('created_by', profile.id),
        supabase.from('review_client_shares')
          .select('review_id')
          .eq('client_id', profile.id),
      ]);
      if (assignRes.error) throw assignRes.error;
      if (shareRes.error) throw shareRes.error;
      const assignRows = assignRes.data || [];
      const sharedIds = [...new Set((shareRes.data || []).map(r => r.review_id))];
      if (assignRows.length === 0 && sharedIds.length === 0) {
        setReviews([]);
        return;
      }

      // 2. Reviews from both sources, with their versions embedded. Kept as two
      //    queries and merged by id — a shared review can also be an assignment
      //    review, and .or() across an embed-bearing select is fragile.
      const cols = '*, versions:review_versions(id, version_number, label, client_verdict, youtube_video_id, created_at)';
      const queries = [];
      if (assignRows.length > 0) {
        queries.push(supabase.from('reviews').select(cols).in('assignment_id', assignRows.map(a => a.id)));
      }
      if (sharedIds.length > 0) {
        queries.push(supabase.from('reviews').select(cols).in('id', sharedIds));
      }
      const results = await Promise.all(queries);
      const failed = results.find(r => r.error);
      if (failed) throw failed.error;
      const revsById = {};
      results.forEach(res => (res.data || []).forEach(row => { revsById[row.id] = row; }));
      const revs = Object.values(revsById)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      // 3. Names — stitched by id (robust vs. FK-hint embeds). Assignment
      //    reviews credit the editor; shared reviews credit the studio member
      //    who made the review.
      const peopleIds = [...new Set([
        ...assignRows.map(a => a.contractor_id),
        ...revs.filter(r => !r.assignment_id).map(r => r.created_by),
      ].filter(Boolean))];
      const peopleById = {};
      if (peopleIds.length > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, full_name, nickname')
          .in('id', peopleIds);
        (profs || []).forEach(p => { peopleById[p.id] = p; });
      }

      const assignById = {};
      assignRows.forEach(a => { assignById[a.id] = a; });

      const enriched = revs.map(r => {
        const assignment = assignById[r.assignment_id] || null;
        const versions = (r.versions || []).slice().sort((a, b) => a.version_number - b.version_number);
        const latest = versions[versions.length - 1] || null;
        return {
          ...r,
          assignment,
          editor: assignment ? (peopleById[assignment.contractor_id] || null) : null,
          sharedBy: assignment ? null : (peopleById[r.created_by] || null),
          isShared: !assignment,
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
  }, [profile?.id, demo]);

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
        demo={demo}
      />
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Review</h1>
        <p style={styles.subtitle}>
          {reviews.length} cut{reviews.length !== 1 ? 's' : ''} from your editors and the studio
        </p>
      </div>

      {loading ? (
        <p style={styles.emptyText}>Loading...</p>
      ) : reviews.length === 0 ? (
        <div style={styles.emptyCard}>
          <p style={styles.emptyText}>
            No cuts to review yet — your editor or the studio will share review links here.
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
                    {review.editor
                      ? `Edited by ${getDisplayName(review.editor)}`
                      : review.isShared
                        ? `Shared by ${review.sharedBy ? getDisplayName(review.sharedBy) : 'Mayday Studio'}`
                        : 'Your editor'}
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
