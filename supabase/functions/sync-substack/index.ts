// supabase/functions/sync-substack/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  getSupabaseAdmin,
  getActiveAccounts,
  updateLastSynced,
  startIngestionLog,
  completeIngestionLog,
  failIngestionLog,
  upsertContentWithMetrics,
  fetchWithRetry,
  jsonResponse,
  errorResponse,
} from "../shared/utils.ts";
import { isSafeExternalUrl } from "../shared/url-validation.ts";

serve(async (req) => {
  try {
    // Auth: CRON_SECRET (header or query) or admin JWT required
    {
      const _expected = Deno.env.get("CRON_SECRET");
      const _provided = req.headers.get("x-cron-secret")
        ?? new URL(req.url).searchParams.get("secret");
      const _isCron = !!_expected && _provided === _expected;
      if (!_isCron) {
        const _auth = req.headers.get("Authorization");
        if (!_auth?.startsWith("Bearer ")) return errorResponse("Unauthorized", 401);
        const _adminClient = getSupabaseAdmin();
        const { data: { user: _u } } = await _adminClient.auth.getUser(_auth.slice(7));
        if (!_u) return errorResponse("Unauthorized", 401);
        const { data: _profile } = await _adminClient
          .from("profiles").select("role").eq("id", _u.id).single();
        if (_profile?.role !== "admin") return errorResponse("Forbidden", 403);
      }
    }

    const supabase = getSupabaseAdmin();
    const accounts = await getActiveAccounts(supabase, "substack");
    if (accounts.length === 0) return jsonResponse({ message: "No active Substack accounts" });

    const results = [];

    for (const account of accounts) {
      const logId = await startIngestionLog(supabase, account.id, "substack_sync");
      let processed = 0, created = 0, updated = 0;

      try {
        const publicationSlug = account.external_id;
        const baseUrl = account.config?.custom_domain
          || `https://${publicationSlug}.substack.com`;

        // SSRF guard: custom_domain is admin-editable but the trust boundary
        // is wide; refuse internal / private-IP / non-http(s) targets.
        if (!isSafeExternalUrl(`${baseUrl}/feed`)) {
          throw new Error(`Unsafe Substack base URL for ${publicationSlug}`);
        }

        const rssRes = await fetchWithRetry(`${baseUrl}/feed`);
        const rssText = await rssRes.text();
        const items = parseRssItems(rssText);

        // NOTE: Substack removed the public /api/v1/subscriber_count endpoint
        // (~2026-03, now 404s on both custom domain and *.substack.com). This block
        // no longer lands data — subscriber/paid counts are slated to move to the
        // Gmail-parse path (see planning.md). Until then, do NOT swallow the failure
        // silently: surface the status so it's visible in edge logs.
        try {
          const statsRes = await fetchWithRetry(`${baseUrl}/api/v1/subscriber_count`);
          if (statsRes.ok) {
            const statsData = await statsRes.json();
            const today = new Date().toISOString().split("T")[0];
            await supabase.from("audience_snapshots").upsert(
              {
                platform_account_id: account.id,
                date: today,
                followers_total: statsData.free_subscribers + (statsData.paid_subscribers || 0),
                metadata: {
                  free_subscribers: statsData.free_subscribers,
                  paid_subscribers: statsData.paid_subscribers,
                },
              },
              { onConflict: "platform_account_id,date" }
            );
          } else {
            const body = await statsRes.text().catch(() => "");
            console.warn(
              `Substack subscriber_count failed for ${publicationSlug}: HTTP ${statsRes.status} ` +
              `(endpoint likely deprecated). Body: ${body.slice(0, 200)}`
            );
          }
        } catch (e) {
          console.warn(
            `Substack subscriber_count error for ${publicationSlug}: ${(e as Error).message}`
          );
        }

        for (const item of items) {
          const result = await upsertContentWithMetrics(
            supabase,
            {
              platform_account_id: account.id,
              external_id: item.guid || item.link,
              title: item.title,
              description: item.description?.substring(0, 500),
              content_type: "article",
              published_at: item.pubDate ? new Date(item.pubDate).toISOString() : undefined,
              url: item.link,
              thumbnail_url: item.image,
              metadata: {
                categories: item.categories,
                author: item.author,
              },
            },
            {
              views: 0,
              likes: 0,
              comments: 0,
              extra_metrics: {
                source: "rss",
                note: "Engagement metrics require manual CSV import or dashboard API",
              },
            }
          );

          processed++;
          if (result.created) created++; else updated++;
        }

        await updateLastSynced(supabase, account.id);
        await completeIngestionLog(supabase, logId, {
          records_processed: processed,
          records_created: created,
          records_updated: updated,
        }, account.id);
        results.push({ account: account.account_name, processed, created, updated });
      } catch (err) {
        await failIngestionLog(supabase, logId, err as Error, undefined, account.id);
        results.push({ account: account.account_name, error: (err as Error).message });
      }
    }

    // Refresh the materialized view so dashboards pick up new data
    try {
      const _adminClient = getSupabaseAdmin();
      await _adminClient.rpc("refresh_daily_platform_rollups");
    } catch (e) { console.error("Rollups refresh failed:", e); }

    return jsonResponse({ success: true, results });
  } catch (err) {
    console.error("sync-substack fatal error:", err);
    return errorResponse((err as Error).message);
  }
});

interface RssItem {
  title: string;
  link: string;
  guid?: string;
  description?: string;
  pubDate?: string;
  author?: string;
  image?: string;
  categories: string[];
}

function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    items.push({
      title: extractTag(itemXml, "title") || "",
      link: extractTag(itemXml, "link") || "",
      guid: extractTag(itemXml, "guid"),
      description: stripHtml(extractTag(itemXml, "description") || ""),
      pubDate: extractTag(itemXml, "pubDate"),
      author: extractTag(itemXml, "dc:creator") || extractTag(itemXml, "author"),
      image: extractEnclosure(itemXml),
      categories: extractAllTags(itemXml, "category"),
    });
  }
  return items;
}

function extractTag(xml: string, tag: string): string | undefined {
  const cdataRegex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, "i");
  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch) return cdataMatch[1].trim();
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = xml.match(regex);
  return match ? match[1].trim() : undefined;
}

function extractAllTags(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const results: string[] = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1].trim());
  }
  return results;
}

function extractEnclosure(xml: string): string | undefined {
  const match = xml.match(/<enclosure[^>]+url="([^"]+)"/);
  return match?.[1];
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim();
}
