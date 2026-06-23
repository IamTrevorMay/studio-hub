// Block-tree → HTML + plaintext renderer for mailer campaigns.
// The editor stores campaigns as an ordered list of blocks; the same
// renderer runs on preview, send, and re-render. Keep the block schema
// additive — old campaigns must keep rendering after new block types
// land.

// Shared visual chrome props every block can carry.
export interface BlockChrome {
  id?: string;
  visible?: boolean;
  padding?: { top?: number | null; right?: number | null; bottom?: number | null; left?: number | null };
  background?: string | null;
  // Optional data binding. Data-bound blocks (scores, standouts, etc.) and
  // claude-backed rich-text are resolved at send time into ctx.blockData[id].
  binding?: {
    source?: "briefs" | "daily_cards" | "claude" | "rss" | "static";
    path?: string;
    claudeField?: string;
    rssUrl?: string;
  };
}

export type Block = BlockChrome & (
  | { type: "heading"; level?: 1 | 2 | 3; text: string; align?: "left" | "center" | "right" }
  | { type: "paragraph"; text: string; align?: "left" | "center" | "right" }
  | { type: "image"; src: string; alt?: string; href?: string; width?: number }
  | { type: "button"; text: string; href: string; align?: "left" | "center" | "right" }
  | { type: "divider" }
  | { type: "spacer"; size?: number }
  | { type: "html"; html: string }
  | { type: "rich-text"; html: string }
  | { type: "personalization"; template: string; field?: string; fallback?: string }
  | { type: "rss-card"; rssUrl: string; ctaText?: string; showImage?: boolean; showAuthor?: boolean; showDescription?: boolean }
  | { type: "header"; style?: "logo" | "banner" | "text"; logoUrl?: string; bannerUrl?: string; title?: string; subtitle?: string; bg?: string; fg?: string }
  | { type: "footer"; text?: string; showUnsubscribe?: boolean; showBranding?: boolean; bg?: string; fg?: string }
  | { type: "social-links"; align?: "left" | "center" | "right"; iconSize?: number; color?: string; links?: { platform: string; url: string }[] }
  | { type: "columns"; columnCount?: 2 | 3; gap?: number; children?: Block[][] }
  | { type: "section"; title?: string; showTitle?: boolean; children?: Block[] }
  // Data blocks — content comes from ctx.blockData[id] at send time.
  | { type: "scores"; columns?: number; showDecisions?: boolean }
  | { type: "standouts"; columns?: number; maxCards?: number }
  | { type: "trend-alerts"; maxItems?: number; showSigma?: boolean }
  | { type: "starter-card"; cardType?: string }
);

export interface SubscriberContext {
  name?: string | null;
  email?: string | null;
  custom_fields?: Record<string, unknown> | null;
}

export interface RssItem {
  title?: string;
  link?: string;
  description?: string;
  author?: string;
  image?: string;
}

export interface RenderContext {
  subject: string;
  preheader?: string;
  openTrackerUrl?: string;
  unsubscribeUrl?: string;
  rewriteHref?: (href: string) => string;
  subscriber?: SubscriberContext;
  // Per-block id → fetched RSS item. Populated once per campaign send
  // and passed to every recipient render so we don't re-fetch per email.
  rssData?: Record<string, RssItem | undefined>;
  // Per-block id → resolved data for bound data blocks (scores, standouts,
  // trend-alerts, starter-card) + claude-backed rich-text. Resolved once
  // per campaign send from the Triton source data.
  blockData?: Record<string, Record<string, unknown> | undefined>;
}

function substituteTokens(tmpl: string, sub: SubscriberContext, fallback: string): string {
  return String(tmpl || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key) => {
    const top = (sub as unknown as Record<string, unknown>)[key];
    if (top != null && top !== "") return String(top);
    const cf = sub.custom_fields || {};
    const v = (cf as Record<string, unknown>)[key];
    if (v != null && v !== "") return String(v);
    return fallback || "";
  });
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

// ─── Data-block helpers (Studio light theme) ──────────────────────────
// The Mayday Daily digest blocks (scores/standouts/trend-alerts/starter-card)
// were ported from Triton's dark email renderer into Studio's light theme.
const DB = {
  card: "#f8f9fb", border: "#e5e7eb", bright: "#111111", text: "#333333",
  muted: "#888888", green: "#16a34a", red: "#dc2626", amber: "#d97706",
  blue: "#2563eb", accent: "#6366f1",
};

function plusColor(val: number): string {
  if (val >= 130) return DB.green;
  if (val >= 115) return "#22c55e";
  if (val >= 100) return DB.text;
  if (val >= 85) return "#ea580c";
  return DB.red;
}

function headshot(playerId: number): string {
  return `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_80,q_auto:best/v1/people/${playerId}/headshot/67/current`;
}

// Uppercase section label with a bottom rule (matches the digest's section heads).
function sectionLabel(text: string): string {
  return `<p style="margin:0 0 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:${DB.muted};border-bottom:1px solid ${DB.border};padding-bottom:8px;">${escapeHtml(text)}</p>`;
}

function wrapperStyle(b: BlockChrome): string {
  const parts: string[] = [];
  if (b.background) parts.push(`background:${b.background};`);
  const p = b.padding || {};
  const pTop = p.top != null ? p.top : 0;
  const pRight = p.right != null ? p.right : 0;
  const pBot = p.bottom != null ? p.bottom : 0;
  const pLeft = p.left != null ? p.left : 0;
  if (pTop || pRight || pBot || pLeft) {
    parts.push(`padding:${pTop}px ${pRight}px ${pBot}px ${pLeft}px;`);
  }
  return parts.join("");
}

function maybeWrap(b: BlockChrome, inner: string): string {
  const style = wrapperStyle(b);
  if (!style) return inner;
  return `<div style="${style}">${inner}</div>`;
}

function renderBlock(b: Block, ctx: RenderContext): string {
  if (b.visible === false) return "";
  const inner = renderInner(b, ctx);
  return maybeWrap(b, inner);
}

function renderInner(b: Block, ctx: RenderContext): string {
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
    case "rich-text": {
      // Claude-backed rich-text resolves its HTML from ctx.blockData at send.
      const bound = ctx.blockData?.[b.id || ""]?.html as string | undefined;
      const html = (bound != null && bound !== "") ? bound : (b.html || "");
      return `<div style="font-size:15px;line-height:1.6;color:#333;">${html}</div>`;
    }
    case "scores": {
      const scores = (ctx.blockData?.[b.id || ""]?.scores as Array<Record<string, unknown>>) || [];
      if (!scores.length) return "";
      const card = (g: Record<string, unknown>) => {
        const aw = Number(g.awayScore), hm = Number(g.homeScore);
        const awayWon = aw > hm;
        const dec: string[] = [];
        if (g.winner) dec.push(`<span style="color:${DB.green};font-weight:600;">W</span> ${escapeHtml(String(g.winner))}`);
        if (g.loser) dec.push(`<span style="color:${DB.red};font-weight:600;">L</span> ${escapeHtml(String(g.loser))}`);
        if (g.save) dec.push(`<span style="color:${DB.blue};font-weight:600;">SV</span> ${escapeHtml(String(g.save))}`);
        return `<td width="50%" valign="top" style="padding:4px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${DB.card};border:1px solid ${DB.border};border-radius:6px;"><tr><td style="padding:8px 10px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="font-size:12px;font-weight:700;color:${awayWon ? DB.bright : DB.muted};">${escapeHtml(String(g.away))}</td><td align="right" style="font-size:14px;font-weight:800;color:${awayWon ? DB.bright : DB.muted};">${aw}</td></tr><tr><td style="font-size:12px;font-weight:700;color:${!awayWon ? DB.bright : DB.muted};">${escapeHtml(String(g.home))}</td><td align="right" style="font-size:14px;font-weight:800;color:${!awayWon ? DB.bright : DB.muted};">${hm}</td></tr></table>${dec.length ? `<p style="margin:4px 0 0;font-size:9px;color:${DB.muted};line-height:1.4;">${dec.join(" &middot; ")}</p>` : ""}</td></tr></table></td>`;
      };
      const rows: string[] = [];
      for (let i = 0; i < scores.length; i += 2) {
        const cells = scores.slice(i, i + 2).map(card);
        while (cells.length < 2) cells.push(`<td width="50%" style="padding:4px;"></td>`);
        rows.push(`<tr>${cells.join("")}</tr>`);
      }
      return `<div style="margin:0 0 8px;">${sectionLabel("Scores")}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join("")}</table></div>`;
    }
    case "standouts": {
      const arr = (ctx.blockData?.[b.id || ""]?.standouts as Array<Record<string, unknown>>) || [];
      if (!arr.length) return "";
      const card = (s: Record<string, unknown>) => {
        const gl = s.game_line as Record<string, unknown> | null;
        const line = gl ? `<p style="margin:4px 0 0;font-size:10px;color:${DB.muted};font-family:monospace;">${escapeHtml(String(gl.ip))} IP, ${escapeHtml(String(gl.h))} H, ${escapeHtml(String(gl.er))} ER, ${escapeHtml(String(gl.bb))} BB, ${escapeHtml(String(gl.k))} K</p>` : "";
        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${DB.card};border:1px solid ${DB.border};border-radius:8px;margin-bottom:8px;"><tr><td style="padding:12px 14px;"><p style="margin:0 0 8px;font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:${DB.muted};"><span style="color:${escapeHtml(String(s.accent_color || DB.amber))};font-weight:700;">${escapeHtml(String(s.plus_label || ""))}</span> ${escapeHtml(String(s.role_label || ""))}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="40" valign="middle" style="padding-right:10px;"><img src="${headshot(Number(s.player_id))}" alt="" width="40" height="40" style="border-radius:50%;display:block;" /></td><td valign="middle"><p style="margin:0;font-size:13px;font-weight:600;color:${DB.bright};">${escapeHtml(String(s.player_name || ""))}</p><p style="margin:2px 0 0;font-size:10px;color:${DB.muted};">${escapeHtml(String(s.team || ""))}</p></td><td width="60" align="right" valign="middle"><p style="margin:0;font-size:22px;font-weight:800;font-family:monospace;color:${plusColor(Number(s.plus_value))};">${escapeHtml(String(s.plus_value ?? ""))}</p></td></tr></table>${line}</td></tr></table>`;
      };
      const rows: string[] = [];
      for (let i = 0; i < arr.length; i += 2) {
        const left = card(arr[i]);
        const right = arr[i + 1] ? card(arr[i + 1]) : "";
        rows.push(`<tr><td width="50%" valign="top" style="padding-right:4px;">${left}</td><td width="50%" valign="top" style="padding-left:4px;">${right}</td></tr>`);
      }
      return `<div style="margin:0 0 8px;">${sectionLabel("Yesterday's Standouts")}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join("")}</table></div>`;
    }
    case "trend-alerts": {
      const d = ctx.blockData?.[b.id || ""] || {};
      const surges = (d.surges as Array<Record<string, unknown>>) || [];
      const concerns = (d.concerns as Array<Record<string, unknown>>) || [];
      if (!surges.length && !concerns.length) return "";
      const list = (alerts: Array<Record<string, unknown>>, kind: "surge" | "concern") => {
        if (!alerts.length) return `<p style="margin:0;color:${DB.muted};font-size:12px;">No ${kind === "surge" ? "surges" : "concerns"} detected.</p>`;
        const color = kind === "surge" ? DB.green : DB.red;
        return alerts.slice(0, 5).map((a, i) => {
          const sigma = Math.abs(Number(a.sigma)).toFixed(1) + "σ";
          const arrow = a.direction === "up" ? "↑" : "↓";
          const delta = Number(a.delta);
          return `<div style="padding:6px 0;border-bottom:1px solid ${DB.border};"><span style="font-weight:600;color:${DB.bright};font-size:13px;">${i + 1}. ${escapeHtml(String(a.player_name || ""))}</span> <span style="font-size:10px;font-weight:700;color:${color};">${arrow} ${sigma}</span><p style="margin:2px 0 0;font-size:11px;color:${DB.muted};">${escapeHtml(String(a.metric_label || ""))}: ${Number(a.season_val).toFixed(1)} → ${Number(a.recent_val).toFixed(1)} (${delta > 0 ? "+" : ""}${delta.toFixed(1)})</p></div>`;
        }).join("");
      };
      const colS = `<td width="50%" valign="top" style="padding-right:8px;">${sectionLabel("Surges")}<div style="background:${DB.card};border:1px solid ${DB.border};border-radius:8px;padding:8px 14px;">${list(surges, "surge")}</div></td>`;
      const colC = `<td width="50%" valign="top" style="padding-left:8px;">${sectionLabel("Concerns")}<div style="background:${DB.card};border:1px solid ${DB.border};border-radius:8px;padding:8px 14px;">${list(concerns, "concern")}</div></td>`;
      return `<div style="margin:0 0 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${colS}${colC}</tr></table></div>`;
    }
    case "starter-card": {
      const date = String(ctx.blockData?.[b.id || ""]?.date || "");
      if (!date) return "";
      const cardType = (b as { cardType?: string }).cardType || "ig-starter-card";
      const url = `https://www.tritonapex.io/api/daily-graphics?date=${encodeURIComponent(date)}&type=${encodeURIComponent(cardType)}`;
      return `<div style="margin:0 0 8px;">${sectionLabel("Start of the Day")}<a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="display:block;border:1px solid ${DB.border};border-radius:8px;overflow:hidden;"><img src="${escapeHtml(url)}" alt="Start of the Day" width="600" style="width:100%;height:auto;display:block;border:0;" /></a></div>`;
    }
    case "rss-card": {
      const item = ctx.rssData?.[b.id || ""];
      if (!item) {
        // Send-time fetch returned nothing — render an empty fallback
        // rather than dropping the block silently, so the operator sees
        // it failed.
        return `<div style="border:1px dashed #ccc;border-radius:8px;padding:16px;margin:8px 0;color:#888;font-size:13px;">RSS feed unavailable.</div>`;
      }
      const img = b.showImage !== false && item.image
        ? `<img src="${escapeHtml(item.image)}" alt="" style="max-width:100%;height:auto;display:block;border-radius:6px;margin-bottom:12px;" />`
        : "";
      const title = `<h3 style="margin:0 0 6px;font-size:18px;color:#111;font-weight:700;"><a href="${escapeHtml(item.link || "#")}" style="color:#111;text-decoration:none;">${escapeHtml(item.title || "")}</a></h3>`;
      const author = b.showAuthor !== false && item.author
        ? `<div style="font-size:12px;color:#888;margin-bottom:8px;">by ${escapeHtml(item.author)}</div>`
        : "";
      const desc = b.showDescription !== false && item.description
        ? `<p style="margin:0 0 12px;font-size:14px;color:#444;line-height:1.5;">${escapeHtml(String(item.description).slice(0, 240))}…</p>`
        : "";
      const cta = item.link
        ? `<a href="${escapeHtml(item.link)}" style="display:inline-block;padding:8px 14px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;">${escapeHtml(b.ctaText || "Read more →")}</a>`
        : "";
      return `<div style="border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin:8px 0;">${img}${title}${author}${desc}${cta}</div>`;
    }
    case "personalization": {
      const sub = ctx.subscriber || {};
      const rendered = substituteTokens(b.template || "", sub, b.fallback || "");
      return `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#333;">${escapeHtml(rendered)}</p>`;
    }
    case "header": {
      const bg = b.bg || "#0f0f1a";
      const fg = b.fg || "#ffffff";
      if (b.style === "banner" && b.bannerUrl) {
        return `<div style="background:${bg};text-align:center;"><img src="${escapeHtml(b.bannerUrl)}" alt="" style="max-width:100%;height:auto;display:block;border:0;" /></div>`;
      }
      const logo = (b.style === "logo" || b.style === "text") && b.logoUrl
        ? `<img src="${escapeHtml(b.logoUrl)}" alt="" style="max-height:48px;display:block;margin:0 auto 8px;border:0;" />`
        : "";
      const title = b.title ? `<h1 style="margin:0;font-size:24px;font-weight:700;color:${fg};">${escapeHtml(b.title)}</h1>` : "";
      const sub = b.subtitle ? `<p style="margin:6px 0 0;font-size:14px;color:${fg};opacity:0.75;">${escapeHtml(b.subtitle)}</p>` : "";
      return `<div style="background:${bg};padding:24px;text-align:center;">${logo}${title}${sub}</div>`;
    }
    case "social-links": {
      const align = b.align || "center";
      const size = Number(b.iconSize) || 28;
      const color = b.color || "#6366f1";
      const labels: Record<string, string> = { instagram:"IG", youtube:"YT", twitter:"X", tiktok:"TT", twitch:"TW", linkedin:"IN", facebook:"FB", website:"WEB" };
      const icons = (b.links || [])
        .filter((l) => l && l.url)
        .map((l) => {
          const label = labels[l.platform] || (l.platform || "?").slice(0, 2).toUpperCase();
          const href = ctx.rewriteHref ? ctx.rewriteHref(l.url) : l.url;
          return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" style="display:inline-block;width:${size}px;height:${size}px;line-height:${size}px;background:${color};color:#fff;border-radius:${size}px;text-decoration:none;font-size:${Math.round(size * 0.42)}px;font-weight:700;text-align:center;margin:0 4px;">${label}</a>`;
        })
        .join("");
      return `<div style="text-align:${align};margin:16px 0;">${icons}</div>`;
    }
    case "columns": {
      const cols = Array.isArray(b.children) ? b.children : [[], []];
      const gap = Number(b.gap) || 16;
      const width = Math.floor((100 - (cols.length - 1) * 2) / cols.length);
      const cells = cols.map((colBlocks) => {
        const inner = (colBlocks || []).map((cb: Block) => renderBlock(cb, ctx)).join("\n");
        return `<td valign="top" style="width:${width}%;padding-right:${gap / 2}px;padding-left:${gap / 2}px;">${inner}</td>`;
      }).join("");
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr>${cells}</tr></table>`;
    }
    case "section": {
      const title = b.showTitle && b.title
        ? `<h2 style="margin:0 0 12px;font-size:20px;color:#111;font-weight:700;">${escapeHtml(b.title)}</h2>`
        : "";
      const children = (b.children || []).map((cb: Block) => renderBlock(cb, ctx)).join("\n");
      return `<div style="margin:12px 0;">${title}${children}</div>`;
    }
    case "footer": {
      const bg = b.bg || "#f5f5f7";
      const fg = b.fg || "#666666";
      const showUnsub = b.showUnsubscribe !== false && ctx.unsubscribeUrl;
      const showBrand = b.showBranding !== false;
      const text = b.text ? `<div style="font-size:12px;color:${fg};line-height:1.5;margin-bottom:8px;">${escapeHtml(b.text)}</div>` : "";
      const unsub = showUnsub ? `<div style="font-size:12px;color:${fg};margin-bottom:4px;">You're receiving this because you subscribed. <a href="${escapeHtml(ctx.unsubscribeUrl!)}" style="color:${fg};text-decoration:underline;">Unsubscribe</a>.</div>` : "";
      const brand = showBrand ? `<div style="font-size:11px;color:${fg};opacity:0.6;">sent via Mayday Studio</div>` : "";
      return `<div style="background:${bg};padding:20px;text-align:center;">${text}${unsub}${brand}</div>`;
    }
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
