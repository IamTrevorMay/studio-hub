// Analytics page — LIGHT "cool blue-gray" theme (Tableau-like), a light/airy
// island inside the app's dark shell. White worksheet cards on a pale blue-gray
// page, gentle blue gradients delineating each zone, hairline borders, ink text,
// steel-blue accent. Everything below builds off the `L` palette so the whole
// page retints from one place.

export const L = {
  pageBg:       '#eef1f6',
  card:         '#ffffff',
  cardAlt:      '#f7f9fc',
  // gentle top-to-bottom washes used on zone wrappers to delineate sections
  zoneGrad:     'linear-gradient(180deg, #f4f8fd 0%, #ffffff 55%)',
  zoneGradAlt:  'linear-gradient(180deg, #eef3fa 0%, #f8fafd 60%)',
  border:       '#dbe2ec',
  borderStrong: '#c7d0dd',
  ink:          '#263043',
  inkMuted:     '#5a6473',
  inkSubtle:    '#8791a0',
  inkFaint:     '#aab2be',
  accent:       '#3d6ea5',
  accentText:   '#2f5c8a',
  accentSoft:   '#e8eff7',
  accentBorder: '#bcd0e6',
  gridLine:     '#e6eaf0',
  shadowSm:     '0 1px 2px rgba(38,48,67,0.05)',
  shadow:       '0 1px 2px rgba(38,48,67,0.04), 0 6px 20px rgba(38,48,67,0.06)',
  pos:          '#2f8f5b',
  neg:          '#c2483d',
};

// analysisStyles — consumed by the analysis-tool components (cards). Light.
export const analysisStyles = {
  card: {
    background: L.card,
    border: `1px solid ${L.border}`,
    borderRadius: '14px',
    padding: '22px 24px',
    marginBottom: '20px',
    boxShadow: L.shadow,
  },
  cardHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px',
  },
  cardTitle: { fontSize: '15px', fontWeight: 700, color: L.ink, letterSpacing: '-0.2px' },
};

export const styles = {
  page: {
    padding: '36px 40px 64px',
    maxWidth: '1500px',
    margin: '0 auto',
    background: L.pageBg,
    minHeight: '100%',
    color: L.ink,
  },

  // ── Header / controls ──
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px', gap: '16px', flexWrap: 'wrap' },
  pageTitle: { fontSize: '30px', fontWeight: 700, color: L.ink, margin: '0 0 4px', letterSpacing: '-0.6px' },
  pageSubtitle: { fontSize: '14px', color: L.inkSubtle, margin: 0 },

  // ── Zones (Tableau worksheet groups) ──
  zone: {
    background: L.zoneGrad,
    border: `1px solid ${L.border}`,
    borderRadius: '18px',
    padding: '24px 26px',
    marginBottom: '28px',
    boxShadow: L.shadowSm,
  },
  zoneHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px', marginBottom: '18px', flexWrap: 'wrap' },
  zoneTitle: { fontSize: '12px', fontWeight: 700, color: L.accentText, textTransform: 'uppercase', letterSpacing: '1.2px', margin: 0 },
  zoneSub: { fontSize: '12px', color: L.inkSubtle, margin: 0 },

  // ── Filters ──
  filterBar: { display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: '22px', padding: '12px 16px', background: L.card, borderRadius: '12px', border: `1px solid ${L.border}`, boxShadow: L.shadowSm },
  filterChip: { padding: '6px 14px', background: L.card, border: `1px solid ${L.border}`, borderRadius: '20px', color: L.inkMuted, fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  filterChipActive: { background: L.accentSoft, borderColor: L.accentBorder, color: L.accentText },
  filterSelect: { padding: '6px 10px', background: L.card, border: `1px solid ${L.border}`, borderRadius: '20px', color: L.inkMuted, fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', outline: 'none', appearance: 'none', WebkitAppearance: 'none', paddingRight: '10px' },
  filterSelectActive: { background: L.accentSoft, borderColor: L.accentBorder, color: L.accentText },
  filterInput: { padding: '6px 10px', background: L.card, border: `1px solid ${L.borderStrong}`, borderRadius: '6px', color: L.ink, fontSize: '12px', fontFamily: 'inherit', outline: 'none' },
  platformDot: { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0 },
  platformDropdown: { position: 'absolute', top: '100%', right: 0, marginTop: '6px', background: L.card, border: `1px solid ${L.border}`, borderRadius: '12px', padding: '6px', zIndex: 50, minWidth: '220px', display: 'flex', flexDirection: 'column', gap: '2px', boxShadow: L.shadow },
  platformDropdownItem: { display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 12px', background: 'transparent', border: '1px solid transparent', borderRadius: '8px', color: L.inkMuted, fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%' },
  platformDropdownClear: { padding: '5px 12px', background: 'transparent', border: 'none', borderRadius: '6px', color: L.inkSubtle, fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', marginBottom: '2px' },

  // ── KPI cards ──
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '4px' },
  kpiCard: { background: L.card, border: `1px solid ${L.border}`, borderRadius: '14px', padding: '20px 22px', position: 'relative', overflow: 'hidden', boxShadow: L.shadow },
  kpiAccent: { position: 'absolute', top: 0, left: 0, right: 0, height: '3px' },
  kpiLabel: { fontSize: '11px', fontWeight: 700, color: L.inkSubtle, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '8px' },
  kpiValue: { fontSize: '28px', fontWeight: 700, color: L.ink, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.5px' },

  // ── Chart section (legacy key kept; light card) ──
  chartSection: { background: L.card, border: `1px solid ${L.border}`, borderRadius: '14px', padding: '22px', boxShadow: L.shadow },
  chartHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' },
  chartTitle: { fontSize: '14px', fontWeight: 700, color: L.ink, letterSpacing: '-0.2px' },
  metricChip: { padding: '5px 12px', background: L.card, border: `1px solid ${L.border}`, borderRadius: '14px', color: L.inkMuted, fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  metricChipActive: { background: L.accentSoft, borderColor: L.accentBorder, color: L.accentText },

  // ── Table ──
  tableHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' },
  tableTitle: { fontSize: '14px', fontWeight: 700, color: L.ink },
  tableWrap: { background: L.card, border: `1px solid ${L.border}`, borderRadius: '14px', overflow: 'auto', maxHeight: '600px', boxShadow: L.shadow },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '700px' },
  th: { padding: '11px 14px', textAlign: 'left', fontWeight: 700, fontSize: '11px', color: L.inkSubtle, textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: `1px solid ${L.border}`, position: 'sticky', top: 0, background: L.cardAlt, zIndex: 1, whiteSpace: 'nowrap', userSelect: 'none' },
  thSticky: { position: 'sticky', left: 0, zIndex: 3, background: L.cardAlt, minWidth: '200px', maxWidth: '300px' },
  td: { padding: '9px 14px', borderBottom: `1px solid ${L.gridLine}`, color: L.inkMuted, whiteSpace: 'nowrap' },
  tdSticky: { position: 'sticky', left: 0, zIndex: 1, maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600, color: L.ink, background: L.card },
  tdValue: { fontWeight: 700, color: L.ink, fontVariantNumeric: 'tabular-nums' },
  trEven: { background: L.cardAlt },
  sortArrow: { marginLeft: '4px', color: L.accent },

  // ── Misc ──
  loadingText: { padding: '40px', textAlign: 'center', color: L.inkSubtle, fontSize: '14px' },
  emptyCard: { background: L.cardAlt, border: `1px dashed ${L.borderStrong}`, borderRadius: '14px', padding: '32px', textAlign: 'center' },
  emptyText: { color: L.inkSubtle, fontSize: '14px', margin: 0 },
  uploadBtn: { padding: '8px 16px', background: L.card, border: '1px solid', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  collapseBtn: { display: 'flex', alignItems: 'center', gap: '8px', padding: '14px 18px', background: L.card, border: `1px solid ${L.border}`, borderRadius: '12px', color: L.ink, fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', width: '100%', textAlign: 'left', boxShadow: L.shadowSm },

  // ── View toggle ──
  viewToggleBar: { display: 'flex', gap: '2px', padding: '4px', background: L.card, border: `1px solid ${L.border}`, borderRadius: '12px', width: 'fit-content', marginBottom: '24px', boxShadow: L.shadowSm },
  viewToggleBtn: { padding: '7px 18px', borderRadius: '8px', border: 'none', background: 'transparent', color: L.inkMuted, fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  viewToggleBtnActive: { padding: '7px 18px', borderRadius: '8px', border: 'none', background: L.accent, color: '#ffffff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
};
