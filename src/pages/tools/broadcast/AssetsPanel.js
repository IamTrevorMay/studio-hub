import React, { useEffect, useState } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';
import { listAssets, deleteAsset } from './api';
import AssetLibrary from './AssetLibrary';
import AssetProperties from './AssetProperties';

// Two-pane asset manager — list (with upload button) on the left,
// per-asset property editor on the right.

export default function AssetsPanel({ project }) {
  const [assets, setAssets] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true); setError(null);
    try { const res = await listAssets(project.id); setAssets(res.assets || []); }
    catch (e) { setError(e.message); }
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [project.id]);

  async function handleDelete(a) {
    if (!window.confirm(`Delete asset "${a.name}"?`)) return;
    try {
      await deleteAsset(a.id);
      if (selected && selected.id === a.id) setSelected(null);
      await load();
    } catch (e) { setError(e.message); }
  }

  return (
    <div style={styles.wrap}>
      <AssetLibrary
        project={project}
        assets={assets}
        selectedId={selected && selected.id}
        loading={loading}
        error={error}
        onSelect={setSelected}
        onDelete={handleDelete}
        onUploaded={load}
        onCreated={async (created) => { await load(); setSelected(created); }}
      />
      <AssetProperties
        project={project}
        asset={selected}
        onSaved={async () => {
          await load();
          if (selected) {
            const updated = (await listAssets(project.id)).assets.find((a) => a.id === selected.id);
            if (updated) setSelected(updated);
          }
        }}
      />
    </div>
  );
}

const styles = {
  wrap: { flex: 1, display: 'flex', minHeight: 0 },
};
