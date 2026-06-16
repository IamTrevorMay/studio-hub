// Centralized block-type registry for the Mailer.
// Every block type lives here with its defaults, category, label, and
// (optionally) child-support flag. The BlockPalette + BlockEditor read
// from this. Server renderer (supabase/functions/shared/mailer-render.ts)
// must mirror any new type.

export const CATEGORIES = [
  { key: 'content',     label: 'Content' },
  { key: 'layout',      label: 'Layout' },
  { key: 'interactive', label: 'Interactive' },
  { key: 'data',        label: 'Data' },
];

const registry = {
  heading: {
    type: 'heading',
    label: 'Heading',
    category: 'content',
    icon: 'Heading',
    description: 'Section title',
    defaults: { text: 'Heading', level: 2, align: 'left' },
  },
  paragraph: {
    type: 'paragraph',
    label: 'Paragraph',
    category: 'content',
    icon: 'AlignLeft',
    description: 'Plain text paragraph',
    defaults: { text: 'Body copy.', align: 'left' },
  },
  image: {
    type: 'image',
    label: 'Image',
    category: 'content',
    icon: 'Image',
    description: 'Image with optional link',
    defaults: { src: '', alt: '', href: '', width: 600 },
  },
  button: {
    type: 'button',
    label: 'Button',
    category: 'content',
    icon: 'MousePointer',
    description: 'Call-to-action button',
    defaults: { text: 'Click here', href: '', align: 'center' },
  },
  divider: {
    type: 'divider',
    label: 'Divider',
    category: 'content',
    icon: 'Minus',
    description: 'Horizontal rule',
    defaults: {},
  },
  spacer: {
    type: 'spacer',
    label: 'Spacer',
    category: 'content',
    icon: 'Move',
    description: 'Vertical whitespace',
    defaults: { size: 24 },
  },
  html: {
    type: 'html',
    label: 'Raw HTML',
    category: 'content',
    icon: 'Code',
    description: 'Inject raw HTML',
    defaults: { html: '<p>Raw HTML…</p>' },
  },
  header: {
    type: 'header',
    label: 'Header',
    category: 'content',
    icon: 'PanelTop',
    description: 'Email header with logo/banner/title',
    defaults: {
      style: 'logo',
      logoUrl: '',
      bannerUrl: '',
      title: '',
      subtitle: '',
      bg: '#0f0f1a',
      fg: '#ffffff',
    },
  },
  footer: {
    type: 'footer',
    label: 'Footer',
    category: 'content',
    icon: 'PanelBottom',
    description: 'Footer with unsubscribe + branding',
    defaults: {
      text: '',
      showUnsubscribe: true,
      showBranding: true,
      bg: '#f5f5f7',
      fg: '#666666',
    },
  },
  'social-links': {
    type: 'social-links',
    label: 'Social Links',
    category: 'content',
    icon: 'Share2',
    description: 'Row of social media icon links',
    defaults: {
      align: 'center',
      iconSize: 28,
      color: '#6366f1',
      links: [
        { platform: 'instagram', url: '' },
        { platform: 'youtube', url: '' },
        { platform: 'twitter', url: '' },
      ],
    },
  },
};

registry['rich-text'] = {
  type: 'rich-text',
  label: 'Rich Text',
  category: 'content',
  icon: 'Type',
  description: 'WYSIWYG formatted text (bold, italic, links, lists)',
  defaults: { html: '<p>Type something…</p>' },
};

// Layout blocks — these contain `children: Block[]`.
registry.columns = {
  type: 'columns',
  label: 'Columns',
  category: 'layout',
  icon: 'Columns',
  description: '2- or 3-column layout',
  defaults: { columnCount: 2, gap: 16, children: [[], []] },
  hasChildren: true,
};
registry.section = {
  type: 'section',
  label: 'Section',
  category: 'layout',
  icon: 'SquareDashedBottom',
  description: 'Grouped section with optional title',
  defaults: { title: '', showTitle: false, children: [] },
  hasChildren: true,
};

export const SOCIAL_PLATFORMS = [
  { key: 'instagram', label: 'Instagram' },
  { key: 'youtube',   label: 'YouTube' },
  { key: 'twitter',   label: 'X / Twitter' },
  { key: 'tiktok',    label: 'TikTok' },
  { key: 'twitch',    label: 'Twitch' },
  { key: 'linkedin',  label: 'LinkedIn' },
  { key: 'facebook',  label: 'Facebook' },
  { key: 'website',   label: 'Website' },
];

export function getBlockDef(type) {
  return registry[type] || null;
}

export function getAllBlocks() {
  return Object.values(registry);
}

export function getBlocksByCategory(category) {
  return Object.values(registry).filter((b) => b.category === category);
}

// Legacy export — old code referenced BLOCK_TYPES as a flat array.
// Kept here so blockRenderer.js + any other consumer keeps working.
export const BLOCK_TYPES = Object.values(registry).map((b) => ({
  type: b.type, label: b.label, defaults: b.defaults,
}));

export default registry;
