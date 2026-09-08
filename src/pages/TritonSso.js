// /triton-sso — the in-app leg of Triton's "Continue with Mayday Studio".
//
// Triton's login button points here. App.js renders this page only once the
// user is signed in (an anonymous visitor sees AuthPage first and lands back
// here after login, since the path never changes). It trades the Mayday JWT
// for a signed hand-off URL via /api/triton-sso and sends the browser on;
// Triton's /api/auth/mayday does the rest.

import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

export default function TritonSso() {
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error('No active session');

        const res = await fetch('/api/triton-sso', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.url) throw new Error(json.error || `SSO failed (${res.status})`);
        if (!cancelled) window.location.replace(json.url);
      } catch (e) {
        if (!cancelled) setError(e.message || 'SSO failed');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={styles.page}>
      <div style={styles.inner}>
        {error ? (
          <>
            <p style={styles.errorText}>{error}</p>
            <a href="/" style={styles.link}>Back to Mayday Studio</a>
          </>
        ) : (
          <>
            <div style={styles.spinner} />
            <p style={styles.text}>Sending you to Triton Apex…</p>
          </>
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
    fontFamily: "'DM Sans', sans-serif",
  },
  inner: { textAlign: 'center' },
  spinner: {
    width: '28px',
    height: '28px',
    margin: '0 auto 14px',
    border: '3px solid rgba(255,255,255,0.1)',
    borderTopColor: '#6366f1',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  text: { color: 'rgba(255,255,255,0.6)', fontSize: '14px' },
  errorText: { color: '#f87171', fontSize: '14px', marginBottom: '12px' },
  link: { color: '#6366f1', fontSize: '13px', textDecoration: 'none' },
};
