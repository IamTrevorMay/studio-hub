// Public unsubscribe endpoint. Idempotent.
//   GET  /api/emails/unsubscribe?t=<token>          → shows confirmation
//   POST /api/emails/unsubscribe?t=<token>          → marks unsubscribed
//
// We do both GET and POST so the List-Unsubscribe-Post one-click flow
// works for Gmail/Apple Mail, and the browser landing page is also nice.

const { createServiceClient } = require('../_lib/emails/auth');
const { verifyUnsubToken } = require('../_lib/emails/tokens');

module.exports = async (req, res) => {
  const q = req.query || {};
  const subscriberId = verifyUnsubToken(q.t);
  if (!subscriberId) {
    res.status(400).setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(page('Invalid or expired unsubscribe link.', false));
    return;
  }
  let admin;
  try { admin = createServiceClient(); }
  catch (e) {
    res.status(500).setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(page(`Unsubscribe failed: ${escapeHtml(e.message)}`, false));
    return;
  }

  if (req.method === 'POST') {
    try {
      await admin.from('email_subscribers').update({
        unsubscribed_at: new Date().toISOString(),
      }).eq('id', subscriberId);
    } catch { /* ignore */ }
    res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(page("You're unsubscribed. We won't email you again.", true));
    return;
  }

  if (req.method === 'GET') {
    res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(formPage(q.t));
    return;
  }

  res.status(405).end('Method not allowed');
};

function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function page(msg, ok) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title>
  <style>body{background:#0f0f1a;color:#e5e7eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:48px 24px;display:flex;justify-content:center}
  .card{max-width:480px;background:#1a1a2e;border:1px solid #1f1f33;border-radius:12px;padding:32px;text-align:center}
  .icon{font-size:32px;margin-bottom:12px;color:${ok ? '#10b981' : '#ef4444'}}</style></head>
  <body><div class="card"><div class="icon">${ok ? '✓' : '⚠︎'}</div><p>${escapeHtml(msg)}</p></div></body></html>`;
}

function formPage(token) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title>
  <style>body{background:#0f0f1a;color:#e5e7eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:48px 24px;display:flex;justify-content:center}
  .card{max-width:480px;background:#1a1a2e;border:1px solid #1f1f33;border-radius:12px;padding:32px;text-align:center}
  button{background:#ef4444;color:white;border:none;padding:12px 24px;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;margin-top:16px;font-family:inherit}</style></head>
  <body><div class="card"><h2 style="margin:0 0 8px;font-size:20px">Unsubscribe</h2>
  <p style="margin:0;color:#9ca3af;font-size:14px">Click below to stop receiving emails.</p>
  <form method="POST" action="/api/emails/unsubscribe?t=${escapeHtml(token)}"><button type="submit">Unsubscribe</button></form>
  </div></body></html>`;
}
