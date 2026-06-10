import React, { useEffect, useState } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights, shadows, zIndex } from '../../../lib/styleTokens';

// Modal UI for connecting to a local OBS Studio instance. Lets the user
// pick scene + start/stop streaming. Connection state lives in useObs.

export default function OBSSettings({ obs, onClose }) {
  const [sceneList, setSceneList] = useState([]);
  const [streamStatus, setStreamStatus] = useState(null);

  useEffect(() => {
    if (obs.status !== 'connected') return;
    let active = true;
    (async () => {
      try {
        const [scenes, stream] = await Promise.all([
          obs.call('GetSceneList'),
          obs.call('GetStreamStatus').catch(() => null),
        ]);
        if (!active) return;
        setSceneList(scenes.scenes || []);
        setStreamStatus(stream);
      } catch { /* ignore */ }
    })();
    return () => { active = false; };
  }, [obs.status, obs]);

  async function setScene(name) {
    try { await obs.call('SetCurrentProgramScene', { sceneName: name }); }
    catch (e) { window.alert(`Set scene failed: ${e.message}`); }
  }
  async function toggleStream() {
    try { await obs.call('ToggleStream'); }
    catch (e) { window.alert(`Toggle stream failed: ${e.message}`); }
  }

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.title}>OBS WebSocket</div>

        <Field label="WebSocket URL">
          <input value={obs.config.url} onChange={(e) => obs.updateConfig({ url: e.target.value })} style={styles.input} />
        </Field>
        <Field label="Password (optional)">
          <input type="password" value={obs.config.password || ''}
            onChange={(e) => obs.updateConfig({ password: e.target.value })}
            style={styles.input} />
        </Field>

        <div style={styles.statusRow}>
          <span style={statusStyle(obs.status)}>{obs.status}</span>
          {obs.error && <span style={styles.errorTxt}>{obs.error}</span>}
        </div>

        <div style={styles.actions}>
          {obs.status === 'connected' ? (
            <button onClick={obs.disconnect} style={styles.disconnect}>Disconnect</button>
          ) : (
            <button onClick={obs.connect} style={styles.connect}>Connect</button>
          )}
          <button onClick={onClose} style={styles.cancel}>Close</button>
        </div>

        {obs.status === 'connected' && (
          <>
            <div style={styles.heading}>Scenes</div>
            <div style={styles.scenes}>
              {sceneList.length === 0
                ? <div style={styles.empty}>No scenes returned.</div>
                : sceneList.map((s) => (
                  <button key={s.sceneName} onClick={() => setScene(s.sceneName)} style={styles.sceneBtn}>
                    {s.sceneName}
                  </button>
                ))}
            </div>

            <div style={styles.heading}>Stream</div>
            <div style={styles.streamRow}>
              <span style={styles.streamState}>
                {streamStatus && streamStatus.outputActive ? 'LIVE' : 'idle'}
              </span>
              <button onClick={toggleStream} style={styles.streamBtn}>Toggle stream</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.xs }}>
      <div style={{ fontSize: fontSizes.xs, color: colors.textMuted, fontWeight: fontWeights.medium }}>{label}</div>
      {children}
    </div>
  );
}

function statusStyle(s) {
  const base = { fontSize: fontSizes.xs, fontWeight: fontWeights.semibold, textTransform: 'uppercase', letterSpacing: '0.06em' };
  if (s === 'connected') return { ...base, color: colors.success.fg };
  if (s === 'connecting') return { ...base, color: colors.warning.fg };
  if (s === 'error') return { ...base, color: colors.danger.fg };
  return { ...base, color: colors.textMuted };
}

const styles = {
  backdrop: { position: 'fixed', inset: 0, background: colors.bgOverlay, zIndex: zIndex.modal, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal: {
    width: '90%', maxWidth: 480,
    background: colors.bgModal, border: `1px solid ${colors.border}`,
    borderRadius: radii.lg, boxShadow: shadows.modal,
    padding: spacing.xxl, display: 'flex', flexDirection: 'column', gap: spacing.md,
  },
  title: { fontSize: fontSizes.lg, fontWeight: fontWeights.semibold, color: colors.text },
  input: {
    padding: `${spacing.sm}px ${spacing.md}px`, background: colors.bgInput,
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    color: colors.text, fontSize: fontSizes.sm, fontFamily: 'inherit', outline: 'none',
  },
  statusRow: { display: 'flex', alignItems: 'center', gap: spacing.sm },
  errorTxt: { fontSize: fontSizes.xs, color: colors.danger.fg },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: spacing.sm },
  connect: {
    padding: `${spacing.sm}px ${spacing.lg}px`, background: colors.accent,
    color: '#fff', border: 'none', borderRadius: radii.sm, cursor: 'pointer',
    fontSize: fontSizes.sm, fontWeight: fontWeights.medium, fontFamily: 'inherit',
  },
  disconnect: {
    padding: `${spacing.sm}px ${spacing.lg}px`, background: 'transparent',
    border: `1px solid ${colors.danger.border}`, borderRadius: radii.sm,
    color: colors.danger.fg, cursor: 'pointer', fontSize: fontSizes.sm, fontFamily: 'inherit',
  },
  cancel: {
    padding: `${spacing.sm}px ${spacing.lg}px`, background: 'transparent',
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    color: colors.textMuted, cursor: 'pointer', fontSize: fontSizes.sm, fontFamily: 'inherit',
  },
  heading: { fontSize: fontSizes.xs, fontWeight: fontWeights.bold, color: colors.textSubtle, letterSpacing: '0.08em', textTransform: 'uppercase', borderBottom: `1px solid ${colors.border}`, paddingBottom: spacing.xs, marginTop: spacing.sm },
  scenes: { display: 'flex', flexWrap: 'wrap', gap: spacing.xs },
  sceneBtn: {
    padding: `${spacing.xs}px ${spacing.sm}px`, background: colors.bgInput,
    border: `1px solid ${colors.border}`, borderRadius: radii.sm,
    color: colors.text, fontSize: fontSizes.xs, cursor: 'pointer', fontFamily: 'inherit',
  },
  empty: { fontSize: fontSizes.xs, color: colors.textSubtle },
  streamRow: { display: 'flex', alignItems: 'center', gap: spacing.sm },
  streamState: { fontSize: fontSizes.xs, color: colors.text, padding: `${spacing.xs}px ${spacing.sm}px`, background: colors.bgInput, borderRadius: radii.sm, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: fontWeights.bold },
  streamBtn: {
    padding: `${spacing.xs}px ${spacing.md}px`, background: colors.danger.fg,
    color: '#fff', border: 'none', borderRadius: radii.sm, cursor: 'pointer',
    fontSize: fontSizes.xs, fontFamily: 'inherit',
  },
};
