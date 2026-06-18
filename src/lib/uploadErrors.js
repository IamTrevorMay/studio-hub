import { supabase } from '../supabaseClient';

// Logs a freelancer/deliverable upload failure to the `upload_errors` table so
// admins can diagnose without needing the user to relay the toast text.
// Best-effort: never throws (a failed log must not mask the original error).
export async function logUploadError({ phase, file, statusCode, error, context } = {}) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('upload_errors').insert({
      user_id: user.id,
      source: 'client',
      phase: phase || 'unknown',
      filename: file?.name || null,
      mime_type: file?.type || null,
      size_bytes: file?.size ?? null,
      status_code: statusCode ?? null,
      error: typeof error === 'string' ? error : (error?.message || String(error)),
      context: context || null,
    });
  } catch {
    // swallow — logging failure must not affect the upload UX
  }
}
