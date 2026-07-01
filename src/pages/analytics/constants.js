import { formatCompact } from './utils';

// `coverage` declares how complete each platform's backend pipeline actually is,
// so the UI can label partial data honestly instead of rendering every platform
// as if it were fully tracked. See COVERAGE_META for the labels/tooltips.
//   full      — views + engagement + audience + revenue (YouTube)
//   reach     — views/engagement + followers, no revenue (Metricool: IG/FB/TikTok)
//   audience  — subscribers + content, engagement not ingested (Substack)
//   followers — follower count only (Twitter/Threads)
//   live      — live/partial only, no history or revenue (Twitch)
//   revenue   — revenue only, no audience/content (Stripe/Fourthwall/Company)
export const PLATFORM_META = {
  youtube:   { label: 'YouTube',   color: '#FF0000', icon: 'YT', coverage: 'full' },
  facebook:  { label: 'Facebook',  color: '#1877F2', icon: 'FB', coverage: 'reach' },
  instagram: { label: 'Instagram', color: '#E4405F', icon: 'IG', coverage: 'reach' },
  tiktok:    { label: 'TikTok',    color: '#00F2EA', icon: 'TT', coverage: 'reach' },
  substack:  { label: 'Substack',  color: '#FF6719', icon: 'SS', coverage: 'audience' },
  // Simplecast's brand color is near-black (#2A2A2A) — invisible on the dark
  // theme. Use a legible neutral so its dots/segments/points actually render.
  simplecast:{ label: 'Simplecast',color: '#9AA0A6', icon: 'SC', coverage: 'reach' },
  twitch:    { label: 'Twitch',    color: '#9146FF', icon: 'TW', coverage: 'live' },
  stripe:    { label: 'Stripe',    color: '#635BFF', icon: '$',  coverage: 'revenue' },
  fourthwall:{ label: 'Fourthwall',color: '#E8451C', icon: 'FW', coverage: 'revenue' },
  twitter:   { label: 'Twitter',   color: '#1DA1F2', icon: 'X',  coverage: 'followers' },
  // Softened from pure #FFFFFF — full white glares and reads as "text" on dark.
  threads:   { label: 'Threads',   color: '#E7E9EA', icon: 'TH', coverage: 'followers' },
  // Non-platform revenue (sponsorships, direct deals) with no per-platform home.
  // Lives in revenue_events with a null platform_account_id; surfaced in totals
  // as "Company / Other" so headline revenue stays complete.
  company:   { label: 'Company / Other', color: '#94a3b8', icon: 'CO', coverage: 'revenue' },
};

// Coverage levels whose accounts are EXPECTED to write a platform_daily_metrics
// row every day — used to scope the data-completeness badge so platforms that
// legitimately never produce daily metrics don't drag the score down.
export const DAILY_PIPELINE_COVERAGES = ['full', 'reach', 'live'];

// Short label + one-line explanation for each coverage level, used to render the
// honesty chip next to a platform anywhere its data could be misread as complete.
export const COVERAGE_META = {
  full:      { label: 'Full',         note: 'Views, engagement, audience and revenue all tracked.' },
  reach:     { label: 'Reach only',   note: 'Views, engagement and followers tracked — no revenue.' },
  audience:  { label: 'Audience only',note: 'Subscribers and posts tracked — engagement not ingested.' },
  followers: { label: 'Followers only', note: 'Only follower count is tracked for this platform.' },
  live:      { label: 'Live only',    note: 'Only live/recent activity — no history, no revenue.' },
  revenue:   { label: 'Revenue only', note: 'Revenue only — no audience or content metrics.' },
};

export const REVENUE_CATEGORIES = {
  merch:        { label: 'Merch',          color: '#f97316' },
  subscription: { label: 'Subscriptions',  color: '#8b5cf6' },
  sponsorship:  { label: 'Sponsorships',   color: '#10b981' },
  ad_revenue:   { label: 'Ad Revenue',     color: '#3b82f6' },
  other:        { label: 'Other',          color: '#6b7280' },
};

export const DATE_RANGES = [
  { key: '7d',  label: '7 days',  days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
  { key: '1y',  label: '1 year',  days: 365 },
  { key: 'custom', label: 'Custom' },
];

export const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export const TREND_METRICS = [
  { key: 'views',      label: 'Views',      color: '#6366f1', getValue: r => r.total_views || 0 },
  { key: 'revenue',    label: 'Revenue',    color: '#f59e0b', getValue: r => (r.revenue_cents || 0) / 100 },
  { key: 'engagement', label: 'Engagement', color: '#22c55e', getValue: r => (Number(r.total_likes) || 0) + (Number(r.total_comments) || 0) + (Number(r.total_shares) || 0) },
  { key: 'followers',  label: 'Followers',  color: '#ec4899', getValue: r => r.followers_eod || 0 },
];

export const LINE_COLORS = ['#6366f1', '#f59e0b', '#22c55e', '#ec4899', '#3b82f6', '#a855f7', '#14b8a6'];

export const BUCKET_DEFS = {
  spring_training: { startMonth: 2, startDay: 15, endMonth: 4, endDay: 1, label: 'Spring Training' },
  regular_season:  { startMonth: 4, startDay: 1, endMonth: 10, endDay: 1, label: 'Regular Season' },
  post_season:     { startMonth: 10, startDay: 1, endMonth: 11, endDay: 1, label: 'Post Season' },
  in_season:       { startMonth: 2, startDay: 15, endMonth: 11, endDay: 1, label: 'In Season' },
  off_season:      { startMonth: 11, startDay: 1, endMonth: 2, endDay: 15, label: 'Off Season', crossesYear: true },
};

export const ROW_SPLITS = [
  { key: 'content', label: 'Content' },
  { key: 'day', label: 'Date (Day)' },
  { key: 'month', label: 'Date (Month)' },
  { key: 'year', label: 'Date (Year)' },
  ...Object.entries(BUCKET_DEFS).map(([k, v]) => ({ key: `bucket_${k}`, label: v.label })),
];

export const AVAILABLE_METRICS = [
  { key: 'views', label: 'Views', group: 'Platform Rollups', table: 'daily_platform_rollups', format: v => formatCompact(v), getValue: r => Number(r.total_views) || 0 },
  { key: 'revenue', label: 'Revenue', group: 'Platform Rollups', table: 'daily_platform_rollups', format: v => '$' + (v / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), getValue: r => Number(r.revenue_cents) || 0 },
  { key: 'avg_engagement', label: 'Avg Engagement', group: 'Platform Rollups', table: 'daily_platform_rollups', format: v => (v * 100).toFixed(2) + '%', getValue: r => Number(r.avg_engagement_rate) || 0, aggregate: 'avg' },
  { key: 'followers_eod', label: 'Followers EOD', group: 'Platform Rollups', table: 'daily_platform_rollups', format: v => formatCompact(v), getValue: r => Number(r.followers_eod) || 0, aggregate: 'last' },
  { key: 'content_views', label: 'Views', group: 'Content Metrics', table: 'content_metrics', format: v => formatCompact(v), contentOnly: true },
  { key: 'content_likes', label: 'Likes', group: 'Content Metrics', table: 'content_metrics', format: v => formatCompact(v), contentOnly: true },
  { key: 'content_comments', label: 'Comments', group: 'Content Metrics', table: 'content_metrics', format: v => formatCompact(v), contentOnly: true },
  { key: 'content_shares', label: 'Shares', group: 'Content Metrics', table: 'content_metrics', format: v => formatCompact(v), contentOnly: true },
  { key: 'content_engagement', label: 'Engagement Rate', group: 'Content Metrics', table: 'content_metrics', format: v => (v * 100).toFixed(2) + '%', contentOnly: true },
  { key: 'yt_watch_time', label: 'Watch Time (hrs)', group: 'YouTube', table: 'analytics_youtube_daily', format: v => formatCompact(v), getValue: r => Number(r.watch_time_hours) || 0 },
  { key: 'yt_impressions', label: 'Impressions', group: 'YouTube', table: 'analytics_youtube_daily', format: v => formatCompact(v), getValue: r => Number(r.impressions) || 0 },
  { key: 'yt_ctr', label: 'Impressions CTR', group: 'YouTube', table: 'analytics_youtube_daily', format: v => v.toFixed(2) + '%', getValue: r => Number(r.impressions_ctr) || 0, aggregate: 'avg' },
  { key: 'yt_subscribers', label: 'Subscribers', group: 'YouTube', table: 'analytics_youtube_daily', format: v => formatCompact(v), getValue: r => Number(r.subscribers) || 0 },
  { key: 'yt_est_revenue', label: 'Est. Revenue', group: 'YouTube', table: 'analytics_youtube_daily', format: v => '$' + v.toFixed(2), getValue: r => Number(r.estimated_revenue) || 0 },
  { key: 'yt_ad_revenue', label: 'Ad Revenue', group: 'YouTube', table: 'analytics_youtube_daily', format: v => '$' + v.toFixed(2), getValue: r => Number(r.ad_revenue) || 0 },
  { key: 'yt_cpm', label: 'CPM', group: 'YouTube', table: 'analytics_youtube_daily', format: v => '$' + v.toFixed(2), getValue: r => Number(r.cpm) || 0, aggregate: 'avg' },
  { key: 'yt_rpm', label: 'RPM', group: 'YouTube', table: 'analytics_youtube_daily', format: v => '$' + v.toFixed(2), getValue: r => Number(r.rpm) || 0, aggregate: 'avg' },
  { key: 'yt_unique_viewers', label: 'Unique Viewers', group: 'YouTube', table: 'analytics_youtube_daily', format: v => formatCompact(v), getValue: r => Number(r.unique_viewers) || 0 },
  { key: 'yt_new_viewers', label: 'New Viewers', group: 'YouTube', table: 'analytics_youtube_daily', format: v => formatCompact(v), getValue: r => Number(r.new_viewers) || 0 },
  { key: 'yt_returning_viewers', label: 'Returning Viewers', group: 'YouTube', table: 'analytics_youtube_daily', format: v => formatCompact(v), getValue: r => Number(r.returning_viewers) || 0 },
];

export const COMPARISON_METRICS = AVAILABLE_METRICS.filter(m => !m.contentOnly);
