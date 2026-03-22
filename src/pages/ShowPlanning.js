import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import Whiteboard from './editors/Whiteboard';
import StickyBoard from './editors/StickyBoard';
import DocEditor from './editors/DocEditor';
import Storyboard from './editors/Storyboard';
import ScriptEditor from './editors/screenplay-editor/components/editor/ScriptEditor';

const SEASONS = [
  { key: 'rampup', label: 'Ramp Up', start: '02-01', end: '03-14', color: '#22c55e' },
  { key: 'spring', label: 'Spring Training', start: '03-15', end: '03-31', color: '#3b82f6' },
  { key: 'opening', label: 'Opening Week', start: '04-01', end: '04-07', color: '#6366f1' },
  { key: 'earlyseason', label: 'Early Season', start: '04-08', end: '05-31', color: '#8b5cf6' },
  { key: 'summer', label: 'Summer Stretch', start: '06-01', end: '07-15', color: '#ec4899' },
  { key: 'allstar', label: 'All-Star Break', start: '07-16', end: '07-21', color: '#f59e0b' },
  { key: 'secondhalf', label: 'Second Half', start: '07-22', end: '08-31', color: '#ef4444' },
  { key: 'september', label: 'September Push', start: '09-01', end: '09-30', color: '#14b8a6' },
  { key: 'postseason', label: 'Postseason', start: '10-01', end: '11-15', color: '#f97316' },
  { key: 'downtime', label: 'Downtime', start: '11-16', end: '01-31', color: '#6b7280' },
];

const DOC_TYPES = {
  whiteboard: { label: 'Whiteboard', icon: '\uD83C\uDFA8' },
  stickyboard: { label: 'Sticky Board', icon: '\uD83D\uDCCC' },
  document: { label: 'Document', icon: '\uD83D\uDCDD' },
  storyboard: { label: 'Storyboard', icon: '\uD83C\uDFAC' },
  screenplay: { label: 'Screenplay', icon: '\uD83C\uDFAD' },
};

function parseSeason(season, year) {
  const [sm, sd] = season.start.split('-').map(Number);
  const [em, ed] = season.end.split('-').map(Number);
  // Downtime wraps: Nov 16 -> Jan 31 next year
  const startYear = sm >= 11 ? year : (sm <= 1 ? year - 1 : year);
  const endYear = em <= 1 ? year + 1 : (em >= 11 && sm >= 11 ? year : year);
  // Actually let's keep it simple: for downtime (Nov-Jan), start is current year, end is next year if month <= 1
  const start = new Date(sm <= 1 && season.key === 'downtime' ? year : year, sm - 1, sd);
  const end = new Date(em <= 1 && season.key === 'downtime' ? year + 1 : year, em - 1, ed);
  return { start, end };
}

function formatDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function ShowPlanning() {
  const { profile, isAdmin } = useAuth();
  const [year, setYear] = useState(new Date().getFullYear());
  const [shows, setShows] = useState([]);
  const [topics, setTopics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedSeasons, setExpandedSeasons] = useState({});
  const [expandedShows, setExpandedShows] = useState({});
  const [showDocs, setShowDocs] = useState({}); // { showId: [docs] }
  const [activeDoc, setActiveDoc] = useState(null);
  const [createShowSeason, setCreateShowSeason] = useState(null);
  const [showForm, setShowForm] = useState({ title: '', date: '' });
  const [topicForm, setTopicForm] = useState({ title: '', description: '' });
  const [showTopicForm, setShowTopicForm] = useState(false);
  const [editingShow, setEditingShow] = useState(null);
  const [editForm, setEditForm] = useState({ title: '', date: '', notes: '' });
  const [createDocShow, setCreateDocShow] = useState(null);
  const [docForm, setDocForm] = useState({ title: '', type: 'document' });
  const [topicsUsedCollapsed, setTopicsUsedCollapsed] = useState(true);

  useEffect(() => {
    if (!profile?.id) return;
    fetchData();
  }, [profile?.id, year]);

  useVisibilityRefresh(() => { fetchData(); });

  async function fetchData() {
    setLoading(true);
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    const [showsRes, topicsRes] = await Promise.all([
      supabase.from('shows').select('*').gte('show_date', yearStart).lte('show_date', yearEnd).order('show_date'),
      supabase.from('show_topics').select('*').order('sort_order'),
    ]);
    setShows(showsRes.data || []);
    setTopics(topicsRes.data || []);
    setLoading(false);
  }

  async function fetchShowDocs(showId) {
    const { data } = await supabase.from('show_documents')
      .select('id, show_id, type, title, created_at, updated_at, created_by')
      .eq('show_id', showId).order('created_at');
    setShowDocs(prev => ({ ...prev, [showId]: data || [] }));
  }

  function toggleSeason(key) {
    setExpandedSeasons(prev => ({ ...prev, [key]: !prev[key] }));
  }

  function toggleShow(showId) {
    const next = !expandedShows[showId];
    setExpandedShows(prev => ({ ...prev, [showId]: next }));
    if (next && !showDocs[showId]) fetchShowDocs(showId);
  }

  function getShowsForSeason(season) {
    const { start, end } = parseSeason(season, year);
    return shows.filter(s => {
      const d = new Date(s.show_date + 'T00:00:00');
      return d >= start && d <= end;
    });
  }

  // --- CRUD: Shows ---
  async function handleCreateShow(e, season) {
    e.preventDefault();
    if (!showForm.title.trim() || !showForm.date) return;
    const { error } = await supabase.from('shows').insert({
      title: showForm.title.trim(),
      show_date: showForm.date,
      created_by: profile.id,
    });
    if (error) { console.error(error); return; }
    setShowForm({ title: '', date: '' });
    setCreateShowSeason(null);
    fetchData();
  }

  async function handleUpdateShow(showId) {
    const { error } = await supabase.from('shows').update({
      title: editForm.title.trim(),
      show_date: editForm.date,
      notes: editForm.notes.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq('id', showId);
    if (error) { console.error(error); return; }
    setEditingShow(null);
    fetchData();
  }

  async function handleDeleteShow(showId) {
    if (!window.confirm('Delete this show and all its documents?')) return;
    await supabase.from('shows').delete().eq('id', showId);
    setExpandedShows(prev => { const n = { ...prev }; delete n[showId]; return n; });
    fetchData();
  }

  // --- CRUD: Documents ---
  async function handleCreateDoc(e, showId) {
    e.preventDefault();
    if (!docForm.title.trim()) return;
    const content = docForm.type === 'whiteboard' ? { strokes: [] }
      : docForm.type === 'stickyboard' ? { notes: [] }
      : docForm.type === 'storyboard' ? { pageCount: 1 }
      : docForm.type === 'screenplay' ? { titlePage: { title: '', writtenBy: '', basedOn: '', draft: '', date: '', contact: '' }, elements: [{ id: Date.now().toString(), type: 'sceneHeading', text: '' }], notes: [] }
      : { html: '' };
    const { error } = await supabase.from('show_documents').insert({
      show_id: showId,
      type: docForm.type,
      title: docForm.title.trim(),
      content,
      created_by: profile.id,
    });
    if (error) { console.error(error); return; }
    setDocForm({ title: '', type: 'document' });
    setCreateDocShow(null);
    fetchShowDocs(showId);
  }

  async function handleDeleteDoc(docId, showId) {
    if (!window.confirm('Delete this document?')) return;
    await supabase.from('show_documents').delete().eq('id', docId);
    fetchShowDocs(showId);
  }

  // --- CRUD: Topics ---
  async function handleCreateTopic(e) {
    e.preventDefault();
    if (!topicForm.title.trim()) return;
    const { error } = await supabase.from('show_topics').insert({
      title: topicForm.title.trim(),
      description: topicForm.description.trim() || null,
      created_by: profile.id,
    });
    if (error) { console.error(error); return; }
    setTopicForm({ title: '', description: '' });
    setShowTopicForm(false);
    fetchData();
  }

  async function handleDeleteTopic(topicId) {
    if (!window.confirm('Delete this topic?')) return;
    await supabase.from('show_topics').delete().eq('id', topicId);
    fetchData();
  }

  async function linkTopic(topicId, showId) {
    await supabase.from('show_topics').update({ show_id: showId }).eq('id', topicId);
    fetchData();
  }

  async function unlinkTopic(topicId) {
    await supabase.from('show_topics').update({ show_id: null }).eq('id', topicId);
    fetchData();
  }

  function handleSaveTemplate(name, type, content) {
    // no-op for show documents (templates not needed here)
  }

  // --- Full-screen editor ---
  if (activeDoc) {
    const EditorComponent = activeDoc.type === 'whiteboard' ? Whiteboard
      : activeDoc.type === 'stickyboard' ? StickyBoard
      : activeDoc.type === 'storyboard' ? Storyboard
      : activeDoc.type === 'screenplay' ? ScriptEditor
      : activeDoc.type === 'screenwriter' ? ScriptEditor
      : DocEditor;
    return (
      <EditorComponent
        docId={activeDoc.id}
        title={activeDoc.title}
        docType="show_documents"
        onBack={() => { setActiveDoc(null); if (activeDoc.show_id) fetchShowDocs(activeDoc.show_id); }}
        onSaveTemplate={handleSaveTemplate}
      />
    );
  }

  const unusedTopics = topics.filter(t => !t.show_id);
  const usedTopics = topics.filter(t => t.show_id);
  const usedByShow = {};
  usedTopics.forEach(t => {
    if (!usedByShow[t.show_id]) usedByShow[t.show_id] = [];
    usedByShow[t.show_id].push(t);
  });

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.topBar}>
        <div>
          <h1 style={styles.pageTitle}>Show Planning</h1>
          <p style={styles.pageSubtitle}>{shows.length} shows in {year}</p>
        </div>
        <div style={styles.yearSelector}>
          <button onClick={() => setYear(y => y - 1)} style={styles.yearBtn}>&lsaquo;</button>
          <span style={styles.yearText}>{year}</span>
          <button onClick={() => setYear(y => y + 1)} style={styles.yearBtn}>&rsaquo;</button>
        </div>
      </div>

      {loading ? (
        <p style={styles.emptyText}>Loading...</p>
      ) : (
        <>
          {/* ── PLANNER SECTION ── */}
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Planner</h2>
            {SEASONS.map(season => {
              const seasonShows = getShowsForSeason(season);
              const isExpanded = expandedSeasons[season.key] !== false; // default open
              const { start, end } = parseSeason(season, year);

              return (
                <div key={season.key} style={{ ...styles.seasonBlock, borderLeftColor: season.color }}>
                  <button onClick={() => toggleSeason(season.key)} style={styles.seasonHeader}>
                    <span style={styles.seasonChevron}>{isExpanded ? '\u25BC' : '\u25B6'}</span>
                    <span style={{ ...styles.seasonLabel, color: season.color }}>{season.label}</span>
                    <span style={styles.seasonDates}>{formatDate(start)} \u2013 {formatDate(end)}</span>
                    <span style={styles.seasonCount}>{seasonShows.length} show{seasonShows.length !== 1 ? 's' : ''}</span>
                  </button>

                  {isExpanded && (
                    <div style={styles.seasonContent}>
                      {seasonShows.map(show => {
                        const isShowExpanded = expandedShows[show.id];
                        const docs = showDocs[show.id] || [];
                        const linkedTopics = topics.filter(t => t.show_id === show.id);
                        const isEditing = editingShow === show.id;

                        return (
                          <div key={show.id} style={styles.showCard}>
                            <div style={styles.showHeader} onClick={() => toggleShow(show.id)}>
                              <span style={styles.showChevron}>{isShowExpanded ? '\u25BC' : '\u25B6'}</span>
                              <span style={styles.showTitle}>{show.title}</span>
                              <span style={styles.showDate}>
                                {new Date(show.show_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              </span>
                            </div>

                            {isShowExpanded && (
                              <div style={styles.showBody}>
                                {/* Editable fields */}
                                {isEditing ? (
                                  <div style={styles.editSection}>
                                    <input value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} style={styles.input} placeholder="Title" />
                                    <input type="date" value={editForm.date} onChange={e => setEditForm(f => ({ ...f, date: e.target.value }))} style={styles.input} />
                                    <textarea value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} style={{ ...styles.input, minHeight: '60px', resize: 'vertical' }} placeholder="Notes..." />
                                    <div style={styles.editActions}>
                                      <button onClick={() => handleUpdateShow(show.id)} style={styles.saveSmallBtn}>Save</button>
                                      <button onClick={() => setEditingShow(null)} style={styles.cancelSmallBtn}>Cancel</button>
                                    </div>
                                  </div>
                                ) : (
                                  <div style={styles.showMeta}>
                                    {show.notes && <p style={styles.showNotes}>{show.notes}</p>}
                                    <div style={styles.showActions}>
                                      <button onClick={() => { setEditingShow(show.id); setEditForm({ title: show.title, date: show.show_date, notes: show.notes || '' }); }} style={styles.editBtn}>Edit</button>
                                      <button onClick={() => handleDeleteShow(show.id)} style={styles.deleteBtnSmall}>Delete</button>
                                    </div>
                                  </div>
                                )}

                                {/* Linked Topics */}
                                <div style={styles.subSection}>
                                  <span style={styles.subLabel}>Topics</span>
                                  <div style={styles.pillRow}>
                                    {linkedTopics.map(t => (
                                      <span key={t.id} style={styles.topicPill}>
                                        {t.title}
                                        <button onClick={() => unlinkTopic(t.id)} style={styles.pillX}>&times;</button>
                                      </span>
                                    ))}
                                    {unusedTopics.length > 0 && (
                                      <select
                                        style={styles.addTopicSelect}
                                        value=""
                                        onChange={e => { if (e.target.value) linkTopic(e.target.value, show.id); }}
                                      >
                                        <option value="">+ Add Topic</option>
                                        {unusedTopics.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
                                      </select>
                                    )}
                                  </div>
                                </div>

                                {/* Documents */}
                                <div style={styles.subSection}>
                                  <span style={styles.subLabel}>Documents</span>
                                  <div style={styles.docList}>
                                    {docs.map(doc => (
                                      <div key={doc.id} style={styles.docItem}>
                                        <button onClick={() => setActiveDoc(doc)} style={styles.docLink}>
                                          {DOC_TYPES[doc.type]?.icon} {doc.title}
                                        </button>
                                        <button onClick={() => handleDeleteDoc(doc.id, show.id)} style={styles.docDeleteBtn}>&times;</button>
                                      </div>
                                    ))}
                                  </div>

                                  {createDocShow === show.id ? (
                                    <form onSubmit={e => handleCreateDoc(e, show.id)} style={styles.inlineForm}>
                                      <input value={docForm.title} onChange={e => setDocForm(f => ({ ...f, title: e.target.value }))} placeholder="Document title..." style={styles.inputSmall} required />
                                      <select value={docForm.type} onChange={e => setDocForm(f => ({ ...f, type: e.target.value }))} style={styles.inputSmall}>
                                        {Object.entries(DOC_TYPES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                                      </select>
                                      <button type="submit" style={styles.saveSmallBtn}>Create</button>
                                      <button type="button" onClick={() => setCreateDocShow(null)} style={styles.cancelSmallBtn}>Cancel</button>
                                    </form>
                                  ) : (
                                    <button onClick={() => setCreateDocShow(show.id)} style={styles.addSmallBtn}>+ New Document</button>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {/* Create Show Button */}
                      {createShowSeason === season.key ? (
                        <form onSubmit={e => handleCreateShow(e, season)} style={styles.inlineForm}>
                          <input value={showForm.title} onChange={e => setShowForm(f => ({ ...f, title: e.target.value }))} placeholder="Show title..." style={styles.inputSmall} required />
                          <input type="date" value={showForm.date} onChange={e => setShowForm(f => ({ ...f, date: e.target.value }))} style={styles.inputSmall} min={`${year}-${season.start}`} max={`${year}-${season.end}`} required />
                          <button type="submit" style={styles.saveSmallBtn}>Create</button>
                          <button type="button" onClick={() => setCreateShowSeason(null)} style={styles.cancelSmallBtn}>Cancel</button>
                        </form>
                      ) : (
                        <button onClick={() => { setCreateShowSeason(season.key); setShowForm({ title: '', date: '' }); }} style={styles.addSmallBtn}>+ Create a Show</button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── TOPICS SECTION ── */}
          <div style={styles.section}>
            <div style={styles.sectionHeader}>
              <h2 style={styles.sectionTitle}>Topics</h2>
              <button onClick={() => setShowTopicForm(!showTopicForm)} style={styles.addSmallBtn}>
                {showTopicForm ? 'Cancel' : '+ Add Topic'}
              </button>
            </div>

            {showTopicForm && (
              <form onSubmit={handleCreateTopic} style={styles.inlineForm}>
                <input value={topicForm.title} onChange={e => setTopicForm(f => ({ ...f, title: e.target.value }))} placeholder="Topic title..." style={styles.inputSmall} required />
                <input value={topicForm.description} onChange={e => setTopicForm(f => ({ ...f, description: e.target.value }))} placeholder="Description (optional)" style={styles.inputSmall} />
                <button type="submit" style={styles.saveSmallBtn}>Add</button>
              </form>
            )}

            {/* Unused */}
            <div style={styles.topicGroup}>
              <h3 style={styles.topicGroupTitle}>Unused ({unusedTopics.length})</h3>
              {unusedTopics.length === 0 ? (
                <p style={styles.emptyTextSmall}>No unused topics</p>
              ) : (
                unusedTopics.map(t => (
                  <div key={t.id} style={styles.topicItem}>
                    <div style={styles.topicInfo}>
                      <span style={styles.topicTitle}>{t.title}</span>
                      {t.description && <span style={styles.topicDesc}>{t.description}</span>}
                    </div>
                    <button onClick={() => handleDeleteTopic(t.id)} style={styles.deleteBtnSmall}>Delete</button>
                  </div>
                ))
              )}
            </div>

            {/* Used */}
            <div style={styles.topicGroup}>
              <button onClick={() => setTopicsUsedCollapsed(!topicsUsedCollapsed)} style={styles.topicGroupToggle}>
                <span>{topicsUsedCollapsed ? '\u25B6' : '\u25BC'}</span>
                <h3 style={styles.topicGroupTitle}>Used ({usedTopics.length})</h3>
              </button>
              {!topicsUsedCollapsed && (
                usedTopics.length === 0 ? (
                  <p style={styles.emptyTextSmall}>No used topics</p>
                ) : (
                  Object.entries(usedByShow).map(([showId, topicsList]) => {
                    const show = shows.find(s => s.id === showId);
                    return (
                      <div key={showId} style={styles.usedGroup}>
                        <span style={styles.usedGroupLabel}>{show?.title || 'Unknown Show'}</span>
                        {topicsList.map(t => (
                          <div key={t.id} style={styles.topicItem}>
                            <div style={styles.topicInfo}>
                              <span style={styles.topicTitle}>{t.title}</span>
                              {t.description && <span style={styles.topicDesc}>{t.description}</span>}
                            </div>
                            <button onClick={() => unlinkTopic(t.id)} style={styles.unlinkBtn}>Unlink</button>
                            <button onClick={() => handleDeleteTopic(t.id)} style={styles.deleteBtnSmall}>Delete</button>
                          </div>
                        ))}
                      </div>
                    );
                  })
                )
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const styles = {
  page: { padding: '32px 40px', maxWidth: '1100px' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' },
  pageTitle: { fontSize: '28px', fontWeight: 700, color: '#fff', margin: '0 0 4px', letterSpacing: '-0.5px' },
  pageSubtitle: { fontSize: '14px', color: 'rgba(255,255,255,0.4)', margin: 0 },
  yearSelector: { display: 'flex', alignItems: 'center', gap: '12px' },
  yearBtn: { width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: 'rgba(255,255,255,0.5)', fontSize: '18px', cursor: 'pointer', fontFamily: 'inherit' },
  yearText: { fontSize: '20px', fontWeight: 700, color: '#e2e8f0', minWidth: '60px', textAlign: 'center' },
  emptyText: { color: 'rgba(255,255,255,0.35)', fontSize: '14px' },

  section: { marginBottom: '40px' },
  sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' },
  sectionTitle: { fontSize: '18px', fontWeight: 700, color: '#fff', margin: '0 0 12px' },

  // Seasons
  seasonBlock: { marginBottom: '8px', borderLeft: '3px solid', borderRadius: '8px', background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.06)', borderLeftWidth: '3px', borderLeftStyle: 'solid', overflow: 'hidden' },
  seasonHeader: { display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' },
  seasonChevron: { fontSize: '10px', color: 'rgba(255,255,255,0.3)', width: '14px' },
  seasonLabel: { fontSize: '14px', fontWeight: 700 },
  seasonDates: { fontSize: '12px', color: 'rgba(255,255,255,0.3)', marginLeft: '4px' },
  seasonCount: { fontSize: '11px', color: 'rgba(255,255,255,0.25)', marginLeft: 'auto' },
  seasonContent: { padding: '4px 16px 12px' },

  // Shows
  showCard: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', marginBottom: '6px', overflow: 'hidden' },
  showHeader: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', cursor: 'pointer' },
  showChevron: { fontSize: '9px', color: 'rgba(255,255,255,0.3)', width: '12px' },
  showTitle: { fontSize: '14px', fontWeight: 600, color: '#e2e8f0', flex: 1 },
  showDate: { fontSize: '12px', color: 'rgba(255,255,255,0.35)' },
  showBody: { padding: '0 14px 14px', borderTop: '1px solid rgba(255,255,255,0.04)' },
  showMeta: { padding: '10px 0 0' },
  showNotes: { fontSize: '13px', color: 'rgba(255,255,255,0.5)', margin: '0 0 8px', lineHeight: 1.5 },
  showActions: { display: 'flex', gap: '8px' },

  // Sub-sections inside show
  subSection: { marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.04)' },
  subLabel: { fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: '6px' },
  pillRow: { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' },
  topicPill: { display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 10px', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '12px', fontSize: '12px', color: '#a5b4fc', fontWeight: 500 },
  pillX: { background: 'none', border: 'none', color: 'rgba(165,180,252,0.5)', cursor: 'pointer', fontSize: '14px', padding: '0 2px', fontFamily: 'inherit', lineHeight: 1 },
  addTopicSelect: { padding: '4px 8px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: 'rgba(255,255,255,0.4)', fontSize: '11px', fontFamily: 'inherit', cursor: 'pointer' },

  // Documents list
  docList: { display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' },
  docItem: { display: 'flex', alignItems: 'center', gap: '8px' },
  docLink: { background: 'none', border: 'none', color: '#a5b4fc', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', padding: '4px 0', fontWeight: 500 },
  docDeleteBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.15)', cursor: 'pointer', fontSize: '14px', padding: '2px 4px' },

  // Inline forms
  inlineForm: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '8px' },
  input: { padding: '8px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff', fontSize: '13px', fontFamily: 'inherit', outline: 'none' },
  inputSmall: { padding: '6px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff', fontSize: '12px', fontFamily: 'inherit', outline: 'none' },
  saveSmallBtn: { padding: '6px 14px', background: '#6366f1', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  cancelSmallBtn: { padding: '6px 10px', background: 'none', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: 'rgba(255,255,255,0.4)', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit' },
  addSmallBtn: { padding: '6px 12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: 'rgba(255,255,255,0.4)', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit', marginTop: '4px' },
  editBtn: { padding: '4px 10px', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '5px', color: '#a5b4fc', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit' },
  deleteBtnSmall: { padding: '4px 10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: '5px', color: '#fca5a5', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit' },

  // Edit section
  editSection: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px 0' },
  editActions: { display: 'flex', gap: '8px' },

  // Topics section
  topicGroup: { marginBottom: '16px' },
  topicGroupTitle: { fontSize: '13px', fontWeight: 700, color: 'rgba(255,255,255,0.4)', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.5px' },
  topicGroupToggle: { display: 'flex', alignItems: 'center', gap: '8px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', color: 'rgba(255,255,255,0.3)', fontSize: '10px', padding: 0, marginBottom: '8px' },
  topicItem: { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', marginBottom: '4px' },
  topicInfo: { flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' },
  topicTitle: { fontSize: '13px', fontWeight: 600, color: '#e2e8f0' },
  topicDesc: { fontSize: '11px', color: 'rgba(255,255,255,0.35)' },
  unlinkBtn: { padding: '3px 8px', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.15)', borderRadius: '5px', color: '#fbbf24', fontSize: '10px', cursor: 'pointer', fontFamily: 'inherit' },
  emptyTextSmall: { color: 'rgba(255,255,255,0.2)', fontSize: '12px', margin: '4px 0 0', padding: '0 4px' },
  usedGroup: { marginBottom: '10px', paddingLeft: '8px' },
  usedGroupLabel: { fontSize: '12px', fontWeight: 600, color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: '4px' },
};
