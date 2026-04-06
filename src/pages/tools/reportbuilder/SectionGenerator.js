import React, { useState, useCallback } from 'react';
import { supabase } from '../../../supabaseClient';

// Inline generator: user describes a new section → Claude returns spec + preview.
// User names it, clicks save, we insert into report_sections and call onSaved(section).

export default function SectionGenerator({ onSaved, onPreview }) {
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [spec, setSpec] = useState(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const handleGenerate = useCallback(async () => {
    if (!description.trim() || loading) return;
    setLoading(true);
    setErr('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setErr('Not authenticated'); return; }
      const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
      const resp = await fetch(`${supabaseUrl}/functions/v1/generate-section`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: process.env.REACT_APP_SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ description }),
      });
      const result = await resp.json();
      if (result.error) {
        setErr(result.error);
      } else {
        setSpec(result.spec);
        setPreviewHtml(result.preview_html || '');
        setName(result.spec?.name || '');
        onPreview?.(result.preview_html || '');
      }
    } catch (e) {
      setErr(e.message || 'Generation failed');
    } finally {
      setLoading(false);
    }
  }, [description, loading, onPreview]);

  const handleSave = useCallback(async () => {
    if (!spec || !name.trim() || saving) return;
    setSaving(true);
    setErr('');
    try {
      const { data, error } = await supabase
        .from('report_sections')
        .insert({
          name: name.trim(),
          description: spec.description || '',
          kind: spec.kind || 'custom',
          data_source: spec.data_source,
          prompt_template: spec.prompt_template || '',
          render_template: spec.render_template || '',
        })
        .select('*')
        .single();
      if (error) { setErr(error.message); return; }
      onSaved?.(data);
      // Reset form
      setDescription('');
      setSpec(null);
      setPreviewHtml('');
      setName('');
    } catch (e) {
      setErr(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [spec, name, saving, onSaved]);

  const handleDiscard = useCallback(() => {
    setSpec(null);
    setPreviewHtml('');
    setName('');
    setErr('');
  }, []);

  return (
    <div style={styles.container}>
      <div style={styles.label}>Generate a new section</div>

      {!spec ? (
        <>
          <textarea
            style={styles.textarea}
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="e.g. Top 5 newsletters from the last 24 hours with a one-line summary each"
            rows={3}
            disabled={loading}
          />
          <button
            onClick={handleGenerate}
            disabled={!description.trim() || loading}
            style={{
              ...styles.generateBtn,
              ...(!description.trim() || loading ? styles.btnDisabled : {}),
            }}
          >
            {loading ? 'Designing section…' : 'Generate'}
          </button>
        </>
      ) : (
        <>
          <label style={styles.fieldLabel}>Section name</label>
          <input
            style={styles.input}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Section name"
          />
          {spec.description && <div style={styles.specDesc}>{spec.description}</div>}
          <div style={styles.specMeta}>
            <span style={styles.sourceBadge}>{spec.data_source?.type || 'unknown'}</span>
          </div>
          <div style={styles.btnRow}>
            <button onClick={handleDiscard} style={styles.discardBtn} disabled={saving}>Discard</button>
            <button
              onClick={handleSave}
              disabled={!name.trim() || saving}
              style={{
                ...styles.saveBtn,
                ...(!name.trim() || saving ? styles.btnDisabled : {}),
              }}
            >
              {saving ? 'Saving…' : 'Save to Library'}
            </button>
          </div>
        </>
      )}

      {err && <div style={styles.errorText}>{err}</div>}
    </div>
  );
}

const styles = {
  container: {
    padding: '12px',
    background: 'rgba(99,102,241,0.05)',
    border: '1px solid rgba(99,102,241,0.15)',
    borderRadius: '8px',
  },
  label: {
    fontSize: '11px',
    fontWeight: 700,
    color: '#a5b4fc',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '8px',
  },
  textarea: {
    width: '100%',
    background: 'rgba(0,0,0,0.2)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '6px',
    color: '#ffffff',
    fontSize: '13px',
    padding: '8px 10px',
    fontFamily: 'inherit',
    resize: 'vertical',
    boxSizing: 'border-box',
    marginBottom: '8px',
  },
  input: {
    width: '100%',
    background: 'rgba(0,0,0,0.2)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '6px',
    color: '#ffffff',
    fontSize: '13px',
    padding: '8px 10px',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    marginBottom: '8px',
  },
  fieldLabel: {
    display: 'block',
    fontSize: '11px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: '4px',
  },
  specDesc: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.55)',
    lineHeight: 1.5,
    marginBottom: '8px',
  },
  specMeta: {
    marginBottom: '10px',
  },
  sourceBadge: {
    fontSize: '10px',
    fontWeight: 700,
    color: '#a5b4fc',
    background: 'rgba(99,102,241,0.15)',
    padding: '3px 8px',
    borderRadius: '3px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  generateBtn: {
    width: '100%',
    background: '#6366f1',
    border: 'none',
    borderRadius: '6px',
    color: '#ffffff',
    fontSize: '13px',
    fontWeight: 600,
    fontFamily: 'inherit',
    padding: '8px 14px',
    cursor: 'pointer',
  },
  btnRow: {
    display: 'flex',
    gap: '8px',
  },
  discardBtn: {
    flex: 1,
    background: 'none',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '12px',
    fontFamily: 'inherit',
    padding: '8px 14px',
    cursor: 'pointer',
  },
  saveBtn: {
    flex: 2,
    background: '#22c55e',
    border: 'none',
    borderRadius: '6px',
    color: '#ffffff',
    fontSize: '12px',
    fontWeight: 600,
    fontFamily: 'inherit',
    padding: '8px 14px',
    cursor: 'pointer',
  },
  btnDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
  errorText: {
    fontSize: '11px',
    color: '#ef4444',
    marginTop: '8px',
  },
};
