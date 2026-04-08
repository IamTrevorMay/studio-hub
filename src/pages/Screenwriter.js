import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';

import ScriptEditor from './editors/screenplay-editor/components/editor/ScriptEditor';

class ScreenplayErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ScriptEditor crashed:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 24px', textAlign: 'center', fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif" }}>
          <div style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.5 }}>
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="rgba(239,68,68,0.6)" strokeWidth="1.5">
              <circle cx="24" cy="24" r="20" />
              <path d="M24 14v12M24 30v2" />
            </svg>
          </div>
          <h3 style={{ fontSize: '18px', fontWeight: 600, color: '#e2e8f0', margin: '0 0 8px' }}>Something went wrong</h3>
          <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.4)', maxWidth: '400px', lineHeight: 1.5, margin: '0 0 24px' }}>
            The screenplay editor encountered an unexpected error. Your work has been auto-saved.
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              if (this.props.onBack) this.props.onBack();
            }}
            style={{ padding: '10px 20px', background: 'linear-gradient(135deg, #6366f1, #818cf8)', border: 'none', borderRadius: '10px', color: '#fff', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Return to Dashboard
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function Screenwriter({ initialScriptId, onScriptOpened }) {
  const { user, refreshKey } = useAuth();
  const [scripts, setScripts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [activeScript, setActiveScript] = useState(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  // Consume nav target
  useEffect(() => {
    if (initialScriptId) {
      setActiveScript({ id: initialScriptId });
      if (onScriptOpened) onScriptOpened();
    }
  }, [initialScriptId, onScriptOpened]);

  // Fetch scripts
  const fetchScripts = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setFetchError(null);
    try {
      const { data, error } = await supabase
        .from('screenwriter_scripts')
        .select('id, title, updated_at, created_at, revision_color, locked, content')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });

      if (error) {
        setFetchError(error.message || 'Failed to load scripts');
      } else {
        setScripts(data || []);
      }
    } catch (err) {
      console.error('Error fetching scripts:', err);
      setFetchError('Failed to load scripts');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    const timeout = setTimeout(() => setLoading(false), 5000);
    fetchScripts().finally(() => clearTimeout(timeout));
    return () => clearTimeout(timeout);
  }, [fetchScripts, refreshKey]);

  // Create new script
  const handleCreate = async () => {
    if (!user?.id || creating) return;
    setCreating(true);

    const defaultContent = {
      editorState: null,
      titlePage: { title: '', writtenBy: '', basedOn: '', draft: '', date: '', contact: '' },
      notes: [],
    };

    const { data, error } = await supabase
      .from('screenwriter_scripts')
      .insert({
        user_id: user.id,
        title: 'Untitled Screenplay',
        content: defaultContent,
      })
      .select('id, title, updated_at, created_at, revision_color, locked, content')
      .single();

    if (!error && data) {
      setActiveScript(data);
    }
    setCreating(false);
  };

  // Delete script
  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm('Delete this screenplay? This cannot be undone.')) return;
    setDeletingId(id);
    await supabase.from('screenwriter_scripts').delete().eq('id', id);
    setScripts((prev) => prev.filter((s) => s.id !== id));
    setDeletingId(null);
  };

  // Go back to dashboard
  const handleBack = () => {
    setActiveScript(null);
    fetchScripts();
  };

  // Estimate page count from content
  function estimatePages(content) {
    if (!content) return 0;
    // If we have Lexical editor state, count root children
    if (content.editorState?.root?.children) {
      const lines = content.editorState.root.children.length;
      return Math.max(1, Math.ceil(lines / 54));
    }
    // Legacy format
    if (content.elements?.length) {
      return Math.max(1, Math.ceil(content.elements.length / 54));
    }
    return 0;
  }

  // Format date
  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
  }

  // ─── Active script → render editor ───
  if (activeScript) {
    return (
      <ScreenplayErrorBoundary onBack={handleBack}>
        <ScriptEditor
          docId={activeScript.id}
          title={activeScript.title || 'Untitled Screenplay'}
          docType="screenwriter_scripts"
          onBack={handleBack}
          onSaveTemplate={null}
        />
      </ScreenplayErrorBoundary>
    );
  }

  // ─── Dashboard ───
  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.heading}>Screenwriter</h1>
          <p style={styles.subheading}>Your screenplays and scripts</p>
        </div>
        <button
          onClick={handleCreate}
          disabled={creating}
          style={styles.createBtn}
        >
          {creating ? 'Creating...' : '+ New Screenplay'}
        </button>
      </div>

      {fetchError ? (
        <div style={styles.emptyState}>
          <div style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.5 }}>
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="rgba(239,68,68,0.6)" strokeWidth="1.5">
              <circle cx="24" cy="24" r="20" />
              <path d="M24 14v12M24 30v2" />
            </svg>
          </div>
          <h3 style={styles.emptyTitle}>Failed to load scripts</h3>
          <p style={styles.emptyDesc}>{fetchError}</p>
          <button onClick={fetchScripts} style={styles.createBtn}>Retry</button>
        </div>
      ) : loading ? (
        <div style={styles.loadingState}>
          <div style={styles.spinner} />
          <span>Loading scripts...</span>
        </div>
      ) : scripts.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5">
              <rect x="8" y="4" width="32" height="40" rx="3" />
              <path d="M16 14h16M16 20h16M16 26h10" />
            </svg>
          </div>
          <h3 style={styles.emptyTitle}>No screenplays yet</h3>
          <p style={styles.emptyDesc}>Create your first screenplay to get started with the industry-standard screenwriting editor.</p>
          <button onClick={handleCreate} disabled={creating} style={styles.createBtn}>
            {creating ? 'Creating...' : '+ New Screenplay'}
          </button>
        </div>
      ) : (
        <div style={styles.grid}>
          {scripts.map((script) => {
            const pages = estimatePages(script.content);
            return (
              <button
                key={script.id}
                style={styles.card}
                onClick={() => setActiveScript(script)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(99,102,241,0.4)';
                  e.currentTarget.style.background = 'rgba(99,102,241,0.06)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
                  e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                }}
              >
                {/* Card top: icon area */}
                <div style={styles.cardIcon}>
                  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="rgba(165,180,252,0.5)" strokeWidth="1.2">
                    <rect x="6" y="3" width="20" height="26" rx="2" />
                    <path d="M11 10h10M11 14h10M11 18h6" />
                  </svg>
                  {script.locked && (
                    <span style={styles.lockBadge} title="Locked">
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="rgba(251,191,36,0.7)">
                        <rect x="2" y="5" width="6" height="4" rx="1" />
                        <path d="M3 5V3.5a2 2 0 014 0V5" fill="none" stroke="rgba(251,191,36,0.7)" strokeWidth="1" />
                      </svg>
                    </span>
                  )}
                </div>

                {/* Title */}
                <div style={styles.cardTitle}>{script.title || 'Untitled Screenplay'}</div>

                {/* Meta */}
                <div style={styles.cardMeta}>
                  <span>{formatDate(script.updated_at)}</span>
                  {pages > 0 && <span>{pages} {pages === 1 ? 'pg' : 'pgs'}</span>}
                </div>

                {/* Revision color dot */}
                {script.revision_color && script.revision_color !== 'white' && (
                  <div
                    style={{
                      ...styles.revDot,
                      background: REVISION_COLORS[script.revision_color] || 'transparent',
                    }}
                    title={`Revision: ${script.revision_color}`}
                  />
                )}

                {/* Delete button */}
                <button
                  onClick={(e) => handleDelete(script.id, e)}
                  style={styles.deleteBtn}
                  title="Delete screenplay"
                  disabled={deletingId === script.id}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
                    <path d="M3 4h8M5 4V3a1 1 0 011-1h2a1 1 0 011 1v1M6 6.5v3M8 6.5v3M4 4l.5 7a1 1 0 001 1h3a1 1 0 001-1L10 4" />
                  </svg>
                </button>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const REVISION_COLORS = {
  blue: '#60a5fa',
  pink: '#f472b6',
  yellow: '#fbbf24',
  green: '#34d399',
  goldenrod: '#d97706',
  buff: '#d4a574',
  salmon: '#f87171',
  cherry: '#dc2626',
};

const styles = {
  root: {
    padding: '32px 40px',
    maxWidth: '1100px',
    margin: '0 auto',
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '32px',
    flexWrap: 'wrap',
    gap: '16px',
  },
  heading: {
    fontSize: '26px',
    fontWeight: 700,
    color: '#e2e8f0',
    margin: 0,
    letterSpacing: '-0.3px',
  },
  subheading: {
    fontSize: '14px',
    color: 'rgba(255,255,255,0.4)',
    margin: '4px 0 0',
  },
  createBtn: {
    padding: '10px 20px',
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    border: 'none',
    borderRadius: '10px',
    color: '#fff',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'opacity 0.15s',
    whiteSpace: 'nowrap',
  },
  loadingState: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    padding: '80px 0',
    color: 'rgba(255,255,255,0.35)',
    fontSize: '14px',
  },
  spinner: {
    width: '20px',
    height: '20px',
    border: '2px solid rgba(255,255,255,0.1)',
    borderTopColor: '#6366f1',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '80px 0',
    textAlign: 'center',
  },
  emptyIcon: {
    marginBottom: '16px',
    opacity: 0.5,
  },
  emptyTitle: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#e2e8f0',
    margin: '0 0 8px',
  },
  emptyDesc: {
    fontSize: '14px',
    color: 'rgba(255,255,255,0.4)',
    maxWidth: '360px',
    lineHeight: 1.5,
    margin: '0 0 24px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: '16px',
  },
  card: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    padding: '20px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '14px',
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'inherit',
    color: '#e2e8f0',
    transition: 'all 0.15s',
    minHeight: '140px',
  },
  cardIcon: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginBottom: '14px',
  },
  lockBadge: {
    display: 'flex',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: '15px',
    fontWeight: 600,
    color: '#e2e8f0',
    marginBottom: '8px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  cardMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '12px',
    color: 'rgba(255,255,255,0.35)',
    marginTop: 'auto',
  },
  revDot: {
    position: 'absolute',
    top: '12px',
    right: '12px',
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },
  deleteBtn: {
    position: 'absolute',
    bottom: '10px',
    right: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    border: 'none',
    borderRadius: '6px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.2)',
    cursor: 'pointer',
    transition: 'all 0.15s',
    padding: 0,
  },
};
