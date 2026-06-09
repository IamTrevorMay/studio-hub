import { formatCompact } from './utils';

export const PLATFORM_META = {
  youtube:   { label: 'YouTube',   color: '#FF0000', icon: 'YT' },
  facebook:  { label: 'Facebook',  color: '#1877F2', icon: 'FB' },
  instagram: { label: 'Instagram', color: '#E4405F', icon: 'IG' },
  tiktok:    { label: 'TikTok',    color: '#00F2EA', icon: 'TT' },
  substack:  { label: 'Substack',  color: '#FF6719', icon: 'SS' },
  twitch:    { label: 'Twitch',    color: '#9146FF', icon: 'TW' },
  stripe:    { label: 'Stripe',    color: '#635BFF', icon: '$' },
  fourthwall:{ label: 'Fourthwall',color: '#E8451C', icon: 'FW' },
  twitter:   { label: 'Twitter',   color: '#1DA1F2', icon: 'X' },
  threads:   { label: 'Threads',   color: '#FFFFFF', icon: 'TH' },
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
