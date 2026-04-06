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
  canvas: [],
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

// ── Canvas Block Types ───────────────────────────────────────

export const BLOCK_TYPES = [
  { type: 'heading', label: 'Heading', icon: 'H' },
  { type: 'text', label: 'Text', icon: 'T' },
  { type: 'image', label: 'Image', icon: '🖼' },
  { type: 'divider', label: 'Divider', icon: '—' },
  { type: 'spacer', label: 'Spacer', icon: '↕' },
  { type: 'columns', label: 'Columns', icon: '▥' },
];

export const CANVAS_FONT_OPTIONS = [
  'DM Sans',
  'Helvetica Neue',
  'Arial',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Verdana',
  'Trebuchet MS',
];

export const CANVAS_FONT_SIZES = [
  '11px', '12px', '13px', '14px', '16px', '18px', '20px', '24px', '28px', '32px', '36px', '42px',
];

export const DEFAULT_BLOCK_STYLES = {
  heading: { fontFamily: 'DM Sans', fontSize: '24px', color: '#1a1a2e', textAlign: 'left', fontWeight: '700' },
  text: { fontFamily: 'DM Sans', fontSize: '14px', color: '#333333', textAlign: 'left', lineHeight: '1.6' },
  image: { width: '100%', borderRadius: '4px' },
  divider: { borderColor: '#e2e8f0', borderWidth: '1px', margin: '8px 0' },
  spacer: { height: '24px' },
  columns: {},
  section: {},
};

let _blockCounter = 0;

export function createBlock(type, overrides = {}) {
  _blockCounter += 1;
  const id = `block-${Date.now()}-${_blockCounter}`;
  const base = { id, type, style: { ...DEFAULT_BLOCK_STYLES[type] } };

  switch (type) {
    case 'heading':
      return { ...base, content: 'Heading', level: 1, ...overrides };
    case 'text':
      return { ...base, content: '<p>Start typing...</p>', ...overrides };
    case 'image':
      return { ...base, src: '', alt: '', ...overrides };
    case 'divider':
      return { ...base, ...overrides };
    case 'spacer':
      return { ...base, ...overrides };
    case 'columns':
      return { ...base, columns: [{ blocks: [] }, { blocks: [] }], ...overrides };
    case 'section':
      return { ...base, sectionId: overrides.sectionId || '', ...overrides };
    default:
      return { ...base, ...overrides };
  }
}
