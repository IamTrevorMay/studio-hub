import React, { useCallback, useEffect, useState } from 'react';
import { colors } from '../../../lib/styleTokens';
import { supabase } from '../../../supabaseClient';
import { populateReportCard } from './reportCardPopulate';
import { exportReportCardPDF } from './exportReportCardPDF';
import TemplateList from './TemplateList';
import GeneratorPreview from './GeneratorPreview';
import PlayerPanel from './PlayerPanel';

// Generator mode: pick a saved template + a player → populateReportCard
// fills text placeholders / player image / per-element binding props →
// POST the populated Scene to /api/imagine-render → display + export.
//
// Full per-binding data fetch (charts, tables, heatmaps from Triton
// scene-stats) lands when we ship a player-data proxy; today populate
// fills text + player-image only, which is enough for sample exports.

export default function Generator() {
  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [player, setPlayer] = useState({ playerId: null, playerName: '' });
  const [title, setTitle] = useState('');
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [populating, setPopulating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [populatedScene, setPopulatedScene] = useState(null);
  const [previewBlob, setPreviewBlob] = useState(null);

  const refreshTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    setTemplatesError(null);
    try {
      const { data, error } = await supabase
        .from('report_card_templates')
        .select('id, name, description, category, width, height, background, elements, created_at, updated_at')
        .order('updated_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      setTemplates(data || []);
    } catch (err) {
      setTemplatesError(err.message || String(err));
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  useEffect(() => { refreshTemplates(); }, [refreshTemplates]);

  function templateToScene(t) {
    return {
      id: `template-${t.id}`,
      name: t.name || 'Untitled',
      width: t.width,
      height: t.height,
      background: t.background || '#09090b',
      elements: Array.isArray(t.elements) ? t.elements : [],
    };
  }

  const renderScene = useCallback(async (scene) => {
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewBlob(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const res = await fetch('/api/imagine-render', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          widget_id: 'report-card',
          filters: {},
          size: { width: scene.width, height: scene.height, label: 'template' },
          scene,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Render ${res.status}: ${text.slice(0, 300)}`);
      }
      const blob = await res.blob();
      setPreviewBlob(blob);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
    } catch (err) {
      setPreviewError(err.message || String(err));
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  // Auto-render the raw template when picked so user sees something
  // immediately. Populate runs explicitly when they hit the button.
  useEffect(() => {
    if (!selected) {
      setPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
      setPopulatedScene(null);
      return;
    }
    const scene = templateToScene(selected);
    setPopulatedScene(scene);
    renderScene(scene);
  }, [selected, renderScene]);

  async function handlePopulate() {
    if (!selected) return;
    setPopulating(true);
    try {
      const baseScene = templateToScene(selected);
      const data = {
        pitcher_id: player.playerId,
        pitcher_name: player.playerName || '',
        opponent: '',
        game_date: '',
        team: '',
        p_throws: '',
        game_line: {},
        grades: {},
        primary_fastball: {},
        command: {},
        pitch_metrics: [],
        locations_lhb: [],
        locations_rhb: [],
        movement: [],
        season_movement: [],
        usage: [],
      };
      const populated = populateReportCard(baseScene, data, title || selected.name);
      setPopulatedScene(populated);
      await renderScene(populated);
    } finally {
      setPopulating(false);
    }
  }

  async function handleExport() {
    if (!previewBlob || !populatedScene) return;
    setExporting(true);
    setExportError(null);
    try {
      const stem = slugify(populatedScene.name || 'report-card');
      await savePngToDisk(previewBlob, `${stem}.png`);
      await exportReportCardPDF(previewBlob, populatedScene, `${stem}.pdf`);
    } catch (err) {
      setExportError(err.message || String(err));
    } finally {
      setExporting(false);
    }
  }

  async function handleDeleteTemplate(t) {
    if (!window.confirm(`Delete template "${t.name}"? This can't be undone.`)) return;
    const { error } = await supabase
      .from('report_card_templates')
      .delete()
      .eq('id', t.id);
    if (error) {
      setTemplatesError(error.message);
      return;
    }
    if (selected && selected.id === t.id) setSelected(null);
    refreshTemplates();
  }

  return (
    <div style={styles.wrap}>
      <aside style={styles.leftRail}>
        <TemplateList
          templates={templates}
          loading={templatesLoading}
          error={templatesError}
          selectedId={selected ? selected.id : null}
          onSelect={setSelected}
          onRefresh={refreshTemplates}
          onDelete={handleDeleteTemplate}
        />
      </aside>
      <main style={styles.center}>
        <GeneratorPreview
          template={selected}
          scene={populatedScene}
          previewUrl={previewUrl}
          previewLoading={previewLoading}
          previewError={previewError}
        />
      </main>
      <aside style={styles.rightRail}>
        <PlayerPanel
          player={player}
          onPlayerChange={setPlayer}
          title={title}
          onTitleChange={setTitle}
          onPopulate={handlePopulate}
          populating={populating}
          onExport={handleExport}
          exporting={exporting}
          canExport={!!previewBlob && !previewLoading}
          exportError={exportError}
        />
      </aside>
    </div>
  );
}

function slugify(s) {
  return (s || 'report-card')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'report-card';
}

async function savePngToDisk(blob, filename) {
  if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'PNG image', accept: { 'image/png': ['.png'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const styles = {
  wrap: {
    flex: 1,
    display: 'grid',
    gridTemplateColumns: '260px 1fr 320px',
    minHeight: 0,
  },
  leftRail: {
    borderRight: `1px solid ${colors.border}`,
    background: colors.bgRaised,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  center: {
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  rightRail: {
    borderLeft: `1px solid ${colors.border}`,
    background: colors.bgRaised,
    minHeight: 0,
  },
};
