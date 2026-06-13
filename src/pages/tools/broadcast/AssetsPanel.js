import React, { useEffect, useRef, useState } from 'react';
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
  // Mirror selection in a ref so async post-load handlers can read the
  // latest user choice instead of the value captured at call time.
  const selectedRef = useRef(null);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

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
        onCreated={async (created) => {
          // Capture the selection at dispatch time; if the user has
          // already picked something different by the time load() returns,
          // don't clobber their choice with the freshly-uploaded asset.
          const selBefore = selectedRef.current;
          await load();
          if (selectedRef.current === selBefore) setSelected(created);
        }}
      />
      <AssetProperties
        project={project}
        asset={selected}
        onSaved={async () => {
          const saveTarget = selectedRef.current;
          await load();
          if (!saveTarget) return;
          // Only refresh selection if the user hasn't switched away.
          if (selectedRef.current?.id !== saveTarget.id) return;
          const updated = (await listAssets(project.id)).assets.find((a) => a.id === saveTarget.id);
          if (updated && selectedRef.current?.id === saveTarget.id) setSelected(updated);
        }}
      />
    </div>
  );
}

const styles = {
  wrap: { flex: 1, display: 'flex', minHeight: 0 },
};
