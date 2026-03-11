import React from 'react';
import FileRow from './FileRow';

export default function FileList({ files, metadata, onMetaChange, onPreview }) {
  return (
    <div style={styles.list}>
      {files.map(file => (
        <FileRow
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
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '0 0 24px',
  },
};
