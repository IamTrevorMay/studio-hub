import React, { useState, useEffect, useCallback } from 'react';
import usePersistedTab from '../../hooks/usePersistedTab';
import useCamera from './teleprompter/useCamera';
import MonitorMode from './teleprompter/MonitorMode';
import TeleprompterMode from './teleprompter/TeleprompterMode';
import { loadSettings, saveSettings, loadScript, saveScript } from './teleprompter/teleprompterStorage';

export default function Teleprompter({ onBack }) {
  const [mode, setMode] = usePersistedTab('teleprompter-mode', 'teleprompter', ['teleprompter', 'monitor']); // 'monitor' | 'teleprompter'
  const [settings, setSettings] = useState(loadSettings);
  const [script, setScript] = useState(loadScript);
  const [focusMode, setFocusMode] = useState(false);
  const camera = useCamera();

  // Start camera on mount
  useEffect(() => {
    camera.startStream();
  }, []); // eslint-disable-line

  // Stop camera on unmount
  useEffect(() => {
    return () => camera.stopStream();
  }, []); // eslint-disable-line

  // Persist settings
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  // Persist script
  useEffect(() => {
    saveScript(script);
  }, [script]);

  const handleBack = useCallback(() => {
    camera.stopStream();
    onBack();
  }, [camera, onBack]);

  return (
    <div style={styles.container}>
      {/* Header — hidden in focus mode */}
      {!focusMode && (
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <button onClick={handleBack} style={styles.backBtn} title="Back to Tools">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
            <span style={styles.headerTitle}>Teleprompter</span>
          </div>

          {/* Mode tabs */}
          <div style={styles.tabs}>
            {['monitor', 'teleprompter'].map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  ...styles.tab,
                  ...(mode === m ? styles.tabActive : {}),
                }}
              >
                {m === 'monitor' ? 'Monitor' : 'Teleprompter'}
              </button>
            ))}
          </div>

          {/* Camera selector */}
          <div style={styles.headerRight}>
            {camera.devices.length > 1 && (
              <select
                value={camera.activeDeviceId || ''}
                onChange={e => camera.switchDevice(e.target.value)}
                style={styles.deviceSelect}
              >
                {camera.devices.map(d => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Camera ${d.deviceId.slice(0, 8)}`}
                  </option>
                ))}
              </select>
            )}
            {camera.error && (
              <span style={styles.errorText}>{camera.error}</span>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      {mode === 'monitor' ? (
        <MonitorMode stream={camera.stream} />
      ) : (
        <TeleprompterMode
          stream={camera.stream}
          script={script}
          onScriptChange={setScript}
          settings={settings}
          onSettingsChange={setSettings}
          focusMode={focusMode}
          onFocusModeChange={setFocusMode}
        />
      )}
    </div>
  );
}

const styles = {
  container: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: '#0f0f1a',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 16px',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(15,15,30,0.95)',
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  backBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '34px',
    height: '34px',
    border: 'none',
    borderRadius: '8px',
    background: 'rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.6)',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  headerTitle: {
    fontSize: '16px',
    fontWeight: 700,
    color: '#e2e8f0',
  },
  tabs: {
    display: 'flex',
    gap: '4px',
    background: 'rgba(255,255,255,0.04)',
    borderRadius: '10px',
    padding: '3px',
  },
  tab: {
    padding: '6px 16px',
    border: 'none',
    borderRadius: '8px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.45)',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.15s',
  },
  tabActive: {
    background: 'rgba(99,102,241,0.15)',
    color: '#a5b4fc',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  deviceSelect: {
    padding: '6px 10px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#e2e8f0',
    fontSize: '12px',
    fontFamily: 'inherit',
    outline: 'none',
    maxWidth: '200px',
  },
  errorText: {
    fontSize: '12px',
    color: '#ef4444',
  },
};
