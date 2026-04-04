import React from 'react';

export default function SubscribeConfig({ draft, onUpdate }) {
  return (
    <div>
      <label style={styles.fieldLabel}>Headline</label>
      <input
        style={styles.input}
        value={draft.subscribe_headline || ''}
        onChange={e => onUpdate({ subscribe_headline: e.target.value })}
        placeholder={draft.name || 'Subscribe to this report'}
      />
      <div style={styles.hint}>Defaults to report name if empty</div>

      <label style={styles.fieldLabel}>Description</label>
      <textarea
        style={styles.textarea}
        value={draft.subscribe_description || ''}
        onChange={e => onUpdate({ subscribe_description: e.target.value })}
        placeholder={draft.description || 'Get this report delivered to your inbox.'}
        rows={2}
      />

      <label style={styles.fieldLabel}>Accent Color</label>
      <div style={styles.colorRow}>
        <input
          type="color"
          value={draft.subscribe_accent_color || '#6366f1'}
          onChange={e => onUpdate({ subscribe_accent_color: e.target.value })}
          style={styles.colorPicker}
        />
        <input
          style={{ ...styles.input, flex: 1 }}
          value={draft.subscribe_accent_color || ''}
          onChange={e => onUpdate({ subscribe_accent_color: e.target.value })}
          placeholder="#6366f1"
        />
      </div>
      <div style={styles.hint}>Used for the header gradient on the subscribe page</div>

      <label style={styles.fieldLabel}>Logo URL (optional)</label>
      <input
        style={styles.input}
        value={draft.subscribe_logo_url || ''}
        onChange={e => onUpdate({ subscribe_logo_url: e.target.value })}
        placeholder="https://example.com/logo.png"
      />
      {draft.subscribe_logo_url && (
        <div style={styles.logoPreview}>
          <img
            src={draft.subscribe_logo_url}
            alt="Logo preview"
            style={styles.logoImg}
            onError={e => { e.target.style.display = 'none'; }}
          />
        </div>
      )}
    </div>
  );
}

const styles = {
  fieldLabel: {
    display: 'block',
    fontSize: '12px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: '6px',
    marginTop: '12px',
  },
  input: {
    width: '100%',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '6px',
    color: '#ffffff',
    fontSize: '13px',
    padding: '8px 12px',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  textarea: {
    width: '100%',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '6px',
    color: '#ffffff',
    fontSize: '13px',
    padding: '8px 12px',
    fontFamily: 'inherit',
    resize: 'vertical',
    boxSizing: 'border-box',
  },
  hint: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.2)',
    marginTop: '4px',
  },
  colorRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  colorPicker: {
    width: '36px',
    height: '36px',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    padding: 0,
    background: 'transparent',
  },
  logoPreview: {
    marginTop: '8px',
  },
  logoImg: {
    maxHeight: '40px',
    maxWidth: '120px',
    borderRadius: '6px',
  },
};
