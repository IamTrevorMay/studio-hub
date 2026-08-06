// Send a mailer campaign to its audience right now.
//
//   POST /functions/v1/mailer-send-now  { campaign_id }
//
// Flow:
//   1. Validate caller is admin (via shared workflow-engine helpers).
//   2. Load the campaign + audience members minus suppressions.
//   3. Mark campaign 'sending', write queued mailer_sends rows.
//   4. Render once, then batch-send via Resend in 100-recipient chunks.
//   5. Patch each send row with resend_id / status / sent_at.
//   6. Flip campaign to 'sent' (or 'failed' if no recipients went out).
//
// Deploy: supabase functions deploy mailer-send-now --no-verify-jwt
//
// We keep the recipient loop here rather than per-row because Resend's
// batch endpoint accepts up to 100 personalized emails in a single call
// (~1 round-trip per chunk vs N round-trips).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders,
  jsonResp,
  getUserFromJwt,
  getAdminClient,
} from "../shared/workflow-engine.ts";
import { renderCampaign, Block, RssItem } from "../shared/mailer-render.ts";
import { resolveBlockData, digestDateET } from "../shared/mailer-bindings.ts";
import { resendBatch, SendEmailInput } from "../shared/resend.ts";
import { isSafeExternalUrl } from "../shared/url-validation.ts";
import { signDest } from "../shared/mailer-links.ts";

interface Campaign {
  id: string;
  name: string;
  subject: string;
  preheader: string | null;
  from_name: string | null;
  from_email: string | null;
  reply_to: string | null;
  audience_id: string | null;
  status: string;
  blocks: Block[];
}

interface Subscriber {
  id: string;
  email: string;
  name: string | null;
  custom_fields?: Record<string, unknown> | null;
}

const DEFAULT_FROM = Deno.env.get("MAILER_DEFAULT_FROM") || "noreply@maydaystudio.app";
const CRON_SECRET = Deno.env.get("CRON_SECRET");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);

  // Internal calls from mailer-cron-tick authenticate with the shared
  // CRON_SECRET instead of a user JWT — a service-role key is not a user,
  // so getUserFromJwt would reject it.
  const isInternal = !!CRON_SECRET && req.headers.get("x-cron-secret") === CRON_SECRET;
  if (!isInternal) {
    const auth = await getUserFromJwt(req);
    if (!auth) return jsonResp({ error: "Unauthorized" }, 401);
    if (!auth.isAdmin) return jsonResp({ error: "Admin only" }, 403);
  }

  let body: { campaign_id?: string; test_recipients?: string[] };
  try { body = await req.json(); } catch { return jsonResp({ error: "Invalid JSON" }, 400); }
  if (!body.campaign_id) return jsonResp({ error: "campaign_id required" }, 400);

  const admin = getAdminClient();

  // 1. Pull the campaign. Test sends are allowed against draft and
  //    already-sent campaigns; audience sends require a fresh state.
  const { data: campaign, error: cErr } = await admin
    .from("mailer_campaigns")
    .select("*")
    .eq("id", body.campaign_id)
    .single<Campaign>();
  if (cErr || !campaign) return jsonResp({ error: cErr?.message || "campaign not found" }, 404);

  // Test-send branch: skip audience + queue, fire to explicit recipients.
  const testRecipients = (body.test_recipients || [])
    .map((e) => String(e || "").trim().toLowerCase())
    .filter((e) => e.includes("@"));
  if (testRecipients.length > 0) {
    if (testRecipients.length > 5) return jsonResp({ error: "max 5 test recipients" }, 400);
    return await runTestSend(admin, campaign, testRecipients);
  }

  // The cron tick pre-claims a due campaign by flipping it to 'sending'
  // before calling us, so internal calls must pass through. For a
  // user-triggered send, 'sending' means another send is already in flight.
  if (!isInternal && campaign.status === "sending") return jsonResp({ error: "already sending" }, 409);
  if (!campaign.audience_id) return jsonResp({ error: "no audience" }, 400);

  // 2. Resolve audience → active subscribers, minus suppressions. We
  //    drop suppressed addresses BEFORE writing queue rows so the audit
  //    log isn't polluted with sends that never had a chance to fire.
  const { data: members } = await admin
    .from("mailer_audience_subscribers")
    .select("mailer_subscribers(id, email, name, status, custom_fields)")
    .eq("audience_id", campaign.audience_id);

  // deno-lint-ignore no-explicit-any
  const subs: Subscriber[] = ((members || []) as any[])
    .map((m) => m.mailer_subscribers)
    .filter((s) => s && s.status === "active");

  if (subs.length === 0) {
    await admin.from("mailer_campaigns").update({ status: "failed" }).eq("id", campaign.id);
    return jsonResp({ error: "audience has no active subscribers" }, 400);
  }

  const { data: suppressed } = await admin
    .from("mailer_suppressions")
    .select("email")
    .in("email", subs.map((s) => s.email));
  const suppressedSet = new Set((suppressed || []).map((r) => String(r.email).toLowerCase()));
  const targets = subs.filter((s) => !suppressedSet.has(s.email.toLowerCase()));

  if (targets.length === 0) {
    await admin.from("mailer_campaigns").update({ status: "failed" }).eq("id", campaign.id);
    return jsonResp({ error: "all recipients suppressed" }, 400);
  }

  // 3. Flip to 'sending' and seed mailer_sends with queued rows. The
  //    composite (campaign_id, email) unique index makes this idempotent:
  //    ignoreDuplicates so a retry after a partial failure does NOT reset
  //    rows that already went out back to 'queued'.
  await admin.from("mailer_campaigns").update({
    status: "sending",
    stats: { ...((campaign as unknown as { stats?: Record<string, number> }).stats || {}), recipients: targets.length },
  }).eq("id", campaign.id);

  const sendRows = targets.map((s) => ({
    campaign_id: campaign.id,
    subscriber_id: s.id,
    email: s.email,
    status: "queued",
  }));
  await admin
    .from("mailer_sends")
    .upsert(sendRows, { onConflict: "campaign_id,email", ignoreDuplicates: true });

  // Load the full id + status map for this campaign — not just freshly
  // inserted rows. On a retry the already-sent rows must be visible so we
  // can skip them rather than re-mailing those recipients.
  const { data: allSends } = await admin
    .from("mailer_sends")
    .select("id, email, status")
    .eq("campaign_id", campaign.id);
  const SENT_STATES = ["sent", "delivered", "opened", "clicked", "bounced", "complained"];
  const idByEmail = new Map<string, string>();
  const alreadySent = new Set<string>();
  for (const r of (allSends || [])) {
    const email = String(r.email).toLowerCase();
    idByEmail.set(email, r.id as string);
    if (SENT_STATES.includes(String(r.status))) alreadySent.add(email);
  }

  // Idempotency: only (re)send to recipients who haven't already gone out.
  const pending = targets.filter((s) => !alreadySent.has(s.email.toLowerCase()));
  if (pending.length === 0) {
    await admin.from("mailer_campaigns").update({
      status: "sent",
      sent_at: new Date().toISOString(),
    }).eq("id", campaign.id);
    return jsonResp({ ok: true, sent: 0, note: "all recipients already sent" });
  }

  // 4a. Pre-fetch any RSS feeds referenced by rss-card blocks. We fetch
  //     ONCE per unique URL and pass the parsed item to every render
  //     call so 10k recipients don't trigger 10k feed hits.
  const rssData = await collectRssData(campaign.blocks || []);
  // Resolve data-bound blocks (Mayday Daily digest: scores/standouts/etc.)
  // once per send from the Triton source data for the digest date.
  const blockData = await resolveBlockData(campaign.blocks || [], digestDateET());

  // 4. Render per recipient + build the send envelope. Tracking URLs
  //    use the deployment public URL so links route back through the
  //    track-open / track-click endpoints.
  const baseUrl = Deno.env.get("MAILER_PUBLIC_URL") || Deno.env.get("SUPABASE_URL") || "";
  const from = campaign.from_email || DEFAULT_FROM;
  const fromHeader = campaign.from_name ? `${campaign.from_name} <${from}>` : from;

  const items: SendEmailInput[] = pending.map((s) => {
    const sendId = idByEmail.get(s.email.toLowerCase());
    const openUrl = baseUrl && sendId ? `${baseUrl}/functions/v1/mailer-track-open?s=${sendId}` : undefined;
    const unsub = baseUrl && sendId ? `${baseUrl}/functions/v1/mailer-unsubscribe?s=${sendId}` : undefined;
    const { html, text } = renderCampaign(campaign.blocks || [], {
      subject: campaign.subject,
      preheader: campaign.preheader || undefined,
      openTrackerUrl: openUrl,
      unsubscribeUrl: unsub,
      rewriteHref: (href) => {
        if (!baseUrl || !sendId) return href;
        const u = new URL(`${baseUrl}/functions/v1/mailer-track-click`);
        u.searchParams.set("s", sendId);
        u.searchParams.set("u", href);
        u.searchParams.set("sig", signDest(href));
        return u.toString();
      },
      subscriber: {
        name: s.name,
        email: s.email,
        custom_fields: s.custom_fields || null,
      },
      rssData,
      blockData,
    });
    return {
      from: fromHeader,
      to: s.email,
      subject: campaign.subject,
      html,
      text,
      reply_to: campaign.reply_to || undefined,
      headers: unsub ? { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined,
      tags: [{ name: "campaign_id", value: campaign.id }],
    };
  });

  // 5. Fire in 100-recipient chunks, persisting each chunk's send rows
  //    BEFORE moving to the next. If a later chunk fails, the earlier
  //    chunks are already marked 'sent', so the idempotency filter above
  //    skips them on retry — no duplicate emails. Resend's batch endpoint
  //    returns ids positionally, so chunkResults[j] lines up with
  //    chunkTargets[j].
  const CHUNK = 100;
  let sentCount = 0;
  let firstError: string | null = null;
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunkItems = items.slice(i, i + CHUNK);
    const chunkTargets = pending.slice(i, i + CHUNK);
    let chunkResults: { id: string }[] = [];
    try {
      chunkResults = await resendBatch(chunkItems);
    } catch (e) {
      firstError = String((e as Error)?.message || e);
      break;
    }
    const sentAt = new Date().toISOString();
    for (let j = 0; j < chunkTargets.length; j++) {
      const sendId = idByEmail.get(chunkTargets[j].email.toLowerCase());
      if (!sendId) continue;
      await admin.from("mailer_sends").update({
        status: "sent",
        sent_at: sentAt,
        resend_id: chunkResults[j]?.id || null,
      }).eq("id", sendId);
      sentCount++;
    }
  }

  // 6. Finalize. Nothing went out at all → failed. Otherwise mark 'sent',
  //    flagging a partial send so the operator knows some recipients are
  //    still pending (a retry picks them up without re-mailing the rest).
  if (sentCount === 0) {
    await admin.from("mailer_campaigns").update({ status: "failed" }).eq("id", campaign.id);
    return jsonResp({ error: firstError || "no emails sent" }, 500);
  }
  await admin.from("mailer_campaigns").update({
    status: "sent",
    sent_at: new Date().toISOString(),
  }).eq("id", campaign.id);

  return jsonResp({ ok: true, sent: sentCount, partial: !!firstError, error: firstError || undefined });
});

// Walk blocks (incl. children) and fetch each rss-card's latest item.
// Returns map keyed by block id so the renderer can look it up.
// deno-lint-ignore no-explicit-any
async function collectRssData(blocks: any[]): Promise<Record<string, RssItem>> {
  const urls = new Map<string, string[]>(); // url → [block ids]
  walkRss(blocks, urls);
  const out: Record<string, RssItem> = {};
  await Promise.all(Array.from(urls.entries()).map(async ([url, ids]) => {
    try {
      const item = await fetchLatestRssItem(url);
      if (item) for (const id of ids) out[id] = item;
    } catch {
      // Swallow — renderer falls back to "feed unavailable" card.
    }
  }));
  return out;
}

// deno-lint-ignore no-explicit-any
function walkRss(blocks: any[], urls: Map<string, string[]>) {
  for (const b of (blocks || [])) {
    if (!b) continue;
    if (b.type === "rss-card" && b.rssUrl && b.id) {
      const arr = urls.get(b.rssUrl) || [];
      arr.push(b.id);
      urls.set(b.rssUrl, arr);
    }
    if (Array.isArray(b.children)) {
      // Children can be Block[] (section) or Block[][] (columns)
      if (Array.isArray(b.children[0])) {
        for (const col of b.children) walkRss(col, urls);
      } else {
        walkRss(b.children, urls);
      }
    }
  }
}

async function fetchLatestRssItem(url: string): Promise<RssItem | null> {
  // SSRF guard: rss-card URLs are admin-authored but still user input fetched
  // server-side, so block loopback/link-local/private targets.
  if (!isSafeExternalUrl(url)) return null;
  const res = await fetch(url, { headers: { "User-Agent": "MaydayStudio-Mailer/1.0" } });
  if (!res.ok) return null;
  const xml = await res.text();
  // Crude but works for both RSS and Atom; first <item> or <entry>.
  const itemMatch = xml.match(/<item\b[\s\S]*?<\/item>/i) || xml.match(/<entry\b[\s\S]*?<\/entry>/i);
  if (!itemMatch) return null;
  const block = itemMatch[0];
  return {
    title: textTag(block, "title"),
    link: textTag(block, "link") || attrTag(block, "link", "href"),
    description: textTag(block, "description") || textTag(block, "summary") || textTag(block, "content"),
    author: textTag(block, "author") || textTag(block, "dc:creator") || textTag(block, "name"),
    image: attrTag(block, "media:content", "url") || attrTag(block, "enclosure", "url") || attrTag(block, "image", "url"),
  };
}

function textTag(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!m) return undefined;
  const raw = m[1].replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1").replace(/<[^>]+>/g, "").trim();
  return raw || undefined;
}
function attrTag(xml: string, tag: string, attr: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}\\b[^>]*\\b${attr}\\s*=\\s*"([^"]+)"`, "i"));
  return m ? m[1] : undefined;
}

// Test sends: render once with a TEST prefix and no tracking. Doesn't
// touch campaign status, doesn't seed mailer_sends — purely a preview
// to verify rendering in a real inbox before going to the real list.
// deno-lint-ignore no-explicit-any
async function runTestSend(_admin: any, campaign: Campaign, recipients: string[]): Promise<Response> {
  const from = campaign.from_email || DEFAULT_FROM;
  const fromHeader = campaign.from_name ? `${campaign.from_name} <${from}>` : from;
  const rssData = await collectRssData(campaign.blocks || []);
  const blockData = await resolveBlockData(campaign.blocks || [], digestDateET());
  const { html, text } = renderCampaign(campaign.blocks || [], {
    subject: `[TEST] ${campaign.subject}`,
    preheader: campaign.preheader || undefined,
    rssData,
    blockData,
  });
  const items: SendEmailInput[] = recipients.map((to) => ({
    from: fromHeader,
    to,
    subject: `[TEST] ${campaign.subject}`,
    html,
    text,
    reply_to: campaign.reply_to || undefined,
    tags: [
      { name: "campaign_id", value: campaign.id },
      { name: "test", value: "true" },
    ],
  }));
  try {
    await resendBatch(items);
  } catch (e) {
    return jsonResp({ error: String((e as Error)?.message || e) }, 500);
  }
  return jsonResp({ ok: true, test: true, sent: recipients.length });
}
