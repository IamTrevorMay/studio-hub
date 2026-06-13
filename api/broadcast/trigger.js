// Public trigger endpoint — used by StreamDeck plugin + producer console
// + any deep-link button. The session ID acts as the capability token,
// so this route does not require user JWT (matches Triton).
//
//   GET /api/broadcast/trigger?sid=<session>&action=<action>&aid=<asset?>&...
//
// Supported actions for v1:
//   - toggle / show / hide              (asset visibility, requires aid)
//   - slideshow_next / slideshow_prev   (requires aid)
//   - slideshow_visible_next / _prev    (cycles whichever slideshow is currently visible)
//   - producer_panel_show / _hide       (broadcasts an ephemeral event)
//
// Mutates broadcast_sessions.active_state so Supabase Realtime fires a
// row-update to overlay subscribers, then optionally fires an ephemeral
// 'broadcast' event on the session's channel name for keypress-style
// signals.

const { createServiceClient, json, applyCors } = require('../_lib/broadcast/access');

const VALID_ACTIONS = new Set([
  'toggle', 'show', 'hide',
  'slideshow_next', 'slideshow_prev',
  'slideshow_visible_next', 'slideshow_visible_prev',
  'producer_panel_show', 'producer_panel_hide',
]);
const AID_OPTIONAL = new Set([
  'slideshow_visible_next', 'slideshow_visible_prev',
  'producer_panel_show', 'producer_panel_hide',
]);

module.exports = async (req, res) => {
  applyCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  const q = { ...(req.query || {}), ...((req.method === 'POST' && req.body) || {}) };
  const sid = q.sid;
  const aid = q.aid;
  const action = q.action;

  if (!sid || !action) return json(res, 400, { error: 'sid + action required' });
  if (!VALID_ACTIONS.has(action)) {
    return json(res, 400, { error: `Invalid action. Allowed: ${[...VALID_ACTIONS].join(', ')}` });
  }
  if (!aid && !AID_OPTIONAL.has(action)) {
    return json(res, 400, { error: 'aid required for this action' });
  }

  let admin;
  try { admin = createServiceClient(); }
  catch (e) { return json(res, 500, { error: e.message }); }

  const { data: session, error: sessErr } = await admin
    .from('broadcast_sessions').select('*').eq('id', sid).maybeSingle();
  if (sessErr) return json(res, 500, { error: sessErr.message });
  if (!session) return json(res, 404, { error: 'session not found' });
  if (!session.is_live) return json(res, 409, { error: 'session not live' });

  const state = session.active_state || {};
  const visible = new Set(state.visibleAssets || []);
  const indexes = { ...(state.slideshowIndexes || {}) };

  // ── Producer panel — ephemeral channel message, no state mutation ──
  if (action === 'producer_panel_show' || action === 'producer_panel_hide') {
    const position = q.position || 'lower-bar';
    const channel = admin.channel(session.channel_name);
    try {
      await channel.subscribe();
      if (action === 'producer_panel_show') {
        let content = q.content;
        if (typeof content === 'string') {
          try { content = JSON.parse(content); }
          catch { return json(res, 400, { error: 'content must be JSON' }); }
        }
        if (!content) return json(res, 400, { error: 'content required' });
        await channel.send({
          type: 'broadcast',
          event: 'producer:panel-show',
          payload: { position, content, source: 'trigger-api', timestamp: Date.now() },
        });
      } else {
        await channel.send({
          type: 'broadcast',
          event: 'producer:panel-hide',
          payload: { position, source: 'trigger-api', timestamp: Date.now() },
        });
      }
    } finally {
      admin.removeChannel(channel);
    }
    return json(res, 200, { ok: true, action, position });
  }

  // ── Visibility actions ──
  let resultVisible;
  if (action === 'toggle' || action === 'show' || action === 'hide') {
    const want = action === 'toggle' ? !visible.has(aid) : action === 'show';
    if (want) visible.add(aid); else visible.delete(aid);
    resultVisible = want;
  }

  // ── Slideshow actions ──
  let resultIndex;
  if (action === 'slideshow_next' || action === 'slideshow_prev') {
    const { data: asset } = await admin
      .from('broadcast_assets').select('slideshow_config').eq('id', aid).maybeSingle();
    const slides = (asset && asset.slideshow_config && asset.slideshow_config.slides) || [];
    const length = Math.max(1, slides.length);
    const cur = indexes[aid] || 0;
    const next = action === 'slideshow_next'
      ? (cur + 1) % length
      : (cur - 1 + length) % length;
    indexes[aid] = next;
    resultIndex = next;
  }
  if (action === 'slideshow_visible_next' || action === 'slideshow_visible_prev') {
    // Find the slideshow asset currently visible.
    const visibleArr = [...visible];
    if (visibleArr.length === 0) {
      return json(res, 409, { error: 'No visible asset to advance' });
    }
    const { data: assets } = await admin
      .from('broadcast_assets').select('id, asset_type, slideshow_config').in('id', visibleArr);
    const target = (assets || []).find((a) => a.asset_type === 'slideshow');
    if (!target) return json(res, 409, { error: 'No visible slideshow asset' });
    const slides = (target.slideshow_config && target.slideshow_config.slides) || [];
    const length = Math.max(1, slides.length);
    const cur = indexes[target.id] || 0;
    const next = action === 'slideshow_visible_next'
      ? (cur + 1) % length
      : (cur - 1 + length) % length;
    indexes[target.id] = next;
    resultIndex = next;
  }

  const newState = {
    ...state,
    visibleAssets: [...visible],
    slideshowIndexes: indexes,
  };
  // Guard the update on is_live=true so a session that went dark between
  // our read above and this write doesn't have its active_state silently
  // mutated. Returns no rows if the session is no longer live, which we
  // surface as a 409 to the caller.
  const { data: updated, error: updErr } = await admin
    .from('broadcast_sessions')
    .update({ active_state: newState })
    .eq('id', sid)
    .eq('is_live', true)
    .select('id');
  if (updErr) return json(res, 500, { error: updErr.message });
  if (!updated || updated.length === 0) {
    return json(res, 409, { error: 'session went offline; state not updated' });
  }

  return json(res, 200, { ok: true, action, aid, visible: resultVisible, index: resultIndex });
};
