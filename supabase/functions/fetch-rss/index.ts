import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createHandler } from "../shared/handler.ts";
import { parseRssItems } from "./parse.ts";
import { isSafeExternalUrl } from "../shared/url-validation.ts";

Deno.serve(
  createHandler({ auth: "jwt", methods: ["POST"] }, async ({ admin }) => {
    // Get enabled feeds
    const { data: feeds, error: feedsError } = await admin
      .from("research_feeds")
      .select("*")
      .eq("enabled", true);

    if (feedsError) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch feeds: " + feedsError.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Fetch all RSS feeds in parallel. SSRF guard: feed.url is admin-set but
    // a compromised or sloppy entry could point at internal services
    // (metadata, localhost, RFC1918) which the edge runtime can reach.
    const feedResults = await Promise.allSettled(
      (feeds || []).map(async (feed) => {
        if (!isSafeExternalUrl(feed.url)) {
          return { feed, items: [] };
        }
        try {
          const res = await fetch(feed.url, {
            headers: { "User-Agent": "StudioHub-RSS/1.0" },
          });
          if (!res.ok) return { feed, items: [] };
          const xml = await res.text();
          const items = parseRssItems(xml);
          return { feed, items };
        } catch {
          return { feed, items: [] };
        }
      })
    );

    // Upsert articles from all feeds
    let upsertCount = 0;
    let upsertErrorCount = 0;
    for (const result of feedResults) {
      if (result.status !== "fulfilled") continue;
      const { feed, items } = result.value;

      for (const item of items) {
        if (!item.title) continue;

        const guid = item.guid || item.link;
        if (!guid) continue;

        const _pd = item.pubDate ? new Date(item.pubDate) : null;

        const { error: upsertError } = await admin
          .from("research_articles")
          .upsert(
            {
              feed_id: feed.id,
              title: item.title,
              link: item.link || null,
              description: item.description || null,
              content: item.content || null,
              author: item.author || null,
              pub_date: _pd && !isNaN(_pd.getTime()) ? _pd.toISOString() : null,
              image_url: item.imageUrl || null,
              guid,
            },
            { onConflict: "feed_id,guid", ignoreDuplicates: false }
          );

        if (upsertError) {
          upsertErrorCount++;
          if (upsertErrorCount === 1) {
            console.error(`fetch-rss upsert failed (feed: ${feed.name}):`, upsertError.message);
          }
        } else {
          upsertCount++;
        }
      }
    }
    if (upsertErrorCount > 0) {
      console.error(`fetch-rss: ${upsertErrorCount} upserts failed, ${upsertCount} succeeded`);
    }

    // Fetch articles with feed data for the response
    const { data: articles } = await admin
      .from("research_articles")
      .select("*, feed:research_feeds(id, name, color, icon_emoji, source_type)")
      .order("pub_date", { ascending: false })
      .limit(200);

    return new Response(
      JSON.stringify({
        articles: articles || [],
        feeds: feeds || [],
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  })
);
