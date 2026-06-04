// youtube-scheduled — returns scheduled (not yet public) videos for all
// active YouTube channels. Called by the Tracking page to populate the
// Upcoming section in each YouTube column.
//
// Auth: admin JWT (same pattern as sync-progress-cards).
// Response: { scheduled: [{ channelName, title, scheduledAt, videoId }] }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CHANNEL_TOKEN_MAP: Record<string, string> = {
  "More Mayday": "YOUTUBE_REFRESH_TOKEN_MAYDAY",
};

async function getYouTubeAccessToken(
  accountName?: string,
): Promise<string | null> {
  const clientId = Deno.env.get("YOUTUBE_CLIENT_ID");
  const clientSecret = Deno.env.get("YOUTUBE_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;

  const tokenEnvVar =
    (accountName && CHANNEL_TOKEN_MAP[accountName]) || "YOUTUBE_REFRESH_TOKEN";
  const refreshToken = Deno.env.get(tokenEnvVar);
  if (!refreshToken) return null;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.access_token;
}

const YT_API = "https://www.googleapis.com/youtube/v3";

// Fetch scheduled videos for one channel using search.list with forMine=true
async function fetchScheduledVideos(
  accessToken: string,
  channelName: string,
): Promise<
  { channelName: string; title: string; scheduledAt: string; videoId: string }[]
> {
  // Step 1: Search for the channel owner's upcoming/private videos
  const searchUrl = new URL(`${YT_API}/search`);
  searchUrl.searchParams.set("part", "snippet");
  searchUrl.searchParams.set("forMine", "true");
  searchUrl.searchParams.set("type", "video");
  searchUrl.searchParams.set("order", "date");
  searchUrl.searchParams.set("maxResults", "50");

  const searchRes = await fetch(searchUrl.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!searchRes.ok) {
    console.error(
      `search.list failed for ${channelName}: ${searchRes.status}`,
    );
    return [];
  }
  const searchData = await searchRes.json();
  const videoIds = (searchData.items || [])
    .map((item: any) => item.id?.videoId)
    .filter(Boolean);

  if (videoIds.length === 0) return [];

  // Step 2: Get video details to check status.publishAt
  const results: {
    channelName: string;
    title: string;
    scheduledAt: string;
    videoId: string;
  }[] = [];

  // Batch in groups of 50
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const videosUrl = new URL(`${YT_API}/videos`);
    videosUrl.searchParams.set("part", "snippet,status");
    videosUrl.searchParams.set("id", batch.join(","));

    const videosRes = await fetch(videosUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!videosRes.ok) continue;
    const videosData = await videosRes.json();

    for (const v of videosData.items || []) {
      const publishAt = v.status?.publishAt;
      const privacy = v.status?.privacyStatus;
      // Scheduled videos are private with a publishAt timestamp in the future
      if (publishAt && privacy === "private") {
        const scheduledTime = new Date(publishAt);
        if (scheduledTime > new Date()) {
          results.push({
            channelName,
            title: v.snippet?.title || "(untitled)",
            scheduledAt: publishAt,
            videoId: v.id,
          });
        }
      }
    }
  }

  return results.sort(
    (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  // Auth: admin JWT
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const userToken = auth.replace("Bearer ", "");
  const {
    data: { user },
  } = await admin.auth.getUser(userToken);
  if (!user) {
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    return new Response(JSON.stringify({ error: "Admin only" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Get active YouTube accounts
    const { data: accounts } = await admin
      .from("platform_accounts")
      .select("id, account_name, external_id")
      .eq("platform", "youtube")
      .eq("is_active", true);

    if (!accounts || accounts.length === 0) {
      return new Response(JSON.stringify({ scheduled: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const allScheduled: {
      channelName: string;
      title: string;
      scheduledAt: string;
      videoId: string;
      accountId: string;
    }[] = [];

    for (const account of accounts) {
      const token = await getYouTubeAccessToken(account.account_name);
      if (!token) {
        console.log(`No token for ${account.account_name}, skipping`);
        continue;
      }

      const videos = await fetchScheduledVideos(token, account.account_name);
      for (const v of videos) {
        allScheduled.push({ ...v, accountId: account.id });
      }
    }

    allScheduled.sort(
      (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
    );

    return new Response(JSON.stringify({ scheduled: allScheduled }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("youtube-scheduled error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
