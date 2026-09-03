// Shared vocabulary for "how many posts of type X did we publish" goals.
//
// Used by the Weekly / Monthly / Yearly goal forms on the Tracking page. One
// key set across all three tiers so a type means the same thing everywhere:
//   video | short  → YouTube, counted from content_items (already synced)
//   ig_* / tiktok / fb_reel → counted live from Metricool's scheduler/posts
//
// IMPORTANT — verified against the live Metricool API on 2026-09-03:
// Instagram exposes exactly three `instagramData.type` values (REEL, STORY,
// POST). There is no CAROUSEL type. A carousel is a POST carrying more than
// one item in the top-level `media` array, which is why `metricool-posts`
// passes `mediaCount` through and why ig_carousel matches on minMedia.
// (`instagramData.carouselTags` is NOT a reliable signal — it only appears
// when accounts are tagged in the images.)
//
// Caveat worth remembering: Metricool's scheduler only knows about posts
// published *through* Metricool. Anything posted natively in the IG/TikTok
// app is invisible here, so these counts are a floor, not a census.

export const POST_TYPE_OPTIONS = [
  { key: 'video',       label: 'YT Long-form',  short: 'Long',      color: '#f472b6', source: 'content_items', platform: 'youtube' },
  { key: 'short',       label: 'YT Shorts',     short: 'Shorts',    color: '#38bdf8', source: 'content_items', platform: 'youtube' },
  { key: 'ig_reel',     label: 'IG Reels',      short: 'Reels',     color: '#E4405F', source: 'metricool', platform: 'instagram', network: 'INSTAGRAM', type: 'REEL' },
  { key: 'ig_carousel', label: 'IG Carousels',  short: 'Carousels', color: '#f0a3b5', source: 'metricool', platform: 'instagram', network: 'INSTAGRAM', type: 'POST', minMedia: 2 },
  { key: 'ig_story',    label: 'IG Stories',    short: 'Stories',   color: '#c13584', source: 'metricool', platform: 'instagram', network: 'INSTAGRAM', type: 'STORY' },
  { key: 'tiktok',      label: 'TikToks',       short: 'TikToks',   color: '#00F2EA', source: 'metricool', platform: 'tiktok',    network: 'TIKTOK' },
  { key: 'fb_reel',     label: 'FB Reels',      short: 'FB Reels',  color: '#1877F2', source: 'metricool', platform: 'facebook',  network: 'FACEBOOK', type: 'REEL' },
];

export const POST_TYPE_MAP = Object.fromEntries(POST_TYPE_OPTIONS.map(o => [o.key, o]));

// Types whose platform has exactly one account, so the goal form can resolve
// the account itself and hide the picker. YouTube is excluded: two channels
// (More Mayday / Trevor May Baseball) means the user still has to choose.
export const AUTO_ACCOUNT_TYPES = POST_TYPE_OPTIONS
  .filter(o => o.source === 'metricool')
  .map(o => o.key);

export const YOUTUBE_TYPES = POST_TYPE_OPTIONS
  .filter(o => o.source === 'content_items')
  .map(o => o.key);

export function needsAccountPicker(types) {
  return (types || []).some(t => YOUTUBE_TYPES.includes(t));
}

// Resolve the implied platform_account_ids for the auto-account types.
// `accounts` is the platform_accounts list already loaded by the caller.
export function impliedAccountIds(types, accounts) {
  const platforms = new Set(
    (types || [])
      .map(t => POST_TYPE_MAP[t])
      .filter(o => o && o.source === 'metricool')
      .map(o => o.platform),
  );
  return (accounts || []).filter(a => platforms.has(a.platform)).map(a => a.id);
}

// YouTube Shorts cutoff. Matches Tracking.js — the DB content_type column is
// unreliable because sync-youtube still uses an old 60s threshold, while the
// real Shorts ceiling is 3 minutes.
export const LONGFORM_THRESHOLD = 180;

export function youtubeTypeOf(item) {
  const d = Number(item.duration_seconds);
  if (item.content_type === 'short') return 'short';
  if (Number.isFinite(d) && d > 0 && d <= LONGFORM_THRESHOLD) return 'short';
  return 'video';
}

// Does a normalized Metricool post (as returned by the metricool-posts edge
// function) match this post-type key? Only PUBLISHED posts count — a post that
// errored out never reached the platform.
export function metricoolPostMatches(post, typeKey) {
  const opt = POST_TYPE_MAP[typeKey];
  if (!opt || opt.source !== 'metricool') return false;
  if (post.status !== 'PUBLISHED') return false;
  if (post.network !== opt.network) return false;

  // TikTok has no subtype — every published post counts.
  if (!opt.type) return true;

  const subtype = post.instagramType || post.facebookType || null;
  if (subtype !== opt.type) return false;
  if (opt.minMedia && (post.mediaCount || 0) < opt.minMedia) return false;
  // A plain single-image POST is not a carousel, and vice versa.
  if (opt.type === 'POST' && !opt.minMedia && (post.mediaCount || 0) > 1) return false;
  return true;
}
