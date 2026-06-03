import React, { useRef, useState } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';
import { createAsset } from './api';
import { uploadAssetTus, inferAssetType } from './tusUpload';

// Left pane of AssetsPanel. Sortable list of project assets + an upload
// area on top. Drop a file or click to browse — upload streams via tus
// directly to Supabase Storage (resumable, supports 5 GB / file).

const TYPE_ICONS = {
  image: 'IMG',
  video: 'VID',
  audio: 'SND',
  widget: 'WID',
  slideshow: 'SLD',
  template: 'TPL',
  file: 'FILE',
};

export default function AssetLibrary({ project, assets, selectedId, loading, error, onSelect, onDelete, onUploaded, onCreated }) {
  const inputRef = useRef();
  const [uploads, setUploads] = useState([]); // { id, name, sent, total, error? }
  const [draggingOver, setDraggingOver] = useState(false);
  const [createMode, setCreateMode] = useState(null); // 'widget' | 'slideshow' | 'template'
  const [createName, setCreateName] = useState('');

  async function handleFiles(files) {
    if (!files || files.length === 0) return;
    const fresh = [];
    for (const file of files) {
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      fresh.push({ id, name: file.name, sent: 0, total: file.size });
      runOneUpload(id, file);
    }
    setUploads((prev) => [...fresh, ...prev]);
  }

  async function runOneUpload(id, file) {
    try {
      const result = await uploadAssetTus({
        projectId: project.id,
        file,
        onProgress: (sent, total) => {
          setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, sent, total } : u)));
        },
      });
      // Persist the asset row now that the storage object exists.
      const inserted = await createAsset({
        project_id: project.id,
        name: file.name,
        asset_type: inferAssetType(file),
        storage_path: result.storage_path,
      });
      setUploads((prev) => prev.filter((u) => u.id !== id));
      if (onCreated) onCreated(inserted.asset);
      else if (onUploaded) onUploaded();
    } catch (e) {
      setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, error: e.message } : u)));
    }
  }

  async function createNonFileAsset(asset_type) {
    if (!createName.trim()) return;
    try {
      const inserted = await createAsset({
        project_id: project.id,
        name: createName.trim(),
        asset_type,
        sort_order: assets.length,
      });
      setCreateName('');
      setCreateMode(null);
      if (onCreated) onCreated(inserted.asset);
      else if (onUploaded) onUploaded();
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(e.message);
    }
  }

  return (
    <div style={styles.wrap}>
      <div
        style={{ ...styles.dropZone, ...(draggingOver ? styles.dropZoneActive : {}) }}
        onDragOver={(e) => { e.preventDefault(); setDraggingOver(true); }}
        onDragLeave={() => setDraggingOver(false)}
        onDrop={(e) => {
          e.preventDefault(); setDraggingOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current && inputRef.current.click()}
      >
        <input
          ref={inputRef} type="file" multiple style={{ display: 'none' }}
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
        />
        <div style={styles.dropTitle}>Drop files to upload</div>
        <div style={styles.dropHint}>or click. tus-resumable, up to 5 GB per file.</div>
      </div>

      {uploads.length > 0 && (
        <div style={styles.uploadList}>
          {uploads.map((u) => (
            <div key={u.id} style={styles.uploadRow}>
              <div style={styles.uploadName} title={u.name}>{u.name}</div>
              {u.error ? (
                <div style={styles.uploadErr}>{u.error}</div>
              ) : (
                <div style={styles.progressTrack}>
                  <div style={{
                    ...styles.progressFill,
                    width: u.total ? `${Math.min(100, (u.sent / u.total) * 100)}%` : '0%',
                  }} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={styles.createRow}>
        {['widget', 'slideshow', 'template'].map((kind) => (
          <button key={kind} onClick={() => setCreateMode(kind)} style={styles.createBtn}>
            + {kind}
          </button>
        ))}
      </div>
      {createMode && (
        <div style={styles.createForm}>
          <input
            placeholder={`${createMode} name`}
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            style={styles.input} autoFocus
          />
          <button onClick={() => createNonFileAsset(createMode)} style={styles.primaryBtn}>Create</button>
          <button onClick={() => { setCreateMode(null); setCreateName(''); }} style={styles.cancelBtn}>Cancel</button>
        </div>
      )}

      {error && <div style={styles.error}>{error}</div>}
      <div style={styles.list}>
        {loading ? (
          <div style={styles.empty}>Loading…</div>
        ) : assets.length === 0 ? (
          <div style={styles.empty}>No assets yet.</div>
        ) : (
          assets.map((a) => (
            <div
              key={a.id} onClick={() => onSelect(a)}
              style={{ ...styles.assetRow, ...(selectedId === a.id ? styles.assetRowActive : {}) }}
            >
              <span style={styles.typeBadge}>{TYPE_ICONS[a.asset_type] || (a.asset_type || '?').slice(0, 3).toUpperCase()}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={styles.assetName}>{a.name}</div>
                <div style={styles.assetMeta}>
                  layer {a.layer}{a.hotkey_key ? ` · ${a.hotkey_key}` : ''}
                </div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); onDelete(a); }} style={styles.deleteBtn} title="Delete">×</button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    width: 320, flexShrink: 0, overflow: 'auto',
    padding: spacing.md, borderRight: `1px solid ${colors.border}`,
    background: colors.bgRaised,
    display: 'flex', flexDirection: 'column', gap: spacing.sm,
  },
  dropZone: {
    padding: spacing.lg, border: `2px dashed ${colors.border}`,
    borderRadius: radii.md, textAlign: 'center', cursor: 'pointer',
    color: colors.textMuted, background: colors.bgInput,
  },
  dropZoneActive: { borderColor: colors.accent, background: colors.accentSoft, color: colors.accentFg },
  dropTitle: { fontSize: fontSizes.sm, fontWeight: fontWeights.semibold },
  dropHint: { fontSize: fontSizes.xxs, color: colors.textSubtle, marginTop: spacing.xs },
  uploadList: { display: 'flex', flexDirection: 'column', gap: spacing.xs },
  uploadRow: { padding: spacing.xs, background: colors.bgInput, borderRadius: radii.sm },
  uploadName: { fontSize: fontSizes.xs, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  uploadErr: { fontSize: fontSizes.xxs, color: colors.danger.fg, marginTop: 2 },
  progressTrack: { height: 4, marginTop: 4, background: colors.border, borderRadius: 2 },
  progressFill: { height: '100%', background: colors.accent, borderRadius: 2, transition: 'width 120ms ease-out' },
  createRow: { display: 'flex', gap: spacing.xs },
  createBtn: {
    flex: 1, padding: `${spacing.xs}px 0`, background: 'transparent',
    border: `1px solid ${colors.border}`, color: colors.textMuted,
    borderRadius: radii.sm, fontSize: fontSizes.xxs, cursor: 'pointer', fontFamily: 'inherit',
  },
  createForm: { display: 'flex', gap: spacing.xs },
  input: {
    flex: 1, padding: `${spacing.xs}px ${spacing.sm}px`, background: colors.bgInput,
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    color: colors.text, fontSize: fontSizes.sm, fontFamily: 'inherit', outline: 'none',
  },
  primaryBtn: {
    padding: `${spacing.xs}px ${spacing.sm}px`, background: colors.accent,
    color: '#fff', border: 'none', borderRadius: radii.sm, cursor: 'pointer',
    fontSize: fontSizes.xs, fontFamily: 'inherit',
  },
  cancelBtn: {
    padding: `${spacing.xs}px ${spacing.sm}px`, background: 'transparent',
    border: `1px solid ${colors.border}`, color: colors.textMuted,
    borderRadius: radii.sm, fontSize: fontSizes.xs, cursor: 'pointer', fontFamily: 'inherit',
  },
  error: { padding: spacing.sm, background: colors.danger.bg, color: colors.danger.fg, border: `1px solid ${colors.danger.border}`, borderRadius: radii.sm, fontSize: fontSizes.xxs },
  empty: { padding: spacing.xxl, textAlign: 'center', color: colors.textSubtle, fontSize: fontSizes.sm },
  list: { display: 'flex', flexDirection: 'column', gap: 4 },
  assetRow: {
    padding: spacing.xs, background: colors.bgInput,
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: spacing.sm,
  },
  assetRowActive: { background: colors.accentSoft, borderColor: colors.accentBorder },
  typeBadge: {
    padding: `2px 6px`, fontSize: 9, fontWeight: fontWeights.bold,
    color: colors.accentFg, background: colors.accentSoft, border: `1px solid ${colors.accentBorder}`,
    borderRadius: radii.xs,
  },
  assetName: { fontSize: fontSizes.sm, color: colors.text, fontWeight: fontWeights.medium, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  assetMeta: { fontSize: fontSizes.xxs, color: colors.textSubtle },
  deleteBtn: {
    width: 22, height: 22, borderRadius: radii.sm,
    background: 'transparent', border: `1px solid ${colors.border}`,
    color: colors.textMuted, cursor: 'pointer', fontSize: 12,
  },
};
