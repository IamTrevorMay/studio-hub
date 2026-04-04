import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../supabaseClient';

export default function SubscriberPanel({ configs, onBack }) {
  const [subscribers, setSubscribers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterConfigId, setFilterConfigId] = useState('all');
  const [showAddForm, setShowAddForm] = useState(false);
  const [addEmail, setAddEmail] = useState('');
  const [addName, setAddName] = useState('');
  const [addConfigId, setAddConfigId] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const fetchSubscribers = useCallback(async () => {
    const { data, error } = await supabase
      .from('newsletter_subscribers')
      .select('*, config:report_configs(id, name)')
      .is('unsubscribed_at', null)
      .order('created_at', { ascending: false });
    if (!error && data) setSubscribers(data);
    setLoading(false);
  }, []);

  useEffect(() => { fetchSubscribers(); }, [fetchSubscribers]);

  const handleAdd = useCallback(async () => {
    if (!addEmail.trim()) return;
    setSaving(true);
    const { error } = await supabase
      .from('newsletter_subscribers')
      .insert({
        email: addEmail.trim().toLowerCase(),
        name: addName.trim() || null,
        report_config_id: addConfigId || null,
        confirmed: true, // manually added = confirmed
      });
    if (!error) {
      setAddEmail('');
      setAddName('');
      setAddConfigId('');
      setShowAddForm(false);
      await fetchSubscribers();
    } else {
      console.error('Add subscriber error:', error);
    }
    setSaving(false);
  }, [addEmail, addName, addConfigId, fetchSubscribers]);

  const handleDelete = useCallback(async (id) => {
    await supabase.from('newsletter_subscribers').delete().eq('id', id);
    setSubscribers(prev => prev.filter(s => s.id !== id));
    setConfirmDeleteId(null);
  }, []);

  const filtered = filterConfigId === 'all'
    ? subscribers
    : filterConfigId === 'global'
      ? subscribers.filter(s => !s.report_config_id)
      : subscribers.filter(s => s.report_config_id === filterConfigId);

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>Subscribers</h2>
          <p style={styles.subtitle}>{subscribers.length} subscriber{subscribers.length !== 1 ? 's' : ''}</p>
        </div>
        <div style={styles.headerActions}>
          <button onClick={() => setShowAddForm(!showAddForm)} style={styles.addBtn}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Subscriber
          </button>
        </div>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div style={styles.addForm}>
          <div style={styles.addRow}>
            <input
              style={styles.input}
              value={addEmail}
              onChange={e => setAddEmail(e.target.value)}
              placeholder="email@example.com"
              type="email"
            />
            <input
              style={{ ...styles.input, maxWidth: '160px' }}
              value={addName}
              onChange={e => setAddName(e.target.value)}
              placeholder="Name (optional)"
            />
            <select
              style={styles.select}
              value={addConfigId}
              onChange={e => setAddConfigId(e.target.value)}
            >
              <option value="">All reports</option>
              {configs.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button onClick={handleAdd} disabled={saving || !addEmail.trim()} style={styles.saveBtn}>
              {saving ? 'Adding...' : 'Add'}
            </button>
            <button onClick={() => setShowAddForm(false)} style={styles.cancelBtn}>Cancel</button>
          </div>
        </div>
      )}

      {/* Filter */}
      <div style={styles.filterRow}>
        <span style={styles.filterLabel}>Filter:</span>
        <select
          style={styles.filterSelect}
          value={filterConfigId}
          onChange={e => setFilterConfigId(e.target.value)}
        >
          <option value="all">All subscribers</option>
          <option value="global">Global (all reports)</option>
          {configs.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div style={styles.empty}>Loading...</div>
      ) : filtered.length === 0 ? (
        <div style={styles.empty}>No subscribers{filterConfigId !== 'all' ? ' for this filter' : ''}. Add one above.</div>
      ) : (
        <div style={styles.table}>
          <div style={styles.tableHeader}>
            <span style={{ ...styles.cell, flex: 2 }}>Email</span>
            <span style={{ ...styles.cell, flex: 1 }}>Name</span>
            <span style={{ ...styles.cell, flex: 1.5 }}>Report</span>
            <span style={{ ...styles.cell, flex: 0.7 }}>Status</span>
            <span style={{ ...styles.cell, flex: 0.8 }}>Added</span>
            <span style={{ ...styles.cell, flex: 0.5 }} />
          </div>
          {filtered.map(sub => (
            <div key={sub.id} style={styles.tableRow}>
              <span style={{ ...styles.cell, flex: 2, color: '#e2e8f0' }}>{sub.email}</span>
              <span style={{ ...styles.cell, flex: 1 }}>{sub.name || '—'}</span>
              <span style={{ ...styles.cell, flex: 1.5 }}>
                {sub.config?.name || (sub.report_config_id ? 'Unknown' : 'All reports')}
              </span>
              <span style={{ ...styles.cell, flex: 0.7 }}>
                <span style={{
                  ...styles.statusBadge,
                  background: sub.confirmed ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.15)',
                  color: sub.confirmed ? '#22c55e' : '#f59e0b',
                }}>
                  {sub.confirmed ? 'Confirmed' : 'Pending'}
                </span>
              </span>
              <span style={{ ...styles.cell, flex: 0.8, fontSize: '11px' }}>
                {new Date(sub.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
              <span style={{ ...styles.cell, flex: 0.5, justifyContent: 'flex-end' }}>
                {confirmDeleteId === sub.id ? (
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button onClick={() => handleDelete(sub.id)} style={{ ...styles.miniBtn, color: '#ef4444' }}>Yes</button>
                    <button onClick={() => setConfirmDeleteId(null)} style={styles.miniBtn}>No</button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmDeleteId(sub.id)} style={styles.miniBtn}>Remove</button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    flex: 1,
    overflowY: 'auto',
    padding: '24px',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: '16px',
  },
  title: {
    fontSize: '20px',
    fontWeight: 700,
    color: '#ffffff',
    margin: '0 0 2px 0',
  },
  subtitle: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.35)',
    margin: 0,
  },
  headerActions: {
    display: 'flex',
    gap: '8px',
  },
  addBtn: {
    background: '#6366f1',
    border: 'none',
    borderRadius: '8px',
    color: '#ffffff',
    fontSize: '13px',
    fontWeight: 600,
    fontFamily: 'inherit',
    padding: '8px 18px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  addForm: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '10px',
    padding: '14px',
    marginBottom: '16px',
  },
  addRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  input: {
    flex: 1,
    minWidth: '160px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '6px',
    color: '#ffffff',
    fontSize: '13px',
    padding: '8px 12px',
    fontFamily: 'inherit',
  },
  select: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '6px',
    color: '#ffffff',
    fontSize: '13px',
    padding: '8px 12px',
    fontFamily: 'inherit',
    minWidth: '140px',
  },
  saveBtn: {
    background: '#6366f1',
    border: 'none',
    borderRadius: '6px',
    color: '#ffffff',
    fontSize: '13px',
    fontWeight: 600,
    fontFamily: 'inherit',
    padding: '8px 18px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  cancelBtn: {
    background: 'none',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '6px',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '13px',
    fontFamily: 'inherit',
    padding: '8px 14px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  filterRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '14px',
  },
  filterLabel: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.35)',
    fontWeight: 600,
  },
  filterSelect: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '6px',
    color: 'rgba(255,255,255,0.7)',
    fontSize: '12px',
    padding: '5px 10px',
    fontFamily: 'inherit',
  },
  empty: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.3)',
    textAlign: 'center',
    padding: '40px 0',
  },
  table: {
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '10px',
    overflow: 'hidden',
  },
  tableHeader: {
    display: 'flex',
    padding: '10px 14px',
    background: 'rgba(255,255,255,0.03)',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    fontSize: '11px',
    fontWeight: 700,
    color: 'rgba(255,255,255,0.35)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  tableRow: {
    display: 'flex',
    padding: '10px 14px',
    borderBottom: '1px solid rgba(255,255,255,0.03)',
    fontSize: '13px',
    color: 'rgba(255,255,255,0.5)',
    alignItems: 'center',
  },
  cell: {
    display: 'flex',
    alignItems: 'center',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    paddingRight: '8px',
  },
  statusBadge: {
    fontSize: '10px',
    fontWeight: 600,
    padding: '2px 7px',
    borderRadius: '4px',
  },
  miniBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.35)',
    fontSize: '11px',
    fontFamily: 'inherit',
    cursor: 'pointer',
    padding: '2px 6px',
  },
};
