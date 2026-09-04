// Metricool analytics endpoints — published account content.
//
// Two different families of Metricool endpoint, answering different questions:
//
//   /v2/scheduler/posts        "what did Metricool publish for me?"  (the outbox)
//   /v2/analytics/<kind>/<net> "what is actually on this account?"   (the truth)
//
// The scheduler cannot see anything posted natively from a phone. Probed
// 2026-09-03 over Aug 1–Sep 3: Instagram matched exactly (16 v 15, the extra
// being a Jul 31 post the scheduler returns because of extendedRange=true),
// but TikTok was missing 2 native posts and Facebook 3. So published counts
// come from analytics.
//
// Two things deliberately stay on the scheduler:
//   * IG Stories — /v2/analytics/stories/instagram returns HTTP 500.
//   * Scheduled/future posts — analytics only knows what already published.
//
// IG feed posts (and therefore carousels) also stay on the scheduler: the
// carousel rule is "a POST with more than one media item", derived from the
// scheduler payload, and there are zero published carousels to verify the
// analytics shape against. Guessing there would be worse than staying put.

export type AnalyticsPost = {
  externalId: string;
  network: "INSTAGRAM" | "TIKTOK" | "FACEBOOK";
  subtype: "REEL" | "POST" | null;
  publishedAt: string | null;   // ISO
  url: string | null;
  text: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  metrics: {
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saves: number | null;
    reach: number | null;
    watchTimeSeconds: number | null;
    avgViewDurationSeconds: number | null;
    engagement: number | null;
  };
  extra: Record<string, unknown>;
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Metricool is inconsistent about date shape across these endpoints: a plain
// ISO string, a Unix timestamp (seconds or ms), or a { dateTime } wrapper.
// Anything unparseable returns null and the caller drops the row rather than
// inventing a date.
export function parseDate(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") {
    const ms = v > 1e12 ? v : v * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof v === "string") {
    if (/^\d+$/.test(v)) return parseDate(Number(v));
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return parseDate(o.dateTime ?? o.date ?? o.value ?? o.timestamp ?? null);
  }
  return null;
}

// Strip tracking params so an id survives URL formatting differences — the
// analytics endpoints append utm_campaign to TikTok share URLs.
export function idFromUrl(u?: string | null): string | null {
  if (!u) return null;
  const m = String(u).match(/\/(reel|reels|p|video|posts)\/([A-Za-z0-9_\-]+)/);
  if (m) return m[2];
  return String(u).split("?")[0].replace(/\/+$/, "").split("/").pop() || null;
}

async function get(token: string, path: string): Promise<any[]> {
  const r = await fetch(`https://app.metricool.com/api${path}`, {
    headers: { "X-Mc-Auth": token },
  });
  if (!r.ok) {
    console.error(`metricool analytics ${path.split("?")[0]} → ${r.status}`);
    return [];
  }
  const b = await r.json().catch(() => null);
  return Array.isArray(b) ? b : (b?.data ?? []);
}

type Args = { token: string; userId: string; blogId: string; start: string; end: string };

// `start`/`end` are plain 'YYYY-MM-DD'. These endpoints reject bare dates —
// they require yyyy-MM-dd'T'HH:mm:ss — and unlike the scheduler they respect
// the window strictly rather than spilling past the boundary.
export async function fetchAnalyticsPosts({ token, userId, blogId, start, end }: Args): Promise<AnalyticsPost[]> {
  const q = `from=${start}T00:00:00&to=${end}T23:59:59`
    + `&blogId=${blogId}&userId=${userId}&timezone=America/Los_Angeles`;

  const [igReels, ttPosts, fbPosts, fbReels] = await Promise.all([
    get(token, `/v2/analytics/reels/instagram?${q}`),
    get(token, `/v2/analytics/posts/tiktok?${q}`),
    get(token, `/v2/analytics/posts/facebook?${q}`),
    get(token, `/v2/analytics/reels/facebook?${q}`),
  ]);

  const out: AnalyticsPost[] = [];

  for (const r of igReels) {
    const publishedAt = parseDate(r.publishedAt);
    const externalId = String(r.reelId ?? idFromUrl(r.url) ?? "");
    if (!publishedAt || !externalId) continue;
    out.push({
      externalId, network: "INSTAGRAM", subtype: "REEL", publishedAt,
      url: r.url ?? null, text: String(r.content ?? "").slice(0, 500),
      thumbnailUrl: r.imageUrl ?? null, durationSeconds: num(r.durationSeconds),
      metrics: {
        views: num(r.views), likes: num(r.likes), comments: num(r.comments),
        shares: num(r.shares), saves: num(r.saved), reach: num(r.reach),
        watchTimeSeconds: num(r.videoViewTotalTime),
        avgViewDurationSeconds: num(r.averageWatchTime),
        engagement: num(r.engagement),
      },
      extra: { impressionsTotal: r.impressionsTotal ?? null, reelsSkipRate: r.reelsSkipRate ?? null },
    });
  }

  for (const r of ttPosts) {
    const publishedAt = parseDate(r.createTime);
    const externalId = String(r.videoId ?? idFromUrl(r.shareUrl) ?? "");
    if (!publishedAt || !externalId) continue;
    out.push({
      externalId, network: "TIKTOK", subtype: null, publishedAt,
      url: r.shareUrl ?? null,
      text: String(r.videoDescription ?? r.title ?? "").slice(0, 500),
      thumbnailUrl: r.coverImageUrl ?? null, durationSeconds: num(r.duration),
      metrics: {
        views: num(r.viewCount), likes: num(r.likeCount), comments: num(r.commentCount),
        shares: num(r.shareCount), saves: null, reach: null,
        watchTimeSeconds: null, avgViewDurationSeconds: null,
        engagement: num(r.engagement),
      },
      extra: { impressionSources: r.impressionSources ?? null },
    });
  }

  for (const r of fbPosts) {
    const publishedAt = parseDate(r.created ?? r.timestamp);
    const externalId = String(r.postId ?? idFromUrl(r.link) ?? "");
    if (!publishedAt || !externalId) continue;
    out.push({
      externalId, network: "FACEBOOK", subtype: "POST", publishedAt,
      url: r.link ?? null, text: String(r.text ?? "").slice(0, 500),
      thumbnailUrl: r.picture ?? null, durationSeconds: null,
      metrics: {
        views: num(r.videoViews), likes: num(r.reactions ?? r.like),
        comments: num(r.comments), shares: num(r.shares), saves: null,
        reach: num(r.impressionsUnique),
        watchTimeSeconds: num(r.videoTimeWatched),
        avgViewDurationSeconds: null, engagement: num(r.engagement),
      },
      extra: { impressions: r.impressions ?? null, clicks: r.clicks ?? null, type: r.type ?? null },
    });
  }

  for (const r of fbReels) {
    const publishedAt = parseDate(r.created);
    const externalId = String(r.reelId ?? idFromUrl(r.reelUrl) ?? "");
    if (!publishedAt || !externalId) continue;
    out.push({
      externalId, network: "FACEBOOK", subtype: "REEL", publishedAt,
      url: r.reelUrl ?? null, text: String(r.description ?? "").slice(0, 500),
      thumbnailUrl: r.thumbnailUrl ?? null, durationSeconds: num(r.length),
      metrics: {
        views: num(r.blueReelsPlayCount), likes: num(r.postVideoReactions),
        comments: null, shares: null, saves: null,
        reach: num(r.postImpressionsUnique),
        watchTimeSeconds: num(r.postVideoViewTimeSeconds),
        avgViewDurationSeconds: num(r.postVideoAvgTimeWatchedSeconds),
        engagement: num(r.engagement),
      },
      extra: { socialActions: r.postVideoSocialActions ?? null },
    });
  }

  return out;
}

// Shape an analytics post like a scheduler post, so metricool-posts can return
// one uniform list and its callers stay unchanged.
export function toSchedulerShape(p: AnalyticsPost) {
  return {
    id: `an_${p.network.toLowerCase()}_${p.externalId}`,
    text: p.text.slice(0, 120),
    publicationDate: p.publishedAt,
    status: "PUBLISHED",
    network: p.network,
    publicUrl: p.url,
    youtubeTitle: null,
    youtubeType: null,
    instagramType: p.network === "INSTAGRAM" ? p.subtype : null,
    facebookType: p.network === "FACEBOOK" ? p.subtype : null,
    // Analytics has no media array; carousels are identified on the scheduler
    // path, which still supplies IG feed posts.
    mediaCount: 1,
    draft: false,
    creatorEmail: null,
    _source: "analytics",
  };
}
