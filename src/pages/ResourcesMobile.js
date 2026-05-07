import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { mobileTokens } from '../utils/mobileTokens';

const FN_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/google-drive-resources`;

// Read-only mobile view of the team Resources Google Drive folder.
// Browse folders, tap to open files in Drive. No create/rename/delete.

export default function ResourcesMobile() {
  const { profile } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rootId, setRootId] = useState(null);
  const [path, setPath] = useState([]);

  const currentFolderId = path.length > 0 ? path[path.length - 1].id : rootId;

  const callFn = useCallback(async (folderId) => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error('Not authenticated');
    const query = folderId ? `?folderId=${encodeURIComponent(folderId)}` : '';
    const res = await fetch(FN_URL + query, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }, []);

  const fetchItems = useCallback(async (folderId) => {
    setLoading(true);
    setError(null);
    try {
      const data = await callFn(folderId || null);
      setItems(data.items || []);
      if (!rootId && data.rootId) setRootId(data.rootId);
    } catch (err) {
      setError(err.message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [callFn, rootId]);

  useEffect(() => {
    if (!profile?.id) return;
    fetchItems(currentFolderId || null);
  }, [profile?.id, currentFolderId, fetchItems]);

  function openItem(item) {
    if (item.type === 'folder') {
      setPath((prev) => [...prev, { id: item.id, name: item.name }]);
    } else if (item.url) {
      window.open(item.url, '_blank', 'noopener,noreferrer');
    }
  }

  function goUp() {
    setPath((prev) => prev.slice(0, -1));
  }

  return (
    <div style={styles.root}>
      {path.length > 0 && (
        <div style={styles.breadcrumb}>
          <button onClick={goUp} style={styles.upBtn} aria-label="Back to parent folder">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 4l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span style={styles.breadcrumbName}>{path[path.length - 1].name}</span>
        </div>
      )}

      {loading ? (
        <p style={styles.empty}>Loading…</p>
      ) : error ? (
        <p style={{ ...styles.empty, color: '#fca5a5' }}>{error}</p>
      ) : items.length === 0 ? (
        <p style={styles.empty}>This folder is empty.</p>
      ) : (
        <ul style={styles.list}>
          {items.map((item) => (
            <li key={item.id}>
              <button onClick={() => openItem(item)} style={styles.row}>
                <span style={styles.icon}>
                  {item.type === 'folder' ? (
                    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <path d="M3 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V6z" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <path d="M6 3h7l5 5v11a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z" strokeLinejoin="round" />
                      <path d="M13 3v5h5" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span style={styles.name}>{item.name}</span>
                {item.type === 'folder' && (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" style={styles.chevron}>
                    <path d="M5 3l4 4-4 4" />
                  </svg>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const styles = {
  root: {
    minHeight: '100%',
    background: '#0f0f1a',
    color: '#e2e8f0',
  },
  breadcrumb: {
    display: 'flex',
    alignItems: 'center',
    gap: mobileTokens.space.sm,
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.lg}px`,
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  upBtn: {
    width: mobileTokens.tap,
    height: mobileTokens.tap,
    border: 'none',
    background: 'transparent',
    color: 'rgba(255,255,255,0.7)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'inherit',
    margin: -mobileTokens.space.sm,
  },
  breadcrumbName: {
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    color: '#fff',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
  row: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: mobileTokens.space.md,
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.lg}px`,
    background: 'transparent',
    border: 'none',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    color: '#e2e8f0',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
    minHeight: mobileTokens.tap + 8,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: mobileTokens.radius.sm,
    background: 'rgba(99,102,241,0.12)',
    color: '#a5b4fc',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  name: {
    flex: 1,
    fontSize: mobileTokens.font.md,
    color: '#e2e8f0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  chevron: {
    color: 'rgba(255,255,255,0.3)',
    flexShrink: 0,
  },
  empty: {
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    fontSize: mobileTokens.font.md,
    padding: mobileTokens.space.xxl,
    margin: 0,
  },
};
