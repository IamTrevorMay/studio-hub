// Storyboard asset constants - silhouettes, props, shot types, transitions

export const SILHOUETTES = [
  { name: 'Standing', path: 'M24 4a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM14 12h12a2 2 0 0 1 2 2v10h-4v16h-3V28h-2v12h-3V24h-4V14a2 2 0 0 1 2-2z' },
  { name: 'Walking', path: 'M24 4a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM12 12h10l2 1 4-1a2 2 0 0 1 2 2v8h-4l-1 8-5-3-3 3-2 10h-3l3-12 3-3-2-5h-5V14a2 2 0 0 1 2-2z' },
  { name: 'Running', path: 'M26 4a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM10 13l8-1 4 3 6-3a1 1 0 0 1 1 1l-3 6-4 2-2 8 4 6h-4l-4-6-4 2-4 10h-3l5-13 4-2-1-5-6 1-1-4z' },
  { name: 'Sitting', path: 'M24 4a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM14 12h12a2 2 0 0 1 2 2v6h-4v2h-2v-2h-4v2h-2v-2h-4v-6a2 2 0 0 1 2-2zM12 22h4v18h-3V24h-1v-2zM24 22h4v18h-3V24h-1v-2z' },
  { name: 'Pointing', path: 'M24 4a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM14 12h12a2 2 0 0 1 2 2v4l6-2 1 3-8 4h-1v4h-4v16h-3V28h-2v12h-3V24h-4V14a2 2 0 0 1 2-2z' },
  { name: 'Crouching', path: 'M24 2a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM12 10h12a2 2 0 0 1 2 2v4h2v4h-4v2l2 8h-3l-2-8h-2l-2 8h-3l2-8v-6h-6v-4h2v-4a2 2 0 0 1 2-2z' },
  { name: 'Arms Raised', path: 'M24 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM10 2l4 10h-2v4h16v-4h-2L30 2h2l-3 12v12h-4v16h-3V26h-4v16h-3V26h-4V14L8 2h2z' },
  { name: 'Two People', path: 'M14 4a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM30 4a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM6 10h10a2 2 0 0 1 2 2v8h-3v16h-2V20h-2v16H9V20H6v-8a2 2 0 0 1 2-2zM22 10h10a2 2 0 0 1 2 2v8h-3v16h-2V20h-2v16h-2V20h-3v-8a2 2 0 0 1 2-2z' },
  { name: 'Group', path: 'M10 3a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM22 3a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM34 3a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM3 8h8v6h-2v14H7V14H5v8H3V8zM15 8h8v6h-2v14h-2V14h-2v8h-2V8zM27 8h8v6h-2v14h-2V14h-2v8h-2V8z' },
];

export const PROPS = [
  { name: 'Camera', path: 'M4 8h20a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2zm22 4l8 4v8l-8 4V12zM8 12a4 4 0 1 0 0 8 4 4 0 0 0 0-8z' },
  { name: 'Microphone', path: 'M16 2a4 4 0 0 1 4 4v10a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4zM8 14v2a8 8 0 0 0 16 0v-2h2v2a10 10 0 0 1-9 9.95V30h6v2H9v-2h6v-4.05A10 10 0 0 1 6 16v-2h2z' },
  { name: 'Studio Light', path: 'M12 2h8l4 12H8L12 2zM14 14h4v4h-4v-4zM15 18h2v14h-2V18zM10 32h12v2H10v-2z' },
  { name: 'Chair', path: 'M8 2h16v2H8V2zM8 4a2 2 0 0 0-2 2v12h2V6h16v12h2V6a2 2 0 0 0-2-2H8zM6 18h20v2H6v-2zM8 20v12h2V20H8zM22 20v12h2V20h-2z' },
  { name: 'Table', path: 'M2 14h28v3H2v-3zM5 17v15h3V17H5zM24 17v15h3V17h-3z' },
  { name: 'Car', path: 'M6 16l3-8h14l3 8h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2v2H22v-2H10v2H6v-2H4a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2h2zM8 20a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM24 20a2 2 0 1 0 0 4 2 2 0 0 0 0-4z' },
  { name: 'Phone', path: 'M10 2h12a2 2 0 0 1 2 2v24a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm0 2v20h12V4H10zm4 22h4v2h-4v-2z' },
  { name: 'Laptop', path: 'M6 6h20a2 2 0 0 1 2 2v14H4V8a2 2 0 0 1 2-2zM2 24h28a1 1 0 0 1 1 1v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2v-1a1 1 0 0 1 1-1z' },
  { name: 'Door', path: 'M8 2h16a2 2 0 0 1 2 2v26H6V4a2 2 0 0 1 2-2zm14 14a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM4 30h24v2H4v-2z' },
  { name: 'Window', path: 'M4 4h24a2 2 0 0 1 2 2v20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM4 6v9h11V6H4zM17 6v9h11V6H17zM4 17v9h11v-9H4zM17 17v9h11v-9H17z' },
  { name: 'Tree', path: 'M16 2l10 12H18l8 10H6l8-10H6L16 2zM14 24h4v8h-4v-8z' },
  { name: 'Building', path: 'M6 2h20a2 2 0 0 1 2 2v26H4V4a2 2 0 0 1 2-2zM8 6h4v4H8V6zM20 6h4v4h-4V6zM8 14h4v4H8v-4zM20 14h4v4h-4v-4zM13 22h6v10h-6V22z' },
  { name: 'Desk', path: 'M2 12h28v3H2v-3zM4 15v2h2v13h2V17h16v13h2V17h2v-2H4z' },
  { name: 'Monitor', path: 'M4 4h24a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM14 26h4v4h-4v-4zM10 30h12v2H10v-2z' },
  { name: 'Coffee Cup', path: 'M4 6h18v2h4a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3h-4v2a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V6zm18 4v6h4a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1h-4zM6 26h14v2H6v-2z' },
];

export const SHOT_TYPES = [
  { code: 'ECU', name: 'Extreme Close-Up', desc: 'Eyes, mouth, or small detail fills frame' },
  { code: 'CU', name: 'Close-Up', desc: 'Face fills most of the frame' },
  { code: 'MCU', name: 'Medium Close-Up', desc: 'Head and shoulders' },
  { code: 'MS', name: 'Medium Shot', desc: 'Waist up' },
  { code: 'MWS', name: 'Medium Wide Shot', desc: 'Knees up' },
  { code: 'WS', name: 'Wide Shot', desc: 'Full body with some environment' },
  { code: 'EWS', name: 'Extreme Wide Shot', desc: 'Subject small in large environment' },
  { code: 'OTS', name: 'Over-the-Shoulder', desc: 'Camera behind one person looking at another' },
  { code: 'POV', name: 'Point of View', desc: 'Camera shows what character sees' },
  { code: 'BIRD', name: "Bird's Eye", desc: 'Directly overhead looking down' },
  { code: 'LOW', name: 'Low Angle', desc: 'Camera looks up at subject' },
  { code: 'HIGH', name: 'High Angle', desc: 'Camera looks down at subject' },
  { code: 'DUTCH', name: 'Dutch Angle', desc: 'Camera tilted on its axis' },
];

export const TRANSITIONS = [
  { code: 'CUT', name: 'Cut', desc: 'Instant switch to next scene' },
  { code: 'FADE_IN', name: 'Fade In', desc: 'Scene gradually appears from black' },
  { code: 'FADE_OUT', name: 'Fade Out', desc: 'Scene gradually disappears to black' },
  { code: 'DISSOLVE', name: 'Dissolve', desc: 'Scene gradually blends into next' },
  { code: 'WIPE', name: 'Wipe', desc: 'Next scene pushes current off screen' },
  { code: 'IRIS', name: 'Iris', desc: 'Circle opens/closes to reveal next scene' },
  { code: 'JUMP', name: 'Jump Cut', desc: 'Abrupt cut within same scene' },
  { code: 'MATCH', name: 'Match Cut', desc: 'Cut using similar shapes/motion' },
  { code: 'CROSS', name: 'Cross Cut', desc: 'Alternate between two scenes' },
  { code: 'SMASH', name: 'Smash Cut', desc: 'Abrupt jarring transition' },
];

export const DRAW_COLORS = [
  '#000000', '#ffffff', '#ef4444', '#f97316', '#eab308',
  '#22c55e', '#3b82f6', '#4f46e5', '#8b5cf6', '#ec4899',
  '#6b7280', '#92400e',
];

export const STROKE_WIDTHS = [1, 2, 4, 8];
