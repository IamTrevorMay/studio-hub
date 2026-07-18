import React from 'react';
import { colors } from '../../../lib/styleTokens';

export default function OrganizeToolbar({
  fileCount,
  completeCount,
  viewMode,
  onViewModeChange,
  onOrganize,
  onRevert,
  hasBackup,
  organizing,
  onAutoTag,
  autoTagging,
  autoTagProgress,
  canAutoTag,
}) {
  return (
    <div style={styles.toolbar}>
      <div style={styles.stats}>
        <span style={styles.statText}>{fileCount} files</span>
        <span style={styles.statDivider}>|</span>
        <span style={{
          ...styles.statText,
          color: completeCount === fileCount && fileCount > 0 ? '#34d399' : 'rgba(255,255,255,0.5)',
        }}>
          {completeCount} ready
        </span>
      </div>

      <div style={styles.actions}>
        <div style={styles.viewToggle}>
          <button
            onClick={() => onViewModeChange('grid')}
            style={{
              ...styles.viewBtn,
              ...(viewMode === 'grid' ? styles.viewBtnActive : {}),
            }}
            title="Grid view"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <rect x="1" y="1" width="6" height="6" rx="1" />
              <rect x="9" y="1" width="6" height="6" rx="1" />
              <rect x="1" y="9" width="6" height="6" rx="1" />
              <rect x="9" y="9" width="6" height="6" rx="1" />
            </svg>
          </button>
          <button
            onClick={() => onViewModeChange('list')}
            style={{
              ...styles.viewBtn,
              ...(viewMode === 'list' ? styles.viewBtnActive : {}),
            }}
            title="List view"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <rect x="1" y="2" width="14" height="2" rx="0.5" />
              <rect x="1" y="7" width="14" height="2" rx="0.5" />
              <rect x="1" y="12" width="14" height="2" rx="0.5" />
            </svg>
          </button>
        </div>

        {onAutoTag && (
          <button
            onClick={onAutoTag}
            style={{
              ...styles.autoTagBtn,
              opacity: (!canAutoTag && !autoTagging) || organizing ? 0.5 : 1,
              cursor: autoTagging || organizing || !canAutoTag ? 'default' : 'pointer',
            }}
            disabled={autoTagging || organizing || !canAutoTag}
            title="Suggest labels with AI"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2l1.9 5.1L19 9l-5.1 1.9L12 16l-1.9-5.1L5 9l5.1-1.9L12 2zM19 14l.9 2.6L22 17l-2.1.4L19 20l-.9-2.6L16 17l2.1-.4L19 14z" />
            </svg>
            {autoTagging
              ? (autoTagProgress ? `Tagging ${autoTagProgress.done}/${autoTagProgress.total}...` : 'Tagging...')
              : 'Auto-tag'}
          </button>
        )}
        {hasBackup && (
          <button onClick={onRevert} style={styles.revertBtn} disabled={organizing}>
            Revert
          </button>
        )}
        <button
          onClick={onOrganize}
          style={{
            ...styles.organizeBtn,
            opacity: completeCount === 0 || organizing ? 0.5 : 1,
          }}
          disabled={completeCount === 0 || organizing}
        >
          {organizing ? 'Organizing...' : 'Organize'}
        </button>
      </div>
    </div>
  );
}

const styles = {
  toolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 0',
    marginBottom: '8px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  stats: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  statText: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.5)',
  },
  statDivider: {
    color: 'rgba(255,255,255,0.15)',
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  viewToggle: {
    display: 'flex',
    background: 'rgba(255,255,255,0.04)',
    borderRadius: '8px',
    overflow: 'hidden',
  },
  viewBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    border: 'none',
    background: 'transparent',
    color: 'rgba(255,255,255,0.3)',
    cursor: 'pointer',
  },
  viewBtnActive: {
    background: colors.accentA15,
    color: colors.accentFg,
  },
  autoTagBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 14px',
    background: 'rgba(168,85,247,0.1)',
    border: '1px solid rgba(168,85,247,0.3)',
    borderRadius: '8px',
    color: '#d8b4fe',
    fontSize: '13px',
    fontWeight: 600,
    fontFamily: 'inherit',
  },
  revertBtn: {
    padding: '6px 14px',
    background: 'rgba(239,68,68,0.1)',
    border: '1px solid rgba(239,68,68,0.25)',
    borderRadius: '8px',
    color: '#fca5a5',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  organizeBtn: {
    padding: '6px 18px',
    background: 'linear-gradient(135deg, #5b8fc7, #8fb4d8)',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
};
