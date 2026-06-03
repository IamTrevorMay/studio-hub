import React, { useCallback, useEffect, useState } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';
import { supabase } from '../../../supabaseClient';
import useSceneHistory from './useSceneHistory';
import { buildDefaultElement } from './elementDefaults';
import BuilderCatalog from './BuilderCatalog';
import BuilderCanvas from './BuilderCanvas';
import BuilderProperties from './BuilderProperties';
import { suggestLayout } from './reportCardLayout';

// Builder mode: design a Report Card Scene and save it to
// public.report_card_templates. The Scene lives in useSceneHistory so
// undo/redo work; the draft is mirrored to localStorage so a page
// refresh doesn't lose work. Save POSTs (or PUTs) to Supabase under the
// caller's auth.uid().

const STORAGE_KEY = 'mayday-report-card-draft';

function createBlankScene() {
  return {
    id: `scene-${Date.now()}`,
    name: 'Untitled Report Card',
    width: 1920,
    height: 1080,
    background: '#09090b',
    elements: [],
  };
}

export default function Builder() {
  const [scene, setScene, { undo, redo, canUndo, canRedo }] = useSceneHistory(createBlankScene());
  const [selectedId, setSelectedId] = useState(null);
  const [templateName, setTemplateName] = useState('Untitled Report Card');
  const [savedId, setSavedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [loaded, setLoaded] = useState(false);

  // Restore draft from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.scene) setScene(parsed.scene);
        if (parsed.savedId) setSavedId(parsed.savedId);
        if (parsed.templateName) setTemplateName(parsed.templateName);
      }
    } catch { /* ignore corrupt draft */ }
    setLoaded(true);
    // eslint-disable-next-line
  }, []);

  // Mirror draft to localStorage
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ scene, savedId, templateName }));
    } catch { /* quota? ignore */ }
  }, [loaded, scene, savedId, templateName]);

  const addElement = useCallback((type) => {
    const el = buildDefaultElement(type);
    setScene((prev) => {
      const maxZ = (prev.elements || []).reduce((m, e) => Math.max(m, e.zIndex || 0), 0);
      return {
        ...prev,
        elements: [...(prev.elements || []), { ...el, zIndex: maxZ + 1 }],
      };
    });
    setSelectedId(el.id);
  }, [setScene]);

  const updateElement = useCallback((id, partial) => {
    setScene((prev) => ({
      ...prev,
      elements: (prev.elements || []).map((e) => e.id === id ? { ...e, ...partial } : e),
    }));
  }, [setScene]);

  const deleteElement = useCallback((id) => {
    setScene((prev) => ({
      ...prev,
      elements: (prev.elements || []).filter((e) => e.id !== id),
    }));
    setSelectedId(null);
  }, [setScene]);

  const updateScene = useCallback((partial) => {
    setScene((prev) => ({ ...prev, ...partial }));
  }, [setScene]);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const payload = {
        user_id: user.id,
        name: templateName,
        width: scene.width,
        height: scene.height,
        background: scene.background,
        elements: scene.elements || [],
      };
      if (savedId) {
        const { error } = await supabase
          .from('report_card_templates')
          .update(payload)
          .eq('id', savedId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('report_card_templates')
          .insert(payload)
          .select('id')
          .single();
        if (error) throw error;
        if (data?.id) setSavedId(data.id);
      }
    } catch (err) {
      setSaveError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  function handleNew() {
    if (!window.confirm('Discard current draft and start a new template?')) return;
    setScene(createBlankScene());
    setSelectedId(null);
    setTemplateName('Untitled Report Card');
    setSavedId(null);
  }

  function handleAutoLayout() {
    setScene((prev) => suggestLayout(prev));
  }

  const selected = (scene.elements || []).find((e) => e.id === selectedId) || null;

  return (
    <div style={styles.wrap}>
      <div style={styles.toolbar}>
        <input
          type="text"
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
          style={styles.nameInput}
          placeholder="Template name"
        />
        <div style={styles.toolbarRight}>
          <button onClick={undo} disabled={!canUndo} style={btn(!canUndo)}>Undo</button>
          <button onClick={redo} disabled={!canRedo} style={btn(!canRedo)}>Redo</button>
          <button onClick={handleAutoLayout} style={btn(false)}>Auto layout</button>
          <button onClick={handleNew} style={btn(false)}>New</button>
          <button onClick={handleSave} disabled={saving} style={btnPrimary(saving)}>
            {saving ? 'Saving…' : (savedId ? 'Update' : 'Save')}
          </button>
        </div>
      </div>
      {saveError && <div style={styles.errBanner}>{saveError}</div>}

      <div style={styles.body}>
        <aside style={styles.leftRail}>
          <BuilderCatalog onAdd={addElement} />
        </aside>
        <main style={styles.center}>
          <BuilderCanvas
            scene={scene}
            selectedId={selectedId}
            onSelectId={setSelectedId}
            onUpdateElement={updateElement}
          />
        </main>
        <aside style={styles.rightRail}>
          <BuilderProperties
            element={selected}
            scene={scene}
            onUpdate={updateElement}
            onDelete={deleteElement}
            onUpdateScene={updateScene}
          />
        </aside>
      </div>
    </div>
  );
}

function btn(disabled) {
  return {
    padding: `${spacing.xs}px ${spacing.md}px`,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.medium,
    color: disabled ? colors.textPlaceholder : colors.text,
    background: 'transparent',
    border: `1px solid ${colors.border}`,
    borderRadius: radii.sm,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit',
    opacity: disabled ? 0.6 : 1,
  };
}
function btnPrimary(disabled) {
  return {
    ...btn(false),
    background: disabled ? colors.bgRaised : colors.accent,
    border: 'none',
    color: colors.text,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  };
}

const styles = {
  wrap: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  },
  toolbar: {
    height: 52,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
    padding: `0 ${spacing.lg}px`,
    borderBottom: `1px solid ${colors.border}`,
    background: colors.bgRaised,
  },
  nameInput: {
    flex: 1,
    maxWidth: 360,
    padding: `${spacing.xs}px ${spacing.md}px`,
    fontSize: fontSizes.sm,
    color: colors.text,
    background: colors.bgInput,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.sm,
    outline: 'none',
    fontFamily: 'inherit',
  },
  toolbarRight: {
    marginLeft: 'auto',
    display: 'flex',
    gap: spacing.xs,
  },
  errBanner: {
    padding: `${spacing.xs}px ${spacing.lg}px`,
    fontSize: fontSizes.xs,
    color: colors.danger?.fg || '#ef4444',
    background: colors.danger?.bg || 'rgba(239,68,68,0.15)',
    borderBottom: `1px solid ${colors.danger?.border || 'rgba(239,68,68,0.35)'}`,
  },
  body: {
    flex: 1,
    display: 'grid',
    gridTemplateColumns: '240px 1fr 320px',
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
