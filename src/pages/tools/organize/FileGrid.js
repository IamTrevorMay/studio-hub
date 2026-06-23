import React from 'react';
import FileCard from './FileCard';

export default function FileGrid({ files, metadata, onMetaChange, onPreview, selectedPaths, onToggleSelect, modifiedPaths, onMoveBack, aiConfidence, confThreshold }) {
  return (
    <div style={styles.grid}>
      {files.map(file => (
        <FileCard
          key={file.path}
          file={file}
          meta={metadata[file.path] || { title: file.nameNoExt }}
          onMetaChange={meta => onMetaChange(file.path, meta)}
          onPreview={onPreview}
          selected={selectedPaths?.has(file.path) ?? false}
          onToggleSelect={() => onToggleSelect?.(file.path)}
          modified={modifiedPaths?.has(file.path) ?? false}
          onMoveBack={onMoveBack ? () => onMoveBack(file) : undefined}
          aiConf={aiConfidence?.[file.path]}
          confThreshold={confThreshold}
        />
      ))}
    </div>
  );
}

const styles = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: '16px',
    padding: '0 0 24px',
  },
};
