// Tool definitions, colors, and configuration for Telestration

export const TOOLS = [
  { key: 'select', label: 'Select', icon: 'cursor' },
  { key: 'pen', label: 'Pen', icon: 'pen' },
  { key: 'line', label: 'Line', icon: 'line' },
  { key: 'arrow', label: 'Arrow', icon: 'arrow' },
  { key: 'circle', label: 'Circle', icon: 'circle' },
  { key: 'triangle', label: 'Triangle', icon: 'triangle' },
  { key: 'square', label: 'Square', icon: 'square' },
  { key: 'highlighter', label: 'Highlighter', icon: 'highlighter' },
  { key: 'text', label: 'Text', icon: 'text' },
];

export const COLORS = [
  { key: 'red', value: '#ef4444' },
  { key: 'yellow', value: '#f59e0b' },
  { key: 'blue', value: '#3b82f6' },
  { key: 'green', value: '#22c55e' },
  { key: 'white', value: '#ffffff' },
];

export const STROKE_WIDTHS = [
  { key: 'thin', value: 2 },
  { key: 'medium', value: 4 },
  { key: 'thick', value: 8 },
];

export const PLAYBACK_SPEEDS = [0.25, 0.5, 1];

export const FRAME_DURATION = 1 / 30; // 30fps

export const DEFAULT_ANNOTATION_DURATION = 5; // seconds

export const STORAGE_KEYS = {
  project: 'studio-hub-telestration-project',
  settings: 'studio-hub-telestration-settings',
};

export const DEFAULT_SETTINGS = {
  drawColor: '#ef4444',
  strokeWidth: 4,
  activeTool: 'pen',
  playbackSpeed: 1,
};

// Fabric.js custom properties to include in serialization
export const CUSTOM_FABRIC_PROPS = ['annotationId', 'startTime', 'endTime', 'annotationType'];
