export const analysisStyles = {
  card: {
    background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '12px', padding: '20px', marginBottom: '16px',
  },
  cardHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px',
  },
  cardTitle: { fontSize: '15px', fontWeight: 700 },
};

export const styles = {
  page: { padding: '32px 40px' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' },
  pageTitle: { fontSize: '28px', fontWeight: 700, color: '#fff', margin: '0 0 4px', letterSpacing: '-0.5px' },
  pageSubtitle: { fontSize: '14px', color: 'rgba(255,255,255,0.4)', margin: 0 },

  // Filters
  filterBar: { display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: '20px', padding: '12px 16px', background: 'rgba(255,255,255,0.02)', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)' },
  filterChip: { padding: '6px 14px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '20px', color: 'rgba(255,255,255,0.5)', fontSize: '12px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' },
  filterChipActive: { background: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.4)', color: '#a5b4fc' },
  filterSelect: { padding: '6px 10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '20px', color: 'rgba(255,255,255,0.5)', fontSize: '12px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', outline: 'none', appearance: 'none', WebkitAppearance: 'none', paddingRight: '10px' },
  filterSelectActive: { background: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.4)', color: '#a5b4fc' },
  filterInput: { padding: '6px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff', fontSize: '12px', fontFamily: 'inherit', outline: 'none' },
  platformDot: { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0 },
  platformDropdown: { position: 'absolute', top: '100%', right: 0, marginTop: '6px', background: '#1e1e36', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', padding: '6px', zIndex: 50, minWidth: '220px', display: 'flex', flexDirection: 'column', gap: '2px', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' },
  platformDropdownItem: { display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 12px', background: 'transparent', border: '1px solid transparent', borderRadius: '8px', color: 'rgba(255,255,255,0.5)', fontSize: '12px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%' },
  platformDropdownClear: { padding: '5px 12px', background: 'transparent', border: 'none', borderRadius: '6px', color: 'rgba(255,255,255,0.3)', fontSize: '11px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', marginBottom: '2px' },

  // KPI
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '20px' },
  kpiCard: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '18px 22px', position: 'relative', overflow: 'hidden' },
  kpiAccent: { position: 'absolute', top: 0, left: 0, right: 0, height: '3px' },
  kpiLabel: { fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' },
  kpiValue: { fontSize: '26px', fontWeight: 700, color: '#fff', fontVariantNumeric: 'tabular-nums' },

  // Chart
  chartSection: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '20px', marginBottom: '20px' },
  chartHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' },
  chartTitle: { fontSize: '15px', fontWeight: 700, color: '#fff' },
  metricChip: { padding: '5px 12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', color: 'rgba(255,255,255,0.4)', fontSize: '11px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' },
  metricChipActive: { background: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.4)', color: '#a5b4fc' },

  // Table
  tableHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' },
  tableTitle: { fontSize: '15px', fontWeight: 700, color: '#fff' },
  tableWrap: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', overflow: 'auto', maxHeight: '600px', marginBottom: '20px' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '700px' },
  th: { padding: '10px 14px', textAlign: 'left', fontWeight: 600, fontSize: '11px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid rgba(255,255,255,0.06)', position: 'sticky', top: 0, background: '#16162a', zIndex: 1, whiteSpace: 'nowrap', userSelect: 'none' },
  thSticky: { position: 'sticky', left: 0, zIndex: 3, background: '#16162a', minWidth: '200px', maxWidth: '300px' },
  td: { padding: '8px 14px', borderBottom: '1px solid rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.6)', whiteSpace: 'nowrap' },
  tdSticky: { position: 'sticky', left: 0, zIndex: 1, maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 500, color: '#e2e8f0' },
  tdValue: { fontWeight: 600, color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' },
  trEven: { background: 'rgba(255,255,255,0.01)' },
  sortArrow: { marginLeft: '4px', color: '#a5b4fc' },

  // Misc
  loadingText: { padding: '40px', textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '14px' },
  emptyCard: { background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '14px', padding: '32px', textAlign: 'center', marginBottom: '20px' },
  emptyText: { color: 'rgba(255,255,255,0.35)', fontSize: '14px', margin: 0 },
  uploadBtn: { padding: '8px 16px', background: 'rgba(255,255,255,0.04)', border: '1px solid', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  collapseBtn: { padding: '8px 16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: 'rgba(255,255,255,0.5)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', width: '100%', textAlign: 'left' },

  // View toggle
  viewToggleBar: { display: 'flex', gap: '2px', padding: '3px', background: 'rgba(255,255,255,0.04)', borderRadius: '10px', width: 'fit-content', marginBottom: '20px' },
  viewToggleBtn: { padding: '7px 18px', borderRadius: '8px', border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.4)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  viewToggleBtnActive: { padding: '7px 18px', borderRadius: '8px', border: 'none', background: 'rgba(99,102,241,0.2)', color: '#a5b4fc', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
};
