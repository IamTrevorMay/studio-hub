import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import ReportList from './reportbuilder/ReportList';
import ReportEditor from './reportbuilder/ReportEditor';
import SubscriberPanel from './reportbuilder/SubscriberPanel';

export default function ReportBuilder({ onBack }) {
  const { profile } = useAuth();
  const [view, setView] = useState('list'); // 'list' | 'editor' | 'subscribers'
  const [configs, setConfigs] = useState([]);
  const [feeds, setFeeds] = useState([]);
  const [lastRuns, setLastRuns] = useState(new Map());
  const [editingConfig, setEditingConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // ── Fetch data on mount ────────────────────────────────────

  const fetchConfigs = useCallback(async () => {
    const { data, error } = await supabase
      .from('report_configs')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && data) setConfigs(data);
  }, []);

  const fetchFeeds = useCallback(async () => {
    const { data, error } = await supabase
      .from('research_feeds')
      .select('id, name, url, source_type, enabled')
      .order('name');
    if (!error && data) setFeeds(data);
  }, []);

  const fetchLastRuns = useCallback(async () => {
    const { data, error } = await supabase
      .from('report_runs')
      .select('report_config_id, date, status')
      .order('date', { ascending: false });
    if (!error && data) {
      const map = new Map();
      for (const run of data) {
        if (!map.has(run.report_config_id)) {
          map.set(run.report_config_id, run);
        }
      }
      setLastRuns(map);
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchConfigs(), fetchFeeds(), fetchLastRuns()])
      .finally(() => setLoading(false));
  }, [fetchConfigs, fetchFeeds, fetchLastRuns]);

  // ── Handlers ───────────────────────────────────────────────

  const handleNew = useCallback(() => {
    setEditingConfig(null);
    setView('editor');
  }, []);

  const handleEdit = useCallback((id) => {
    const cfg = configs.find(c => c.id === id);
    if (cfg) {
      setEditingConfig(cfg);
      setView('editor');
    }
  }, [configs]);

  const handleSave = useCallback(async (draft) => {
    setSaving(true);
    try {
      if (draft.id) {
        // Update existing
        const { id, created_at, created_by, ...updates } = draft;
        const { error } = await supabase
          .from('report_configs')
          .update(updates)
          .eq('id', id);
        if (error) { console.error('Save error:', error); return; }
      } else {
        // Insert new
        const { error } = await supabase
          .from('report_configs')
          .insert({ ...draft, created_by: profile?.id });
        if (error) { console.error('Save error:', error); return; }
      }
      await fetchConfigs();
      setView('list');
      setEditingConfig(null);
    } finally {
      setSaving(false);
    }
  }, [profile, fetchConfigs]);

  const handleDelete = useCallback(async (id) => {
    const { error } = await supabase.from('report_configs').delete().eq('id', id);
    if (!error) {
      setConfigs(prev => prev.filter(c => c.id !== id));
    }
  }, []);

  const handleToggleEnabled = useCallback(async (id, enabled) => {
    const { error } = await supabase
      .from('report_configs')
      .update({ enabled, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (!error) {
      setConfigs(prev => prev.map(c => c.id === id ? { ...c, enabled } : c));
    }
  }, []);

  const handlePreview = useCallback(async ({ data_sources, instruction, conversation_history }) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return { error: 'Not authenticated' };
      const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
      const resp = await fetch(`${supabaseUrl}/functions/v1/preview-report`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: process.env.REACT_APP_SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ data_sources, instruction, conversation_history }),
      });
      return await resp.json();
    } catch (err) {
      return { error: err.message || 'Preview failed' };
    }
  }, []);

  const [running, setRunning] = useState(false);
  const handleRunNow = useCallback(async () => {
    if (!editingConfig?.id || running) return;
    setRunning(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
      const resp = await fetch(`${supabaseUrl}/functions/v1/run-report`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: process.env.REACT_APP_SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ config_id: editingConfig.id }),
      });
      const result = await resp.json();
      if (result.success) {
        await fetchLastRuns();
      } else {
        console.error('Run failed:', result.error);
      }
    } catch (err) {
      console.error('Run error:', err);
    } finally {
      setRunning(false);
    }
  }, [editingConfig, running, fetchLastRuns]);

  const handleBack = useCallback(() => {
    if (view === 'editor' || view === 'subscribers') {
      setView('list');
      setEditingConfig(null);
    } else {
      onBack();
    }
  }, [view, onBack]);

  // ── Render ─────────────────────────────────────────────────

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <button onClick={handleBack} style={styles.backBtn} title={view === 'editor' ? 'Back to list' : 'Back to Toolbox'}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <span style={styles.headerTitle}>Report Builder</span>
        </div>
        {view === 'list' && (
          <button onClick={() => setView('subscribers')} style={styles.subscribersBtn}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" />
            </svg>
            Subscribers
          </button>
        )}
      </div>

      {/* Content */}
      {view === 'list' && (
        <ReportList
          configs={configs}
          lastRuns={lastRuns}
          loading={loading}
          onNew={handleNew}
          onEdit={handleEdit}
          onToggleEnabled={handleToggleEnabled}
          onDelete={handleDelete}
        />
      )}
      {view === 'editor' && (
        <ReportEditor
          config={editingConfig}
          feeds={feeds}
          saving={saving}
          onSave={handleSave}
          onCancel={() => { setView('list'); setEditingConfig(null); }}
          onRunNow={handleRunNow}
          running={running}
          onPreview={handlePreview}
        />
      )}
      {view === 'subscribers' && (
        <SubscriberPanel
          configs={configs}
          onBack={() => setView('list')}
        />
      )}
    </div>
  );
}

const styles = {
  page: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#0f0f1a',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  backBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.5)',
    cursor: 'pointer',
    padding: '6px',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'color 0.15s',
  },
  headerTitle: {
    fontSize: '16px',
    fontWeight: 700,
    color: '#ffffff',
  },
  subscribersBtn: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '6px',
    color: 'rgba(255,255,255,0.6)',
    fontSize: '13px',
    fontFamily: 'inherit',
    padding: '6px 14px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    transition: 'background 0.12s',
  },
};
