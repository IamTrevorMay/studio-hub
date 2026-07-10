import React, { useState, useRef, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { colors, spacing, radii, fontSizes, fontWeights } from '../lib/styleTokens';
import { button, input } from '../lib/styleRecipes';
import { getDisplayName } from '../lib/displayName';

// Shared comment thread for agency <-> team communication. Used on the
// admin Deliverables page and the agency portal. The parent owns the
// comment data (so it can compute unresolved dots across rows) and passes
// it in; this component renders the thread and posts new comments.
// Admin-tier users can right-click a message to delete any / edit their
// own (RLS enforces the same server-side); agency users get no menu.
export default function AgencyThread({ comments = [], onPost, onRefresh, emptyText = 'No comments yet.' }) {
  const { profile, isAdmin } = useAuth();
  const confirm = useConfirm();
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, comment }
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState('');
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

  async function handleDelete(comment) {
    setCtxMenu(null);
    if (!(await confirm('Delete this message? The agency will no longer see it.'))) return;
    const { error } = await supabase.from('agency_comments').delete().eq('id', comment.id);
    if (error) {
      alert('Could not delete the message: ' + error.message);
      return;
    }
    onRefresh?.();
  }

  function startEdit(comment) {
    setCtxMenu(null);
    setEditingId(comment.id);
    setEditDraft(comment.body);
  }

  async function commitEdit(comment) {
    const text = editDraft.trim();
    setEditingId(null);
    setEditDraft('');
    if (!text || text === comment.body) return;
    const { error } = await supabase.from('agency_comments').update({
      body: text,
      edited_at: new Date().toISOString(),
    }).eq('id', comment.id);
    if (error) {
      alert('Could not save the edit: ' + error.message);
      return;
    }
    onRefresh?.();
  }

  return (
    <div style={styles.wrap}>
      <div ref={listRef} style={styles.list}>
        {comments.length === 0 && <div style={styles.empty}>{emptyText}</div>}
        {comments.map((c) => {
          const isAgency = c.author_role === 'agency';
          return (
            <div
              key={c.id}
              style={styles.comment}
              onContextMenu={isAdmin ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                setCtxMenu({ x: e.clientX, y: e.clientY, comment: c });
              } : undefined}
            >
              <div style={styles.commentMeta}>
                <span style={styles.commentAuthor}>{getDisplayName(c.author) || 'Unknown'}</span>
                <span style={isAgency ? styles.roleChipAgency : styles.roleChipTeam}>
                  {isAgency ? 'Agency' : 'Mayday'}
                </span>
                <span style={styles.commentTime}>
                  {new Date(c.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  {c.edited_at && <span style={styles.editedTag}> (edited)</span>}
                </span>
              </div>
              {editingId === c.id ? (
                <div style={styles.editWrap}>
                  <textarea
                    autoFocus
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(c); }
                      if (e.key === 'Escape') { setEditingId(null); setEditDraft(''); }
                    }}
                    rows={3}
                    style={styles.textarea}
                  />
                  <div style={styles.editActions}>
                    <button onClick={() => commitEdit(c)} style={button({ variant: 'primary', size: 'sm' })}>Save</button>
                    <button onClick={() => { setEditingId(null); setEditDraft(''); }} style={button({ variant: 'ghost', size: 'sm' })}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={styles.commentBody}>{c.body}</div>
              )}
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

      {ctxMenu && (
        <>
          <div
            style={styles.ctxOverlay}
            onClick={() => setCtxMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }}
          />
          <div style={{ ...styles.ctxMenu, top: ctxMenu.y, left: ctxMenu.x }}>
            {ctxMenu.comment.author_id === profile?.id && (
              <button style={styles.ctxItem} onClick={() => startEdit(ctxMenu.comment)}>
                Edit
              </button>
            )}
            <button
              style={{ ...styles.ctxItem, color: colors.danger.fgSoft }}
              onClick={() => handleDelete(ctxMenu.comment)}
            >
              Delete
            </button>
          </div>
        </>
      )}
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
  editedTag: {
    color: colors.textDim,
    fontStyle: 'italic',
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
  editWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.sm,
  },
  editActions: {
    display: 'flex',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  ctxOverlay: { position: 'fixed', inset: 0, zIndex: 10000 },
  ctxMenu: {
    position: 'fixed',
    zIndex: 10001,
    background: '#1e1e32',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: radii.md,
    padding: 4,
    minWidth: 140,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  },
  ctxItem: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: 'none',
    border: 'none',
    borderRadius: radii.sm,
    padding: `${spacing.sm}px ${spacing.md}px`,
    color: colors.text,
    fontSize: fontSizes.sm,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
};
