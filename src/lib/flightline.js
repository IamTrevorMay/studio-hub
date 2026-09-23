import { supabase, VIEW_AS } from '../supabaseClient';

function httpsOrigin(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      url.pathname === '/' && !url.search && !url.hash ? url.origin : '';
  } catch { return ''; }
}
export const FLIGHTLINE_ORIGIN = httpsOrigin(process.env.REACT_APP_FLIGHTLINE_SERVICE_URL);
export const FLIGHTLINE_DOWNLOAD = (() => {
  try {
    const url = new URL(process.env.REACT_APP_FLIGHTLINE_DOWNLOAD_URL);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
})();

async function headers() {
  if (VIEW_AS.active) throw new Error('Open Flightline from your own account, outside preview mode.');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Sign in to Mayday Studio to continue.');
  let terminal = sessionStorage.getItem('flightline.terminal');
  if (!terminal) { terminal = crypto.randomUUID(); sessionStorage.setItem('flightline.terminal', terminal); }
  return { Authorization: `Bearer ${session.access_token}`, 'X-Flightline-Terminal': terminal };
}
export async function flightline(path, options = {}) {
  if (!FLIGHTLINE_ORIGIN) throw new Error('Your Flightline workspace is being connected.');
  const response = await fetch(`${FLIGHTLINE_ORIGIN}/api${path}`, {
    ...options, credentials: 'omit',
    headers: { ...await headers(), ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Flightline request failed.');
  return data;
}

export async function uploadFootage(file, projectId, onProgress) {
  const auth = await headers();
  const key = 'flightline.upload.' + JSON.stringify([projectId, file.name, file.size, file.lastModified]);
  let id = sessionStorage.getItem(key);
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem(key, id); }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${FLIGHTLINE_ORIGIN}/api/upload?project_id=${encodeURIComponent(projectId)}`);
    Object.entries({ ...auth, 'X-Upload-Id': id }).forEach(([name, value]) => xhr.setRequestHeader(name, value));
    xhr.upload.onprogress = event => onProgress(event.lengthComputable ? event.loaded / event.total : 0);
    xhr.onerror = () => reject(new Error('Upload interrupted. Select the file again to retry.'));
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 400) reject(new Error(typeof data.detail === 'string' ? data.detail : 'Upload failed.'));
        else resolve(data);
      } catch { reject(new Error('Upload failed.')); }
    };
    const body = new FormData(); body.append('file', file); xhr.send(body);
  });
}

export async function completeFlightlineHandoff(search) {
  const params = new URLSearchParams(search);
  const state = params.get('state'), challenge = params.get('challenge');
  if (!/^[A-Za-z0-9_-]{43}$/.test(state || '') || !/^[A-Za-z0-9_-]{43}$/.test(challenge || '')) {
    throw new Error('This sign-in request has expired. Open Flightline and try again.');
  }
  const { code } = await flightline('/session/mayday/handoff', { method: 'POST', body: JSON.stringify({ challenge }) });
  // Return only to the configured service, never to a caller-provided redirect.
  return `${FLIGHTLINE_ORIGIN}/#${new URLSearchParams({ mayday_code: code, state })}`;
}
