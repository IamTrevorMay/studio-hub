import React from 'react';

export default function DataSourceConfig({ sourceType, config, feeds, onChange }) {
  if (sourceType === 'rss') return <RssConfig config={config} feeds={feeds} onChange={onChange} />;
  if (sourceType === 'triton_api') return <TritonApiConfig config={config} onChange={onChange} />;
  if (sourceType === 'supabase_query') return <CustomQueryConfig config={config} onChange={onChange} />;
  return null;
}

// ─── RSS Feeds ─────────────────────────────────────────────────

function RssConfig({ config, feeds, onChange }) {
  const selectedIds = config.feed_ids || [];
  const newsFeeds = (feeds || []).filter(f => f.source_type === 'news');
  const newsletterFeeds = (feeds || []).filter(f => f.source_type === 'newsletter');

  const toggleFeed = (id) => {
    const next = selectedIds.includes(id)
      ? selectedIds.filter(fid => fid !== id)
      : [...selectedIds, id];
    onChange({ ...config, feed_ids: next });
  };

  const selectAll = () => onChange({ ...config, feed_ids: (feeds || []).map(f => f.id) });
  const deselectAll = () => onChange({ ...config, feed_ids: [] });

  const renderFeedGroup = (label, feedList) => {
    if (feedList.length === 0) return null;
    return (
      <div style={{ marginBottom: '12px' }}>
        <div style={styles.groupLabel}>{label}</div>
        {feedList.map(f => (
          <label key={f.id} style={styles.checkRow}>
            <input
              type="checkbox"
              checked={selectedIds.includes(f.id)}
              onChange={() => toggleFeed(f.id)}
              style={styles.checkbox}
            />
            <span style={styles.feedName}>{f.name}</span>
            {!f.enabled && <span style={styles.disabledBadge}>disabled</span>}
          </label>
        ))}
      </div>
    );
  };

  return (
    <div>
      <div style={styles.row}>
        <button onClick={selectAll} style={styles.miniBtn}>Select All</button>
        <button onClick={deselectAll} style={styles.miniBtn}>Deselect All</button>
        <span style={styles.countBadge}>{selectedIds.length} selected</span>
      </div>
      {renderFeedGroup('News', newsFeeds)}
      {renderFeedGroup('Newsletters', newsletterFeeds)}
      <div style={{ marginTop: '12px' }}>
        <label style={styles.fieldLabel}>Time window</label>
        <select
          value={config.time_window_hours || 48}
          onChange={e => onChange({ ...config, time_window_hours: parseInt(e.target.value) })}
          style={styles.select}
        >
          <option value={24}>Last 24 hours</option>
          <option value={48}>Last 48 hours</option>
          <option value={72}>Last 72 hours</option>
        </select>
      </div>
    </div>
  );
}

// ─── Triton API ────────────────────────────────────────────────

function TritonApiConfig({ config, onChange }) {
  return (
    <div>
      <label style={styles.fieldLabel}>Endpoint URL</label>
      <input
        style={styles.input}
        value={config.endpoint || ''}
        onChange={e => onChange({ ...config, endpoint: e.target.value })}
        placeholder="https://www.tritonapex.io/api/..."
      />
      <label style={styles.fieldLabel}>Method</label>
      <div style={styles.row}>
        {['GET', 'POST'].map(m => (
          <button
            key={m}
            onClick={() => onChange({ ...config, method: m })}
            style={{
              ...styles.methodBtn,
              ...(config.method === m ? styles.methodBtnActive : {}),
            }}
          >{m}</button>
        ))}
      </div>
      <label style={styles.fieldLabel}>Parameters (JSON)</label>
      <textarea
        style={styles.textarea}
        value={config.params || '{}'}
        onChange={e => onChange({ ...config, params: e.target.value })}
        rows={4}
        placeholder='{"key": "value"}'
      />
      <label style={styles.fieldLabel}>Headers (JSON, optional)</label>
      <textarea
        style={styles.textarea}
        value={config.headers || ''}
        onChange={e => onChange({ ...config, headers: e.target.value })}
        rows={3}
        placeholder='{"Authorization": "Bearer ..."}'
      />
    </div>
  );
}

// ─── Custom Query ──────────────────────────────────────────────

function CustomQueryConfig({ config, onChange }) {
  return (
    <div>
      <label style={styles.fieldLabel}>Table name</label>
      <input
        style={styles.input}
        value={config.table || ''}
        onChange={e => onChange({ ...config, table: e.target.value })}
        placeholder="research_articles"
      />
      <label style={styles.fieldLabel}>Select columns</label>
      <input
        style={styles.input}
        value={config.select || '*'}
        onChange={e => onChange({ ...config, select: e.target.value })}
        placeholder="id, title, description"
      />
      <label style={styles.fieldLabel}>Filters (JSON array)</label>
      <textarea
        style={styles.textarea}
        value={config.filters || '[]'}
        onChange={e => onChange({ ...config, filters: e.target.value })}
        rows={3}
        placeholder='[{"column": "status", "op": "eq", "value": "published"}]'
      />
      <div style={styles.row}>
        <div style={{ flex: 1 }}>
          <label style={styles.fieldLabel}>Limit</label>
          <input
            style={styles.input}
            type="number"
            value={config.limit || 100}
            onChange={e => onChange({ ...config, limit: parseInt(e.target.value) || 100 })}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={styles.fieldLabel}>Order by</label>
          <input
            style={styles.input}
            value={config.order_by || ''}
            onChange={e => onChange({ ...config, order_by: e.target.value })}
            placeholder="created_at desc"
          />
        </div>
      </div>
    </div>
  );
}

// ─── Styles ────────────────────────────────────────────────────

const styles = {
  fieldLabel: {
    display: 'block',
    fontSize: '12px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: '6px',
    marginTop: '12px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  groupLabel: {
    fontSize: '11px',
    fontWeight: 700,
    color: 'rgba(255,255,255,0.35)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '6px',
  },
  input: {
    width: '100%',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '6px',
    color: '#ffffff',
    fontSize: '13px',
    padding: '8px 12px',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  textarea: {
    width: '100%',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '6px',
    color: '#ffffff',
    fontSize: '13px',
    padding: '8px 12px',
    fontFamily: "'DM Sans', monospace",
    resize: 'vertical',
    boxSizing: 'border-box',
  },
  select: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '6px',
    color: '#ffffff',
    fontSize: '13px',
    padding: '8px 12px',
    fontFamily: 'inherit',
  },
  checkRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '4px 0',
    cursor: 'pointer',
    fontSize: '13px',
    color: 'rgba(255,255,255,0.7)',
  },
  checkbox: {
    accentColor: '#6366f1',
  },
  feedName: {
    flex: 1,
  },
  disabledBadge: {
    fontSize: '10px',
    color: 'rgba(255,255,255,0.25)',
    background: 'rgba(255,255,255,0.04)',
    padding: '1px 6px',
    borderRadius: '4px',
  },
  row: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    marginBottom: '8px',
  },
  miniBtn: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '4px',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '11px',
    fontFamily: 'inherit',
    padding: '4px 10px',
    cursor: 'pointer',
  },
  countBadge: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.3)',
    marginLeft: 'auto',
  },
  methodBtn: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '6px',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '12px',
    fontWeight: 600,
    fontFamily: 'inherit',
    padding: '6px 16px',
    cursor: 'pointer',
    transition: 'background 0.12s, border-color 0.12s, color 0.12s',
  },
  methodBtnActive: {
    background: 'rgba(99,102,241,0.15)',
    borderColor: 'rgba(99,102,241,0.4)',
    color: '#a5b4fc',
  },
};
