// Client-side mirror of supabase/functions/shared/mailer-render.ts so
// the editor can render previews without an edge-function round-trip.
// Keep this in sync with the server renderer — any block-type addition
// must land in both files. The block schema is the contract.

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function alignStyle(a) {
  return a ? `text-align:${a};` : 'text-align:left;';
}

function renderBlock(b, ctx) {
  if (!b || typeof b !== 'object') return '';
  switch (b.type) {
    case 'heading': {
      const level = b.level || 2;
      const size = level === 1 ? 28 : level === 2 ? 22 : 18;
      return `<h${level} style="margin:0 0 12px;font-size:${size}px;line-height:1.25;color:#111;${alignStyle(b.align)}">${escapeHtml(b.text || '')}</h${level}>`;
    }
    case 'paragraph':
      return `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#333;${alignStyle(b.align)}">${escapeHtml(b.text || '')}</p>`;
    case 'image': {
      const w = b.width ? ` width="${b.width}"` : '';
      const img = `<img src="${escapeHtml(b.src || '')}" alt="${escapeHtml(b.alt || '')}"${w} style="max-width:100%;height:auto;display:block;margin:0 auto;border:0;" />`;
      const href = b.href ? (ctx?.rewriteHref ? ctx.rewriteHref(b.href) : b.href) : null;
      return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${img}</a>` : img;
    }
    case 'button': {
      const href = b.href ? (ctx?.rewriteHref ? ctx.rewriteHref(b.href) : b.href) : '#';
      return `<div style="margin:16px 0;${alignStyle(b.align ?? 'center')}"><a href="${escapeHtml(href)}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;font-weight:600;border-radius:6px;text-decoration:none;font-size:14px;">${escapeHtml(b.text || 'Click here')}</a></div>`;
    }
    case 'divider':
      return `<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;" />`;
    case 'spacer':
      return `<div style="height:${b.size || 16}px;line-height:${b.size || 16}px;">&nbsp;</div>`;
    case 'html':
      return b.html || '';
    default:
      return '';
  }
}

function renderPreheaderHtml(text) {
  return `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(text)}${'‌ '.repeat(60)}</div>`;
}

export function renderCampaign(blocks, ctx = {}) {
  const body = (blocks || []).map((b) => renderBlock(b, ctx)).join('\n');
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(ctx.subject || '')}</title></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
${ctx.preheader ? renderPreheaderHtml(ctx.preheader) : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f7;">
  <tr><td align="center" style="padding:24px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">
      <tr><td style="padding:32px;">
${body}
${ctx.unsubscribeUrl ? `<p style="margin:24px 0 0;font-size:12px;color:#888;text-align:center;">You're receiving this because you subscribed. <a href="${escapeHtml(ctx.unsubscribeUrl)}" style="color:#888;text-decoration:underline;">Unsubscribe</a>.</p>` : ''}
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
  return { html };
}

export const BLOCK_TYPES = [
  { type: 'heading',   label: 'Heading',   defaults: { text: 'Heading', level: 2, align: 'left' } },
  { type: 'paragraph', label: 'Paragraph', defaults: { text: 'Body copy.', align: 'left' } },
  { type: 'image',     label: 'Image',     defaults: { src: '', alt: '', href: '', width: 600 } },
  { type: 'button',    label: 'Button',    defaults: { text: 'Click here', href: '', align: 'center' } },
  { type: 'divider',   label: 'Divider',   defaults: {} },
  { type: 'spacer',    label: 'Spacer',    defaults: { size: 24 } },
  { type: 'html',      label: 'Raw HTML',  defaults: { html: '<p>Raw HTML…</p>' } },
];
