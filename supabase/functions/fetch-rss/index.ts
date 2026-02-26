import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function parseRssItems(xml: string): Array<Record<string, string>> {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (!doc) return [];

  const items: Array<Record<string, string>> = [];
  const itemEls = doc.querySelectorAll("item");

  for (const item of itemEls) {
    const get = (tag: string) => item.querySelector(tag)?.textContent?.trim() || "";

    // Try multiple image sources
    let imageUrl = "";
    const mediaContent = item.querySelector("media\\:content, content");
    if (mediaContent?.getAttribute("url")) {
      imageUrl = mediaContent.getAttribute("url")!;
    }
    const enclosure = item.querySelector("enclosure");
    if (!imageUrl && enclosure?.getAttribute("type")?.startsWith("image")) {
      imageUrl = enclosure.getAttribute("url") || "";
    }

    items.push({
      title: get("title"),
      link: get("link"),
      description: get("description"),
      content: get("content\\:encoded") || get("content"),
      author: get("dc\\:creator") || get("author"),
      pubDate: get("pubDate"),
      guid: get("guid") || get("link"),
      imageUrl,
    });
  }

  return items;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "No authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify the user is authenticated
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Not authenticated" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use service role to upsert articles
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get enabled feeds
    const { data: feeds, error: feedsError } = await adminClient
      .from("research_feeds")
      .select("*")
      .eq("enabled", true);

    if (feedsError) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch feeds: " + feedsError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch all RSS feeds in parallel
    const feedResults = await Promise.allSettled(
      (feeds || []).map(async (feed) => {
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
    for (const result of feedResults) {
      if (result.status !== "fulfilled") continue;
      const { feed, items } = result.value;

      for (const item of items) {
        if (!item.title) continue;

        const guid = item.guid || item.link;
        if (!guid) continue;

        const { error: upsertError } = await adminClient
          .from("research_articles")
          .upsert(
            {
              feed_id: feed.id,
              title: item.title,
              link: item.link || null,
              description: item.description || null,
              content: item.content || null,
              author: item.author || null,
              pub_date: item.pubDate ? new Date(item.pubDate).toISOString() : null,
              image_url: item.imageUrl || null,
              guid,
            },
            { onConflict: "guid", ignoreDuplicates: false }
          );

        if (!upsertError) upsertCount++;
      }
    }

    // Fetch articles with feed data for the response
    const { data: articles } = await adminClient
      .from("research_articles")
      .select("*, feed:research_feeds(id, name, color, icon_emoji)")
      .order("pub_date", { ascending: false })
      .limit(200);

    return new Response(
      JSON.stringify({
        articles: articles || [],
        feeds: feeds || [],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
