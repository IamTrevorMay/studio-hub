import React, { useState } from 'react';
import { supabase } from '../../../supabaseClient';
import backdropDismiss from '../../../lib/backdropDismiss';
import { colors } from '../../../lib/styleTokens';

export default function AddBriefModal({ task, onSubmit, onClose }) {
  const [mode, setMode] = useState('upload');
  const [file, setFile] = useState(null);
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);

  // Workflow tasks carry the campaign in context; one-off (direct) tasks carry
  // it as the related entity.
  const campaignId = task.workflow_instance?.context?.campaign_id
    || (task.related_entity_type === 'campaign' ? task.related_entity_id : null);
  const brandName = task.workflow_instance?.context?.brand_name || '';

  const canSubmit = mode === 'upload' ? !!file : !!url.trim();

  const handleSave = async () => {
    if (!campaignId) { alert('No campaign linked to this workflow'); return; }
    if (!canSubmit) return;
    setSaving(true);
    try {
      let briefUrl, briefName;

      if (mode === 'upload') {
        const filePath = `${campaignId}/${Date.now()}_${file.name}`;
        const { error: uploadError } = await supabase.storage.from('campaign-briefs').upload(filePath, file);
        if (uploadError) { alert('Upload failed: ' + uploadError.message); setSaving(false); return; }
        const { data: urlData } = supabase.storage.from('campaign-briefs').getPublicUrl(filePath);
        briefUrl = urlData.publicUrl;
        briefName = file.name;
      } else {
        briefUrl = url.trim();
        briefName = label.trim();
        if (!briefName) {
          try { briefName = new URL(briefUrl).hostname.replace(/^www\./, ''); } catch { briefName = 'Brief'; }
        }
      }

      await supabase.from('sponsor_campaigns').update({
        brief_url: briefUrl,
        brief_name: briefName,
      }).eq('id', campaignId);

      await onSubmit({ campaign_id: campaignId, brief_url: briefUrl, brief_name: briefName });
    } finally {
      setSaving(false);
    }
  };

  const modeBtn = (m) => ({
    flex: 1, padding: '6px 8px', borderRadius: 6,
    fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
    textTransform: 'capitalize', border: '1px solid',
    background: mode === m ? 'rgba(91, 143, 199,0.2)' : 'transparent',
    color: mode === m ? '#8fb4d8' : 'rgba(255,255,255,0.35)',
    borderColor: mode === m ? 'rgba(91, 143, 199,0.4)' : 'rgba(255,255,255,0.08)',
  });

  return (
    <div style={styles.overlay} {...backdropDismiss(onClose)}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div>
            <div style={styles.title}>Add Brief</div>
            <div style={styles.subtitle}>
              Attach the creative brief for {brandName || 'this campaign'}.
            </div>
          </div>
          <button style={styles.closeBtn} onClick={onClose}>{'\u2715'}</button>
        </div>

        <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
          <button type="button" onClick={() => setMode('upload')} style={modeBtn('upload')}>Upload</button>
          <button type="button" onClick={() => setMode('link')} style={modeBtn('link')}>Link</button>
        </div>

        {mode === 'upload' ? (
          <div>
            <label style={styles.label}>File</label>
            <input
              type="file"
              accept=".pdf,.docx,.doc"
              onChange={(e) => setFile(e.target.files[0] || null)}
              style={{ ...styles.input, padding: '6px 8px' }}
            />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={styles.label}>URL</label>
              <input
                autoFocus
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://docs.google.com/..."
                style={styles.input}
                onKeyDown={(e) => { if (e.key === 'Enter' && url.trim()) handleSave(); }}
              />
            </div>
            <div>
              <label style={styles.label}>Label (optional)</label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. AG1 Brief"
                style={styles.input}
                onKeyDown={(e) => { if (e.key === 'Enter' && url.trim()) handleSave(); }}
              />
            </div>
          </div>
        )}

        <div style={styles.footer}>
          <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button
            style={{ ...styles.submitBtn, opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? 'pointer' : 'not-allowed' }}
            onClick={handleSave}
            disabled={!canSubmit || saving}
          >
            {saving ? 'Saving\u2026' : 'Save Brief'}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  modal: {
    background: colors.bgRaised, border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 16, padding: 20, width: 440, maxWidth: '90vw',
    boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16,
  },
  title: { fontSize: 18, fontWeight: 700, color: '#fff' },
  subtitle: { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 2 },
  closeBtn: {
    background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)',
    fontSize: 16, cursor: 'pointer', padding: 4,
  },
  label: {
    display: 'block', fontSize: 11, color: 'rgba(255,255,255,0.5)',
    marginBottom: 4, fontWeight: 600,
  },
  input: {
    width: '100%', boxSizing: 'border-box', padding: '8px 12px',
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8, color: '#fff', fontSize: 13, outline: 'none',
  },
  footer: {
    display: 'flex', justifyContent: 'flex-end', gap: 8,
    paddingTop: 16, marginTop: 16, borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  cancelBtn: {
    padding: '8px 16px', borderRadius: 8, background: 'transparent',
    border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.7)',
    cursor: 'pointer', fontSize: 13,
  },
  submitBtn: {
    padding: '8px 18px', borderRadius: 8, background: colors.accent,
    border: 'none', color: '#fff', fontWeight: 600, fontSize: 13,
  },
};
