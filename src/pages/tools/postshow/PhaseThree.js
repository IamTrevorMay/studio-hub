import React, { useState } from 'react';
import { createPodcastAssignment, STATUS_COLORS, STATUS_LABELS } from './postShowConstants';

function fillTemplate(template, data) {
  return template.replace(/\{(\w+)\}/g, (_, key) => data[key] ?? '');
}

export default function PhaseThree({ session, onSessionChange, recipients, settings, discordTemplates, onTemplatesChange }) {
  const [sending, setSending] = useState(false);
  const [previewMsg, setPreviewMsg] = useState(null);
  const [activeTab, setActiveTab] = useState('video'); // 'video' | 'podcast'

  const uploadedClips = (session.clips || []).filter(c => c.status === 'uploaded' || c.status === 'notified');
  const podcastAssignments = session.podcastAssignments || [];

  // ── Podcast assignments CRUD ──
  function addPodcastAssignment() {
    onSessionChange({
      ...session,
      podcastAssignments: [...podcastAssignments, createPodcastAssignment()],
    });
  }

  function updatePodcastAssignment(index, updated) {
    const next = [...podcastAssignments];
    next[index] = updated;
    onSessionChange({ ...session, podcastAssignments: next });
  }

  function removePodcastAssignment(index) {
    onSessionChange({
      ...session,
      podcastAssignments: podcastAssignments.filter((_, i) => i !== index),
    });
  }

  // ── Preview message ──
  function previewVideoMessage(clip) {
    const recipient = recipients.find(r => r.id === clip.assignee);
    const msg = fillTemplate(discordTemplates.video_assignment.template, {
      assignee: recipient?.name || clip.assignee,
      title: clip.title,
      type: clip.type === 'short' ? 'Short' : 'Long',
      timeSensitive: clip.timeSensitive ? 'Yes' : 'No',
      postByDate: clip.postByDate || 'N/A',
      showDate: clip.showDate || '',
      driveLink: clip.driveLink || '(pending)',
    });
    setPreviewMsg({ type: 'video', clipId: clip.id, message: msg, recipient });
  }

  function previewPodcastMessage(pa, index) {
    const recipient = recipients.find(r => r.id === pa.assignee);
    const msg = fillTemplate(discordTemplates.podcast_assignment.template, {
      assignee: recipient?.name || pa.assignee,
      title: pa.title,
      startTime: pa.startTime,
      endTime: pa.endTime,
    });
    setPreviewMsg({ type: 'podcast', index, message: msg, recipient });
  }

  // ── Send notification ──
  async function handleSend() {
    if (!previewMsg) return;
    setSending(true);
    try {
      const resp = await fetch(`${settings.apiBaseUrl}/api/discord/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: previewMsg.recipient?.discordChannelId || '',
          userId: previewMsg.recipient?.discordUserId || '',
          message: previewMsg.message,
        }),
      });
      if (!resp.ok) throw new Error(await resp.text() || 'Send failed');

      // Update status
      if (previewMsg.type === 'video') {
        const allClips = session.clips.map(c =>
          c.id === previewMsg.clipId ? { ...c, status: 'notified' } : c
        );
        onSessionChange({ ...session, clips: allClips });
      } else {
        const next = [...podcastAssignments];
        next[previewMsg.index] = { ...next[previewMsg.index], status: 'notified' };
        onSessionChange({ ...session, podcastAssignments: next });
      }
      setPreviewMsg(null);
    } catch (err) {
      alert(`Notification failed: ${err.message}`);
    } finally {
      setSending(false);
    }
  }

  // ── Batch send all ──
  async function handleBatchNotify() {
    const toNotify = uploadedClips.filter(c => c.status === 'uploaded' && c.assignee);
    if (toNotify.length === 0) return;
    setSending(true);
    try {
      for (const clip of toNotify) {
        const recipient = recipients.find(r => r.id === clip.assignee);
        const msg = fillTemplate(discordTemplates.video_assignment.template, {
          assignee: recipient?.name || clip.assignee,
          title: clip.title,
          type: clip.type === 'short' ? 'Short' : 'Long',
          timeSensitive: clip.timeSensitive ? 'Yes' : 'No',
          postByDate: clip.postByDate || 'N/A',
          showDate: clip.showDate || '',
          driveLink: clip.driveLink || '(pending)',
        });
        await fetch(`${settings.apiBaseUrl}/api/discord/notify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channelId: recipient?.discordChannelId || '',
            userId: recipient?.discordUserId || '',
            message: msg,
          }),
        });
      }
      const allClips = session.clips.map(c =>
        toNotify.find(n => n.id === c.id) ? { ...c, status: 'notified' } : c
      );
      onSessionChange({ ...session, clips: allClips });
    } catch (err) {
      alert(`Batch notify failed: ${err.message}`);
    } finally {
      setSending(false);
    }
  }

  const notifiableCount = uploadedClips.filter(c => c.status === 'uploaded' && c.assignee).length;

  return (
    <div style={st.phase}>
      {/* Tabs */}
      <div style={st.tabs}>
        {[{ key: 'video', label: 'Video Assignments' }, { key: 'podcast', label: 'Podcast Assignments' }].map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{ ...st.tab, ...(activeTab === t.key ? st.tabActive : {}) }}
          >{t.label}</button>
        ))}
      </div>

      {/* Video assignments */}
      {activeTab === 'video' && (
        <div style={st.section}>
          {uploadedClips.length === 0 ? (
            <div style={st.emptyState}>
              <p style={st.emptyText}>No uploaded clips yet. Complete Phase 2 to upload clips first.</p>
            </div>
          ) : (
            <>
              <div style={st.list}>
                {uploadedClips.map(clip => {
                  const recipient = recipients.find(r => r.id === clip.assignee);
                  return (
                    <div key={clip.id} style={st.row}>
                      <div style={st.rowInfo}>
                        <span style={st.rowTitle}>{clip.title}</span>
                        <span style={st.rowMeta}>{recipient?.name || 'Unassigned'} &middot; {clip.type}</span>
                      </div>
                      <span style={{ ...st.badge, background: STATUS_COLORS[clip.status] + '22', color: STATUS_COLORS[clip.status] }}>
                        {STATUS_LABELS[clip.status]}
                      </span>
                      {clip.status === 'uploaded' && (
                        <button style={st.sendBtn} onClick={() => previewVideoMessage(clip)}>Preview & Send</button>
                      )}
                    </div>
                  );
                })}
              </div>
              {notifiableCount > 0 && (
                <div style={st.actionBar}>
                  <button
                    style={{ ...st.primaryBtn, ...(sending ? st.disabledBtn : {}) }}
                    onClick={handleBatchNotify}
                    disabled={sending}
                  >
                    {sending ? 'Sending...' : `Notify All (${notifiableCount})`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Podcast assignments */}
      {activeTab === 'podcast' && (
        <div style={st.section}>
          <div style={st.sectionHeader}>
            <h4 style={st.sectionTitle}>Podcast Clips</h4>
            <button style={st.addBtn} onClick={addPodcastAssignment}>+ Add</button>
          </div>
          {podcastAssignments.length === 0 ? (
            <div style={st.emptyState}>
              <p style={st.emptyText}>No podcast assignments. Add clips with title and timestamps.</p>
            </div>
          ) : (
            <div style={st.list}>
              {podcastAssignments.map((pa, i) => (
                <div key={pa.id} style={st.podcastRow}>
                  <div style={st.podcastFields}>
                    <input
                      style={{ ...st.input, flex: 2 }}
                      placeholder="Podcast clip title"
                      value={pa.title}
                      onChange={e => updatePodcastAssignment(i, { ...pa, title: e.target.value })}
                    />
                    <input
                      style={{ ...st.input, width: '90px', fontFamily: 'monospace' }}
                      placeholder="HH:MM:SS"
                      value={pa.startTime}
                      onChange={e => updatePodcastAssignment(i, { ...pa, startTime: e.target.value })}
                    />
                    <span style={st.dash}>—</span>
                    <input
                      style={{ ...st.input, width: '90px', fontFamily: 'monospace' }}
                      placeholder="HH:MM:SS"
                      value={pa.endTime}
                      onChange={e => updatePodcastAssignment(i, { ...pa, endTime: e.target.value })}
                    />
                    <select
                      style={st.select}
                      value={pa.assignee}
                      onChange={e => updatePodcastAssignment(i, { ...pa, assignee: e.target.value })}
                    >
                      <option value="">Assign...</option>
                      {recipients.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>
                  <div style={st.podcastActions}>
                    {pa.title && pa.assignee && pa.status !== 'notified' && (
                      <button style={st.sendBtn} onClick={() => previewPodcastMessage(pa, i)}>Preview</button>
                    )}
                    {pa.status === 'notified' && (
                      <span style={{ ...st.badge, background: STATUS_COLORS.notified + '22', color: STATUS_COLORS.notified }}>Sent</span>
                    )}
                    <button style={st.removeBtn} onClick={() => removePodcastAssignment(i)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Message preview modal */}
      {previewMsg && (
        <div style={st.overlay} onClick={() => setPreviewMsg(null)}>
          <div style={st.modal} onClick={e => e.stopPropagation()}>
            <h3 style={st.modalTitle}>Message Preview</h3>
            <p style={st.modalMeta}>
              To: {previewMsg.recipient?.name || 'Unknown'} &middot; Channel: {previewMsg.recipient?.discordChannelId || 'Not configured'}
            </p>
            <textarea
              style={st.messageArea}
              value={previewMsg.message}
              onChange={e => setPreviewMsg({ ...previewMsg, message: e.target.value })}
              rows={10}
            />
            <div style={st.modalActions}>
              <button style={st.cancelBtn} onClick={() => setPreviewMsg(null)}>Cancel</button>
              <button
                style={{ ...st.primaryBtn, ...(sending ? st.disabledBtn : {}) }}
                onClick={handleSend}
                disabled={sending}
              >
                {sending ? 'Sending...' : 'Send to Discord'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const st = {
  phase: { display: 'flex', flexDirection: 'column', gap: '20px' },
  tabs: { display: 'flex', gap: '4px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '3px' },
  tab: {
    flex: 1, padding: '8px 12px', fontSize: '13px', fontWeight: 600,
    color: 'rgba(255,255,255,0.4)', background: 'none', border: 'none',
    borderRadius: '6px', cursor: 'pointer', fontFamily: 'inherit',
  },
  tabActive: { color: '#e2e8f0', background: 'rgba(255,255,255,0.06)' },
  section: { display: 'flex', flexDirection: 'column', gap: '12px' },
  sectionHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: '14px', fontWeight: 700, color: '#e2e8f0', margin: 0 },
  list: { display: 'flex', flexDirection: 'column', gap: '6px' },
  row: {
    display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px',
    background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '8px',
  },
  rowInfo: { flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' },
  rowTitle: { fontSize: '13px', fontWeight: 600, color: '#e2e8f0' },
  rowMeta: { fontSize: '11px', color: 'rgba(255,255,255,0.35)' },
  badge: { padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, flexShrink: 0 },
  sendBtn: {
    padding: '5px 12px', fontSize: '12px', fontWeight: 600, color: '#f59e0b',
    background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)',
    borderRadius: '6px', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
  },
  addBtn: {
    padding: '5px 12px', fontSize: '12px', fontWeight: 600, color: '#6366f1',
    background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)',
    borderRadius: '6px', cursor: 'pointer', fontFamily: 'inherit',
  },
  podcastRow: {
    display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px',
    background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '8px',
  },
  podcastFields: { flex: 1, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  podcastActions: { display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 },
  dash: { color: 'rgba(255,255,255,0.2)' },
  input: {
    padding: '6px 10px', fontSize: '13px', color: '#e2e8f0',
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px', outline: 'none', fontFamily: 'inherit',
  },
  select: {
    padding: '5px 8px', fontSize: '12px', color: '#e2e8f0',
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px', outline: 'none', fontFamily: 'inherit', cursor: 'pointer',
  },
  removeBtn: {
    padding: '4px', background: 'none', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px', color: '#ef4444', cursor: 'pointer', display: 'flex',
    alignItems: 'center', justifyContent: 'center', opacity: 0.6,
  },
  primaryBtn: {
    padding: '7px 16px', fontSize: '13px', fontWeight: 600, color: '#fff',
    background: '#f59e0b', border: 'none', borderRadius: '8px',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  disabledBtn: { opacity: 0.4, cursor: 'not-allowed' },
  actionBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '12px',
    padding: '16px 0', borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  cancelBtn: {
    padding: '7px 16px', fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.5)',
    background: 'none', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit',
  },
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  modal: {
    background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '14px', padding: '24px', width: '500px', maxWidth: '90vw',
  },
  modalTitle: { fontSize: '16px', fontWeight: 700, color: '#e2e8f0', margin: '0 0 8px 0' },
  modalMeta: { fontSize: '12px', color: 'rgba(255,255,255,0.35)', margin: '0 0 16px 0' },
  messageArea: {
    width: '100%', padding: '12px', fontSize: '13px', color: '#e2e8f0',
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px', outline: 'none', fontFamily: 'monospace', resize: 'vertical',
    boxSizing: 'border-box',
  },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' },
  emptyState: {
    padding: '40px', textAlign: 'center',
    border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '10px',
  },
  emptyText: { fontSize: '13px', color: 'rgba(255,255,255,0.3)', margin: 0 },
};
