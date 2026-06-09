import React, { useState } from 'react';
import { PLATFORM_META } from '../constants';
import { styles } from '../styles';
import YouTubeCSVUpload from './YouTubeCSVUpload';
import TikTokCSVUpload from './TikTokCSVUpload';
import ManualMetricsForm from './ManualMetricsForm';

const DATA_INPUT_TABS = [
  { key: 'youtube',   label: 'YouTube' },
  { key: 'tiktok',    label: 'TikTok' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'facebook',  label: 'Facebook' },
  { key: 'substack',  label: 'Substack' },
  { key: 'twitch',    label: 'Twitch' },
];

export default function DataInputSection({ profile, accounts }) {
  const [activeTab, setActiveTab] = useState('youtube');
  const meta = PLATFORM_META[activeTab] || {};

  return (
    <div style={{ padding: '16px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', marginTop: '8px' }}>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {DATA_INPUT_TABS.map(t => {
          const pm = PLATFORM_META[t.key] || {};
          const isActive = activeTab === t.key;
          return (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              style={{
                ...styles.filterChip,
                ...(isActive ? { background: (pm.color || '#666') + '22', borderColor: (pm.color || '#666') + '66', color: pm.color || '#666' } : {}),
              }}>
              {t.label}
            </button>
          );
        })}
      </div>
      {activeTab === 'youtube' && <YouTubeCSVUpload profile={profile} />}
      {activeTab === 'tiktok' && (
        <div>
          <TikTokCSVUpload profile={profile} accounts={accounts} />
          <div style={{ marginTop: '16px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '12px' }}>
            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Manual Input</span>
            <ManualMetricsForm platform="tiktok" fields={['followers']} accounts={accounts} />
          </div>
        </div>
      )}
      {activeTab === 'instagram' && <ManualMetricsForm platform="instagram" fields={['views', 'followers']} accounts={accounts} />}
      {activeTab === 'facebook' && <ManualMetricsForm platform="facebook" fields={['views', 'revenue', 'followers']} accounts={accounts} />}
      {activeTab === 'substack' && <ManualMetricsForm platform="substack" fields={['views', 'revenue', 'supporters', 'followers']} accounts={accounts} />}
      {activeTab === 'twitch' && <ManualMetricsForm platform="twitch" fields={['revenue']} accounts={accounts} />}
    </div>
  );
}
