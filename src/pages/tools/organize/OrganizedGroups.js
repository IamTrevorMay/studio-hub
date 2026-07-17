import React from 'react';
import FileGrid from './FileGrid';
import FileList from './FileList';
import { clickableKeyProps } from '../../../lib/styleRecipes';

export default function OrganizedGroups({
  groups,
  metadata,
  onMetaChange,
  onPreview,
  expandedGroups,
  onToggleGroup,
  onMoveBack,
  selectedPaths,
  onToggleSelect,
  modifiedPaths,
  viewMode,
}) {
  if (groups.length === 0) return null;

  return (
    <div style={styles.section}>
      {groups.map(group => {
        const isExpanded = expandedGroups.has(group.key);
        return (
          <div key={group.key} style={styles.group}>
            <div {...clickableKeyProps(() => onToggleGroup(group.key))} style={styles.groupHeader} onClick={() => onToggleGroup(group.key)}>
              <svg
                width="12" height="12" viewBox="0 0 12 12" fill="none"
                stroke="rgba(255,255,255,0.4)" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}
              >
                <path d="M4 2l4 4-4 4" />
              </svg>
              <span style={styles.groupLabel}>
                <span style={styles.groupType}>{group.type}</span>
                <span style={styles.slash}> / </span>
                <span style={styles.groupSubtype}>{group.subtype}</span>
              </span>
              <span style={styles.count}>
                {group.files.length} {group.files.length === 1 ? 'file' : 'files'}
              </span>
            </div>

            {isExpanded && (
              <div style={styles.groupContent}>
                {viewMode === 'grid' ? (
                  <FileGrid
                    files={group.files}
                    metadata={metadata}
                    onMetaChange={onMetaChange}
                    onPreview={onPreview}
                    selectedPaths={selectedPaths}
                    onToggleSelect={onToggleSelect}
                    modifiedPaths={modifiedPaths}
                    onMoveBack={onMoveBack}
                  />
                ) : (
                  <FileList
                    files={group.files}
                    metadata={metadata}
                    onMetaChange={onMetaChange}
                    onPreview={onPreview}
                    selectedPaths={selectedPaths}
                    onToggleSelect={onToggleSelect}
                    modifiedPaths={modifiedPaths}
                    onMoveBack={onMoveBack}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const styles = {
  section: {
    marginBottom: '8px',
  },
  group: {
    marginBottom: '4px',
    borderRadius: '8px',
    overflow: 'hidden',
    border: '1px solid rgba(255,255,255,0.06)',
  },
  groupHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 14px',
    background: 'rgba(255,255,255,0.03)',
    cursor: 'pointer',
    userSelect: 'none',
    transition: 'background 0.12s',
  },
  groupLabel: {
    flex: 1,
    fontSize: '13px',
    fontWeight: 600,
  },
  groupType: {
    color: '#a5b4fc',
  },
  slash: {
    color: 'rgba(255,255,255,0.25)',
  },
  groupSubtype: {
    color: 'rgba(255,255,255,0.7)',
  },
  count: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.35)',
    fontWeight: 500,
  },
  groupContent: {
    padding: '12px 14px',
    background: 'rgba(0,0,0,0.15)',
    borderTop: '1px solid rgba(255,255,255,0.05)',
  },
};
