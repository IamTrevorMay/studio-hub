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

// Replace {{token}} occurrences using a subscriber-like object.
// Lookup order: name/email at top level, then anything in custom_fields.
// Tokens with no value fall back to `fallback`.
function renderRssCard(b, item) {
  const img = b.showImage !== false && item.image
    ? `<img src="${escapeHtml(item.image)}" alt="" style="max-width:100%;height:auto;display:block;border-radius:6px;margin-bottom:12px;" />`
    : '';
  const title = `<h3 style="margin:0 0 6px;font-size:18px;color:#111;font-weight:700;"><a href="${escapeHtml(item.link || '#')}" style="color:#111;text-decoration:none;">${escapeHtml(item.title || '')}</a></h3>`;
  const author = b.showAuthor !== false && item.author
    ? `<div style="font-size:12px;color:#888;margin-bottom:8px;">by ${escapeHtml(item.author)}</div>`
    : '';
  const desc = b.showDescription !== false && item.description
    ? `<p style="margin:0 0 12px;font-size:14px;color:#444;line-height:1.5;">${escapeHtml(item.description).slice(0, 240)}…</p>`
    : '';
  const cta = item.link
    ? `<a href="${escapeHtml(item.link)}" style="display:inline-block;padding:8px 14px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;">${escapeHtml(b.ctaText || 'Read more →')}</a>`
    : '';
  return `<div style="border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin:8px 0;">${img}${title}${author}${desc}${cta}</div>`;
}

function substituteTokens(tmpl, sub, fallback) {
  return String(tmpl || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key) => {
    if (sub[key] != null && sub[key] !== '') return String(sub[key]);
    const cf = sub.custom_fields || {};
    if (cf[key] != null && cf[key] !== '') return String(cf[key]);
    return fallback || '';
  });
}

function wrapperStyle(b) {
  const parts = [];
  if (b.background) parts.push(`background:${b.background};`);
  const p = b.padding || {};
  const pTop = p.top != null ? p.top : 0;
  const pRight = p.right != null ? p.right : 0;
  const pBot = p.bottom != null ? p.bottom : 0;
  const pLeft = p.left != null ? p.left : 0;
  if (pTop || pRight || pBot || pLeft) {
    parts.push(`padding:${pTop}px ${pRight}px ${pBot}px ${pLeft}px;`);
  }
  return parts.join('');
}

function maybeWrap(b, inner) {
  const style = wrapperStyle(b);
  if (!style) return inner;
  return `<div style="${style}">${inner}</div>`;
}

function renderBlock(b, ctx) {
  if (!b || typeof b !== 'object') return '';
  if (b.visible === false) return '';
  const inner = renderInner(b, ctx);
  return maybeWrap(b, inner);
}

function renderInner(b, ctx) {
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
    case 'rich-text':
      // Tiptap output is already semantic HTML. Wrap in a div so any
      // padding/background props from the chrome wrapper apply cleanly.
      return `<div style="font-size:15px;line-height:1.6;color:#333;">${b.html || ''}</div>`;
    case 'rss-card': {
      // Editor preview shows a placeholder. Real fetch happens server-side
      // at send time inside mailer-send-now using the same renderer.
      const fetched = ctx?.rssData?.[b.id];
      if (!fetched) {
        return `<div style="border:1px dashed #ccc;border-radius:8px;padding:16px;margin:8px 0;color:#888;font-size:13px;text-align:center;">RSS card · feed: <em>${escapeHtml(b.rssUrl || '(none)')}</em><br/><small>Latest item fetched at send time.</small></div>`;
      }
      return renderRssCard(b, fetched);
    }
    case 'personalization': {
      // Preview-time substitution. ctx.subscriber populated at send;
      // empty in editor preview so tokens display with fallback value.
      const sub = ctx?.subscriber || {};
      const rendered = substituteTokens(b.template || '', sub, b.fallback || '');
      return `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#333;">${escapeHtml(rendered)}</p>`;
    }
    case 'header': {
      const bg = b.bg || '#0f0f1a';
      const fg = b.fg || '#ffffff';
      const banner = b.style === 'banner' && b.src ? `<img src="${escapeHtml(b.bannerUrl || '')}" alt="" style="max-width:100%;height:auto;display:block;border:0;" />` : '';
      const logo = (b.style === 'logo' || b.style === 'text') && b.logoUrl
        ? `<img src="${escapeHtml(b.logoUrl)}" alt="" style="max-height:48px;display:block;margin:0 auto 8px;border:0;" />`
        : '';
      const title = b.title ? `<h1 style="margin:0;font-size:24px;font-weight:700;color:${fg};">${escapeHtml(b.title)}</h1>` : '';
      const sub = b.subtitle ? `<p style="margin:6px 0 0;font-size:14px;color:${fg};opacity:0.75;">${escapeHtml(b.subtitle)}</p>` : '';
      if (b.style === 'banner' && b.bannerUrl) {
        return `<div style="background:${bg};text-align:center;">${banner}</div>`;
      }
      return `<div style="background:${bg};padding:24px;text-align:center;">${logo}${title}${sub}</div>`;
    }
    case 'social-links': {
      const align = b.align || 'center';
      const size = Number(b.iconSize) || 28;
      const color = b.color || '#6366f1';
      const labels = { instagram:'IG', youtube:'YT', twitter:'X', tiktok:'TT', twitch:'TW', linkedin:'IN', facebook:'FB', website:'WEB' };
      const icons = (b.links || [])
        .filter((l) => l && l.url)
        .map((l) => {
          const label = labels[l.platform] || (l.platform || '?').slice(0, 2).toUpperCase();
          return `<a href="${escapeHtml(l.href || l.url)}" target="_blank" rel="noopener" style="display:inline-block;width:${size}px;height:${size}px;line-height:${size}px;background:${color};color:#fff;border-radius:${size}px;text-decoration:none;font-size:${Math.round(size * 0.42)}px;font-weight:700;text-align:center;margin:0 4px;">${label}</a>`;
        })
        .join('');
      return `<div style="text-align:${align};margin:16px 0;">${icons}</div>`;
    }
    case 'columns': {
      const cols = Array.isArray(b.children) ? b.children : [[], []];
      const gap = Number(b.gap) || 16;
      const width = Math.floor((100 - (cols.length - 1) * 2) / cols.length);
      const cells = cols.map((colBlocks) => {
        const inner = (colBlocks || []).map((cb) => renderBlock(cb, ctx)).join('\n');
        return `<td valign="top" style="width:${width}%;padding-right:${gap / 2}px;padding-left:${gap / 2}px;">${inner}</td>`;
      }).join('');
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr>${cells}</tr></table>`;
    }
    case 'section': {
      const title = b.showTitle && b.title
        ? `<h2 style="margin:0 0 12px;font-size:20px;color:#111;font-weight:700;">${escapeHtml(b.title)}</h2>`
        : '';
      const children = (b.children || []).map((cb) => renderBlock(cb, ctx)).join('\n');
      return `<div style="margin:12px 0;">${title}${children}</div>`;
    }
    case 'footer': {
      const bg = b.bg || '#f5f5f7';
      const fg = b.fg || '#666666';
      const showUnsub = b.showUnsubscribe !== false && ctx?.unsubscribeUrl;
      const showBrand = b.showBranding !== false;
      const text = b.text ? `<div style="font-size:12px;color:${fg};line-height:1.5;margin-bottom:8px;">${escapeHtml(b.text)}</div>` : '';
      const unsub = showUnsub ? `<div style="font-size:12px;color:${fg};margin-bottom:4px;">You're receiving this because you subscribed. <a href="${escapeHtml(ctx.unsubscribeUrl)}" style="color:${fg};text-decoration:underline;">Unsubscribe</a>.</div>` : '';
      const brand = showBrand ? `<div style="font-size:11px;color:${fg};opacity:0.6;">sent via Mayday Studio</div>` : '';
      return `<div style="background:${bg};padding:20px;text-align:center;">${text}${unsub}${brand}</div>`;
    }
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

// Block-type catalog has moved to ./blockRegistry.js. Re-exported here
// to keep older imports of `BLOCK_TYPES` working without churn.
export { BLOCK_TYPES } from './blockRegistry';
