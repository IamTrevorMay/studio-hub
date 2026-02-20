import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import DocEditor from './editors/DocEditor';

const FOLDER_COLORS = ['#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#22c55e', '#ef4444', '#14b8a6'];

export default function Resources() {
  const { profile } = useAuth();
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [folderForm, setFolderForm] = useState({ name: '', description: '', color: '#3b82f6' });
  const [activeFolder, setActiveFolder] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [activeDoc, setActiveDoc] = useState(null);
  const [showCreateDoc, setShowCreateDoc] = useState(false);
  const [docTitle, setDocTitle] = useState('');
  const [uploading, setUploading] = useState(false);
  const [viewingFile, setViewingFile] = useState(null);
  const [editingUpload, setEditingUpload] = useState(null);
  const [movingDoc, setMovingDoc] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!profile?.id) return;
    fetchFolders();
  }, [profile?.id]);

  useEffect(() => {
    if (activeFolder) fetchDocuments(activeFolder.id);
  }, [activeFolder]);

  async function fetchFolders() {
    try {
      const { data, error } = await supabase.from('resource_folders')
        .select('*, creator:profiles!resource_folders_created_by_fkey(full_name)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setFolders(data || []);
    } catch (err) {
      console.error('Error fetching folders:', err);
      setFolders([]);
    } finally {
      setLoading(false);
    }
  }

  async function fetchDocuments(folderId) {
    try {
      const { data, error } = await supabase.from('resource_documents')
        .select('*, creator:profiles!resource_documents_created_by_fkey(full_name)')
        .eq('folder_id', folderId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setDocuments(data || []);
    } catch (err) {
      console.error('Error fetching documents:', err);
      setDocuments([]);
    }
  }

  // Also fetch unfiled documents (folder_id is null)
  async function fetchUnfiledDocuments() {
    try {
      const { data, error } = await supabase.from('resource_documents')
        .select('*, creator:profiles!resource_documents_created_by_fkey(full_name)')
        .is('folder_id', null)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setDocuments(data || []);
    } catch (err) {
      console.error('Error fetching documents:', err);
      setDocuments([]);
    }
  }

  async function handleCreateFolder(e) {
    e.preventDefault();
    if (!folderForm.name.trim()) return;
    const { error } = await supabase.from('resource_folders').insert({
      name: folderForm.name.trim(),
      description: folderForm.description.trim(),
      color: folderForm.color,
      created_by: profile.id,
    });
    if (error) { console.error(error); return; }
    setFolderForm({ name: '', description: '', color: '#3b82f6' });
    setShowCreateFolder(false);
    fetchFolders();
  }

  async function handleDeleteFolder(folderId) {
    if (!window.confirm('Delete this folder and all its documents?')) return;
    await supabase.from('resource_folders').delete().eq('id', folderId);
    if (activeFolder?.id === folderId) { setActiveFolder(null); setActiveDoc(null); }
    fetchFolders();
  }

  async function handleCreateDoc(e) {
    e.preventDefault();
    if (!docTitle.trim() || !activeFolder) return;
    const { error } = await supabase.from('resource_documents').insert({
      folder_id: activeFolder.id,
      type: 'document',
      title: docTitle.trim(),
      content: { html: '' },
      created_by: profile.id,
    });
    if (error) { console.error(error); return; }
    setDocTitle('');
    setShowCreateDoc(false);
    fetchDocuments(activeFolder.id);
  }

  async function handleDeleteDoc(docId) {
    if (!window.confirm('Delete this document?')) return;
    // If it's an upload, also delete from storage
    const doc = documents.find(d => d.id === docId);
    if (doc?.file_path) {
      await supabase.storage.from('resources').remove([doc.file_path]);
    }
    await supabase.from('resource_documents').delete().eq('id', docId);
    if (activeDoc?.id === docId) setActiveDoc(null);
    if (viewingFile?.id === docId) setViewingFile(null);
    if (activeFolder) fetchDocuments(activeFolder.id);
  }

  async function handleFileUpload(e) {
    const files = Array.from(e.target.files);
    if (!files.length || !activeFolder) return;
    setUploading(true);

    const allowed = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'text/markdown'];
    const extMap = { 'application/pdf': 'pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'text/plain': 'txt', 'text/markdown': 'md' };

    for (const file of files) {
      // Also accept .md files which might come as application/octet-stream
      const ext = file.name.split('.').pop().toLowerCase();
      const isAllowed = allowed.includes(file.type) || ['pdf', 'docx', 'txt', 'md'].includes(ext);
      if (!isAllowed) {
        alert(`File type not supported: ${file.name}\nSupported: PDF, DOCX, TXT, MD`);
        continue;
      }

      const fileExt = ext;
      const filePath = `${activeFolder.id}/${Date.now()}_${file.name}`;

      const { error: uploadError } = await supabase.storage.from('resources').upload(filePath, file);
      if (uploadError) { console.error('Upload error:', uploadError); continue; }

      await supabase.from('resource_documents').insert({
        folder_id: activeFolder.id,
        type: 'upload',
        title: file.name.replace(/\.[^/.]+$/, ''),
        file_path: filePath,
        file_type: fileExt,
        file_size: file.size,
        original_filename: file.name,
        created_by: profile.id,
      });
    }

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    fetchDocuments(activeFolder.id);
  }

  async function handleConvertToEditable(doc) {
    // Read the file content and convert to editable document
    const { data: fileData, error } = await supabase.storage.from('resources').download(doc.file_path);
    if (error) { console.error(error); return; }

    let html = '';
    if (doc.file_type === 'txt' || doc.file_type === 'md') {
      const text = await fileData.text();
      // Simple conversion: wrap lines in <p> tags
      html = text.split('\n').map(line => {
        if (!line.trim()) return '<p></p>';
        // Basic markdown heading support
        if (doc.file_type === 'md') {
          if (line.startsWith('### ')) return `<h3>${line.slice(4)}</h3>`;
          if (line.startsWith('## ')) return `<h2>${line.slice(3)}</h2>`;
          if (line.startsWith('# ')) return `<h1>${line.slice(2)}</h1>`;
          // Bold
          line = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
          // Italic
          line = line.replace(/\*(.+?)\*/g, '<em>$1</em>');
        }
        return `<p>${line}</p>`;
      }).join('');
    } else if (doc.file_type === 'docx') {
      // DOCX files: extract readable text content
      try {
        const arrayBuffer = await fileData.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuffer);
        // Simple extraction: find text between XML tags
        const decoder = new TextDecoder('utf-8', { fatal: false });
        const raw = decoder.decode(uint8);
        // DOCX is a zip containing XML - extract visible text patterns
        const textParts = [];
        const regex = /<w:t[^>]*>([^<]+)<\/w:t>/g;
        let match;
        while ((match = regex.exec(raw)) !== null) {
          textParts.push(match[1]);
        }
        if (textParts.length > 0) {
          html = textParts.join(' ').split(/\s{2,}/).map(p => `<p>${p.trim()}</p>`).join('');
        } else {
          html = '<p><em>Could not extract text from DOCX. You can edit this document manually.</em></p>';
        }
      } catch (err) {
        html = '<p><em>Could not extract text from DOCX. You can edit this document manually.</em></p>';
      }
    }

    // Create a new editable document from the upload
    const { data: newDoc, error: insertError } = await supabase.from('resource_documents').insert({
      folder_id: doc.folder_id,
      type: 'document',
      title: doc.title + ' (editable)',
      content: { html },
      created_by: profile.id,
    }).select().single();

    if (insertError) { console.error(insertError); return; }
    fetchDocuments(doc.folder_id);
    alert(`Created editable copy: "${doc.title} (editable)"`);
  }

  async function handleMoveDoc(docId, newFolderId) {
    const { error } = await supabase.from('resource_documents')
      .update({ folder_id: newFolderId })
      .eq('id', docId);
    if (error) { console.error(error); return; }
    setMovingDoc(null);
    if (activeFolder) fetchDocuments(activeFolder.id);
  }

  function getFileIcon(fileType) {
    switch (fileType) {
      case 'pdf': return '📕';
      case 'docx': return '📘';
      case 'txt': return '📄';
      case 'md': return '📋';
      default: return '📁';
    }
  }

  function formatFileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function getFileUrl(filePath) {
    const { data } = supabase.storage.from('resources').getPublicUrl(filePath);
    return data?.publicUrl;
  }

  // ── Viewing an uploaded file ──
  if (viewingFile) {
    const fileUrl = getFileUrl(viewingFile.file_path);
    const canEdit = ['txt', 'md', 'docx'].includes(viewingFile.file_type);

    return (
      <div style={styles.page}>
        <button onClick={() => setViewingFile(null)} style={styles.backBtn}>← Back to {activeFolder?.name || 'folder'}</button>
        <div style={styles.topBar}>
          <div>
            <h1 style={styles.pageTitle}>
              {getFileIcon(viewingFile.file_type)} {viewingFile.title}
              <span style={styles.fileBadge}>.{viewingFile.file_type}</span>
            </h1>
            <p style={styles.pageSubtitle}>
              {formatFileSize(viewingFile.file_size)} · Uploaded by {viewingFile.creator?.full_name} · {new Date(viewingFile.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {canEdit && (
              <button onClick={() => handleConvertToEditable(viewingFile)} style={styles.secondaryBtn}>
                ✏️ Convert to Editable
              </button>
            )}
            <a href={fileUrl} download={viewingFile.original_filename} style={styles.addBtn}>
              ⬇ Download
            </a>
          </div>
        </div>

        <div style={styles.fileViewer}>
          {viewingFile.file_type === 'pdf' ? (
            <iframe src={fileUrl} style={styles.pdfFrame} title={viewingFile.title} />
          ) : viewingFile.file_type === 'docx' ? (
            <div style={styles.previewNote}>
              <p>📘 DOCX files can be downloaded or converted to an editable document.</p>
              <p>Use "Convert to Editable" to edit this document in the hub.</p>
            </div>
          ) : (
            <TextFileViewer url={fileUrl} />
          )}
        </div>
      </div>
    );
  }

  // ── Editing an editable document ──
  if (activeDoc) {
    return (
      <DocEditor
        docId={activeDoc.id}
        title={activeDoc.title}
        docType="resource_documents"
        onBack={() => { setActiveDoc(null); if (activeFolder) fetchDocuments(activeFolder.id); }}
        onSaveTemplate={null}
      />
    );
  }

  // ── Inside a folder ──
  if (activeFolder) {
    return (
      <div style={styles.page}>
        <button onClick={() => { setActiveFolder(null); setDocuments([]); }} style={styles.backBtn}>← Back to Resources</button>

        <div style={styles.topBar}>
          <div>
            <h1 style={styles.pageTitle}>
              <span style={{ ...styles.folderDot, background: activeFolder.color }} />
              {activeFolder.name}
            </h1>
            <p style={styles.pageSubtitle}>{documents.length} items</p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => fileInputRef.current?.click()}
              style={styles.uploadBtn}
              disabled={uploading}
            >
              {uploading ? '⏳ Uploading...' : '📎 Upload Files'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt,.md"
              multiple
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
            <button onClick={() => setShowCreateDoc(!showCreateDoc)} style={styles.addBtn}>
              {showCreateDoc ? '✕ Cancel' : '+ New Document'}
            </button>
          </div>
        </div>

        {showCreateDoc && (
          <form onSubmit={handleCreateDoc} style={styles.createForm}>
            <input
              value={docTitle}
              onChange={(e) => setDocTitle(e.target.value)}
              placeholder="Document title..."
              required
              style={styles.input}
            />
            <button type="submit" style={styles.submitBtn}>Create Document</button>
          </form>
        )}

        {documents.length === 0 ? (
          <div style={styles.emptyCard}>
            <p style={styles.emptyText}>No documents yet. Create one or upload files!</p>
          </div>
        ) : (
          <div style={styles.docGrid}>
            {documents.map(doc => (
              <div
                key={doc.id}
                style={styles.docCard}
                onClick={() => {
                  if (doc.type === 'upload') setViewingFile(doc);
                  else setActiveDoc(doc);
                }}
              >
                <div style={styles.docCardIcon}>
                  {doc.type === 'upload' ? getFileIcon(doc.file_type) : '📝'}
                </div>
                <div style={styles.docCardTitle}>{doc.title}</div>
                <div style={styles.docCardMeta}>
                  {doc.type === 'upload' ? (
                    <>{doc.file_type?.toUpperCase()} · {formatFileSize(doc.file_size)}</>
                  ) : (
                    'Editable Document'
                  )}
                </div>
                <div style={styles.docCardMeta}>
                  {doc.creator?.full_name} · {new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </div>
                <div style={styles.docCardActions}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setMovingDoc(doc); }}
                    style={styles.docActionBtn}
                    title="Move to folder"
                  >📂</button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteDoc(doc.id); }}
                    style={styles.docActionBtn}
                    title="Delete"
                  >✕</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Move document modal */}
        {movingDoc && (
          <div style={styles.modalOverlay} onClick={() => setMovingDoc(null)}>
            <div style={styles.modal} onClick={e => e.stopPropagation()}>
              <h3 style={styles.modalTitle}>Move "{movingDoc.title}" to:</h3>
              <div style={styles.modalList}>
                {folders.filter(f => f.id !== activeFolder?.id).map(f => (
                  <button
                    key={f.id}
                    onClick={() => handleMoveDoc(movingDoc.id, f.id)}
                    style={styles.modalItem}
                  >
                    <span style={{ ...styles.folderDot, background: f.color }} />
                    {f.name}
                  </button>
                ))}
              </div>
              <button onClick={() => setMovingDoc(null)} style={styles.modalCancel}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Main folder list ──
  return (
    <div style={styles.page}>
      <div style={styles.topBar}>
        <div>
          <h1 style={styles.pageTitle}>Resources</h1>
          <p style={styles.pageSubtitle}>{folders.length} folders</p>
        </div>
        <button onClick={() => setShowCreateFolder(!showCreateFolder)} style={styles.addBtn}>
          {showCreateFolder ? '✕ Cancel' : '+ New Folder'}
        </button>
      </div>

      {showCreateFolder && (
        <form onSubmit={handleCreateFolder} style={styles.createForm}>
          <input
            value={folderForm.name}
            onChange={(e) => setFolderForm({ ...folderForm, name: e.target.value })}
            placeholder="Folder name..."
            required
            style={styles.input}
          />
          <input
            value={folderForm.description}
            onChange={(e) => setFolderForm({ ...folderForm, description: e.target.value })}
            placeholder="Description (optional)"
            style={styles.input}
          />
          <div style={styles.colorPicker}>
            {FOLDER_COLORS.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setFolderForm({ ...folderForm, color: c })}
                style={{
                  ...styles.colorDot,
                  background: c,
                  outline: folderForm.color === c ? `2px solid ${c}` : 'none',
                  outlineOffset: '2px',
                }}
              />
            ))}
          </div>
          <button type="submit" style={styles.submitBtn}>Create Folder</button>
        </form>
      )}

      {loading ? (
        <p style={styles.emptyText}>Loading...</p>
      ) : folders.length === 0 ? (
        <div style={styles.emptyCard}>
          <p style={styles.emptyText}>No resource folders yet. Create one to get started!</p>
        </div>
      ) : (
        <div style={styles.folderGrid}>
          {folders.map(folder => (
            <div
              key={folder.id}
              style={styles.folderCard}
              onClick={() => setActiveFolder(folder)}
            >
              <div style={{ ...styles.folderCardStripe, background: folder.color }} />
              <div style={styles.folderCardBody}>
                <div style={{ fontSize: '28px', marginBottom: '8px' }}>📁</div>
                <h3 style={styles.folderCardName}>{folder.name}</h3>
                {folder.description && <p style={styles.folderCardDesc}>{folder.description}</p>}
                <div style={styles.folderCardFooter}>
                  <span style={styles.folderCardMeta}>
                    {folder.creator?.full_name} · {new Date(folder.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteFolder(folder.id); }}
                    style={styles.deleteBtn}
                  >✕</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Simple text/markdown file viewer ──
function TextFileViewer({ url }) {
  const [content, setContent] = useState('Loading...');

  useEffect(() => {
    fetch(url)
      .then(r => r.text())
      .then(text => setContent(text))
      .catch(() => setContent('Error loading file'));
  }, [url]);

  return (
    <pre style={styles.textViewer}>{content}</pre>
  );
}

const styles = {
  page: { padding: '32px 40px' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' },
  pageTitle: { fontSize: '28px', fontWeight: 700, color: '#ffffff', margin: '0 0 4px 0', letterSpacing: '-0.5px', display: 'flex', alignItems: 'center', gap: '10px' },
  pageSubtitle: { fontSize: '14px', color: 'rgba(255,255,255,0.4)', margin: 0 },
  backBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.45)', fontSize: '13px', cursor: 'pointer', padding: '0 0 8px 0', fontFamily: 'inherit', fontWeight: 500 },
  addBtn: { padding: '10px 20px', background: 'linear-gradient(135deg, #6366f1, #818cf8)', border: 'none', borderRadius: '10px', color: '#fff', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' },
  uploadBtn: { padding: '10px 20px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#e2e8f0', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  secondaryBtn: { padding: '10px 20px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#e2e8f0', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  createForm: { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '20px', marginBottom: '24px', display: 'flex', flexDirection: 'column', gap: '12px' },
  input: { padding: '10px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '14px', fontFamily: 'inherit', outline: 'none' },
  colorPicker: { display: 'flex', gap: '8px' },
  colorDot: { width: '28px', height: '28px', borderRadius: '8px', border: 'none', cursor: 'pointer' },
  submitBtn: { padding: '10px 20px', background: '#6366f1', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', alignSelf: 'flex-start' },
  folderDot: { width: '12px', height: '12px', borderRadius: '4px', display: 'inline-block' },
  folderGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' },
  folderCard: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', overflow: 'hidden', cursor: 'pointer', transition: 'border-color 0.15s' },
  folderCardStripe: { height: '4px' },
  folderCardBody: { padding: '16px' },
  folderCardName: { fontSize: '16px', fontWeight: 700, color: '#ffffff', margin: '0 0 6px 0' },
  folderCardDesc: { fontSize: '13px', color: 'rgba(255,255,255,0.4)', margin: '0 0 12px 0', lineHeight: 1.4 },
  folderCardFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  folderCardMeta: { fontSize: '11px', color: 'rgba(255,255,255,0.25)' },
  deleteBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)', cursor: 'pointer', fontSize: '14px', padding: '2px 6px' },
  docGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' },
  docCard: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '16px', cursor: 'pointer', transition: 'border-color 0.15s', position: 'relative' },
  docCardIcon: { fontSize: '28px', marginBottom: '8px' },
  docCardTitle: { fontSize: '14px', fontWeight: 600, color: '#e2e8f0', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  docCardMeta: { fontSize: '11px', color: 'rgba(255,255,255,0.3)', marginBottom: '2px' },
  docCardActions: { position: 'absolute', top: '8px', right: '8px', display: 'flex', gap: '2px' },
  docActionBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)', cursor: 'pointer', fontSize: '13px', padding: '4px' },
  emptyCard: { background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '14px', padding: '40px', textAlign: 'center' },
  emptyText: { color: 'rgba(255,255,255,0.35)', fontSize: '14px', margin: 0 },
  fileBadge: { fontSize: '12px', color: 'rgba(255,255,255,0.3)', fontWeight: 400, marginLeft: '4px' },
  fileViewer: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '14px', overflow: 'hidden', minHeight: '500px' },
  pdfFrame: { width: '100%', height: '80vh', border: 'none', background: '#fff' },
  textViewer: { padding: '24px 32px', color: 'rgba(255,255,255,0.8)', fontSize: '14px', lineHeight: 1.7, fontFamily: "'DM Sans', monospace", whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 },
  previewNote: { padding: '60px 40px', textAlign: 'center', color: 'rgba(255,255,255,0.45)', fontSize: '15px', lineHeight: 1.7 },
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px', padding: '24px', minWidth: '320px', maxWidth: '400px' },
  modalTitle: { fontSize: '16px', fontWeight: 700, color: '#fff', margin: '0 0 16px 0' },
  modalList: { display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px', maxHeight: '300px', overflow: 'auto' },
  modalItem: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', color: '#e2e8f0', fontSize: '14px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500, textAlign: 'left' },
  modalCancel: { width: '100%', padding: '10px', background: 'none', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'rgba(255,255,255,0.5)', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' },
};
