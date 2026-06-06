// Same-origin fetch helper that forwards the current Supabase session as a
// Bearer token. Used by widgets that hit /api/* proxies (tritonProxy.js
// requires a valid Mayday JWT). The supabase client is imported via a
// relative path because the registry files are TS-checked without the
// CRA path aliases.

// @ts-ignore — supabaseClient is plain JS and ships no .d.ts file
import { supabase } from '../../../../../supabaseClient';

export async function proxyFetchJson(url: string): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = { 'cache-control': 'no-store' };
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`proxy fetch failed (${res.status}): ${url}`);
  }
  return res.json();
}

export async function proxyFetchJsonOrNull(url: string): Promise<any | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = { 'cache-control': 'no-store' };
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
