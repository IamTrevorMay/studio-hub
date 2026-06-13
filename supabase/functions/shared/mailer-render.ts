// Block-tree → HTML + plaintext renderer for mailer campaigns.
// The editor stores campaigns as an ordered list of blocks; the same
// renderer runs on preview, send, and re-render. Keep the block schema
// additive — old campaigns must keep rendering after new block types
// land.

export type Block =
  | { type: "heading"; level?: 1 | 2 | 3; text: string; align?: "left" | "center" | "right" }
  | { type: "paragraph"; text: string; align?: "left" | "center" | "right" }
  | { type: "image"; src: string; alt?: string; href?: string; width?: number }
  | { type: "button"; text: string; href: string; align?: "left" | "center" | "right" }
  | { type: "divider" }
  | { type: "spacer"; size?: number }
  | { type: "html"; html: string };

export interface RenderContext {
  subject: string;
  preheader?: string;
  openTrackerUrl?: string;
  unsubscribeUrl?: string;
  rewriteHref?: (href: string) => string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function alignStyle(a: string | undefined): string {
  return a ? `text-align:${a};` : "text-align:left;";
}

function renderBlock(b: Block, ctx: RenderContext): string {
  switch (b.type) {
    case "heading": {
      const level = b.level ?? 2;
      const size = level === 1 ? 28 : level === 2 ? 22 : 18;
      return `<h${level} style="margin:0 0 12px;font-size:${size}px;line-height:1.25;color:#111;${alignStyle(b.align)}">${escapeHtml(b.text)}</h${level}>`;
    }
    case "paragraph":
      return `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#333;${alignStyle(b.align)}">${escapeHtml(b.text)}</p>`;
    case "image": {
      const w = b.width ? ` width="${b.width}"` : "";
      const img = `<img src="${escapeHtml(b.src)}" alt="${escapeHtml(b.alt || "")}"${w} style="max-width:100%;height:auto;display:block;margin:0 auto;border:0;" />`;
      const href = b.href ? (ctx.rewriteHref ? ctx.rewriteHref(b.href) : b.href) : null;
      return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${img}</a>` : img;
    }
    case "button": {
      const href = ctx.rewriteHref ? ctx.rewriteHref(b.href) : b.href;
      return `<div style="margin:16px 0;${alignStyle(b.align ?? "center")}"><a href="${escapeHtml(href)}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;font-weight:600;border-radius:6px;text-decoration:none;font-size:14px;">${escapeHtml(b.text)}</a></div>`;
    }
    case "divider":
      return `<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;" />`;
    case "spacer":
      return `<div style="height:${b.size ?? 16}px;line-height:${b.size ?? 16}px;">&nbsp;</div>`;
    case "html":
      // Raw HTML blocks bypass escaping; the editor must label this as
      // an advanced control so non-technical users don't inject markup
      // they don't understand. Renderer trusts the stored value.
      return b.html;
  }
  return "";
}

function renderPreheaderHtml(text: string): string {
  // Hidden preheader span — most clients show the first ~100 chars in
  // the inbox preview. Use zero-width joiners after to push real body
  // copy out of the preview window.
  return `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(text)}${"‌ ".repeat(60)}</div>`;
}

function renderTrackerPixel(url: string | undefined): string {
  if (!url) return "";
  return `<img src="${escapeHtml(url)}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px;" />`;
}

function renderUnsubFooter(url: string | undefined): string {
  if (!url) return "";
  return `<p style="margin:24px 0 0;font-size:12px;color:#888;text-align:center;">You're receiving this because you subscribed. <a href="${escapeHtml(url)}" style="color:#888;text-decoration:underline;">Unsubscribe</a>.</p>`;
}

export function renderCampaign(blocks: Block[], ctx: RenderContext): { html: string; text: string } {
  const body = (blocks || []).map((b) => renderBlock(b, ctx)).join("\n");
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(ctx.subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
${ctx.preheader ? renderPreheaderHtml(ctx.preheader) : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f7;">
  <tr><td align="center" style="padding:24px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">
      <tr><td style="padding:32px;">
${body}
${renderUnsubFooter(ctx.unsubscribeUrl)}
      </td></tr>
    </table>
  </td></tr>
</table>
${renderTrackerPixel(ctx.openTrackerUrl)}
</body></html>`;

  const text = (blocks || []).map((b) => {
    if (b.type === "heading" || b.type === "paragraph") return b.text;
    if (b.type === "button") return `${b.text}: ${b.href}`;
    if (b.type === "image") return b.alt || "";
    if (b.type === "divider") return "---";
    return "";
  }).filter(Boolean).join("\n\n");

  return { html, text };
}
