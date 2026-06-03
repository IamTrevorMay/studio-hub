// Inject open-pixel + rewrite http(s) anchors to go through /track for
// per-recipient analytics. Run on the final HTML once per recipient.

const { makeRecipientToken } = require('./tokens');

function buildBaseUrl(req) {
  const explicit = process.env.PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  if (!req) return '';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function injectTracking(html, sendId, subscriberId, opts = {}) {
  const base = (opts.baseUrl || '').replace(/\/$/, '');
  if (!base) return html;
  const token = makeRecipientToken(sendId, subscriberId);

  // Rewrite anchor hrefs (skip mailto:, tel:, anchors, template vars, our own track URL).
  const rewritten = html.replace(/<a\s+([^>]*?)href=("|')(.*?)\2([^>]*)>/gi,
    (full, pre, q, href, post) => {
      if (!href) return full;
      if (/^(mailto:|tel:|#|\{\{)/i.test(href)) return full;
      if (href.indexOf('/api/emails/track') !== -1) return full;
      if (href.indexOf('/api/emails/unsubscribe') !== -1) return full;
      const target = `${base}/api/emails/track?t=${token}&u=${encodeURIComponent(href)}`;
      return `<a ${pre}href=${q}${target}${q}${post}>`;
    }
  );

  // 1x1 open pixel right before </body>
  const pixel = `<img src="${base}/api/emails/track?t=${token}&p=1" width="1" height="1" alt="" style="display:none;border:0;width:1px;height:1px;" />`;
  if (/<\/body>/i.test(rewritten)) {
    return rewritten.replace(/<\/body>/i, `${pixel}</body>`);
  }
  return rewritten + pixel;
}

module.exports = { injectTracking, buildBaseUrl };
