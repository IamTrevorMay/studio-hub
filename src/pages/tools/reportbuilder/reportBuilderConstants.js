// Report Builder configuration constants

export const DATA_SOURCE_TYPES = [
  { key: 'rss', label: 'RSS Feeds', description: 'Pull from your research feeds (news & newsletters)' },
  { key: 'triton_api', label: 'Triton API', description: 'Call a Triton Apex endpoint for stats data' },
  { key: 'supabase_query', label: 'Custom Query', description: 'Query a Supabase table directly' },
];

export const OUTPUT_FORMATS = [
  { key: 'markdown', label: 'Markdown' },
  { key: 'html', label: 'HTML' },
  { key: 'json', label: 'JSON' },
];

export const SCHEDULE_PRESETS = [
  { label: 'Daily at 8 AM PT', value: '0 15 * * *' },
  { label: 'Weekly Monday 8 AM PT', value: '0 15 * * 1' },
  { label: 'Weekdays at 8 AM PT', value: '0 15 * * 1-5' },
  { label: 'Manual only', value: null },
  { label: 'Custom', value: '__custom__' },
];

export const PROMPT_VARIABLES = [
  { key: '{{articles}}', description: 'Formatted list of fetched articles (title, source, description)' },
  { key: '{{feed_names}}', description: 'Comma-separated list of feed names' },
  { key: '{{date}}', description: 'Today\'s date (YYYY-MM-DD)' },
  { key: '{{source_count}}', description: 'Number of sources/articles fetched' },
  { key: '{{triton_data}}', description: 'JSON response from Triton API call' },
  { key: '{{query_results}}', description: 'Results from custom Supabase query' },
];

export const DEFAULT_REPORT_CONFIG = {
  name: '',
  description: '',
  slug: '',
  data_source_type: 'rss',
  data_source_config: { feed_ids: [], time_window_hours: 48 },
  prompt_template: '',
  output_format: 'markdown',
  schedule: '0 15 * * *',
  delivery: { inbox: true, email: false },
  enabled: false,
};

export const DEFAULT_SOURCE_CONFIGS = {
  rss: { feed_ids: [], time_window_hours: 48 },
  triton_api: { endpoint: '', method: 'GET', params: '{}' },
  supabase_query: { table: '', select: '*', filters: '[]', limit: 100, order_by: '' },
};

export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function describeSchedule(cron) {
  if (!cron) return 'Manual only';
  const presets = {
    '0 15 * * *': 'Daily at 8 AM PT',
    '0 15 * * 1': 'Weekly Monday 8 AM PT',
    '0 15 * * 1-5': 'Weekdays at 8 AM PT',
  };
  return presets[cron] || cron;
}
