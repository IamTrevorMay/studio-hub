// CRUD for broadcast_chat_messages (Twitch chat replay buffer).
// YouTube was dropped per decisions Q; only 'twitch' supported for now.
//   GET   /api/broadcast/chat-messages?session_id=<id>&limit=<n>
//   POST  /api/broadcast/chat-messages  { session_id, provider, display_name, content, ... }
//
// Writes require edit-on-project; reads are public so the overlay page
// can pull recent messages on load (live updates come via Supabase Realtime).

const {
  json, applyCors, requireUser, createServiceClient,
  projectAccessLevel, canEdit,
} = require('../_lib/broadcast/access');

const ALLOWED_PROVIDERS = new Set(['twitch']);
const MESSAGE_TYPES = new Set([
  'chat', 'sub', 'resub', 'subgift', 'cheer', 'raid', 'follow',
]);

module.exports = async (req, res) => {
  applyCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  try {
    if (req.method === 'GET') {
      const sessionId = req.query && req.query.session_id;
      if (!sessionId) return json(res, 400, { error: 'session_id required' });
      const limit = Math.min(200, Math.max(1, Number((req.query || {}).limit) || 100));
      const admin = createServiceClient();
      const { data, error } = await admin
        .from('broadcast_chat_messages').select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return json(res, 200, { messages: (data || []).reverse() });
    }

    if (req.method === 'POST') {
      const ctx = await requireUser(req, res);
      if (!ctx) return;
      const { user, admin } = ctx;
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      if (!body.session_id || !body.provider) {
        return json(res, 400, { error: 'session_id + provider required' });
      }
      if (!ALLOWED_PROVIDERS.has(body.provider)) {
        return json(res, 400, { error: 'unsupported provider' });
      }
      const { data: sess } = await admin
        .from('broadcast_sessions').select('project_id').eq('id', body.session_id).maybeSingle();
      if (!sess) return json(res, 404, { error: 'session not found' });
      const level = await projectAccessLevel(admin, sess.project_id, user.id);
      if (!canEdit(level)) return json(res, 403, { error: 'Forbidden' });

      const insert = {
        session_id: body.session_id,
        provider: body.provider,
        display_name: body.display_name || null,
        content: body.content || null,
        profile_image_url: body.profile_image_url || null,
        message_type: MESSAGE_TYPES.has(body.message_type) ? body.message_type : 'chat',
        color: body.color || null,
        plan: body.plan || null,
        months: typeof body.months === 'number' ? body.months : null,
        amount: typeof body.amount === 'number' ? body.amount : null,
      };
      const { data, error } = await admin
        .from('broadcast_chat_messages').insert(insert).select().single();
      if (error) throw error;
      return json(res, 200, { message: data });
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return json(res, 500, { error: e.message || String(e) });
  }
};
