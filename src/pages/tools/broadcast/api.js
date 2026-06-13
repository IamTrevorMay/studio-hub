// Thin fetch wrapper for the broadcast routes.

import { supabase } from '../../../supabaseClient';

async function authHeader() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');
  return { Authorization: `Bearer ${session.access_token}`, _accessToken: session.access_token };
}

async function request(method, path, body, opts = {}) {
  const headers = { ...(await authHeader()) };
  delete headers._accessToken;
  let bodyText;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    bodyText = JSON.stringify(body);
  }
  const res = await fetch(path, { method, headers, body: bodyText, signal: opts.signal });
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

// Projects
export const listProjects   = ()         => request('GET',    '/api/broadcast/projects');
export const getProject     = (id)       => request('GET',    `/api/broadcast/projects?id=${encodeURIComponent(id)}`);
export const createProject  = (data)     => request('POST',   '/api/broadcast/projects', data);
export const updateProject  = (id, data) => request('PATCH',  `/api/broadcast/projects?id=${encodeURIComponent(id)}`, data);
export const deleteProject  = (id)       => request('DELETE', `/api/broadcast/projects?id=${encodeURIComponent(id)}`);

// Members
export const listMembers   = (projectId)  => request('GET', `/api/broadcast/project-members?project_id=${encodeURIComponent(projectId)}`);
export const addMember     = (data)       => request('POST', '/api/broadcast/project-members', data);
export const updateMember  = (id, data)   => request('PATCH', `/api/broadcast/project-members?id=${encodeURIComponent(id)}`, data);
export const removeMember  = (id)         => request('DELETE', `/api/broadcast/project-members?id=${encodeURIComponent(id)}`);

// Scenes
export const listScenes    = (projectId)  => request('GET', `/api/broadcast/scenes?project_id=${encodeURIComponent(projectId)}`);
export const createScene   = (data)       => request('POST', '/api/broadcast/scenes', data);
export const updateScene   = (id, data)   => request('PATCH', `/api/broadcast/scenes?id=${encodeURIComponent(id)}`, data);
export const deleteScene   = (id)         => request('DELETE', `/api/broadcast/scenes?id=${encodeURIComponent(id)}`);

// Scene assets
export const listSceneAssets    = (params) =>
  request('GET', `/api/broadcast/scene-assets?${new URLSearchParams(params).toString()}`);
export const createSceneAsset   = (data)       => request('POST', '/api/broadcast/scene-assets', data);
export const updateSceneAsset   = (id, data)   => request('PATCH', `/api/broadcast/scene-assets?id=${encodeURIComponent(id)}`, data);
export const deleteSceneAsset   = (id)         => request('DELETE', `/api/broadcast/scene-assets?id=${encodeURIComponent(id)}`);

// Assets
export const listAssets    = (projectId)  => request('GET', `/api/broadcast/assets?project_id=${encodeURIComponent(projectId)}`);
export const getAsset      = (id)         => request('GET', `/api/broadcast/assets?id=${encodeURIComponent(id)}`);
export const createAsset   = (data, opts) => request('POST', '/api/broadcast/assets', data, opts);
export const updateAsset   = (id, data, opts) => request('PATCH', `/api/broadcast/assets?id=${encodeURIComponent(id)}`, data, opts);
export const deleteAsset   = (id)         => request('DELETE', `/api/broadcast/assets?id=${encodeURIComponent(id)}`);

// Sessions
export const listSessions  = (projectId)  => request('GET', `/api/broadcast/sessions?project_id=${encodeURIComponent(projectId)}`);
export const getSession    = (id)         => request('GET', `/api/broadcast/sessions?id=${encodeURIComponent(id)}`);
export const getSessionBySlug = (slug)    => request('GET', `/api/broadcast/sessions?channel_name=${encodeURIComponent(slug)}`);
export const createSession = (data)       => request('POST', '/api/broadcast/sessions', data);
export const updateSession = (id, data)   => request('PATCH', `/api/broadcast/sessions?id=${encodeURIComponent(id)}`, data);
export const deleteSession = (id)         => request('DELETE', `/api/broadcast/sessions?id=${encodeURIComponent(id)}`);

// Widget state
export const getWidgetState = (projectId) =>
  request('GET', `/api/broadcast/widget-state?project_id=${encodeURIComponent(projectId)}`);
export const putWidgetState = (project_id, state) =>
  request('PUT', '/api/broadcast/widget-state', { project_id, state });
export const patchWidgetState = (project_id, patch) =>
  request('PATCH', '/api/broadcast/widget-state', { project_id, patch });

// Clip markers
export const listMarkers   = (sessionId)  => request('GET', `/api/broadcast/clip-markers?session_id=${encodeURIComponent(sessionId)}`);
export const createMarker  = (data)       => request('POST', '/api/broadcast/clip-markers', data);
export const updateMarker  = (id, data)   => request('PATCH', `/api/broadcast/clip-markers?id=${encodeURIComponent(id)}`, data);
export const deleteMarker  = (id)         => request('DELETE', `/api/broadcast/clip-markers?id=${encodeURIComponent(id)}`);

// Chat
export const listChat      = (sessionId)  => request('GET', `/api/broadcast/chat-messages?session_id=${encodeURIComponent(sessionId)}&limit=200`);
export const postChat      = (data)       => request('POST', '/api/broadcast/chat-messages', data);

// Trigger (capability via sid; can be called unauth too)
export const trigger = async (params, opts = {}) => {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api/broadcast/trigger?${qs}`, { signal: opts.signal });
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
  return data;
};

// Upload helper — returns endpoint + headers for tus client
export const requestUpload = (data) => request('POST', '/api/broadcast/upload', data);
