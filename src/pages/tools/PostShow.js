import React, { useState, useEffect, useCallback } from 'react';
import { PHASES, PHASE_COLORS } from './postshow/postShowConstants';
import { loadSession, saveSession, loadRecipients, saveRecipients, loadSettings, saveSettings, loadDiscordTemplates, saveDiscordTemplates } from './postshow/postShowStorage';
import PhaseOne from './postshow/PhaseOne';
import PhaseTwo from './postshow/PhaseTwo';
import PhaseThree from './postshow/PhaseThree';
import PhaseFour from './postshow/PhaseFour';

// ─── Settings Panel ─────────────────────────────────────────────────────
function SettingsPanel({ settings, onSettingsChange, recipients, onRecipientsChange, discordTemplates, onTemplatesChange, onClose }) {
  const [activeTab, setActiveTab] = useState('general');

  function updateRecipient(index, field, value) {
    const next = [...recipients];
    next[index] = { ...next[index], [field]: value };
    onRecipientsChange(next);
  }

  function addRecipient() {
    onRecipientsChange([...recipients, {
      id: crypto.randomUUID(),
      name: '',
      driveFolderPath: '',
      discordChannelId: '',
      discordUserId: '',
    }]);
  }

  function removeRecipient(index) {
    onRecipientsChange(recipients.filter((_, i) => i !== index));
  }

  return (
    <div style={st.settingsOverlay} onClick={onClose}>
      <div style={st.settingsPanel} onClick={e => e.stopPropagation()}>
        <div style={st.settingsHeader}>
          <h3 style={st.settingsTitle}>Post Show Settings</h3>
          <button style={st.closeBtn} onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div style={st.settingsTabs}>
          {[
            { key: 'general', label: 'General' },
            { key: 'recipients', label: 'Recipients' },
            { key: 'templates', label: 'Templates' },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              style={{ ...st.settingsTab, ...(activeTab === t.key ? st.settingsTabActive : {}) }}
            >{t.label}</button>
          ))}
        </div>

        <div style={st.settingsBody}>
          {activeTab === 'general' && (
            <div style={st.fieldGroup}>
              <div style={st.field}>
                <label style={st.fieldLabel}>Local API Base URL</label>
                <input
                  style={st.fieldInput}
                  value={settings.apiBaseUrl}
                  onChange={e => onSettingsChange({ ...settings, apiBaseUrl: e.target.value })}
                  placeholder="http://localhost:4400"
                />
                <span style={st.fieldHint}>The local backend service that handles video cutting, Drive uploads, Discord, and Kanban sync.</span>
              </div>
              <div style={st.field}>
                <label style={st.fieldLabel}>Default Output Format</label>
                <select
                  style={st.fieldSelect}
                  value={settings.defaultOutputFormat}
                  onChange={e => onSettingsChange({ ...settings, defaultOutputFormat: e.target.value })}
                >
                  <option value="mp4">MP4</option>
                  <option value="mov">MOV</option>
                </select>
              </div>
              <div style={st.field}>
                <label style={st.checkLabel}>
                  <input
                    type="checkbox"
                    checked={settings.autoKanbanSync}
                    onChange={e => onSettingsChange({ ...settings, autoKanbanSync: e.target.checked })}
                    style={st.checkbox}
                  />
                  Auto-sync Alana's shorts to Kanban
                </label>
              </div>
            </div>
          )}

          {activeTab === 'recipients' && (
            <div style={st.fieldGroup}>
              {recipients.map((r, i) => (
                <div key={r.id} style={st.recipientCard}>
                  <div style={st.recipientHeader}>
                    <input
                      style={{ ...st.fieldInput, fontWeight: 600 }}
                      value={r.name}
                      onChange={e => updateRecipient(i, 'name', e.target.value)}
                      placeholder="Recipient name"
                    />
                    <button style={st.removeBtn} onClick={() => removeRecipient(i)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <input
                    style={st.fieldInput}
                    value={r.driveFolderPath}
                    onChange={e => updateRecipient(i, 'driveFolderPath', e.target.value)}
                    placeholder="Google Drive folder path (e.g., Editors/Aaron/Shorts)"
                  />
                  <div style={st.recipientRow}>
                    <input
                      style={{ ...st.fieldInput, flex: 1 }}
                      value={r.discordChannelId}
                      onChange={e => updateRecipient(i, 'discordChannelId', e.target.value)}
                      placeholder="Discord Channel ID"
                    />
                    <input
                      style={{ ...st.fieldInput, flex: 1 }}
                      value={r.discordUserId}
                      onChange={e => updateRecipient(i, 'discordUserId', e.target.value)}
                      placeholder="Discord User ID"
                    />
                  </div>
                </div>
              ))}
              <button style={st.addBtn} onClick={addRecipient}>+ Add Recipient</button>
            </div>
          )}

          {activeTab === 'templates' && (
            <div style={st.fieldGroup}>
              <div style={st.field}>
                <label style={st.fieldLabel}>Video Assignment Template</label>
                <textarea
                  style={st.fieldTextarea}
                  value={discordTemplates.video_assignment.template}
                  onChange={e => onTemplatesChange({
                    ...discordTemplates,
                    video_assignment: { ...discordTemplates.video_assignment, template: e.target.value },
                  })}
                  rows={8}
                />
                <span style={st.fieldHint}>
                  Variables: {'{assignee}'}, {'{title}'}, {'{type}'}, {'{timeSensitive}'}, {'{postByDate}'}, {'{showDate}'}, {'{driveLink}'}
                </span>
              </div>
              <div style={st.field}>
                <label style={st.fieldLabel}>Podcast Assignment Template</label>
                <textarea
                  style={st.fieldTextarea}
                  value={discordTemplates.podcast_assignment.template}
                  onChange={e => onTemplatesChange({
                    ...discordTemplates,
                    podcast_assignment: { ...discordTemplates.podcast_assignment, template: e.target.value },
                  })}
                  rows={6}
                />
                <span style={st.fieldHint}>
                  Variables: {'{assignee}'}, {'{title}'}, {'{startTime}'}, {'{endTime}'}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main PostShow Component ────────────────────────────────────────────
export default function PostShow({ onBack }) {
  const [activePhase, setActivePhase] = useState('cut');
  const [session, setSession] = useState(loadSession);
  const [recipients, setRecipients] = useState(loadRecipients);
  const [settings, setSettings] = useState(loadSettings);
  const [discordTemplates, setDiscordTemplates] = useState(loadDiscordTemplates);
  const [showSettings, setShowSettings] = useState(false);

  // Persist on change
  useEffect(() => { saveSession(session); }, [session]);
  useEffect(() => { saveRecipients(recipients); }, [recipients]);
  useEffect(() => { saveSettings(settings); }, [settings]);
  useEffect(() => { saveDiscordTemplates(discordTemplates); }, [discordTemplates]);

  const handleSessionChange = useCallback((newSession) => {
    // Strip non-serializable fields before saving
    const { _sourceObjectUrl, _sourceFile, ...serializable } = newSession;
    setSession(newSession);
    saveSession(serializable);
  }, []);

  function handleNewSession() {
    if (session.clips.length > 0 && !window.confirm('Start a new session? Current clips will be cleared.')) return;
    const fresh = {
      sourceFileName: '',
      sourceFilePath: '',
      showDate: new Date().toISOString().slice(0, 10),
      clips: [],
      podcastAssignments: [],
    };
    setSession(fresh);
    setActivePhase('cut');
  }

  // Count clips at various stages for phase badges
  const totalClips = session.clips?.length || 0;
  const cutClips = (session.clips || []).filter(c => ['cut', 'uploading', 'uploaded', 'notified', 'synced'].includes(c.status)).length;
  const uploadedClips = (session.clips || []).filter(c => ['uploaded', 'notified', 'synced'].includes(c.status)).length;
  const notifiedClips = (session.clips || []).filter(c => ['notified', 'synced'].includes(c.status)).length;
  const syncedClips = (session.clips || []).filter(c => c.status === 'synced').length;

  const phaseCounts = { cut: totalClips, upload: cutClips, notify: uploadedClips, kanban: syncedClips };

  return (
    <div style={st.container}>
      {/* Header */}
      <div style={st.header}>
        <div style={st.headerLeft}>
          <button onClick={onBack} style={st.backBtn} title="Back to Tools">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <span style={st.headerTitle}>Post Show</span>
            {session.sourceFileName && (
              <span style={st.headerFile}>{session.sourceFileName}</span>
            )}
          </div>
        </div>
        <div style={st.headerRight}>
          <button style={st.headerBtn} onClick={handleNewSession} title="New Session">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New
          </button>
          <button style={st.headerBtn} onClick={() => setShowSettings(true)} title="Settings">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
            Settings
          </button>
        </div>
      </div>

      {/* Phase navigation */}
      <div style={st.phaseNav}>
        {PHASES.map((phase, i) => {
          const isActive = activePhase === phase.key;
          const color = PHASE_COLORS[phase.key];
          const count = phaseCounts[phase.key];
          return (
            <React.Fragment key={phase.key}>
              {i > 0 && (
                <div style={st.phaseConnector}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </div>
              )}
              <button
                onClick={() => setActivePhase(phase.key)}
                style={{
                  ...st.phaseBtn,
                  ...(isActive ? { background: color + '15', borderColor: color + '40' } : {}),
                }}
              >
                <div style={st.phaseBtnTop}>
                  <span style={{ ...st.phaseStep, color: isActive ? color : 'rgba(255,255,255,0.3)' }}>
                    {i + 1}
                  </span>
                  <span style={{ ...st.phaseName, color: isActive ? '#e2e8f0' : 'rgba(255,255,255,0.5)' }}>
                    {phase.label}
                  </span>
                  {count > 0 && (
                    <span style={{ ...st.phaseBadge, background: color + '22', color }}>{count}</span>
                  )}
                </div>
                <span style={st.phaseDesc}>{phase.description}</span>
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {/* Phase content */}
      <div style={st.phaseContent}>
        {activePhase === 'cut' && (
          <PhaseOne
            session={session}
            onSessionChange={handleSessionChange}
            recipients={recipients}
            settings={settings}
          />
        )}
        {activePhase === 'upload' && (
          <PhaseTwo
            session={session}
            onSessionChange={handleSessionChange}
            recipients={recipients}
            settings={settings}
          />
        )}
        {activePhase === 'notify' && (
          <PhaseThree
            session={session}
            onSessionChange={handleSessionChange}
            recipients={recipients}
            settings={settings}
            discordTemplates={discordTemplates}
            onTemplatesChange={setDiscordTemplates}
          />
        )}
        {activePhase === 'kanban' && (
          <PhaseFour
            session={session}
            onSessionChange={handleSessionChange}
            recipients={recipients}
            settings={settings}
          />
        )}
      </div>

      {/* Settings panel */}
      {showSettings && (
        <SettingsPanel
          settings={settings}
          onSettingsChange={setSettings}
          recipients={recipients}
          onRecipientsChange={setRecipients}
          discordTemplates={discordTemplates}
          onTemplatesChange={setDiscordTemplates}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────
const st = {
  container: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '100vh' },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '16px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: '12px' },
  headerRight: { display: 'flex', alignItems: 'center', gap: '8px' },
  backBtn: {
    padding: '6px', background: 'none', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px', color: 'rgba(255,255,255,0.5)', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: '18px', fontWeight: 700, color: '#e2e8f0' },
  headerFile: {
    fontSize: '12px', color: 'rgba(255,255,255,0.35)', marginLeft: '12px',
    padding: '2px 8px', background: 'rgba(255,255,255,0.04)',
    borderRadius: '4px', fontFamily: 'monospace',
  },
  headerBtn: {
    display: 'flex', alignItems: 'center', gap: '6px',
    padding: '6px 12px', fontSize: '12px', fontWeight: 600,
    color: 'rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px',
    cursor: 'pointer', fontFamily: 'inherit',
  },

  // Phase navigation
  phaseNav: {
    display: 'flex', alignItems: 'center', gap: '4px',
    padding: '16px 24px', overflowX: 'auto',
  },
  phaseBtn: {
    flex: 1, minWidth: '140px', padding: '12px 14px',
    background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '10px', cursor: 'pointer', textAlign: 'left',
    fontFamily: 'inherit', transition: 'all 0.15s',
  },
  phaseBtnTop: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' },
  phaseStep: { fontSize: '12px', fontWeight: 700 },
  phaseName: { fontSize: '13px', fontWeight: 700 },
  phaseBadge: { fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '4px', marginLeft: 'auto' },
  phaseDesc: { fontSize: '11px', color: 'rgba(255,255,255,0.3)', lineHeight: 1.3 },
  phaseConnector: { display: 'flex', alignItems: 'center', flexShrink: 0 },

  // Phase content
  phaseContent: { flex: 1, padding: '24px', overflow: 'auto' },

  // Settings panel
  settingsOverlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
    display: 'flex', justifyContent: 'flex-end', zIndex: 1000,
  },
  settingsPanel: {
    width: '480px', maxWidth: '90vw', height: '100%',
    background: '#12121f', borderLeft: '1px solid rgba(255,255,255,0.08)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  settingsHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  settingsTitle: { fontSize: '16px', fontWeight: 700, color: '#e2e8f0', margin: 0 },
  closeBtn: {
    padding: '4px', background: 'none', border: 'none',
    color: 'rgba(255,255,255,0.4)', cursor: 'pointer', display: 'flex',
  },
  settingsTabs: {
    display: 'flex', gap: '4px', padding: '12px 24px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  settingsTab: {
    padding: '6px 12px', fontSize: '12px', fontWeight: 600,
    color: 'rgba(255,255,255,0.4)', background: 'none', border: 'none',
    borderRadius: '6px', cursor: 'pointer', fontFamily: 'inherit',
  },
  settingsTabActive: { color: '#e2e8f0', background: 'rgba(255,255,255,0.06)' },
  settingsBody: { flex: 1, padding: '20px 24px', overflow: 'auto' },
  fieldGroup: { display: 'flex', flexDirection: 'column', gap: '16px' },
  field: { display: 'flex', flexDirection: 'column', gap: '6px' },
  fieldLabel: { fontSize: '12px', fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  fieldInput: {
    padding: '8px 12px', fontSize: '13px', color: '#e2e8f0',
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px', outline: 'none', fontFamily: 'inherit', width: '100%',
    boxSizing: 'border-box',
  },
  fieldSelect: {
    padding: '8px 12px', fontSize: '13px', color: '#e2e8f0',
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px', outline: 'none', fontFamily: 'inherit', cursor: 'pointer',
  },
  fieldTextarea: {
    padding: '10px 12px', fontSize: '13px', color: '#e2e8f0',
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px', outline: 'none', fontFamily: 'monospace', resize: 'vertical',
    width: '100%', boxSizing: 'border-box',
  },
  fieldHint: { fontSize: '11px', color: 'rgba(255,255,255,0.25)', lineHeight: 1.4 },
  checkLabel: {
    display: 'flex', alignItems: 'center', gap: '8px',
    fontSize: '13px', color: 'rgba(255,255,255,0.5)', cursor: 'pointer',
  },
  checkbox: { accentColor: '#6366f1' },
  recipientCard: {
    display: 'flex', flexDirection: 'column', gap: '8px',
    padding: '14px', background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px',
  },
  recipientHeader: { display: 'flex', alignItems: 'center', gap: '8px' },
  recipientRow: { display: 'flex', gap: '8px' },
  removeBtn: {
    padding: '4px', background: 'none', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px', color: '#ef4444', cursor: 'pointer', display: 'flex',
    alignItems: 'center', justifyContent: 'center', opacity: 0.6, flexShrink: 0,
  },
  addBtn: {
    padding: '8px 16px', fontSize: '13px', fontWeight: 600, color: '#6366f1',
    background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)',
    borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit', alignSelf: 'flex-start',
  },
};
