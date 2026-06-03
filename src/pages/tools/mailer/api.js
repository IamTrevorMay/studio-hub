// Thin fetch wrapper that injects the current Supabase access token as
// Bearer auth for every call to /api/emails/*. All routes are admin-only
// so the server will 401/403 if the token is missing or the user isn't
// an admin.

import { supabase } from '../../../supabaseClient';

async function authHeader() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');
  return { Authorization: `Bearer ${session.access_token}` };
}

async function request(method, path, body, opts = {}) {
  const headers = { ...(await authHeader()) };
  let bodyText;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    bodyText = JSON.stringify(body);
  }
  const res = await fetch(path, { method, headers, body: bodyText });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = (data && data.error) || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return opts.raw ? text : data;
}

// Products
export const listProducts   = ()         => request('GET',    '/api/emails/products');
export const getProduct     = (id)       => request('GET',    `/api/emails/products?id=${encodeURIComponent(id)}`);
export const createProduct  = (data)     => request('POST',   '/api/emails/products', data);
export const updateProduct  = (id, data) => request('PATCH',  `/api/emails/products?id=${encodeURIComponent(id)}`, data);
export const deleteProduct  = (id)       => request('DELETE', `/api/emails/products?id=${encodeURIComponent(id)}`);

// Templates
export const listTemplates  = (productId) =>
  request('GET', `/api/emails/templates?product_id=${encodeURIComponent(productId)}`);
export const getTemplate    = (id)       => request('GET',    `/api/emails/templates?id=${encodeURIComponent(id)}`);
export const createTemplate = (data)     => request('POST',   '/api/emails/templates', data);
export const updateTemplate = (id, data) => request('PATCH',  `/api/emails/templates?id=${encodeURIComponent(id)}`, data);
export const deleteTemplate = (id)       => request('DELETE', `/api/emails/templates?id=${encodeURIComponent(id)}`);

// Audiences
export const listAudiences  = (productId) =>
  request('GET', `/api/emails/audiences?product_id=${encodeURIComponent(productId)}`);
export const createAudience = (data)     => request('POST',   '/api/emails/audiences', data);
export const updateAudience = (id, data) => request('PATCH',  `/api/emails/audiences?id=${encodeURIComponent(id)}`, data);
export const deleteAudience = (id)       => request('DELETE', `/api/emails/audiences?id=${encodeURIComponent(id)}`);

// Subscribers + audience membership
export const listSubscribersInAudience = (audienceId) =>
  request('GET', `/api/emails/subscribers?audience_id=${encodeURIComponent(audienceId)}`);
export const searchSubscribers = (q) =>
  request('GET', `/api/emails/subscribers?q=${encodeURIComponent(q)}`);
export const createSubscriber = (data) => request('POST', '/api/emails/subscribers', data);
export const updateSubscriber = (id, data) => request('PATCH', `/api/emails/subscribers?id=${encodeURIComponent(id)}`, data);
export const removeSubscriberFromAudience = (subscriber_id, audience_id) =>
  request('POST', '/api/emails/subscribers?op=remove-from-audience', { subscriber_id, audience_id });
export const addSubscriberToAudience = (subscriber_id, audience_id) =>
  request('POST', '/api/emails/subscribers?op=add-to-audience', { subscriber_id, audience_id });
export const bulkImportSubscribers = (audience_id, rows) =>
  request('POST', '/api/emails/subscribers?op=bulk-import', { audience_id, rows });

// Preview + send
export const previewTemplate = (payload) =>
  request('POST', '/api/emails/preview', payload, { raw: true });
export const sendTemplate    = (payload) => request('POST', '/api/emails/send', payload);

// Sends (list)
export const listSends = (productId) =>
  request('GET', `/api/emails/sends?product_id=${encodeURIComponent(productId)}`);

// Triton subscriber migration (one-shot server-to-server import)
export const migrateFromTriton = (payload) =>
  request('POST', '/api/emails/migrate-triton', payload);
