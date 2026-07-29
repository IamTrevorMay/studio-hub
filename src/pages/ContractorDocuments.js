import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationContext';
import backdropDismiss from '../lib/backdropDismiss';
import { colors } from '../lib/styleTokens';

export default function ContractorDocuments() {
  const { user } = useAuth();
  const { refreshNotifications } = useNotifications();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [signingDoc, setSigningDoc] = useState(null);
  const [signedName, setSignedName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [signing, setSigning] = useState(false);
  const [pdfUrl, setPdfUrl] = useState(null);

  const fetchDocuments = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('contractor_documents')
      .select('*')
      .eq('contractor_id', user.id)
      .order('created_at', { ascending: false });
    if (!error) setDocuments(data || []);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const actionRequired = documents.filter(d => d.doc_type === 'signing' && !d.signed_at);
  const allDocs = documents;

  async function openDoc(doc) {
    const { data } = await supabase.storage
      .from('freelancer-documents')
      .createSignedUrl(doc.storage_path, 3600);
    if (data?.signedUrl) {
      if (doc.doc_type === 'reference' || doc.signed_at) {
        window.open(data.signedUrl, '_blank');
      } else {
        setPdfUrl(data.signedUrl);
        setSigningDoc(doc);
        setSignedName('');
        setAgreed(false);
      }
    }
  }

  async function handleSign() {
    if (!signingDoc || !signedName.trim() || !agreed) return;
    setSigning(true);
    const { error } = await supabase
      .from('contractor_documents')
      .update({
        signed_at: new Date().toISOString(),
        signed_name: signedName.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', signingDoc.id);
    if (!error) {
      setSigningDoc(null);
      setPdfUrl(null);
      fetchDocuments();
      refreshNotifications();
    }
    setSigning(false);
  }

  function closeModal() {
    setSigningDoc(null);
    setPdfUrl(null);
    setSignedName('');
    setAgreed(false);
  }

  if (loading) {
    return (
      <div style={styles.page}>
        <h1 style={styles.pageTitle}>Documents</h1>
        <p style={styles.muted}>Loading...</p>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <h1 style={styles.pageTitle}>Documents</h1>

      {/* Action Required */}
      {actionRequired.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <h2 style={styles.sectionTitle}>Action Required</h2>
          <div style={styles.docList}>
            {actionRequired.map(doc => (
              <button
                key={doc.id}
                onClick={() => openDoc(doc)}
                style={styles.docRow}
              >
                <div style={{ flex: 1 }}>
                  <div style={styles.docTitle}>{doc.title}</div>
                  {doc.description && <div style={styles.docDesc}>{doc.description}</div>}
                  <div style={styles.docMeta}>
                    Uploaded {new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                </div>
                <span style={styles.badgeNeedsSign}>Needs Signature</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* All Documents */}
      <div>
        <h2 style={styles.sectionTitle}>All Documents</h2>
        {allDocs.length === 0 ? (
          <p style={styles.muted}>No documents yet.</p>
        ) : (
          <div style={styles.docList}>
            {allDocs.map(doc => (
              <button
                key={doc.id}
                onClick={() => openDoc(doc)}
                style={styles.docRow}
              >
                <div style={{ flex: 1 }}>
                  <div style={styles.docTitle}>{doc.title}</div>
                  {doc.description && <div style={styles.docDesc}>{doc.description}</div>}
                  <div style={styles.docMeta}>
                    Uploaded {new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={doc.doc_type === 'signing' ? styles.badgeSign : styles.badgeRef}>
                    {doc.doc_type === 'signing' ? 'Sign' : 'Reference'}
                  </span>
                  {doc.doc_type === 'signing' && (
                    doc.signed_at
                      ? <span style={styles.badgeSigned}>Signed</span>
                      : <span style={styles.badgeNeedsSign}>Needs Signature</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Signing Modal */}
      {signingDoc && (
        <div style={styles.overlay} {...backdropDismiss(closeModal)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>{signingDoc.title}</h2>
              <button onClick={closeModal} style={styles.closeBtn}>X</button>
            </div>

            {pdfUrl && (
              <iframe
                src={pdfUrl}
                title="Document"
                style={styles.pdfFrame}
              />
            )}

            <div style={styles.signArea}>
              <label style={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={e => setAgreed(e.target.checked)}
                  style={{ marginRight: 8 }}
                />
                <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)' }}>
                  I have read and agree to this document
                </span>
              </label>

              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <label style={styles.label}>Full Legal Name</label>
                  <input
                    type="text"
                    value={signedName}
                    onChange={e => setSignedName(e.target.value)}
                    placeholder="Your full legal name"
                    style={styles.input}
                  />
                </div>
                <div>
                  <label style={styles.label}>Date</label>
                  <input
                    type="text"
                    value={new Date().toLocaleDateString('en-US')}
                    disabled
                    style={{ ...styles.input, opacity: 0.5, width: 120 }}
                  />
                </div>
              </div>

              <button
                onClick={handleSign}
                disabled={!agreed || !signedName.trim() || signing}
                style={{
                  ...styles.signBtn,
                  ...(!agreed || !signedName.trim() ? styles.signBtnDisabled : {}),
                }}
              >
                {signing ? 'Signing...' : 'Sign Document'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  page: {
    padding: '32px 40px',
    maxWidth: 900,
    fontFamily: 'DM Sans, sans-serif',
  },
  pageTitle: {
    fontSize: 26,
    fontWeight: 700,
    color: '#fff',
    margin: '0 0 28px',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    margin: '0 0 12px',
  },
  muted: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 14,
  },
  docList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  docRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '14px 18px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 10,
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
    fontFamily: 'DM Sans, sans-serif',
    color: '#fff',
    transition: 'background 0.15s',
  },
  docTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: '#e2e8f0',
  },
  docDesc: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.45)',
    marginTop: 2,
  },
  docMeta: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.3)',
    marginTop: 4,
  },
  badgeSign: {
    padding: '3px 10px',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    background: colors.accentA12,
    color: colors.accentFg,
    whiteSpace: 'nowrap',
  },
  badgeRef: {
    padding: '3px 10px',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    background: 'rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.5)',
    whiteSpace: 'nowrap',
  },
  badgeSigned: {
    padding: '3px 10px',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    background: 'rgba(34,197,94,0.12)',
    color: '#86efac',
    whiteSpace: 'nowrap',
  },
  badgeNeedsSign: {
    padding: '3px 10px',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    background: 'rgba(245,158,11,0.12)',
    color: '#fbbf24',
    whiteSpace: 'nowrap',
  },
  overlay: {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  modal: {
    background: colors.bgHover,
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 14,
    width: '90%',
    maxWidth: 800,
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '18px 24px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: '#fff',
    margin: 0,
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: 'rgba(255,255,255,0.5)',
    fontSize: 16,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
    fontWeight: 600,
  },
  pdfFrame: {
    width: '100%',
    height: 400,
    border: 'none',
    background: '#fff',
  },
  signArea: {
    padding: '20px 24px',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  checkRow: {
    display: 'flex',
    alignItems: 'center',
    cursor: 'pointer',
  },
  label: {
    fontSize: 12,
    fontWeight: 500,
    color: 'rgba(255,255,255,0.45)',
    display: 'block',
    marginBottom: 4,
  },
  input: {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.05)',
    color: '#fff',
    fontSize: 14,
    fontFamily: 'DM Sans, sans-serif',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  },
  signBtn: {
    padding: '10px 24px',
    borderRadius: 8,
    border: 'none',
    background: colors.accent,
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
    alignSelf: 'flex-end',
  },
  signBtnDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
};
