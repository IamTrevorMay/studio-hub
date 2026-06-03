// Pure email HTML renderer. Table-based with inline styles for email
// client compatibility. CommonJS so Vercel Node functions can require it.
//
// Inputs:
//   blocks    — array of EmailBlock objects
//   branding  — { primaryColor, fromName, logoUrl, headerStyle }
//   settings  — { maxWidth, bodyBg, contentBg, fontFamily }
//   data      — map of blockId -> resolved bind data
//   subject, date, unsubscribeUrl
// Returns full <!DOCTYPE html> string.

const BG          = '#0f0f1a';
const CARD_BG     = '#1a1a2e';
const BORDER      = '#1f1f33';
const TEXT        = '#e5e7eb';
const TEXT_MUTED  = '#9ca3af';
const TEXT_BRIGHT = '#ffffff';
const ACCENT      = '#6366f1';

function escapeHtml(text) {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function padStr(p) {
  if (!p) return '0';
  return `${p.top}px ${p.right}px ${p.bottom}px ${p.left}px`;
}

// ── Block renderers ─────────────────────────────────────────────────

function renderHeader(block, _data, branding) {
  const c = block.config || {};
  const style = c.style || branding.headerStyle || 'text';
  const color = branding.primaryColor || ACCENT;

  if (style === 'banner' && (c.bannerUrl || branding.logoUrl)) {
    const url = c.bannerUrl || branding.logoUrl;
    return `<tr><td style="padding:24px 0 16px;text-align:center;">
      <img src="${escapeHtml(url)}" alt="${escapeHtml(c.title || branding.fromName)}" width="640" style="width:100%;max-width:640px;height:auto;display:block;margin:0 auto;" />
      ${c.showDate !== false ? `<p style="margin:12px 0 0;font-size:12px;color:${TEXT_MUTED};letter-spacing:0.06em;text-transform:uppercase;">{{date_formatted}}</p>` : ''}
    </td></tr>`;
  }
  if (style === 'logo' && (c.logoUrl || branding.logoUrl)) {
    return `<tr><td style="padding:24px 0 16px;text-align:center;">
      <img src="${escapeHtml(c.logoUrl || branding.logoUrl)}" alt="" width="120" style="width:120px;height:auto;display:block;margin:0 auto;" />
      ${c.title ? `<p style="margin:12px 0 0;font-size:18px;font-weight:700;color:${TEXT_BRIGHT};">${escapeHtml(c.title)}</p>` : ''}
      ${c.subtitle ? `<p style="margin:4px 0 0;font-size:12px;color:${TEXT_MUTED};">${escapeHtml(c.subtitle)}</p>` : ''}
    </td></tr>`;
  }
  return `<tr><td style="padding:24px 0 16px;text-align:center;">
    <p style="margin:0;font-size:22px;font-weight:800;color:${color};letter-spacing:-0.02em;">${escapeHtml(c.title || branding.fromName)}</p>
    ${c.subtitle ? `<p style="margin:4px 0 0;font-size:12px;color:${TEXT_MUTED};">${escapeHtml(c.subtitle)}</p>` : ''}
    ${c.showDate !== false ? `<p style="margin:8px 0 0;font-size:12px;color:${TEXT_MUTED};letter-spacing:0.06em;text-transform:uppercase;">{{date_formatted}}</p>` : ''}
  </td></tr>`;
}

function renderFooter(block, _data, branding) {
  const c = block.config || {};
  return `<tr><td style="border-top:1px solid ${BORDER};"></td></tr>
  <tr><td style="padding:24px 0;text-align:center;">
    ${c.text ? `<p style="margin:0 0 8px;font-size:11px;color:${TEXT_MUTED};">${escapeHtml(c.text)}</p>` : ''}
    ${c.showBranding !== false ? `<p style="margin:0;font-size:11px;color:${TEXT_MUTED};">${escapeHtml(branding.fromName || 'Mayday')}</p>` : ''}
    ${c.showUnsubscribe !== false ? `<p style="margin:8px 0 0;font-size:10px;color:${TEXT_MUTED};"><a href="{{unsubscribe_url}}" style="color:${TEXT_MUTED};text-decoration:underline;">Unsubscribe</a></p>` : ''}
  </td></tr>`;
}

function renderDivider(block) {
  const c = block.config || {};
  return `<tr><td style="padding:${padStr(block.padding)};"><hr style="border:none;border-top:${c.thickness || 1}px ${c.style || 'solid'} ${c.color || BORDER};margin:0;" /></td></tr>`;
}

function renderSpacer(block) {
  const h = (block.config || {}).height || 24;
  return `<tr><td style="height:${h}px;font-size:0;line-height:0;">&nbsp;</td></tr>`;
}

function renderRichText(block, data) {
  const html = (data && data.html) || (block.config || {}).html || '';
  return `<tr><td style="padding:${padStr(block.padding)};">${html}</td></tr>`;
}

function renderImage(block) {
  const c = block.config || {};
  const img = `<img src="${escapeHtml(c.src)}" alt="${escapeHtml(c.alt)}" width="640" style="width:${c.width || '100%'};max-width:640px;height:auto;display:block;margin:0 auto;${c.borderRadius ? `border-radius:${c.borderRadius}px;` : ''}" />`;
  const wrapped = c.linkUrl ? `<a href="${escapeHtml(c.linkUrl)}" target="_blank" rel="noopener" style="display:block;">${img}</a>` : img;
  return `<tr><td style="padding:${padStr(block.padding)};text-align:center;">${wrapped}</td></tr>`;
}

function renderButton(block) {
  const c = block.config || {};
  const bg = c.bgColor || ACCENT;
  const tc = c.textColor || '#ffffff';
  const align = c.align || 'center';
  const radius = c.borderRadius || 6;
  const widthStyle = c.fullWidth ? 'display:block;width:100%;' : 'display:inline-block;';
  return `<tr><td style="padding:${padStr(block.padding)};text-align:${align};">
    <a href="${escapeHtml(c.url)}" target="_blank" rel="noopener" style="${widthStyle}background:${bg};color:${tc};font-size:14px;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:${radius}px;text-align:center;">
      ${escapeHtml(c.text)}
    </a>
  </td></tr>`;
}

function renderSocialLinks(block) {
  const c = block.config || {};
  const links = c.links || [];
  const align = c.align || 'center';
  const size = c.iconSize || 24;
  const icons = links
    .filter((l) => l.url)
    .map((l) => {
      const label = (l.platform || '').charAt(0).toUpperCase() + (l.platform || '').slice(1);
      return `<td style="padding:0 6px;">
        <a href="${escapeHtml(l.url)}" target="_blank" rel="noopener" style="color:${TEXT_MUTED};text-decoration:none;font-size:${Math.max(11, size - 8)}px;font-weight:600;">
          ${escapeHtml(label)}
        </a>
      </td>`;
    })
    .join('');
  return `<tr><td style="padding:${padStr(block.padding)};text-align:${align};">
    <table cellpadding="0" cellspacing="0" border="0" align="${align}" style="margin:0 auto;"><tr>${icons}</tr></table>
  </td></tr>`;
}

function renderCustomHtml(block) {
  const html = (block.config || {}).html || '';
  return `<tr><td style="padding:${padStr(block.padding)};">${html}</td></tr>`;
}

function renderRssCard(_block, data) {
  const post = data || {};
  if (!post.title) return '';
  return `<tr><td style="padding:0 0 24px;">
    <table cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr><td style="padding:0 0 12px 0;"><p style="margin:0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:${TEXT_MUTED};border-bottom:1px solid ${BORDER};padding-bottom:8px;">Latest</p></td></tr>
      <tr><td>
        <a href="${escapeHtml(post.link)}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit;display:block;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${CARD_BG};border:1px solid ${BORDER};border-radius:8px;overflow:hidden;">
            ${post.imageUrl ? `<tr><td style="padding:0;"><img src="${escapeHtml(post.imageUrl)}" alt="" width="640" style="width:100%;height:auto;display:block;border-radius:8px 8px 0 0;" /></td></tr>` : ''}
            <tr><td style="padding:16px 20px;">
              <p style="margin:0;font-size:16px;font-weight:700;color:${TEXT_BRIGHT};line-height:1.4;">${escapeHtml(post.title)}</p>
              ${post.description ? `<p style="margin:6px 0 0;font-size:13px;color:${TEXT};line-height:1.5;">${escapeHtml(post.description)}</p>` : ''}
              ${post.author ? `<p style="margin:10px 0 0;font-size:11px;color:${TEXT_MUTED};">By ${escapeHtml(post.author)}</p>` : ''}
              <p style="margin:12px 0 0;"><span style="font-size:12px;font-weight:600;color:${ACCENT};">Read more &rarr;</span></p>
            </td></tr>
          </table>
        </a>
      </td></tr>
    </table>
  </td></tr>`;
}

function renderPoll(block) {
  const c = block.config || {};
  const question = c.question || '';
  const options = c.options || [];
  const optionHtml = options
    .map((o) => `<tr><td style="padding:4px 0;">
      <a href="${escapeHtml(o.url)}" target="_blank" rel="noopener" style="display:block;padding:10px 16px;background:${CARD_BG};border:1px solid ${BORDER};border-radius:6px;text-decoration:none;color:${TEXT_BRIGHT};font-size:13px;font-weight:500;">
        ${escapeHtml(o.label)}
      </a>
    </td></tr>`)
    .join('');
  return `<tr><td style="padding:${padStr(block.padding)};">
    <p style="margin:0 0 12px;font-size:15px;font-weight:600;color:${TEXT_BRIGHT};">${escapeHtml(question)}</p>
    <table cellpadding="0" cellspacing="0" border="0" width="100%">${optionHtml}</table>
  </td></tr>`;
}

function renderCountdown(block) {
  const c = block.config || {};
  return `<tr><td style="padding:${padStr(block.padding)};text-align:center;">
    <p style="margin:0 0 8px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:${TEXT_MUTED};">${escapeHtml(c.label)}</p>
    <p style="margin:0;font-size:11px;color:${TEXT_MUTED};">${escapeHtml(c.targetDate)}</p>
  </td></tr>`;
}

function renderPersonalization(block) {
  const c = block.config || {};
  const template = c.template || `Hey {{${c.field || 'name'}}},`;
  return `<tr><td style="padding:${padStr(block.padding)};font-size:14px;color:${TEXT};">${escapeHtml(template)}</td></tr>`;
}

function renderSection(block, data, branding) {
  const c = block.config || {};
  const children = block.children || [];
  const childHtml = children.map((child) => renderBlockHtml(child, data, branding)).join('');
  const sectionTitle = c.showTitle !== false && c.title
    ? `<tr><td style="padding:0 0 12px 0;"><p style="margin:0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:${TEXT_MUTED};border-bottom:1px solid ${BORDER};padding-bottom:8px;">${escapeHtml(c.title)}</p></td></tr>`
    : '';
  const bg = c.background ? `background:${c.background};` : '';
  return `<tr><td style="padding:${padStr(block.padding)};${bg}">
    <table cellpadding="0" cellspacing="0" border="0" width="100%">
      ${sectionTitle}
      ${childHtml}
    </table>
  </td></tr>`;
}

function renderColumns(block, data, branding) {
  const c = block.config || {};
  const colCount = c.columnCount || 2;
  const children = block.children || [];
  const colWidth = Math.floor(100 / colCount);
  const gap = c.gap || 16;
  const cols = Array.from({ length: colCount }, (_, i) => {
    const child = children[i];
    const inner = child ? renderBlockHtml(child, data, branding) : '';
    return `<td width="${colWidth}%" valign="top" style="padding:0 ${i < colCount - 1 ? gap / 2 : 0}px 0 ${i > 0 ? gap / 2 : 0}px;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%">${inner}</table>
    </td>`;
  }).join('');
  return `<tr><td style="padding:${padStr(block.padding)};">
    <table cellpadding="0" cellspacing="0" border="0" width="100%" class="two-col"><tr>${cols}</tr></table>
  </td></tr>`;
}

// ── Dispatcher ──────────────────────────────────────────────────────

function renderBlockHtml(block, dataMap, branding) {
  if (block.visible === false) return '';
  const data = (dataMap && dataMap[block.id]) || (block.children ? dataMap : {});
  switch (block.type) {
    case 'header':          return renderHeader(block, data, branding);
    case 'footer':          return renderFooter(block, data, branding);
    case 'divider':         return renderDivider(block);
    case 'spacer':          return renderSpacer(block);
    case 'rich-text':       return renderRichText(block, data);
    case 'image':           return renderImage(block);
    case 'button':          return renderButton(block);
    case 'social-links':    return renderSocialLinks(block);
    case 'custom-html':     return renderCustomHtml(block);
    case 'rss-card':        return renderRssCard(block, data);
    case 'poll':            return renderPoll(block);
    case 'countdown':       return renderCountdown(block);
    case 'personalization': return renderPersonalization(block);
    case 'section':         return renderSection(block, dataMap, branding);
    case 'columns':         return renderColumns(block, dataMap, branding);
    default:                return '';
  }
}

// ── Full email shell ────────────────────────────────────────────────

function renderEmail(opts) {
  const {
    blocks = [],
    branding = {},
    settings = {},
    data = {},
    subject = '',
    date,
    unsubscribeUrl = '',
  } = opts || {};

  const maxWidth = settings.maxWidth || 640;
  const bodyBg = settings.bodyBg || BG;
  const fontFamily = settings.fontFamily ||
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  const primary = branding.primaryColor || ACCENT;

  const dateFormatted = date
    ? new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      })
    : '';

  const blocksHtml = blocks.map((b) => renderBlockHtml(b, data, branding)).join('\n');
  const processed = blocksHtml
    .replace(/\{\{date_formatted\}\}/g, escapeHtml(dateFormatted))
    .replace(/\{\{date\}\}/g, escapeHtml(date || ''))
    .replace(/\{\{unsubscribe_url\}\}/g, escapeHtml(unsubscribeUrl));

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>${escapeHtml(subject)}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <style>
    body, table, td { font-family: ${fontFamily}; }
    body { margin: 0; padding: 0; background-color: ${bodyBg}; }
    img { border: 0; display: block; }
    a { color: ${primary}; }
    @media only screen and (max-width: 660px) {
      .email-container { width: 100% !important; }
      .two-col td { display: block !important; width: 100% !important; padding-left: 0 !important; padding-right: 0 !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${bodyBg};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <center>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${bodyBg};">
      <tr>
        <td align="center" style="padding:20px 16px;">
          <table role="presentation" class="email-container" cellpadding="0" cellspacing="0" border="0" width="${maxWidth}" style="max-width:${maxWidth}px;width:100%;background-color:${bodyBg};">
            ${processed}
          </table>
        </td>
      </tr>
    </table>
  </center>
</body>
</html>`;
}

module.exports = { renderEmail, renderBlockHtml, escapeHtml };
