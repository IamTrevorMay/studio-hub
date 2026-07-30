import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { colors } from '../lib/styleTokens';
import { EDITOR_SUB_ROLES, canManageClients } from '../lib/rolePermissions';

const TABS = ['Clients', 'Documents'];

/* ─────────────────────────────────────────── */
/*  Component                                  */
/* ─────────────────────────────────────────── */

export default function Clients() {
  const { profile } = useAuth();
  const confirm = useConfirm();
  const [activeTab, setActiveTab] = useState('Clients');
  const [loading, setLoading] = useState(true);

  /* ── Data ── */
  const [clients, setClients] = useState([]);
  const [clientProfilesMap, setClientProfilesMap] = useState({});
  const [editorRows, setEditorRows] = useState([]);       // client_editors rows
  const [editorOptions, setEditorOptions] = useState([]); // contractor profiles with editor sub-roles
  const [docs, setDocs] = useState([]);

  /* ── Admin notes drafts (save on blur) ── */
  const [notesDraft, setNotesDraft] = useState({});

  /* ── Invite form ── */
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteFullName, setInviteFullName] = useState('');
  const [inviteTitle, setInviteTitle] = useState('');
  const [inviteCompany, setInviteCompany] = useState('');
  const [inviteContractFile, setInviteContractFile] = useState(null);
  const [inviteNeedsSigning, setInviteNeedsSigning] = useState(true);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteMsg, setInviteMsg] = useState(null);

  /* ── Documents tab ── */
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadForm, setUploadForm] = useState({ title: '', description: '', doc_type: 'signing', client_ids: [] });
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [docsClientFilter, setDocsClientFilter] = useState('all');

  /* ─────────────────────────────────────────── */
  /*  Data fetching                              */
  /* ─────────────────────────────────────────── */

  const fetchAll = useCallback(async () => {
    const [clientsRes, cpRes, ceRes, edRes, docsRes] = await Promise.all([
      supabase.from('profiles')
        .select('id, full_name, email, avatar_url, title')
        .eq('role', 'client')
        .order('full_name'),
      supabase.from('client_profiles').select('*'),
      supabase.from('client_editors').select('client_id, contractor_id'),
      supabase.from('profiles')
        .select('id, full_name, email, avatar_url, sub_role')
        .in('role', ['contractor', 'freelancer'])
        .in('sub_role', EDITOR_SUB_ROLES)
        .order('full_name'),
      supabase.from('client_documents').select('*').order('created_at', { ascending: false }),
    ]);
    setClients(clientsRes.data || []);
    const cpMap = {};
    (cpRes.data || []).forEach(r => { cpMap[r.id] = r; });
    setClientProfilesMap(cpMap);
    setEditorRows(ceRes.data || []);
    setEditorOptions(edRes.data || []);
    setDocs(docsRes.data || []);
    // Seed notes drafts without clobbering in-progress edits.
    setNotesDraft(prev => {
      const next = { ...prev };
      (cpRes.data || []).forEach(r => {
        if (next[r.id] === undefined) next[r.id] = r.admin_notes || '';
      });
      return next;
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  /* ─────────────────────────────────────────── */
  /*  Handlers                                   */
  /* ─────────────────────────────────────────── */

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviteLoading(true);
    setInviteMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();

      // If a contract file was selected, upload it to a pending path first
      let contractStoragePath = null;
      let contractFileName = null;
      if (inviteContractFile) {
        const safeName = inviteContractFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        contractStoragePath = `pending/${Date.now()}_${safeName}`;
        contractFileName = inviteContractFile.name;
        const { error: uploadErr } = await supabase.storage
          .from('client-documents')
          .upload(contractStoragePath, inviteContractFile, { upsert: true });
        if (uploadErr) throw new Error('Failed to upload contract: ' + uploadErr.message);
      }

      const res = await fetch(`${process.env.REACT_APP_SUPABASE_URL}/functions/v1/invite-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: 'client',
          title: inviteTitle.trim() || null,
          full_name: inviteFullName.trim() || null,
          company_name: inviteCompany.trim() || null,
          contract_storage_path: contractStoragePath,
          contract_file_name: contractFileName,
          contract_needs_signing: inviteContractFile ? inviteNeedsSigning : false,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to send invite');
      setInviteMsg({ type: 'success', text: `Invite sent to ${inviteEmail.trim()}` });
      setInviteEmail('');
      setInviteFullName('');
      setInviteTitle('');
      setInviteCompany('');
      setInviteContractFile(null);
      setInviteNeedsSigning(true);
      setShowInviteForm(false);
    } catch (err) {
      setInviteMsg({ type: 'error', text: err.message });
    } finally {
      setInviteLoading(false);
    }
  };

  const handleSaveNotes = async (clientId) => {
    const value = notesDraft[clientId] ?? '';
    const existing = clientProfilesMap[clientId]?.admin_notes ?? '';
    if (value === existing) return; // unchanged
    const { error } = await supabase.from('client_profiles').upsert({
      id: clientId,
      admin_notes: value || null,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      alert('Failed to save notes: ' + error.message);
      return;
    }
    setClientProfilesMap(prev => ({
      ...prev,
      [clientId]: { ...(prev[clientId] || { id: clientId }), admin_notes: value || null },
    }));
  };

  const handleAssignEditor = async (clientId, contractorId) => {
    if (!contractorId) return;
    const { error } = await supabase.from('client_editors').insert({
      client_id: clientId,
      contractor_id: contractorId,
      created_by: profile.id,
    });
    if (error) {
      alert('Failed to assign editor: ' + error.message);
      return;
    }
    setEditorRows(prev => [...prev, { client_id: clientId, contractor_id: contractorId }]);
  };

  const handleRemoveEditor = async (clientId, contractorId) => {
    const { error } = await supabase.from('client_editors')
      .delete()
      .eq('client_id', clientId)
      .eq('contractor_id', contractorId);
    if (error) {
      alert('Failed to remove editor: ' + error.message);
      return;
    }
    setEditorRows(prev => prev.filter(r => !(r.client_id === clientId && r.contractor_id === contractorId)));
  };

  /* ── Document handlers ── */

  const handleUploadDoc = async () => {
    if (!uploadFile || !uploadForm.title.trim() || uploadForm.client_ids.length === 0) return;
    setUploadLoading(true);
    try {
      const safeName = uploadFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      for (const cId of uploadForm.client_ids) {
        const storagePath = `${cId}/${Date.now()}_${safeName}`;
        const { error: uploadError } = await supabase.storage
          .from('client-documents')
          .upload(storagePath, uploadFile);
        if (uploadError) throw uploadError;

        const { error: insertError } = await supabase.from('client_documents').insert({
          client_id: cId,
          uploaded_by: profile.id,
          title: uploadForm.title.trim(),
          description: uploadForm.description.trim() || null,
          doc_type: uploadForm.doc_type,
          storage_path: storagePath,
          file_name: uploadFile.name,
        });
        if (insertError) throw insertError;
      }
      setShowUploadForm(false);
      setUploadForm({ title: '', description: '', doc_type: 'signing', client_ids: [] });
      setUploadFile(null);
      fetchAll();
    } catch (err) {
      console.error('Upload failed:', err);
      alert('Upload failed: ' + err.message);
    }
    setUploadLoading(false);
  };

  const handleDeleteDoc = async (doc) => {
    const clientName = clients.find(c => c.id === doc.client_id)?.full_name || 'this client';
    const ok = await confirm(`Delete "${doc.title}" for ${clientName}?`);
    if (!ok) return;
    await supabase.storage.from('client-documents').remove([doc.storage_path]);
    await supabase.from('client_documents').delete().eq('id', doc.id);
    fetchAll();
  };

  const openDoc = async (doc) => {
    const { data } = await supabase.storage
      .from('client-documents')
      .createSignedUrl(doc.storage_path, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  };

  /* ─────────────────────────────────────────── */
  /*  Helpers                                    */
  /* ─────────────────────────────────────────── */

  const formatDate = (ts) => {
    if (!ts) return '--';
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const avatarLetter = (name) => (name || '?')[0].toUpperCase();

  const editorsForClient = (clientId) =>
    editorRows
      .filter(r => r.client_id === clientId)
      .map(r => editorOptions.find(e => e.id === r.contractor_id))
      .filter(Boolean);

  const unassignedEditorsForClient = (clientId) => {
    const assigned = new Set(editorRows.filter(r => r.client_id === clientId).map(r => r.contractor_id));
    return editorOptions.filter(e => !assigned.has(e.id));
  };

  const docStatsForClient = (clientId) => {
    const clientDocs = docs.filter(d => d.client_id === clientId);
    const signed = clientDocs.filter(d => d.doc_type === 'signing' && d.signed_at).length;
    return { signed, total: clientDocs.length };
  };

  const studioDocs = docs.filter(d => d.doc_type === 'signing' || d.doc_type === 'reference');
  const filteredDocs = docsClientFilter === 'all'
    ? studioDocs
    : studioDocs.filter(d => d.client_id === docsClientFilter);

  /* ─────────────────────────────────────────── */
  /*  Render                                     */
  /* ─────────────────────────────────────────── */

  // UI-only gate — mirrors the ROLE_RESTRICTED_NAV_KEYS boundaries; the DB
  // still enforces admin-tier RLS on all client_* tables.
  if (!canManageClients(profile?.role, profile?.sub_role)) return null;

  return (
    <div style={styles.page}>
      <h1 style={styles.pageTitle}>Clients</h1>

      {/* Tab bar */}
      <div style={styles.tabBar}>
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              ...styles.tabPill,
              ...(activeTab === tab ? styles.tabPillActive : {}),
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════ */}
      {/*  TAB 1: CLIENTS                        */}
      {/* ══════════════════════════════════════ */}
      {activeTab === 'Clients' && (
        <div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center' }}>
            <button style={styles.primaryBtn} onClick={() => setShowInviteForm(v => !v)}>
              {showInviteForm ? 'Cancel' : 'Invite Client'}
            </button>
          </div>

          {inviteMsg && (
            <div style={inviteMsg.type === 'success' ? styles.successBanner : styles.errorBanner}>
              {inviteMsg.text}
            </div>
          )}

          {showInviteForm && (
            <div style={{ ...styles.card, marginBottom: 20 }}>
              <h3 style={styles.cardTitle}>Invite a Client</h3>
              <div style={styles.formGrid}>
                <div style={styles.formField}>
                  <label style={styles.label}>Email *</label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    placeholder="client@company.com"
                    style={styles.input}
                  />
                </div>
                <div style={styles.formField}>
                  <label style={styles.label}>Full Name (optional)</label>
                  <input
                    type="text"
                    value={inviteFullName}
                    onChange={e => setInviteFullName(e.target.value)}
                    placeholder="Jane Smith"
                    style={styles.input}
                  />
                </div>
                <div style={styles.formField}>
                  <label style={styles.label}>Title (optional)</label>
                  <input
                    type="text"
                    value={inviteTitle}
                    onChange={e => setInviteTitle(e.target.value)}
                    placeholder="e.g. Founder"
                    style={styles.input}
                  />
                </div>
                <div style={styles.formField}>
                  <label style={styles.label}>Company Name (optional)</label>
                  <input
                    type="text"
                    value={inviteCompany}
                    onChange={e => setInviteCompany(e.target.value)}
                    placeholder="Acme Inc."
                    style={styles.input}
                  />
                </div>
                <div style={styles.formField}>
                  <label style={styles.label}>Contract (optional, PDF)</label>
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={e => setInviteContractFile(e.target.files?.[0] || null)}
                    style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}
                  />
                </div>
                {inviteContractFile && (
                  <div style={{ ...styles.formField, justifyContent: 'flex-end' }}>
                    <label style={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={inviteNeedsSigning}
                        onChange={e => setInviteNeedsSigning(e.target.checked)}
                        style={{ marginRight: 8 }}
                      />
                      <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
                        Requires signature
                      </span>
                    </label>
                  </div>
                )}
              </div>
              <div style={{ marginTop: 14 }}>
                <button
                  onClick={handleInvite}
                  disabled={inviteLoading || !inviteEmail.trim()}
                  style={{
                    ...styles.primaryBtn,
                    ...(inviteLoading || !inviteEmail.trim() ? { opacity: 0.5 } : {}),
                  }}
                >
                  {inviteLoading ? 'Sending...' : 'Send Invite'}
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <p style={styles.emptyText}>Loading...</p>
          ) : clients.length === 0 ? (
            <p style={styles.emptyText}>No clients yet. Send an invite to get started.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {clients.map(client => {
                const cp = clientProfilesMap[client.id];
                const assignedEditors = editorsForClient(client.id);
                const availableEditors = unassignedEditorsForClient(client.id);
                const { signed, total } = docStatsForClient(client.id);
                return (
                  <div key={client.id} style={styles.card}>
                    {/* Header row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      {client.avatar_url ? (
                        <img src={client.avatar_url} alt="" style={styles.avatarImg} />
                      ) : (
                        <div style={styles.avatar}>{avatarLetter(client.full_name)}</div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 600, color: '#e2e8f0' }}>
                          {client.full_name || client.email}
                          {client.title && (
                            <span style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.4)', marginLeft: 8 }}>
                              {client.title}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
                          {client.email}
                          {cp?.company_name ? ` · ${cp.company_name}` : ''}
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', whiteSpace: 'nowrap' }}>
                        Docs: {signed} signed / {total} total
                      </div>
                    </div>

                    {/* Drive folder */}
                    <div style={styles.cardRow}>
                      <span style={styles.rowLabel}>Delivery folder</span>
                      {cp?.drive_folder_url ? (
                        <a
                          href={cp.drive_folder_url}
                          target="_blank"
                          rel="noreferrer"
                          style={styles.openLink}
                        >
                          Open ↗
                        </a>
                      ) : (
                        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)' }}>Not set</span>
                      )}
                    </div>

                    {/* Assigned editors */}
                    <div style={styles.cardRow}>
                      <span style={styles.rowLabel}>Assigned editors</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', flex: 1 }}>
                        {assignedEditors.length === 0 && (
                          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)' }}>None</span>
                        )}
                        {assignedEditors.map(ed => (
                          <span key={ed.id} style={styles.editorChip}>
                            {ed.full_name || ed.email}
                            <span style={styles.chipSub}>{ed.sub_role}</span>
                            <button
                              onClick={() => handleRemoveEditor(client.id, ed.id)}
                              style={styles.chipRemove}
                              title="Remove editor"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        {availableEditors.length > 0 && (
                          <select
                            value=""
                            onChange={e => handleAssignEditor(client.id, e.target.value)}
                            style={{ ...styles.select, width: 'auto' }}
                          >
                            <option value="">Assign editor…</option>
                            {availableEditors.map(ed => (
                              <option key={ed.id} value={ed.id}>
                                {(ed.full_name || ed.email)} — {ed.sub_role}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>

                    {/* Admin notes */}
                    <div style={{ marginTop: 12 }}>
                      <label style={styles.label}>Admin notes (internal — not visible to the client)</label>
                      <textarea
                        value={notesDraft[client.id] ?? ''}
                        onChange={e => setNotesDraft(prev => ({ ...prev, [client.id]: e.target.value }))}
                        onBlur={() => handleSaveNotes(client.id)}
                        placeholder="Notes about this client..."
                        rows={2}
                        style={styles.textarea}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════ */}
      {/*  TAB 2: DOCUMENTS                      */}
      {/* ══════════════════════════════════════ */}
      {activeTab === 'Documents' && (
        <div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center' }}>
            <button style={styles.primaryBtn} onClick={() => setShowUploadForm(v => !v)}>
              {showUploadForm ? 'Cancel' : 'Upload Document'}
            </button>
            <select
              value={docsClientFilter}
              onChange={e => setDocsClientFilter(e.target.value)}
              style={styles.select}
            >
              <option value="all">All Clients</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.full_name || c.email}</option>
              ))}
            </select>
          </div>

          {showUploadForm && (
            <div style={{ ...styles.card, marginBottom: 20 }}>
              <h3 style={styles.cardTitle}>Upload Document</h3>
              <div style={styles.formGrid}>
                <div style={styles.formField}>
                  <label style={styles.label}>Title</label>
                  <input
                    type="text"
                    value={uploadForm.title}
                    onChange={e => setUploadForm(p => ({ ...p, title: e.target.value }))}
                    placeholder="Document title"
                    style={styles.input}
                  />
                </div>
                <div style={styles.formField}>
                  <label style={styles.label}>Type</label>
                  <select
                    value={uploadForm.doc_type}
                    onChange={e => setUploadForm(p => ({ ...p, doc_type: e.target.value }))}
                    style={styles.select}
                  >
                    <option value="signing">Signing</option>
                    <option value="reference">Reference</option>
                  </select>
                </div>
                <div style={{ ...styles.formField, gridColumn: '1 / -1' }}>
                  <label style={styles.label}>Description (optional)</label>
                  <input
                    type="text"
                    value={uploadForm.description}
                    onChange={e => setUploadForm(p => ({ ...p, description: e.target.value }))}
                    placeholder="Brief description"
                    style={styles.input}
                  />
                </div>
                <div style={{ ...styles.formField, gridColumn: '1 / -1' }}>
                  <label style={styles.label}>Client(s)</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {clients.map(c => {
                      const sel = uploadForm.client_ids.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setUploadForm(p => ({
                            ...p,
                            client_ids: sel
                              ? p.client_ids.filter(x => x !== c.id)
                              : [...p.client_ids, c.id],
                          }))}
                          style={{
                            ...styles.filterPill,
                            ...(sel ? styles.filterPillActive : {}),
                          }}
                        >
                          {c.full_name || c.email}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div style={styles.formField}>
                  <label style={styles.label}>PDF File</label>
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={e => setUploadFile(e.target.files?.[0] || null)}
                    style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}
                  />
                </div>
              </div>
              <div style={{ marginTop: 14 }}>
                <button
                  onClick={handleUploadDoc}
                  disabled={uploadLoading || !uploadFile || !uploadForm.title.trim() || uploadForm.client_ids.length === 0}
                  style={{
                    ...styles.primaryBtn,
                    ...(uploadLoading ? { opacity: 0.5 } : {}),
                  }}
                >
                  {uploadLoading ? 'Uploading...' : 'Upload'}
                </button>
              </div>
            </div>
          )}

          {filteredDocs.length === 0 ? (
            <p style={styles.emptyText}>No documents uploaded yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filteredDocs.map(doc => {
                const clientName = clients.find(c => c.id === doc.client_id)?.full_name || 'Unknown';
                return (
                  <div key={doc.id} style={{ ...styles.card, display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>
                        {doc.title}
                      </div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
                        {clientName} · {doc.file_name} · {formatDate(doc.created_at)}
                      </div>
                      {doc.description && (
                        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{doc.description}</div>
                      )}
                    </div>
                    <span style={{
                      ...styles.typeBadge,
                      ...(doc.doc_type === 'reference' ? { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' } : {}),
                    }}>
                      {doc.doc_type === 'signing' ? 'Sign' : 'Reference'}
                    </span>
                    {doc.doc_type === 'signing' && (
                      <span style={{
                        ...styles.statusBadge,
                        ...(doc.signed_at
                          ? { background: 'rgba(34,197,94,0.15)', color: '#34d399' }
                          : { background: 'rgba(245,158,11,0.15)', color: '#fbbf24' }),
                      }}>
                        {doc.signed_at ? `✓ Signed ${formatDate(doc.signed_at)}` : 'Awaiting signature'}
                      </span>
                    )}
                    <button onClick={() => openDoc(doc)} style={styles.smallBtn}>Open</button>
                    <button onClick={() => handleDeleteDoc(doc)} style={styles.deleteBtn}>Delete</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────── */
/*  Styles                                     */
/* ─────────────────────────────────────────── */

const styles = {
  page: {
    padding: '36px 40px 64px',
    maxWidth: '1100px',
    margin: '0 auto',
    minHeight: '100vh',
    background: colors.bg,
    fontFamily: 'DM Sans, sans-serif',
  },
  pageTitle: {
    fontSize: 26,
    fontWeight: 700,
    color: '#fff',
    margin: '0 0 24px',
  },

  /* Tabs */
  tabBar: {
    display: 'flex',
    gap: 8,
    marginBottom: 28,
  },
  tabPill: {
    padding: '8px 18px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(255,255,255,0.04)',
    color: 'rgba(255,255,255,0.55)',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
    transition: 'all 0.15s',
  },
  tabPillActive: {
    background: colors.accent,
    color: '#fff',
    borderColor: colors.accent,
  },

  /* Cards */
  card: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 12,
    padding: 20,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: '#e2e8f0',
    margin: '0 0 14px',
  },
  cardRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
  },
  rowLabel: {
    fontSize: 12,
    fontWeight: 500,
    color: 'rgba(255,255,255,0.45)',
    width: 120,
    flexShrink: 0,
  },
  openLink: {
    fontSize: 13,
    fontWeight: 600,
    color: colors.accentFg,
    textDecoration: 'none',
  },

  /* Avatar */
  avatar: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    background: colors.accent,
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: 15,
    flexShrink: 0,
  },
  avatarImg: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    objectFit: 'cover',
    flexShrink: 0,
  },

  /* Editor chips */
  editorChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '3px 6px 3px 10px',
    borderRadius: 7,
    background: colors.accentA12,
    color: colors.accentFg,
    fontSize: 12,
    fontWeight: 600,
  },
  chipSub: {
    fontSize: 11,
    fontWeight: 500,
    color: 'rgba(255,255,255,0.4)',
  },
  chipRemove: {
    background: 'transparent',
    border: 'none',
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    lineHeight: 1,
    cursor: 'pointer',
    padding: '0 2px',
    fontFamily: 'DM Sans, sans-serif',
  },

  /* Badges */
  statusBadge: {
    padding: '3px 10px',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  typeBadge: {
    padding: '2px 8px',
    borderRadius: 5,
    fontSize: 11,
    fontWeight: 500,
    background: colors.accentA12,
    color: colors.accentFg,
    whiteSpace: 'nowrap',
  },

  /* Buttons */
  primaryBtn: {
    padding: '8px 18px',
    borderRadius: 8,
    border: 'none',
    background: colors.accent,
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
  },
  smallBtn: {
    padding: '4px 12px',
    borderRadius: 6,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
    flexShrink: 0,
  },
  deleteBtn: {
    padding: '4px 10px',
    background: 'transparent',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 6,
    color: '#ef4444',
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
    flexShrink: 0,
  },

  /* Filters */
  filterPill: {
    padding: '6px 14px',
    borderRadius: 7,
    border: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(255,255,255,0.04)',
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
  },
  filterPillActive: {
    background: colors.accent,
    color: '#fff',
    borderColor: colors.accent,
  },

  /* Form */
  formGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 14,
  },
  formField: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: 500,
    color: 'rgba(255,255,255,0.45)',
  },
  input: {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.05)',
    color: '#fff',
    fontSize: 13,
    fontFamily: 'DM Sans, sans-serif',
    outline: 'none',
  },
  textarea: {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.05)',
    color: '#fff',
    fontSize: 13,
    fontFamily: 'DM Sans, sans-serif',
    outline: 'none',
    resize: 'vertical',
    width: '100%',
    boxSizing: 'border-box',
    marginTop: 4,
  },
  select: {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.05)',
    color: '#fff',
    fontSize: 13,
    fontFamily: 'DM Sans, sans-serif',
    outline: 'none',
  },
  checkRow: {
    display: 'flex',
    alignItems: 'center',
    cursor: 'pointer',
  },

  /* Banners */
  successBanner: {
    background: 'rgba(74,222,128,0.12)',
    border: '1px solid rgba(74,222,128,0.3)',
    borderRadius: 8,
    padding: '10px 16px',
    color: '#22c55e',
    fontSize: 13,
    marginBottom: 20,
  },
  errorBanner: {
    background: 'rgba(239,68,68,0.12)',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 8,
    padding: '10px 16px',
    color: '#f87171',
    fontSize: 13,
    marginBottom: 20,
  },

  /* Empty states */
  emptyText: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 14,
    textAlign: 'center',
    padding: '40px 0',
  },
};
