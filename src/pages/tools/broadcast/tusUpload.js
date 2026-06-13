// Thin wrapper around tus-js-client that uses the /api/broadcast/upload
// helper to discover endpoint + headers. Callers get a promise that
// resolves with { storage_path, public_url, size } after the upload
// finishes; progress is reported through onProgress.

import * as tus from 'tus-js-client';
import { supabase } from '../../../supabaseClient';
import { requestUpload } from './api';

export async function uploadAssetTus({ projectId, file, onProgress, signal }) {
  const init = await requestUpload({
    project_id: projectId,
    file_name: file.name,
    file_size: file.size,
    content_type: file.type || null,
  });

  // The upload endpoint no longer echoes the user's JWT back to us —
  // attach it here from the current Supabase session so the tus client
  // can talk directly to Storage. If the session expired between the
  // /upload call and the tus PUT, this throws and the caller surfaces it.
  const { data: { session: authSession } } = await supabase.auth.getSession();
  if (!authSession) throw new Error('Not signed in');

  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: init.endpoint,
      retryDelays: [0, 1000, 3000, 5000],
      headers: {
        ...(init.headers || {}),
        Authorization: `Bearer ${authSession.access_token}`,
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: init.bucket,
        objectName: init.path,
        contentType: file.type || 'application/octet-stream',
        cacheControl: '3600',
      },
      chunkSize: 6 * 1024 * 1024, // Supabase requires 6 MB chunks
      onError: (err) => reject(err),
      onProgress: (sent, total) => {
        if (onProgress) onProgress(sent, total);
      },
      onSuccess: () => {
        resolve({
          storage_path: init.path,
          public_url: init.public_url,
          size: file.size,
        });
      },
    });

    upload.findPreviousUploads().then((prev) => {
      if (prev && prev.length > 0) upload.resumeFromPreviousUpload(prev[0]);
      upload.start();
    }).catch(() => upload.start());

    if (signal) signal.addEventListener('abort', () => upload.abort(true).catch(() => null));
  });
}

// Pick a sensible asset_type for a file based on MIME.
export function inferAssetType(file) {
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  return 'file';
}
