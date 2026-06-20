import React, { useState, useEffect } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { supabase } from '../../supabaseClient';

function idFromPath() {
  const m = window.location.pathname.match(/^\/brief\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export default function PublicBrief() {
  const [brief, setBrief] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const id = idFromPath();
    if (!id) { setError('Missing brief id'); setLoading(false); return; }
    (async () => {
      const { data, error: dbErr } = await supabase
        .from('campaign_briefs')
        .select('id, label, url, type, source_type, onepager_md, generated_at, campaign_id')
        .eq('id', id)
        .maybeSingle();
      if (dbErr || !data) {
        setError(dbErr ? dbErr.message : 'Brief not found or not yet public');
        setLoading(false);
        return;
      }
      setBrief(data);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div style={styles.center}><div style={styles.spinner} /></div>;
  if (error) return <div style={styles.center}><p style={styles.errorText}>{error}</p></div>;

  const onepager = brief.onepager_md;
  const isLinkOnly = !onepager && (brief.source_type === 'link' || brief.type === 'link');

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <p style={styles.eyebrow}>Sponsor Brief</p>
          <h1 style={styles.h1}>{brief.label || 'Brief'}</h1>
        </div>

        {isLinkOnly ? (
          <div style={styles.linkCard}>
            <p style={styles.linkLabel}>External brief</p>
            <a href={brief.url} target="_blank" rel="noopener noreferrer" style={styles.linkAnchor}>
              {brief.url}
            </a>
          </div>
        ) : onepager ? (
          <div
            className="brief-md"
            style={styles.markdown}
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(onepager)) }}
          />
        ) : (
          <div style={styles.linkCard}>
            <p style={styles.linkLabel}>No generated one-pager yet</p>
            <a href={brief.url} target="_blank" rel="noopener noreferrer" style={styles.linkAnchor}>
              View original brief
            </a>
          </div>
        )}

        {brief.generated_at && (
          <p style={styles.footer}>Generated {new Date(brief.generated_at).toLocaleString()}</p>
        )}
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    background: '#0f0f1a',
    color: 'rgba(255,255,255,0.9)',
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
    padding: '48px 24px',
  },
  container: {
    maxWidth: '780px',
    margin: '0 auto',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '16px',
    padding: '40px 48px',
  },
  header: { marginBottom: '32px', paddingBottom: '24px', borderBottom: '1px solid rgba(255,255,255,0.08)' },
  eyebrow: {
    margin: 0,
    fontSize: '12px',
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: '#a5b4fc',
  },
  h1: { margin: '8px 0 4px', fontSize: '28px', fontWeight: 700, color: '#fff' },
  sub: { margin: 0, fontSize: '14px', color: 'rgba(255,255,255,0.5)' },
  markdown: { fontSize: '15px', lineHeight: 1.7 },
  linkCard: {
    padding: '20px 24px',
    background: 'rgba(99,102,241,0.08)',
    border: '1px solid rgba(99,102,241,0.25)',
    borderRadius: '10px',
  },
  linkLabel: { margin: '0 0 6px', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.5)' },
  linkAnchor: { color: '#a5b4fc', fontSize: '15px', textDecoration: 'none', wordBreak: 'break-all' },
  footer: { marginTop: '32px', fontSize: '11px', color: 'rgba(255,255,255,0.35)', textAlign: 'right' },
  center: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#0f0f1a',
  },
  errorText: { color: '#fca5a5', fontSize: '14px' },
  spinner: {
    width: '36px', height: '36px',
    border: '3px solid rgba(99,102,241,0.2)',
    borderTopColor: '#6366f1',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
};

const styleSheet = document.createElement('style');
styleSheet.textContent = `
  .brief-md h2 { font-size: 18px; font-weight: 700; color: #fff; margin: 28px 0 10px; letter-spacing: -0.01em; }
  .brief-md h2:first-child { margin-top: 0; }
  .brief-md p { margin: 0 0 12px; color: rgba(255,255,255,0.78); }
  .brief-md ul { margin: 0 0 16px; padding-left: 22px; color: rgba(255,255,255,0.78); }
  .brief-md li { margin-bottom: 6px; }
  .brief-md strong { color: #fff; font-weight: 600; }
  .brief-md a { color: #a5b4fc; }
  .brief-md code { background: rgba(99,102,241,0.15); padding: 1px 6px; border-radius: 4px; font-size: 13px; }
`;
if (typeof document !== 'undefined' && !document.getElementById('brief-md-styles')) {
  styleSheet.id = 'brief-md-styles';
  document.head.appendChild(styleSheet);
}
