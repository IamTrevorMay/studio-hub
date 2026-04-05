// Report Builder configuration constants

export const SCHEDULE_PRESETS = [
  { label: 'Daily at 8 AM PT', value: '0 15 * * *' },
  { label: 'Weekly Monday 8 AM PT', value: '0 15 * * 1' },
  { label: 'Weekdays at 8 AM PT', value: '0 15 * * 1-5' },
  { label: 'Manual only', value: null },
  { label: 'Custom', value: '__custom__' },
];

export const DEFAULT_REPORT_CONFIG = {
  name: '',
  description: '',
  slug: '',
  section_ids: [],
  output_format: 'html',
  schedule: '0 15 * * *',
  delivery: { inbox: true, email: false },
  enabled: false,
  subscribe_headline: '',
  subscribe_description: '',
  subscribe_accent_color: '',
  subscribe_logo_url: '',
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
