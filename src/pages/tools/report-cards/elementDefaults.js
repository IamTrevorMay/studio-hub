// Sensible default Scene element props per type. The Builder catalog
// calls this when the user clicks "+ Add <type>" so a new element drops
// in already looking reasonable instead of as an empty box.

let _idCounter = 0;
function nextId(type) {
  _idCounter++;
  return `${type}-${Date.now()}-${_idCounter}`;
}

const COMMON = (type, partial) => ({
  id: nextId(type),
  type,
  x: 80,
  y: 80,
  width: 320,
  height: 160,
  zIndex: 1,
  rotation: 0,
  opacity: 1,
  locked: false,
  props: {},
  ...partial,
});

export const ELEMENT_TYPES = [
  { type: 'text',            label: 'Text',          group: 'Basic' },
  { type: 'shape',           label: 'Shape',         group: 'Basic' },
  { type: 'player-image',    label: 'Player Image',  group: 'Basic' },
  { type: 'rc-stat-box',     label: 'Stat Box',      group: 'Report Card' },
  { type: 'rc-statline',     label: 'Statline',      group: 'Report Card' },
  { type: 'rc-table',        label: 'Table',         group: 'Report Card' },
  { type: 'rc-bar-chart',    label: 'Bar Chart',     group: 'Report Card' },
  { type: 'rc-donut-chart',  label: 'Donut Chart',   group: 'Report Card' },
  { type: 'rc-heatmap',      label: 'Heat Map',      group: 'Report Card' },
  { type: 'rc-zone-plot',    label: 'Zone Plot',     group: 'Report Card' },
  { type: 'rc-movement-plot',label: 'Movement Plot', group: 'Report Card' },
];

export function buildDefaultElement(type) {
  switch (type) {
    case 'text':
      return COMMON(type, {
        width: 600,
        height: 80,
        props: {
          text: 'New text',
          fontSize: 36,
          fontWeight: 700,
          color: '#ffffff',
          textAlign: 'left',
          lineHeight: 1.2,
        },
      });
    case 'shape':
      return COMMON(type, {
        width: 400,
        height: 240,
        props: {
          bgColor: '#1a1a2e',
          bgOpacity: 1,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: '#6366f1',
        },
      });
    case 'player-image':
      return COMMON(type, {
        width: 240,
        height: 240,
        props: {
          playerId: 660271,
          playerName: 'Player Name',
          showLabel: true,
          borderRadius: 16,
          borderWidth: 2,
          borderColor: '#ffffff',
        },
      });
    case 'rc-stat-box':
      return COMMON(type, {
        width: 280,
        height: 140,
        props: {
          label: 'ERA',
          value: '2.41',
          fontSize: 56,
          color: '#06b6d4',
          bgColor: 'rgba(255,255,255,0.04)',
          borderRadius: 12,
        },
      });
    case 'rc-statline':
      return COMMON(type, {
        width: 720,
        height: 140,
        props: {
          title: 'Last Outing',
          statline: { ip: '6.1', h: 4, r: 2, k: 8, bb: 1, decision: 'W', era: '2.41' },
          fontSize: 28,
          color: '#ffffff',
          bgColor: 'rgba(255,255,255,0.04)',
          borderRadius: 12,
        },
      });
    case 'rc-table':
      return COMMON(type, {
        width: 480,
        height: 320,
        props: {
          title: 'Pitches',
          columns: [
            { key: 'pitch_name', label: 'Type' },
            { key: 'avg_velo',   label: 'Velo',  format: '1f' },
            { key: 'usage',      label: 'Usage', format: 'percent' },
          ],
          rows: [
            { pitch_name: 'FF', avg_velo: 96.3, usage: 0.42 },
            { pitch_name: 'SL', avg_velo: 88.1, usage: 0.22 },
          ],
          fontSize: 16,
          headerFontSize: 13,
          bgColor: '#09090b',
        },
      });
    case 'rc-bar-chart':
      return COMMON(type, {
        width: 480,
        height: 320,
        props: {
          title: 'Pitch Usage',
          barData: [
            { label: 'FF', value: 42, color: '#ef4444' },
            { label: 'SL', value: 22, color: '#0ea5e9' },
            { label: 'CH', value: 18, color: '#10b981' },
            { label: 'CU', value: 12, color: '#a855f7' },
          ],
          bgColor: '#09090b',
        },
      });
    case 'rc-donut-chart':
      return COMMON(type, {
        width: 360,
        height: 320,
        props: {
          title: 'Pitch Mix',
          usageData: [
            { label: 'FF', value: 42, color: '#ef4444' },
            { label: 'SL', value: 22, color: '#0ea5e9' },
            { label: 'CH', value: 18, color: '#10b981' },
            { label: 'CU', value: 12, color: '#a855f7' },
          ],
          innerRadius: 0.55,
          bgColor: '#09090b',
        },
      });
    case 'rc-heatmap':
      return COMMON(type, {
        width: 360,
        height: 480,
        props: {
          title: 'Whiff Rate',
          metric: 'whiff_pct',
          colorMode: 'rainbow',
          showZone: true,
          showLegend: true,
          locations: [],
          bgColor: '#0f0f12',
        },
      });
    case 'rc-zone-plot':
      return COMMON(type, {
        width: 360,
        height: 480,
        props: {
          title: 'Pitch Locations',
          pitches: [],
          bgColor: '#09090b',
        },
      });
    case 'rc-movement-plot':
      return COMMON(type, {
        width: 480,
        height: 480,
        props: {
          title: 'Movement',
          pitches: [],
          seasonShapes: [],
          maxRange: 24,
          dotSize: 10,
          bgColor: '#09090b',
        },
      });
    default:
      return COMMON(type, {});
  }
}
