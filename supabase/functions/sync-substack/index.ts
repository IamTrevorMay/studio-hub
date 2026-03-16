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
} from "./shared/utils.ts";

serve(async (req) => {
  try {
    const supabase = getSupabaseAdmin();
    const accounts = await getActiveAccounts(supabase, "substack");
    if (accounts.length === 0) return jsonResponse({ message: "No active Substack accounts" });

    const results = [];

    for (const account of accounts) {
      const logId = await startIngestionLog(supabase, account.id, "content_sync");
      let processed = 0, created = 0, updated = 0;

      try {
        const publicationSlug = account.external_id;
        const baseUrl = account.config?.custom_domain
          || `https://${publicationSlug}.substack.com`;

        const rssRes = await fetchWithRetry(`${baseUrl}/feed`);
        const rssText = await rssRes.text();
        const items = parseRssItems(rssText);

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
          }
        } catch {
          console.log(`Could not fetch subscriber count for ${publicationSlug}`);
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
        });
        results.push({ account: account.account_name, processed, created, updated });
      } catch (err) {
        await failIngestionLog(supabase, logId, err as Error);
        results.push({ account: account.account_name, error: (err as Error).message });
      }
    }

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
