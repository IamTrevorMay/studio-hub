import React from 'react';
import { DATA_SOURCE_TYPES, DEFAULT_SOURCE_CONFIGS } from './reportBuilderConstants';

// Multi-source mode: dataSources is an array of { type, config }
// Toggle sources on/off, render config panel for each enabled source

export default function DataSourceConfig({ dataSources, feeds, onChange }) {
  const enabledTypes = new Set((dataSources || []).map(s => s.type));

  const toggleSource = (type) => {
    if (enabledTypes.has(type)) {
      onChange((dataSources || []).filter(s => s.type !== type));
    } else {
      onChange([...(dataSources || []), { type, config: { ...DEFAULT_SOURCE_CONFIGS[type] } }]);
    }
  };

  const updateSourceConfig = (type, newConfig) => {
    onChange((dataSources || []).map(s => s.type === type ? { ...s, config: newConfig } : s));
  };

  return (
    <div>
      {/* Source type toggles */}
      <div style={styles.sourceToggles}>
        {DATA_SOURCE_TYPES.map(src => (
          <button
            key={src.key}
            onClick={() => toggleSource(src.key)}
            style={{
              ...styles.sourceToggle,
              ...(enabledTypes.has(src.key) ? styles.sourceToggleActive : {}),
            }}
          >
            <div style={styles.toggleCheck}>
              {enabledTypes.has(src.key) && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </div>
            <div>
              <div style={styles.sourceToggleLabel}>{src.label}</div>
              <div style={styles.sourceToggleDesc}>{src.description}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Config panels for enabled sources */}
      {(dataSources || []).map(source => (
        <div key={source.type} style={styles.sourcePanel}>
          <div style={styles.sourcePanelHeader}>
            {DATA_SOURCE_TYPES.find(t => t.key === source.type)?.label || source.type}
          </div>
          {source.type === 'rss' && (
            <RssConfig config={source.config} feeds={feeds} onChange={c => updateSourceConfig('rss', c)} />
          )}
          {source.type === 'triton_api' && (
            <TritonApiConfig config={source.config} onChange={c => updateSourceConfig('triton_api', c)} />
          )}
          {source.type === 'supabase_query' && (
            <CustomQueryConfig config={source.config} onChange={c => updateSourceConfig('supabase_query', c)} />
          )}
        </div>
      ))}

      {(dataSources || []).length === 0 && (
        <div style={styles.noSources}>Select at least one data source above</div>
      )}
    </div>
  );
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
  sourceToggles: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    marginBottom: '16px',
  },
  sourceToggle: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '8px',
    padding: '10px 14px',
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'inherit',
    transition: 'border-color 0.12s, background 0.12s',
  },
  sourceToggleActive: {
    background: 'rgba(99,102,241,0.06)',
    borderColor: 'rgba(99,102,241,0.35)',
  },
  toggleCheck: {
    width: '18px',
    height: '18px',
    borderRadius: '4px',
    border: '1px solid rgba(255,255,255,0.15)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: '1px',
    color: '#a5b4fc',
  },
  sourceToggleLabel: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#e2e8f0',
  },
  sourceToggleDesc: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.35)',
    marginTop: '1px',
  },
  sourcePanel: {
    background: 'rgba(255,255,255,0.01)',
    border: '1px solid rgba(255,255,255,0.04)',
    borderRadius: '8px',
    padding: '14px',
    marginBottom: '10px',
  },
  sourcePanelHeader: {
    fontSize: '12px',
    fontWeight: 700,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '10px',
  },
  noSources: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.25)',
    textAlign: 'center',
    padding: '16px 0',
  },
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
  checkbox: { accentColor: '#6366f1' },
  feedName: { flex: 1 },
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
