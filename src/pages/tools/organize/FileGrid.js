import React from 'react';
import FileCard from './FileCard';

export default function FileGrid({ files, metadata, onMetaChange, onPreview }) {
  return (
    <div style={styles.grid}>
      {files.map(file => (
        <FileCard
          key={file.path}
          file={file}
          meta={metadata[file.path] || { title: file.nameNoExt }}
          onMetaChange={meta => onMetaChange(file.path, meta)}
          onPreview={onPreview}
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
