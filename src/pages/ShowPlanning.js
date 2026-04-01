import React, { useState, useEffect, useCallback } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';

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

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseSeason(season, year) {
  const [sm, sd] = season.start.split('-').map(Number);
  const [em, ed] = season.end.split('-').map(Number);
  const start = new Date(sm <= 1 && season.key === 'downtime' ? year : year, sm - 1, sd);
  const end = new Date(em <= 1 && season.key === 'downtime' ? year + 1 : year, em - 1, ed);
  return { start, end };
}

function formatDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getCalendarDays(month) {
  const year = month.getFullYear();
  const m = month.getMonth();
  const firstDay = new Date(year, m, 1);
  const lastDay = new Date(year, m + 1, 0);
  const startOffset = firstDay.getDay();
  const days = [];
  for (let i = startOffset - 1; i >= 0; i--) days.push({ date: new Date(year, m, -i), isCurrentMonth: false });
  for (let i = 1; i <= lastDay.getDate(); i++) days.push({ date: new Date(year, m, i), isCurrentMonth: true });
  while (days.length < 42) {
    const d = new Date(year, m + 1, days.length - lastDay.getDate() - startOffset + 1);
    days.push({ date: d, isCurrentMonth: false });
  }
  return days;
}

function dk(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function ShowPlanning() {
  const { profile, isAdmin, refreshKey } = useAuth();
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

  // Calendar view state
  const [viewMode, setViewMode] = useState('seasons'); // 'seasons' | 'calendar'
  const [calendarMonth, setCalendarMonth] = useState(new Date());

  // Document context menu state
  const [docContextMenu, setDocContextMenu] = useState(null); // { x, y, doc, showId }
  const [renamingDoc, setRenamingDoc] = useState(null);
  const [renameDocValue, setRenameDocValue] = useState('');

  useEffect(() => {
    if (!profile?.id) return;
    fetchData();
  }, [profile?.id, year, refreshKey]);

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
      .select('id, show_id, type, title, created_at, updated_at, created_by, sort_order')
      .eq('show_id', showId).order('sort_order', { ascending: true });
    setShowDocs(prev => ({ ...prev, [showId]: data || [] }));
  }

  // Bulk fetch docs for a set of show IDs (for calendar view)
  async function fetchBulkShowDocs(showIds) {
    if (!showIds.length) return;
    const { data } = await supabase.from('show_documents')
      .select('id, show_id, type, title, created_at, updated_at, created_by, sort_order')
      .in('show_id', showIds).order('sort_order', { ascending: true });
    const grouped = {};
    (data || []).forEach(doc => {
      if (!grouped[doc.show_id]) grouped[doc.show_id] = [];
      grouped[doc.show_id].push(doc);
    });
    setShowDocs(prev => ({ ...prev, ...grouped }));
  }

  // Fetch docs for visible month's shows when calendar renders
  useEffect(() => {
    if (viewMode !== 'calendar') return;
    const days = getCalendarDays(calendarMonth);
    const firstDate = dk(days[0].date);
    const lastDate = dk(days[days.length - 1].date);
    const visibleShows = shows.filter(s => s.show_date >= firstDate && s.show_date <= lastDate);
    const showIds = visibleShows.map(s => s.id).filter(id => !showDocs[id]);
    if (showIds.length > 0) fetchBulkShowDocs(showIds);
  }, [viewMode, calendarMonth, shows]);

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

  // --- Close doc context menu on click outside or Escape ---
  useEffect(() => {
    if (!docContextMenu) return;
    const handleClick = () => setDocContextMenu(null);
    const handleKey = (e) => { if (e.key === 'Escape') setDocContextMenu(null); };
    window.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleKey);
    return () => { window.removeEventListener('click', handleClick); window.removeEventListener('keydown', handleKey); };
  }, [docContextMenu]);

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
    const docs = showDocs[showId] || [];
    const { error } = await supabase.from('show_documents').insert({
      show_id: showId,
      type: docForm.type,
      title: docForm.title.trim(),
      content,
      created_by: profile.id,
      sort_order: docs.length,
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

  async function handleRenameDoc(docId, newTitle, showId) {
    if (!newTitle.trim()) { setRenamingDoc(null); setRenameDocValue(''); return; }
    await supabase.from('show_documents').update({ title: newTitle.trim() }).eq('id', docId);
    setRenamingDoc(null);
    setRenameDocValue('');
    fetchShowDocs(showId);
  }

  // --- Doc Drag Reorder ---
  const handleDocDragEnd = useCallback(async (result) => {
    if (!result.destination || result.source.index === result.destination.index) return;
    const showId = result.destination.droppableId;
    const docs = [...(showDocs[showId] || [])];
    const [moved] = docs.splice(result.source.index, 1);
    docs.splice(result.destination.index, 0, moved);
    setShowDocs(prev => ({ ...prev, [showId]: docs }));

    for (let i = 0; i < docs.length; i++) {
      await supabase.from('show_documents').update({ sort_order: i }).eq('id', docs[i].id);
    }
  }, [showDocs]);

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

  // --- Calendar helpers ---
  function navigateCalendar(dir) {
    const d = new Date(calendarMonth);
    d.setMonth(d.getMonth() + dir);
    setCalendarMonth(d);
  }

  function getShowsForDate(dateStr) {
    return shows.filter(s => s.show_date === dateStr);
  }

  // Find season color for a show
  function getShowSeasonColor(show) {
    const d = new Date(show.show_date + 'T00:00:00');
    for (const season of SEASONS) {
      const { start, end } = parseSeason(season, year);
      if (d >= start && d <= end) return season.color;
    }
    return '#6b7280';
  }

  // --- Render document list for a show (used in both season and calendar views) ---
  function renderDocList(docs, showId) {
    return (
      <DragDropContext onDragEnd={handleDocDragEnd}>
        <Droppable droppableId={showId} direction="vertical">
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps} style={styles.docList}>
              {docs.map((doc, index) => (
                <Draggable key={doc.id} draggableId={doc.id} index={index}>
                  {(dragProvided, dragSnapshot) => (
                    <div
                      ref={dragProvided.innerRef}
                      {...dragProvided.draggableProps}
                      {...dragProvided.dragHandleProps}
                      style={{
                        ...styles.docItem,
                        ...(dragSnapshot.isDragging ? { background: 'rgba(99,102,241,0.1)', borderRadius: '4px' } : {}),
                        ...dragProvided.draggableProps.style,
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDocContextMenu({ x: e.clientX, y: e.clientY, doc, showId });
                      }}
                    >
                      {renamingDoc === doc.id ? (
                        <input
                          autoFocus
                          value={renameDocValue}
                          onChange={(e) => setRenameDocValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRenameDoc(doc.id, renameDocValue, showId);
                            if (e.key === 'Escape') { setRenamingDoc(null); setRenameDocValue(''); }
                          }}
                          onBlur={() => handleRenameDoc(doc.id, renameDocValue, showId)}
                          onClick={(e) => e.stopPropagation()}
                          style={styles.renameInput}
                        />
                      ) : (
                        <button onClick={() => setActiveDoc(doc)} style={styles.docLink}>
                          {DOC_TYPES[doc.type]?.icon} {doc.title}
                        </button>
                      )}
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
    );
  }

  // --- Calendar View ---
  function renderCalendarView() {
    const calendarDays = getCalendarDays(calendarMonth);
    const weeks = [];
    for (let i = 0; i < calendarDays.length; i += 7) weeks.push(calendarDays.slice(i, i + 7));
    const today = new Date();

    return (
      <div style={styles.calendarSection}>
        <div style={styles.calendarNav}>
          <button onClick={() => navigateCalendar(-1)} style={styles.yearBtn}>&lsaquo;</button>
          <span style={styles.calendarMonthLabel}>
            {calendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </span>
          <button onClick={() => navigateCalendar(1)} style={styles.yearBtn}>&rsaquo;</button>
        </div>

        <div style={styles.calendarGrid}>
          <div style={styles.weekdayRow}>
            {WEEKDAYS.map(day => <div key={day} style={styles.weekdayCell}>{day}</div>)}
          </div>

          {weeks.map((week, wi) => (
            <div key={wi} style={styles.weekRow}>
              {week.map((day, di) => {
                const isToday = day.date.toDateString() === today.toDateString();
                const dateStr = dk(day.date);
                const dayShows = getShowsForDate(dateStr);
                return (
                  <div key={di} style={{
                    ...styles.dayCell,
                    opacity: day.isCurrentMonth ? 1 : 0.3,
                    background: isToday ? 'rgba(99,102,241,0.06)' : 'transparent',
                    borderRight: di < 6 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                  }}>
                    <div style={styles.dateRow}>
                      <span style={{ ...styles.dateNumber, ...(isToday ? styles.dateNumberToday : {}) }}>
                        {day.date.getDate()}
                      </span>
                    </div>
                    {dayShows.map(show => {
                      const color = getShowSeasonColor(show);
                      const linkedTopics = topics.filter(t => t.show_id === show.id);
                      const docs = showDocs[show.id] || [];
                      return (
                        <div key={show.id} style={styles.calShowBlock}>
                          <div
                            style={{ ...styles.calShowChip, background: color + '22', borderColor: color + '44', color }}
                            onClick={() => toggleShow(show.id)}
                          >
                            {show.title}
                          </div>
                          {linkedTopics.length > 0 && (
                            <div style={styles.calTopicRow}>
                              {linkedTopics.map(t => (
                                <span key={t.id} style={styles.calTopicPill}>{t.title}</span>
                              ))}
                            </div>
                          )}
                          {docs.length > 0 && (
                            <div style={styles.calDocRow}>
                              {docs.map(doc => (
                                <span key={doc.id} style={styles.calDocChip} onClick={(e) => { e.stopPropagation(); setActiveDoc(doc); }}>
                                  {DOC_TYPES[doc.type]?.icon} {doc.title}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.topBar}>
        <div>
          <h1 style={styles.pageTitle}>Show Planning</h1>
          <p style={styles.pageSubtitle}>{shows.length} shows in {year}</p>
        </div>
        <div style={styles.headerRight}>
          {/* View Mode Toggle */}
          <div style={styles.viewToggle}>
            <button
              onClick={() => setViewMode('seasons')}
              style={{ ...styles.toggleBtn, ...(viewMode === 'seasons' ? styles.toggleBtnActive : {}) }}
            >Seasons</button>
            <button
              onClick={() => setViewMode('calendar')}
              style={{ ...styles.toggleBtn, ...(viewMode === 'calendar' ? styles.toggleBtnActive : {}) }}
            >Calendar</button>
          </div>
          <div style={styles.yearSelector}>
            <button onClick={() => setYear(y => y - 1)} style={styles.yearBtn}>&lsaquo;</button>
            <span style={styles.yearText}>{year}</span>
            <button onClick={() => setYear(y => y + 1)} style={styles.yearBtn}>&rsaquo;</button>
          </div>
        </div>
      </div>

      {loading ? (
        <p style={styles.emptyText}>Loading...</p>
      ) : (
        <>
          {viewMode === 'calendar' ? renderCalendarView() : (
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
                                      {renderDocList(docs, show.id)}

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
            </>
          )}

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

      {/* Document Right-Click Context Menu */}
      {docContextMenu && (
        <>
          <div style={styles.contextOverlay} onClick={() => setDocContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setDocContextMenu(null); }} />
          <div style={{ ...styles.ctxMenu, top: docContextMenu.y, left: docContextMenu.x }}>
            <button
              style={styles.ctxMenuItem}
              onClick={() => {
                setRenamingDoc(docContextMenu.doc.id);
                setRenameDocValue(docContextMenu.doc.title);
                setDocContextMenu(null);
              }}
            >Rename</button>
            <button
              style={{ ...styles.ctxMenuItem, color: '#f87171' }}
              onClick={() => {
                handleDeleteDoc(docContextMenu.doc.id, docContextMenu.showId);
                setDocContextMenu(null);
              }}
            >Delete</button>
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
  headerRight: { display: 'flex', alignItems: 'center', gap: '16px' },
  yearSelector: { display: 'flex', alignItems: 'center', gap: '12px' },
  yearBtn: { width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: 'rgba(255,255,255,0.5)', fontSize: '18px', cursor: 'pointer', fontFamily: 'inherit' },
  yearText: { fontSize: '20px', fontWeight: 700, color: '#e2e8f0', minWidth: '60px', textAlign: 'center' },
  emptyText: { color: 'rgba(255,255,255,0.35)', fontSize: '14px' },

  // View toggle
  viewToggle: { display: 'flex', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', overflow: 'hidden' },
  toggleBtn: { padding: '6px 14px', background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s' },
  toggleBtnActive: { background: 'rgba(99,102,241,0.15)', color: '#a5b4fc' },

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
  renameInput: { padding: '4px 8px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '4px', color: '#fff', fontSize: '13px', fontFamily: 'inherit', outline: 'none', width: '200px' },

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

  // Context menu
  ctxMenu: { position: 'fixed', zIndex: 1000, background: '#1e1e2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '4px 0', minWidth: '140px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' },
  ctxMenuItem: { display: 'block', width: '100%', padding: '8px 16px', background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', fontSize: '13px', fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left' },
  contextOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 },

  // Calendar view
  calendarSection: { marginBottom: '32px' },
  calendarNav: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' },
  calendarMonthLabel: { fontSize: '18px', fontWeight: 700, color: '#e2e8f0', minWidth: '200px', textAlign: 'center' },
  calendarGrid: { border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', overflow: 'hidden' },
  weekdayRow: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' },
  weekdayCell: { padding: '10px', textAlign: 'center', fontSize: '12px', fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  weekRow: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid rgba(255,255,255,0.04)' },
  dayCell: { minHeight: '100px', padding: '6px', borderRight: '1px solid rgba(255,255,255,0.04)', display: 'flex', flexDirection: 'column', gap: '4px' },
  dateRow: { display: 'flex', justifyContent: 'flex-end', marginBottom: '2px' },
  dateNumber: { fontSize: '12px', color: 'rgba(255,255,255,0.4)', fontWeight: 600 },
  dateNumberToday: { background: '#6366f1', color: '#fff', borderRadius: '50%', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center' },

  // Calendar show blocks
  calShowBlock: { display: 'flex', flexDirection: 'column', gap: '2px', marginBottom: '4px' },
  calShowChip: { padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', border: '1px solid', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  calTopicRow: { display: 'flex', flexWrap: 'wrap', gap: '2px', paddingLeft: '4px' },
  calTopicPill: { padding: '1px 5px', background: 'rgba(99,102,241,0.08)', borderRadius: '3px', fontSize: '9px', color: '#a5b4fc', fontWeight: 500 },
  calDocRow: { display: 'flex', flexWrap: 'wrap', gap: '2px', paddingLeft: '4px' },
  calDocChip: { padding: '1px 5px', background: 'rgba(255,255,255,0.04)', borderRadius: '3px', fontSize: '9px', color: 'rgba(255,255,255,0.45)', cursor: 'pointer', fontWeight: 500 },
};
