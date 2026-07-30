import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useEffectivePortalIdentity } from '../lib/impersonation';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import { getDisplayName } from '../lib/displayName';
import { colors } from '../lib/styleTokens';
import ReviewPlayer from '../components/reviews/ReviewPlayer';

// Contractor portal — Reviews tab (nav key fl_reviews, editor sub-roles only;
// AppLayout gates who sees the tab). Lists reviews on this contractor's
// client-created assignments with the client's per-version verdicts. Opening
// one renders the shared ReviewPlayer in contractor mode — its own
// "+ New Version" form is the v2/v3 path (insert sets created_by = the
// contractor, which RLS requires).

function latestVerdictOf(review) {
  const versions = (review.versions || []).slice().sort((a, b) => a.version_number - b.version_number);
  const latest = versions[versions.length - 1] || null;
  return { latest, verdict: latest?.client_verdict || null, count: versions.length };
}

export default function ContractorReviews({ initialReviewId, onOpened }) {
  const { profile: realProfile } = useAuth();
  const { profile, supabase } = useEffectivePortalIdentity(realProfile);

  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeReview, setActiveReview] = useState(null);

  // Consume the deep-link prop exactly once per incoming id.
  const openedInitialRef = useRef(null);

  const fetchReviews = useCallback(async () => {
    if (!profile?.id) return;
    try {
      // 1. Own assignments (RLS: contractor_id = self)
      const { data: assigns, error: assignErr } = await supabase
        .from('contractor_assignments')
        .select('id, title, created_by')
        .eq('contractor_id', profile.id);
      if (assignErr) throw assignErr;
      const assignRows = assigns || [];
      if (assignRows.length === 0) {
        setReviews([]);
        return;
      }

      // 2. Reviews on those assignments, versions + verdicts embedded
      const { data: revs, error: revErr } = await supabase
        .from('reviews')
        .select('*, versions:review_versions(id, version_number, label, client_verdict, youtube_video_id, created_at)')
        .in('assignment_id', assignRows.map(a => a.id))
        .order('created_at', { ascending: false });
      if (revErr) throw revErr;

      // 3. Client names — stitched by id (robust vs. FK-hint embeds)
      const clientIds = [...new Set(assignRows.map(a => a.created_by).filter(Boolean))];
      const clientsById = {};
      if (clientIds.length > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, full_name, nickname')
          .in('id', clientIds);
        (profs || []).forEach(p => { clientsById[p.id] = p; });
      }

      const assignById = {};
      assignRows.forEach(a => { assignById[a.id] = a; });

      const enriched = (revs || []).map(r => {
        const assignment = assignById[r.assignment_id] || null;
        const { verdict, count } = latestVerdictOf(r);
        return {
          ...r,
          assignment,
          client: assignment ? (clientsById[assignment.created_by] || null) : null,
          versionCount: count,
          latestVerdict: verdict,
        };
      });
      // Changes-requested cards first — those need the editor's action.
      enriched.sort((a, b) => {
        const aChanges = a.latestVerdict === 'changes_requested' ? 0 : 1;
        const bChanges = b.latestVerdict === 'changes_requested' ? 0 : 1;
        if (aChanges !== bChanges) return aChanges - bChanges;
        return new Date(b.created_at) - new Date(a.created_at);
      });
      setReviews(enriched);
    } catch (err) {
      console.error('ContractorReviews fetch failed:', err);
      setReviews([]);
    } finally {
      setLoading(false);
    }
  }, [profile?.id, supabase]);

  useEffect(() => { fetchReviews(); }, [fetchReviews]);
  useVisibilityRefresh(useCallback(() => { fetchReviews(); }, [fetchReviews]));

  // Deep-link from AppLayout (notification click: fl_review_feedback → review id)
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
        mode="contractor"
      />
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Reviews</h1>
        <p style={styles.subtitle}>
          {reviews.length} review{reviews.length !== 1 ? 's' : ''} with your clients
        </p>
      </div>

      {loading ? (
        <p style={styles.emptyText}>Loading...</p>
      ) : reviews.length === 0 ? (
        <div style={styles.emptyCard}>
          <p style={styles.emptyText}>Reviews from your clients will appear here.</p>
        </div>
      ) : (
        <div style={styles.cardList}>
          {reviews.map(review => {
            const changesRequested = review.latestVerdict === 'changes_requested';
            const approved = review.latestVerdict === 'approved';
            return (
              <div
                key={review.id}
                role="button"
                tabIndex={0}
                style={{
                  ...styles.card,
                  ...(changesRequested ? styles.cardChanges : {}),
                }}
                onClick={() => setActiveReview(review)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveReview(review); }
                }}
              >
                <div style={styles.cardLeft}>
                  <span style={styles.cardTitle}>
                    {review.assignment?.title || review.title}
                  </span>
                  <span style={styles.cardMeta}>
                    {review.client ? `Client: ${getDisplayName(review.client)}` : 'Client review'}
                    {' · '}
                    {review.versionCount} version{review.versionCount !== 1 ? 's' : ''}
                  </span>
                </div>
                <div style={styles.cardRight}>
                  {changesRequested ? (
                    <span style={{ ...styles.verdictChip, ...styles.verdictChipChanges }}>
                      ↻ Client requested changes
                    </span>
                  ) : approved ? (
                    <span style={{ ...styles.verdictChip, ...styles.verdictChipApproved }}>
                      ✓ Approved
                    </span>
                  ) : (
                    <span style={{ ...styles.verdictChip, ...styles.verdictChipWaiting }}>
                      Waiting on client review
                    </span>
                  )}
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
    maxWidth: 800,
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

  // Card list
  cardList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  card: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderLeft: '3px solid transparent',
    borderRadius: 12,
    padding: '16px 20px',
    cursor: 'pointer',
    transition: 'background 0.15s',
  },
  cardChanges: {
    borderLeft: `3px solid ${colors.warning.fg}`,
  },
  cardLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: '#fff',
  },
  cardMeta: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.45)',
  },
  cardRight: {
    flexShrink: 0,
  },
  verdictChip: {
    display: 'inline-block',
    padding: '4px 10px',
    borderRadius: 8,
    fontSize: 11,
    fontWeight: 700,
    whiteSpace: 'nowrap',
  },
  verdictChipChanges: {
    background: colors.warning.bg,
    border: `1px solid ${colors.warning.border}`,
    color: colors.warning.fg,
  },
  verdictChipApproved: {
    background: colors.success.bg,
    border: `1px solid ${colors.success.border}`,
    color: colors.success.fg,
  },
  verdictChipWaiting: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: 'rgba(255,255,255,0.45)',
  },
};
