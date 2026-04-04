import React, { useState, useEffect, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';

// Use anon client for public reads (report_configs has public RLS policy)
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
const publicClient = createClient(supabaseUrl, supabaseAnonKey);

export default function SubscribePage() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedReportId, setSelectedReportId] = useState(null);
  const [selectedReport, setSelectedReport] = useState(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // { success, message } or { error }

  // Parse slug from URL: /subscribe/some-slug
  const slug = window.location.pathname.replace(/^\/subscribe\/?/, '').replace(/\/$/, '') || null;

  // Fetch available reports
  useEffect(() => {
    async function load() {
      const { data } = await publicClient
        .from('report_configs')
        .select('id, name, slug, description, subscribe_headline, subscribe_description, subscribe_accent_color, subscribe_logo_url')
        .eq('enabled', true)
        .order('name');

      if (data) {
        setReports(data);
        // If slug in URL, find matching report
        if (slug) {
          const match = data.find(r => r.slug === slug);
          if (match) {
            setSelectedReportId(match.id);
            setSelectedReport(match);
          }
        }
      }
      setLoading(false);
    }
    load();
  }, [slug]);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    setResult(null);

    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/public-subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: supabaseAnonKey },
        body: JSON.stringify({
          email: email.trim(),
          name: name.trim() || undefined,
          report_config_id: selectedReportId || undefined,
        }),
      });
      const data = await resp.json();
      if (resp.ok) {
        setResult({ success: true, message: data.message });
        setEmail('');
        setName('');
      } else {
        setResult({ error: data.error || 'Something went wrong' });
      }
    } catch {
      setResult({ error: 'Network error. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  }, [email, name, selectedReportId]);

  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.loadingText}>Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        {/* Header */}
        <div style={styles.header}>
          {selectedReport?.subscribe_logo_url ? (
            <img src={selectedReport.subscribe_logo_url} alt="" style={styles.logoImg} />
          ) : (
            <div style={{
              ...styles.logoMark,
              background: selectedReport?.subscribe_accent_color
                ? `linear-gradient(135deg, ${selectedReport.subscribe_accent_color}, ${selectedReport.subscribe_accent_color}cc)`
                : 'linear-gradient(135deg, #6366f1, #4f46e5)',
            }} />
          )}
          <h1 style={styles.title}>
            {selectedReport?.subscribe_headline || selectedReport?.name || 'Subscribe to Reports'}
          </h1>
          <p style={styles.subtitle}>
            {selectedReport?.subscribe_description || selectedReport
              ? (selectedReport?.subscribe_description || selectedReport?.description || 'Get this report delivered to your inbox.')
              : 'Get AI-powered reports delivered straight to your inbox.'
            }
          </p>
        </div>

        {/* Success state */}
        {result?.success ? (
          <div style={styles.successBox}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" style={{ marginBottom: '12px' }}>
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <div style={styles.successTitle}>You're in!</div>
            <div style={styles.successText}>{result.message}</div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={styles.form}>
            {/* Report selector (only if no slug and multiple reports) */}
            {!slug && reports.length > 1 && (
              <div style={styles.reportList}>
                <button
                  type="button"
                  onClick={() => { setSelectedReportId(null); setSelectedReport(null); }}
                  style={{
                    ...styles.reportOption,
                    ...(selectedReportId === null ? styles.reportOptionActive : {}),
                  }}
                >
                  <div style={styles.reportOptionName}>All Reports</div>
                  <div style={styles.reportOptionDesc}>Receive every report we publish</div>
                </button>
                {reports.map(r => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => { setSelectedReportId(r.id); setSelectedReport(r); }}
                    style={{
                      ...styles.reportOption,
                      ...(selectedReportId === r.id ? styles.reportOptionActive : {}),
                    }}
                  >
                    <div style={styles.reportOptionName}>{r.name}</div>
                    {r.description && <div style={styles.reportOptionDesc}>{r.description}</div>}
                  </button>
                ))}
              </div>
            )}

            {/* Email + name inputs */}
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Your email address"
              required
              style={styles.input}
            />
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Your name (optional)"
              style={styles.input}
            />

            {/* Error */}
            {result?.error && (
              <div style={styles.errorBox}>{result.error}</div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting || !email.trim()}
              style={{
                ...styles.submitBtn,
                ...(selectedReport?.subscribe_accent_color ? { background: selectedReport.subscribe_accent_color } : {}),
                ...(submitting ? { opacity: 0.6 } : {}),
              }}
            >
              {submitting ? 'Subscribing...' : 'Subscribe'}
            </button>

            <div style={styles.privacy}>
              We respect your inbox. Unsubscribe anytime.
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    background: '#0f0f1a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 20px',
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  },
  card: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '20px',
    padding: '48px',
    maxWidth: '460px',
    width: '100%',
  },
  header: {
    textAlign: 'center',
    marginBottom: '32px',
  },
  logoMark: {
    width: '40px',
    height: '40px',
    borderRadius: '10px',
    background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
    margin: '0 auto 16px',
  },
  title: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#ffffff',
    margin: '0 0 8px 0',
  },
  subtitle: {
    fontSize: '14px',
    color: 'rgba(255,255,255,0.45)',
    margin: 0,
    lineHeight: 1.5,
  },
  logoImg: {
    maxHeight: '48px',
    maxWidth: '160px',
    margin: '0 auto 16px',
    display: 'block',
    borderRadius: '8px',
  },
  loadingText: {
    textAlign: 'center',
    color: 'rgba(255,255,255,0.3)',
    fontSize: '14px',
    padding: '40px 0',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  reportList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    marginBottom: '8px',
  },
  reportOption: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '10px',
    padding: '12px 16px',
    textAlign: 'left',
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'border-color 0.12s, background 0.12s',
  },
  reportOptionActive: {
    background: 'rgba(99,102,241,0.08)',
    borderColor: 'rgba(99,102,241,0.4)',
  },
  reportOptionName: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#e2e8f0',
    marginBottom: '2px',
  },
  reportOptionDesc: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.35)',
    lineHeight: 1.3,
  },
  input: {
    width: '100%',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '10px',
    color: '#ffffff',
    fontSize: '15px',
    padding: '14px 18px',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    outline: 'none',
    transition: 'border-color 0.12s',
  },
  submitBtn: {
    width: '100%',
    background: '#6366f1',
    border: 'none',
    borderRadius: '10px',
    color: '#ffffff',
    fontSize: '15px',
    fontWeight: 600,
    fontFamily: 'inherit',
    padding: '14px',
    cursor: 'pointer',
    transition: 'opacity 0.12s',
    marginTop: '4px',
  },
  errorBox: {
    background: 'rgba(239,68,68,0.1)',
    border: '1px solid rgba(239,68,68,0.2)',
    borderRadius: '8px',
    color: '#fca5a5',
    fontSize: '13px',
    padding: '10px 14px',
  },
  successBox: {
    textAlign: 'center',
    padding: '24px 0',
  },
  successTitle: {
    fontSize: '20px',
    fontWeight: 700,
    color: '#22c55e',
    marginBottom: '6px',
  },
  successText: {
    fontSize: '14px',
    color: 'rgba(255,255,255,0.5)',
  },
  privacy: {
    textAlign: 'center',
    fontSize: '12px',
    color: 'rgba(255,255,255,0.2)',
    marginTop: '4px',
  },
};
