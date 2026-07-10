import React, { useState, useRef, useEffect } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../lib/styleTokens';
import { button, input } from '../lib/styleRecipes';
import { getDisplayName } from '../lib/displayName';

// Shared comment thread for agency <-> team communication. Used on the
// admin Deliverables page and the agency portal. The parent owns the
// comment data (so it can compute unresolved dots across rows) and passes
// it in; this component only renders the thread and posts new comments.
export default function AgencyThread({ comments = [], onPost, emptyText = 'No comments yet.' }) {
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [comments.length]);

  async function handleSubmit(e) {
    e.preventDefault();
    const text = body.trim();
    if (!text || posting) return;
    setPosting(true);
    try {
      await onPost(text);
      setBody('');
    } finally {
      setPosting(false);
    }
  }

  return (
    <div style={styles.wrap}>
      <div ref={listRef} style={styles.list}>
        {comments.length === 0 && <div style={styles.empty}>{emptyText}</div>}
        {comments.map((c) => {
          const isAgency = c.author_role === 'agency';
          return (
            <div key={c.id} style={styles.comment}>
              <div style={styles.commentMeta}>
                <span style={styles.commentAuthor}>{getDisplayName(c.author) || 'Unknown'}</span>
                <span style={isAgency ? styles.roleChipAgency : styles.roleChipTeam}>
                  {isAgency ? 'Agency' : 'Mayday'}
                </span>
                <span style={styles.commentTime}>
                  {new Date(c.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
              </div>
              <div style={styles.commentBody}>{c.body}</div>
            </div>
          );
        })}
      </div>
      <form onSubmit={handleSubmit} style={styles.composer}>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e); }
          }}
          placeholder="Write a reply…"
          rows={2}
          style={styles.textarea}
        />
        <button type="submit" disabled={posting || !body.trim()} style={button({ variant: 'primary', size: 'sm', disabled: posting || !body.trim() })}>
          {posting ? 'Posting…' : 'Post'}
        </button>
      </form>
    </div>
  );
}

const styles = {
  wrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.md,
    minHeight: 0,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.md,
    maxHeight: 320,
    overflowY: 'auto',
    paddingRight: spacing.xs,
  },
  empty: {
    color: colors.textDim,
    fontSize: fontSizes.sm,
    padding: `${spacing.sm}px 0`,
  },
  comment: {
    background: colors.bgRaised,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  commentMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  commentAuthor: {
    color: colors.text,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
  },
  roleChipAgency: {
    background: colors.warning.bg,
    border: `1px solid ${colors.warning.border}`,
    color: colors.warning.fgSoft,
    borderRadius: radii.pill,
    padding: `1px ${spacing.sm}px`,
    fontSize: fontSizes.xxs,
    fontWeight: fontWeights.semibold,
    letterSpacing: 0.3,
  },
  roleChipTeam: {
    background: colors.accentSoft,
    border: `1px solid ${colors.accentBorder}`,
    color: colors.accentFg,
    borderRadius: radii.pill,
    padding: `1px ${spacing.sm}px`,
    fontSize: fontSizes.xxs,
    fontWeight: fontWeights.semibold,
    letterSpacing: 0.3,
  },
  commentTime: {
    color: colors.textDim,
    fontSize: fontSizes.xs,
    marginLeft: 'auto',
  },
  commentBody: {
    color: colors.textMuted,
    fontSize: fontSizes.md,
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  composer: {
    display: 'flex',
    gap: spacing.sm,
    alignItems: 'flex-end',
  },
  textarea: {
    ...input(),
    flex: 1,
    resize: 'vertical',
    minHeight: 44,
    fontFamily: 'inherit',
  },
};
