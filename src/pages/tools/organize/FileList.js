import React from 'react';
import FileRow from './FileRow';

export default function FileList({ files, metadata, onMetaChange, onPreview, selectedPaths, onToggleSelect, modifiedPaths, onMoveBack }) {
  return (
    <div style={styles.list}>
      {files.map(file => (
        <FileRow
          key={file.path}
          file={file}
          meta={metadata[file.path] || { title: file.nameNoExt }}
          onMetaChange={meta => onMetaChange(file.path, meta)}
          onPreview={onPreview}
          selected={selectedPaths?.has(file.path) ?? false}
          onToggleSelect={() => onToggleSelect?.(file.path)}
          modified={modifiedPaths?.has(file.path) ?? false}
          onMoveBack={onMoveBack ? () => onMoveBack(file) : undefined}
        />
      ))}
    </div>
  );
}

const styles = {
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '0 0 24px',
  },
};
