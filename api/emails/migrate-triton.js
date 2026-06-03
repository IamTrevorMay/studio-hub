// One-shot import of subscribers from Triton's email_subscribers table
// into Mayday's email_subscribers (and into a target audience).
//
// Triton's subscribers are stored encrypted (encrypted_email + email_hash
// + libsodium-style AES-GCM via lib/encryption.ts). We support two modes:
//
//   1) plaintext: when Triton's row has a populated `email` column (older
//      seeded rows + admin imports). No decryption keys required.
//   2) encrypted: when only encrypted_email is set — needs ENCRYPTION_KEY
//      set to match Triton's key. We import the helper inline so the
//      cipher format matches byte-for-byte. If keys aren't configured,
//      these rows are skipped and reported back to the caller.
//
// Auth: admin user JWT (same as the rest of the email routes), so this
// endpoint can be exposed in the AudiencesPanel UI safely.
//
// POST /api/emails/migrate-triton
//   { audience_id, limit?, dry_run? }

const { createClient } = require('@supabase/supabase-js');
const { requireAdmin, json, applyCors } = require('../_lib/emails/auth');
const crypto = require('crypto');

const PAGE_SIZE = 500;
const HARD_CAP  = 25000;

module.exports = async (req, res) => {
  applyCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const ctx = await requireAdmin(req, res);
  if (!ctx) return;
  const { admin } = ctx;

  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  if (!body.audience_id) return json(res, 400, { error: 'audience_id required' });
  const limit = Math.min(HARD_CAP, Math.max(1, Number(body.limit) || HARD_CAP));
  const dryRun = !!body.dry_run;

  const tritonUrl = process.env.TRITON_SUPABASE_URL;
  const tritonKey = process.env.TRITON_SUPABASE_SERVICE_ROLE_KEY;
  if (!tritonUrl || !tritonKey) {
    return json(res, 400, {
      error: 'TRITON_SUPABASE_URL / TRITON_SUPABASE_SERVICE_ROLE_KEY not set on this deployment. Export to CSV from Triton and use the bulk-import flow instead.',
    });
  }
  const triton = createClient(tritonUrl, tritonKey, { auth: { persistSession: false } });

  // Verify destination audience belongs to this account.
  const { data: audience, error: audErr } = await admin
    .from('email_audiences').select('id').eq('id', body.audience_id).maybeSingle();
  if (audErr) return json(res, 500, { error: audErr.message });
  if (!audience) return json(res, 404, { error: 'audience not found' });

  let imported = 0, skipped = 0, addedToAudience = 0, page = 0;
  const errors = [];

  while (imported + skipped < limit) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data: rows, error: rErr } = await triton
      .from('email_subscribers')
      .select('id, email, encrypted_email, email_hash, name, encrypted_name, metadata, created_at')
      .range(from, to);
    if (rErr) { errors.push(`triton fetch page ${page}: ${rErr.message}`); break; }
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      if (imported + skipped >= limit) break;
      const email = await extractEmail(row);
      if (!email) { skipped++; continue; }
      if (dryRun) { imported++; continue; }
      try {
        const sub = await upsertMaydaySubscriber(admin, email, row);
        imported++;
        const { error: linkErr } = await admin
          .from('email_audience_members')
          .upsert(
            { audience_id: body.audience_id, subscriber_id: sub.id },
            { onConflict: 'audience_id,subscriber_id' }
          );
        if (!linkErr) addedToAudience++;
      } catch (e) {
        errors.push(`${email}: ${e.message}`);
        skipped++;
      }
    }
    if (rows.length < PAGE_SIZE) break;
    page++;
  }

  return json(res, 200, {
    imported, skipped, added_to_audience: addedToAudience,
    dry_run: dryRun, errors: errors.slice(0, 50),
  });
};

async function extractEmail(row) {
  if (row.email && typeof row.email === 'string') return row.email.toLowerCase().trim();
  if (!row.encrypted_email) return null;
  const key = process.env.ENCRYPTION_KEY || process.env.TRITON_ENCRYPTION_KEY;
  if (!key) return null;
  try {
    const plain = decrypt(row.encrypted_email, key);
    return plain ? plain.toLowerCase().trim() : null;
  } catch {
    return null;
  }
}

async function upsertMaydaySubscriber(admin, email, src) {
  const { data: existing } = await admin
    .from('email_subscribers').select('*').ilike('email', email).maybeSingle();
  if (existing) return existing;

  const name = src.name || (src.encrypted_name && process.env.ENCRYPTION_KEY
    ? safeDecrypt(src.encrypted_name, process.env.ENCRYPTION_KEY)
    : null);

  const { data, error } = await admin.from('email_subscribers').insert({
    email,
    name: name || null,
    confirmed: true,
    confirmed_at: src.created_at || new Date().toISOString(),
    metadata: { ...(src.metadata || {}), migrated_from: 'triton', triton_id: src.id },
    created_at: src.created_at || new Date().toISOString(),
  }).select().single();
  if (error) throw error;
  return data;
}

// Triton uses AES-256-GCM with the key being either base64 32 bytes or
// hex 64 chars. Format on disk: base64(iv(12) || tag(16) || ciphertext).
function decrypt(b64, keyEnv) {
  const key = normaliseKey(keyEnv);
  const buf = Buffer.from(b64, 'base64');
  const iv = buf.slice(0, 12);
  const tag = buf.slice(12, 28);
  const ct = buf.slice(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}
function safeDecrypt(b64, keyEnv) {
  try { return decrypt(b64, keyEnv); } catch { return null; }
}
function normaliseKey(k) {
  if (/^[0-9a-f]{64}$/i.test(k)) return Buffer.from(k, 'hex');
  return Buffer.from(k, 'base64');
}
