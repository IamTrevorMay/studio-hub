import React, { useState, useEffect, useCallback, useRef } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { callWorkflowFn } from '../lib/workflowApi';
import SprintGoals from './SprintGoals';
import SprintRetroModal from './SprintRetroModal';

const SPRINT_COLUMNS = [
  { id: 'ready', label: 'Ready', color: '#3b82f6' },
  { id: 'in_progress', label: 'In Progress', color: '#f59e0b' },
  { id: 'holding', label: 'Holding', color: '#f97316' },
  { id: 'done', label: 'Done', color: '#22c55e' },
];

const BUCKET_COLUMNS = [
  { id: 'inbox', label: 'Inbox', color: '#a78bfa' },
  { id: 'backlog', label: 'Backlog', color: '#f97316' },
];

const ALL_COLUMNS = [...SPRINT_COLUMNS, ...BUCKET_COLUMNS];

const CATEGORY_OPTIONS = [
  { value: 'administration', label: 'Admin', color: '#3b82f6' },
  { value: 'creative', label: 'Creative', color: '#ec4899' },
  { value: 'production', label: 'Production', color: '#22c55e' },
  { value: 'business_development', label: 'Business Dev', color: '#f97316' },
  { value: 'communication', label: 'Communication', color: '#f59e0b' },
  { value: 'software', label: 'Software', color: '#8b5cf6' },
  { value: 'ad', label: 'Ad', color: '#f59e0b' },
  { value: 'social', label: 'Social', color: '#06b6d4' },
];

const SUBCATEGORY_OPTIONS = [
  { value: 'task', label: 'Task' },
  { value: 'idea', label: 'Idea' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'document', label: 'Document' },
];


// Rotation of colors auto-assigned to new buckets so each appears distinct
// on task cards without requiring a per-bucket color picker in the UI.
const BUCKET_COLORS = ['#8b5cf6', '#3b82f6', '#f59e0b', '#ec4899', '#22c55e', '#ef4444', '#14b8a6', '#f97316'];

const POINT_COLORS = { '15': '#ef4444', '10': '#f97316', '6': '#f59e0b', '3': '#3b82f6', '1': '#6b7280' };
const PRIORITY_OPTIONS = [
  { value: null, label: 'None', points: 0 },
  { value: '1', label: '1 pt', points: 1 },
  { value: '3', label: '3 pts', points: 3 },
  { value: '6', label: '6 pts', points: 6 },
  { value: '10', label: '10 pts', points: 10 },
  { value: '15', label: '15 pts', points: 15 },
];

const MAYDAY_STAGE_LABELS = {
  idea: 'Idea', script: 'Script', gather_broadcast: 'Gather Assets + Broadcast',
  film: 'Film', editor: 'Editor', thumbnail_post: 'Thumbnail + Post', complete: 'Complete',
};
const MAYDAY_STAGE_COLORS = {
  idea: '#8b5cf6', script: '#3b82f6', gather_broadcast: '#f59e0b',
  film: '#ef4444', editor: '#f97316', thumbnail_post: '#ec4899', complete: '#22c55e',
};

// ─── Week helpers ──────────────────────────────────────────
function getSprintWeek(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    start: monday.toISOString().split('T')[0],
    end: sunday.toISOString().split('T')[0],
  };
}

function offsetWeek(startDate, offset) {
  const d = new Date(startDate + 'T00:00:00');
  d.setDate(d.getDate() + offset * 7);
  return getSprintWeek(d);
}

function fmtWeekRange(start, end) {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(s)} \u2013 ${fmt(e)}`;
}

function isCurrentWeek(start) {
  const current = getSprintWeek();
  return current.start === start;
}

// ─── TaskCard ───────────────────────────────────────────────
function TaskCard({ task, index, onClick, projectsMap, campaignsMap, bucketMap, readOnly }) {
  const cat = CATEGORY_OPTIONS.find(c => c.value === task.category);
  const subcat = SUBCATEGORY_OPTIONS.find(c => c.value === task.subcategory);
  const bucket = task.bucket && bucketMap ? bucketMap[task.bucket] : null;
  const priorityColor = task.priority ? POINT_COLORS[task.priority] : null;

  return (
    <Draggable draggableId={task.id} index={index} isDragDisabled={readOnly}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={() => !readOnly && onClick(task)}
          style={{
            ...cardStyle,
            borderLeft: priorityColor ? `3px solid ${priorityColor}` : '3px solid transparent',
            ...(readOnly ? { opacity: 0.6, cursor: 'default' } : {}),
            ...(snapshot.isDragging ? { boxShadow: '0 8px 24px rgba(0,0,0,0.4)', border: '1px solid rgba(99,102,241,0.3)', borderLeft: priorityColor ? `3px solid ${priorityColor}` : '3px solid rgba(99,102,241,0.3)' } : {}),
            ...provided.draggableProps.style,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '6px' }}>
            <div style={{ fontSize: '13px', color: '#e2e8f0', lineHeight: '1.4', wordBreak: 'break-word', flex: 1 }}>
              {task.content}
            </div>
            {task.priority && (
              <span style={{ fontSize: '10px', fontWeight: 700, color: POINT_COLORS[task.priority], flexShrink: 0, lineHeight: '1.4' }}>
                {task.priority}pt
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
            {cat && (
              <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: `${cat.color}22`, color: cat.color, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {cat.label}
              </span>
            )}
            {subcat && (
              <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}>
                {subcat.label}
              </span>
            )}
            {bucket && (
              <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: `${bucket.color || '#6366f1'}22`, color: bucket.color || '#a5b4fc', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {bucket.label}
              </span>
            )}
            {task.due_date && (
              <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>
                {new Date(task.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            )}
            {task.project_id && projectsMap[task.project_id] && (
              <span style={{ fontSize: '10px', color: '#a5b4fc', background: 'rgba(99,102,241,0.15)', padding: '1px 5px', borderRadius: '4px' }}>
                {projectsMap[task.project_id]}
              </span>
            )}
            {task.campaign_id && campaignsMap[task.campaign_id] && (
              <span style={{ fontSize: '10px', color: '#10b981', background: 'rgba(16,185,129,0.15)', padding: '1px 5px', borderRadius: '4px' }}>
                {campaignsMap[task.campaign_id]}
              </span>
            )}
            {task.mayday_video && MAYDAY_STAGE_LABELS[task.mayday_video.stage] && (
              <span style={{ fontSize: '10px', color: MAYDAY_STAGE_COLORS[task.mayday_video.stage], background: `${MAYDAY_STAGE_COLORS[task.mayday_video.stage]}15`, padding: '1px 5px', borderRadius: '4px', fontWeight: 600 }}>
                {MAYDAY_STAGE_LABELS[task.mayday_video.stage]}
              </span>
            )}
            {task.linked_task && task.linked_task.workflow_instance && (
              <span style={{ fontSize: '10px', color: '#fbbf24', background: 'rgba(251,191,36,0.15)', padding: '1px 5px', borderRadius: '4px', fontWeight: 600 }}>
                Workflow
              </span>
            )}
            {task.linked_task && task.linked_task.related_entity_type === 'project' && !task.linked_task.workflow_instance && (
              <span style={{ fontSize: '10px', color: '#a5b4fc', background: 'rgba(99,102,241,0.15)', padding: '1px 5px', borderRadius: '4px', fontWeight: 600 }}>
                Project
              </span>
            )}
          </div>
        </div>
      )}
    </Draggable>
  );
}

// ─── AddOptionInline ────────────────────────────────────────
// Inline text field used for "+ Add new…" in the taxonomy dropdowns.
// Replaces window.prompt, which gets blocked or silently no-ops in several
// browsers and was letting the add flow fail without any user feedback.
function AddOptionInline({ kind, value, onChange, onCommit, onCancel, busy, error }) {
  return (
    <div style={{ marginTop: '6px' }}>
      <div style={{ display: 'flex', gap: '8px' }}>
        <input
          autoFocus
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); onCommit(); }
            if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
          }}
          placeholder={`New ${kind} name…`}
          disabled={busy}
          style={{ ...inputStyle, flex: 1 }}
        />
        <button
          onClick={onCommit}
          disabled={busy || !value.trim()}
          style={{ background: '#6366f1', border: 'none', color: '#fff', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy || !value.trim() ? 0.5 : 1 }}
        >
          {busy ? 'Saving…' : 'Add'}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer' }}
        >
          Cancel
        </button>
      </div>
      {error && <div style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px' }}>{error}</div>}
    </div>
  );
}

// ─── TaskDetailModal ────────────────────────────────────────
function TaskDetailModal({
  task, onClose, onSave, onDelete,
  projects, categoryOptions, subcategoryOptions, bucketOptions, onAddOption, activeSprint,
  isNew, templates, onSaveTemplate, onDeleteTemplate,
}) {
  const [form, setForm] = useState({
    content: task.content,
    category: task.category || 'administration',
    subcategory: task.subcategory || 'task',
    bucket: task.bucket || '',
    priority: task.priority || null,
    due_date: task.due_date || '',
    project_id: task.project_id || '',
  });

  // Inline "+ Add new…" input state. When a user picks the sentinel option we
  // open an inline text field instead of window.prompt (prompts are blocked
  // or silently no-op in several browser configs).
  const [addingKind, setAddingKind] = useState(null); // 'category' | 'subcategory' | 'bucket'
  const [addingLabel, setAddingLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState(null);

  // Template UI state.
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateNameInput, setTemplateNameInput] = useState('');
  const [templateSaveError, setTemplateSaveError] = useState(null);
  const [showTemplateManager, setShowTemplateManager] = useState(false);

  function applyTemplate(tplId) {
    if (!tplId) return;
    const tpl = (templates || []).find(t => t.id === tplId);
    if (!tpl) return;
    setForm(f => ({
      ...f,
      content: tpl.content || f.content,
      category: tpl.category || f.category,
      subcategory: tpl.subcategory || f.subcategory,
      bucket: tpl.bucket || '',
      priority: tpl.priority || null,
      project_id: tpl.project_id || '',
    }));
  }

  async function handleSaveTemplate() {
    const name = templateNameInput.trim();
    if (!name) { setTemplateSaveError('Name required.'); return; }
    if (!onSaveTemplate) return;
    setTemplateSaveError(null);
    try {
      await onSaveTemplate(name, {
        content: form.content,
        category: form.category,
        subcategory: form.subcategory,
        bucket: form.bucket || null,
        priority: form.priority || null,
        project_id: form.project_id || null,
      });
      setSavingTemplate(false);
      setTemplateNameInput('');
    } catch (err) {
      setTemplateSaveError(err?.message || 'Could not save.');
    }
  }

  function handleSave() {
    onSave(task.id, {
      content: form.content.trim(),
      category: form.category,
      subcategory: form.subcategory,
      bucket: form.bucket || null,
      priority: form.priority || null,
      due_date: form.due_date || null,
      project_id: form.project_id || null,
    });
    onClose();
  }

  function handleTaxonomyChange(kind, rawValue) {
    if (rawValue === '__new__') {
      setAddingKind(kind);
      setAddingLabel('');
      setAddError(null);
      return;
    }
    setForm(f => ({ ...f, [kind]: rawValue }));
  }

  async function commitNewOption() {
    if (!addingKind) return;
    const label = addingLabel.trim();
    if (!label) { setAddingKind(null); setAddingLabel(''); return; }
    setAdding(true);
    setAddError(null);
    try {
      const newValue = await onAddOption(addingKind, label);
      if (newValue) {
        setForm(f => ({ ...f, [addingKind]: newValue }));
        setAddingKind(null);
        setAddingLabel('');
      } else {
        setAddError('Could not save. Try a different name.');
      }
    } catch (err) {
      setAddError(err?.message || 'Could not save.');
    } finally {
      setAdding(false);
    }
  }

  function cancelNewOption() {
    setAddingKind(null);
    setAddingLabel('');
    setAddError(null);
  }

  return (
    <div style={overlayStyle} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', color: '#fff', fontWeight: 600 }}>{task.content ? 'Edit Task' : 'New Task'}</h3>
          <button onClick={onClose} style={closeBtnStyle}>{'\u2715'}</button>
        </div>

        {/* Template picker (new cards only) */}
        {isNew && templates && templates.length > 0 && (
          <div style={{ marginBottom: '14px', padding: '10px 12px', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label style={{ ...labelStyle, marginBottom: 0, color: '#a5b4fc', flexShrink: 0 }}>Template</label>
              <select
                defaultValue=""
                onChange={e => applyTemplate(e.target.value)}
                style={{ ...inputStyle, flex: 1 }}
              >
                <option value="">\u2014 None \u2014</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <button
                onClick={() => setShowTemplateManager(true)}
                style={{ background: 'none', border: 'none', color: 'rgba(165,180,252,0.7)', fontSize: '11px', cursor: 'pointer', textDecoration: 'underline' }}
              >
                Manage
              </button>
            </div>
          </div>
        )}
        {isNew && templates && templates.length === 0 && (
          <div style={{ marginBottom: '14px', fontSize: '11px', color: 'rgba(255,255,255,0.35)', fontStyle: 'italic' }}>
            No templates yet \u2014 save this card's setup as one below.
          </div>
        )}

        {/* Content */}
        <label style={labelStyle}>Content</label>
        <textarea
          value={form.content}
          onChange={e => setForm({ ...form, content: e.target.value })}
          rows={3}
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
        />

        {/* Category + Subcategory + Priority row */}
        <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Category</label>
            <select value={form.category} onChange={e => handleTaxonomyChange('category', e.target.value)} style={inputStyle}>
              {categoryOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              <option value="__new__">+ Add new…</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Subcategory</label>
            <select value={form.subcategory} onChange={e => handleTaxonomyChange('subcategory', e.target.value)} style={inputStyle}>
              {subcategoryOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              <option value="__new__">+ Add new…</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Priority</label>
            <select value={form.priority || ''} onChange={e => setForm({ ...form, priority: e.target.value || null })} style={inputStyle}>
              {PRIORITY_OPTIONS.map(o => <option key={o.value || 'none'} value={o.value || ''}>{o.label}</option>)}
            </select>
          </div>
        </div>

        {(addingKind === 'category' || addingKind === 'subcategory') && (
          <AddOptionInline
            kind={addingKind}
            value={addingLabel}
            onChange={setAddingLabel}
            onCommit={commitNewOption}
            onCancel={cancelNewOption}
            busy={adding}
            error={addError}
          />
        )}

        {/* Bucket */}
        <div style={{ marginTop: '12px' }}>
          <label style={labelStyle}>Bucket</label>
          <select value={form.bucket} onChange={e => handleTaxonomyChange('bucket', e.target.value)} style={inputStyle}>
            <option value="">None</option>
            {bucketOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            <option value="__new__">+ Add new…</option>
          </select>
          {addingKind === 'bucket' && (
            <AddOptionInline
              kind="bucket"
              value={addingLabel}
              onChange={setAddingLabel}
              onCommit={commitNewOption}
              onCancel={cancelNewOption}
              busy={adding}
              error={addError}
            />
          )}
        </div>

        {/* Due date */}
        <div style={{ marginTop: '12px' }}>
          <label style={labelStyle}>Due Date</label>
          <input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} style={inputStyle} />
        </div>

        {/* Project link */}
        <div style={{ marginTop: '12px' }}>
          <label style={labelStyle}>Project</label>
          <select value={form.project_id} onChange={e => setForm({ ...form, project_id: e.target.value })} style={inputStyle}>
            <option value="">None</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {/* Sprint controls */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '14px', flexWrap: 'wrap' }}>
          {activeSprint && !task.sprint_id && (
            <button
              onClick={() => { onSave(task.id, { sprint_id: activeSprint.id, status: 'ready' }); onClose(); }}
              style={{ background: 'rgba(99,102,241,0.1)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '6px', padding: '6px 12px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
            >
              Add to Sprint
            </button>
          )}
          {activeSprint && task.sprint_id === activeSprint.id && (
            <span style={{ fontSize: '10px', padding: '4px 10px', borderRadius: '6px', background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
              In Sprint
              <button
                onClick={() => { onSave(task.id, { sprint_id: null, status: 'backlog' }); onClose(); }}
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: '12px', padding: '0 2px' }}
              >
                \u00d7
              </button>
            </span>
          )}
        </div>

        {/* Save as Template */}
        {onSaveTemplate && (
          <div style={{ marginTop: '14px', padding: '10px 12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px' }}>
            {!savingTemplate ? (
              <button
                onClick={() => { setSavingTemplate(true); setTemplateNameInput(''); setTemplateSaveError(null); }}
                style={{ background: 'none', border: 'none', color: '#a5b4fc', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
              >
                + Save current layout as template
              </button>
            ) : (
              <div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    autoFocus
                    type="text"
                    placeholder="Template name"
                    value={templateNameInput}
                    onChange={e => setTemplateNameInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveTemplate(); if (e.key === 'Escape') setSavingTemplate(false); }}
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button onClick={handleSaveTemplate} disabled={!templateNameInput.trim()} style={{ ...saveBtnStyle, opacity: templateNameInput.trim() ? 1 : 0.4 }}>Save</button>
                  <button onClick={() => setSavingTemplate(false)} style={cancelBtnStyle}>Cancel</button>
                </div>
                {templateSaveError && (
                  <div style={{ marginTop: '6px', fontSize: '11px', color: '#f87171' }}>{templateSaveError}</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '14px' }}>
          <button onClick={() => { onDelete(task.id); onClose(); }} style={deleteBtnStyle}>Delete</button>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={onClose} style={cancelBtnStyle}>Cancel</button>
            <button onClick={handleSave} disabled={!form.content.trim()} style={{ ...saveBtnStyle, opacity: form.content.trim() ? 1 : 0.4 }}>Save</button>
          </div>
        </div>

        {/* Template Manager sub-modal */}
        {showTemplateManager && (
          <div
            style={{ ...overlayStyle, zIndex: 1100 }}
            onMouseDown={(e) => { if (e.target === e.currentTarget) setShowTemplateManager(false); }}
          >
            <div style={{ ...modalStyle, maxWidth: '420px' }} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <h3 style={{ margin: 0, fontSize: '15px', color: '#fff', fontWeight: 600 }}>Manage Templates</h3>
                <button onClick={() => setShowTemplateManager(false)} style={closeBtnStyle}>{'✕'}</button>
              </div>
              {(!templates || templates.length === 0) ? (
                <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '13px', margin: 0 }}>No templates yet.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {templates.map(t => (
                    <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px' }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: '13px', color: '#fff', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
                        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {[t.category, t.subcategory, t.bucket && `bucket:${t.bucket}`, t.priority && `${t.priority}pts`].filter(Boolean).join(' · ') || 'No fields set'}
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          if (window.confirm(`Delete template "${t.name}"?`)) {
                            if (onDeleteTemplate) await onDeleteTemplate(t.id);
                          }
                        }}
                        style={{ background: 'none', border: 'none', color: '#f87171', fontSize: '12px', cursor: 'pointer', padding: '4px 8px', fontFamily: 'inherit' }}
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SprintBoard (main export) ──────────────────────────────────
export default function SprintBoard({ profile, onNavigate, onBoardChange, sprintVersion }) {
  const { refreshKey } = useAuth();
  const [tasks, _setTasks] = useState([]);
  const tasksRef = useRef(tasks);
  const setTasks = useCallback((update) => {
    _setTasks(prev => {
      const next = typeof update === 'function' ? update(prev) : update;
      tasksRef.current = next;
      return next;
    });
  }, []);
  const [loading, setLoading] = useState(true);
  const [editingTask, setEditingTask] = useState(null);
  const isNewTaskRef = useRef(false);
  const [projects, setProjects] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [userOptions, setUserOptions] = useState({ category: [], subcategory: [], bucket: [] });
  const [templates, setTemplates] = useState([]);
  const [showAllDone, setShowAllDone] = useState(false);

  // Sprint state
  const [selectedWeek, setSelectedWeek] = useState(getSprintWeek());
  const [sprintForWeek, setSprintForWeek] = useState(null);
  const [sprintLoading, setSprintLoading] = useState(true);

  // Plan a Sprint state
  const [planExpanded, setPlanExpanded] = useState(false);
  const [planWeek, setPlanWeek] = useState(() => offsetWeek(getSprintWeek().start, 1));
  const [planSprint, setPlanSprint] = useState(null);
  const [planGoals, setPlanGoals] = useState([]);

  // Retro modal state
  const [showRetro, setShowRetro] = useState(false);
  const [closeResult, setCloseResult] = useState(null);

  const isViewingCurrentWeek = isCurrentWeek(selectedWeek.start);
  const isArchived = sprintForWeek && sprintForWeek.status === 'completed';
  const activeSprint = sprintForWeek && sprintForWeek.status === 'active' ? sprintForWeek : null;

  const projectsMap = {};
  projects.forEach(p => { projectsMap[p.id] = p.name; });
  const campaignsMap = {};
  campaigns.forEach(c => { campaignsMap[c.id] = c.label; });

  // ── Fetch sprint for selected week ──
  const fetchSprintForWeek = useCallback(async () => {
    if (!profile?.id) return;
    setSprintLoading(true);
    const { data, error } = await supabase
      .from('sprints')
      .select('*')
      .eq('user_id', profile.id)
      .eq('start_date', selectedWeek.start)
      .maybeSingle();
    if (!error) setSprintForWeek(data);
    setSprintLoading(false);
  }, [profile?.id, selectedWeek.start]);

  // ── Fetch plan sprint (for Plan a Sprint section) ──
  const fetchPlanSprint = useCallback(async () => {
    if (!profile?.id) return;
    const { data, error } = await supabase
      .from('sprints')
      .select('*')
      .eq('user_id', profile.id)
      .eq('start_date', planWeek.start)
      .maybeSingle();
    if (!error) setPlanSprint(data);
  }, [profile?.id, planWeek.start]);

  const fetchPlanGoals = useCallback(async () => {
    if (!planSprint) { setPlanGoals([]); return; }
    const { data, error } = await supabase
      .from('sprint_goals')
      .select('*')
      .eq('sprint_id', planSprint.id)
      .order('position');
    if (!error) setPlanGoals(data || []);
  }, [planSprint]);

  // ── Fetch tasks ──
  // Include archived tasks that belong to the current sprint so the progress bar
  // and sprint completion count tasks archived by the nightly snapshot.
  const fetchTasks = useCallback(async () => {
    if (!profile?.id) return;
    try {
      const sprintId = sprintForWeek?.id;
      const selectWithLinked = '*, mayday_video:mayday_videos(id, title, stage), linked_task:tasks(id, step_key, requires_sign_off, status, related_entity_type, related_entity_id, workflow_instance:workflow_instances(id, workflow_id, context, status, workflow:workflows(id, name)))';
      const selectFallback = '*, mayday_video:mayday_videos(id, title, stage)';

      let query = supabase
        .from('personal_tasks')
        .select(selectWithLinked)
        .eq('created_by', profile.id)
        .order('position', { ascending: true });

      if (sprintId) {
        query = query.or(`status.neq.archived,sprint_id.eq.${sprintId}`);
      } else {
        query = query.neq('status', 'archived');
      }

      let { data, error } = await query;

      // Fallback if linked_task join fails (task_id column not yet migrated)
      if (error) {
        let fallbackQuery = supabase
          .from('personal_tasks')
          .select(selectFallback)
          .eq('created_by', profile.id)
          .order('position', { ascending: true });
        if (sprintId) {
          fallbackQuery = fallbackQuery.or(`status.neq.archived,sprint_id.eq.${sprintId}`);
        } else {
          fallbackQuery = fallbackQuery.neq('status', 'archived');
        }
        const res = await fallbackQuery;
        if (res.error) throw res.error;
        data = res.data;
      }

      setTasks(data || []);
    } catch (err) {
      console.error('Error fetching personal tasks:', err);
    } finally {
      setLoading(false);
    }
  }, [profile?.id, sprintForWeek?.id]);

  // ── Fetch projects + campaigns for linking ──
  // Campaigns are no longer surfaced in the task modal, but existing tasks
  // still reference campaign_id for the card badge — keep fetching so the
  // badge keeps working without a regression.
  useEffect(() => {
    async function fetchMeta() {
      const [projRes, campRes] = await Promise.all([
        supabase.from('projects').select('id, name').eq('is_archived', false).order('name'),
        supabase.from('sponsor_campaigns').select('id, name, sponsor_id, sponsors(name)').order('name'),
      ]);
      if (projRes.data) setProjects(projRes.data);
      if (campRes.data) setCampaigns(campRes.data.map(c => ({
        id: c.id, name: c.name, sponsor_id: c.sponsor_id,
        label: `${c.sponsors?.name || 'Sponsor'} \u2014 ${c.name}`,
      })));
    }
    fetchMeta();
  }, []);

  // ── Fetch user-defined taxonomy options ──
  const fetchUserOptions = useCallback(async () => {
    if (!profile?.id) return;
    const { data, error } = await supabase
      .from('user_task_options')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: true });
    if (error) { console.error('Error fetching user task options:', error); return; }
    const byKind = { category: [], subcategory: [], bucket: [] };
    for (const row of (data || [])) {
      if (byKind[row.kind]) byKind[row.kind].push({ value: row.value, label: row.label, color: row.color });
    }
    setUserOptions(byKind);
  }, [profile?.id]);

  useEffect(() => { fetchUserOptions(); }, [fetchUserOptions]);

  // Sprint card templates (per-user, private).
  const fetchTemplates = useCallback(async () => {
    if (!profile?.id) return;
    const { data, error } = await supabase
      .from('personal_task_templates')
      .select('*')
      .eq('user_id', profile.id)
      .order('name', { ascending: true });
    if (error) { console.error('Error fetching templates:', error); return; }
    setTemplates(data || []);
  }, [profile?.id]);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const saveTemplate = useCallback(async (name, fields) => {
    if (!profile?.id) throw new Error('Not signed in.');
    const row = {
      user_id: profile.id,
      name,
      content: fields.content || '',
      category: fields.category || 'administration',
      subcategory: fields.subcategory || null,
      bucket: fields.bucket || null,
      priority: fields.priority || null,
      project_id: fields.project_id || null,
    };
    const { error } = await supabase
      .from('personal_task_templates')
      .upsert(row, { onConflict: 'user_id,name' });
    if (error) {
      throw new Error(error.message || 'Could not save template.');
    }
    await fetchTemplates();
  }, [profile?.id, fetchTemplates]);

  const deleteTemplate = useCallback(async (id) => {
    const { error } = await supabase
      .from('personal_task_templates')
      .delete()
      .eq('id', id);
    if (error) { console.error('Error deleting template:', error); return; }
    setTemplates(prev => prev.filter(t => t.id !== id));
  }, []);

  // Insert a user-specific option and return the stored value.
  // Errors bubble up so the inline input can surface them to the user.
  // Buckets auto-pick a color from BUCKET_COLORS so each badge is visually distinct.
  const addUserOption = useCallback(async (kind, label) => {
    if (!profile?.id) throw new Error('Not signed in.');
    const trimmed = (label || '').trim();
    if (!trimmed) throw new Error('Name is required.');
    const value = trimmed.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    if (!value) throw new Error('Use letters or numbers in the name.');
    const row = { user_id: profile.id, kind, value, label: trimmed };
    if (kind === 'bucket') {
      row.color = BUCKET_COLORS[userOptions.bucket.length % BUCKET_COLORS.length];
    }
    const { data, error } = await supabase
      .from('user_task_options')
      .insert(row)
      .select()
      .single();
    if (error) {
      if (error.code === '23505') throw new Error(`You already have a ${kind} named "${trimmed}".`);
      throw new Error(error.message || `Could not add ${kind}.`);
    }
    setUserOptions(prev => ({
      ...prev,
      [kind]: [...prev[kind], { value: data.value, label: data.label, color: data.color }],
    }));
    return data.value;
  }, [profile?.id, userOptions.bucket.length]);

  const categoryOptions = [...CATEGORY_OPTIONS, ...userOptions.category];
  const subcategoryOptions = [...SUBCATEGORY_OPTIONS, ...userOptions.subcategory];
  const bucketOptions = userOptions.bucket;
  const bucketMap = {};
  bucketOptions.forEach(b => { bucketMap[b.value] = { label: b.label, color: b.color }; });

  useEffect(() => { if (profile?.id) fetchTasks(); }, [profile?.id, fetchTasks, sprintVersion]);
  useEffect(() => { fetchSprintForWeek(); }, [fetchSprintForWeek]);
  useEffect(() => { fetchPlanSprint(); }, [fetchPlanSprint]);
  useEffect(() => { fetchPlanGoals(); }, [fetchPlanGoals]);

  // ── Realtime: refresh tasks when mayday video stages change ──
  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel('myboard-mayday-videos')
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'mayday_videos',
      }, () => { fetchTasks(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.id, fetchTasks, refreshKey]);

  // ── Week navigation ──
  function navigateWeek(offset) {
    setSelectedWeek(prev => offsetWeek(prev.start, offset));
  }

  // ── Start sprint for a week ──
  async function startSprint(week) {
    if (!profile?.id) return;

    // Complete any stale active sprint from a previous week so the
    // one_active_sprint_per_user unique constraint doesn't block the insert.
    // Calculate velocity before closing so the velocity chart stays accurate.
    const { data: staleSprints } = await supabase
      .from('sprints')
      .select('id')
      .eq('user_id', profile.id)
      .eq('status', 'active')
      .neq('start_date', week.start);

    for (const stale of (staleSprints || [])) {
      const { data: staleTasks } = await supabase
        .from('personal_tasks')
        .select('id, status, priority')
        .eq('sprint_id', stale.id);
      const pts = (t) => parseInt(t.priority) || 0;
      const vel = (staleTasks || [])
        .filter(t => t.status === 'done' || t.status === 'archived')
        .reduce((sum, t) => sum + pts(t), 0);
      await supabase
        .from('sprints')
        .update({ status: 'completed', velocity: vel, updated_at: new Date().toISOString() })
        .eq('id', stale.id);
    }

    const { data: newSprint, error } = await supabase.from('sprints').insert({
      user_id: profile.id,
      start_date: week.start,
      end_date: week.end,
      status: 'active',
    }).select('id').single();
    if (error) {
      console.error('Error starting sprint:', error);
      // If unique constraint, re-fetch to show existing sprint
      fetchSprintForWeek();
      fetchPlanSprint();
      return;
    }

    // Carry over incomplete tasks from the most recent previous sprint
    if (newSprint) {
      const { data: prevSprint } = await supabase
        .from('sprints')
        .select('id')
        .eq('user_id', profile.id)
        .neq('id', newSprint.id)
        .order('start_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (prevSprint) {
        await supabase
          .from('personal_tasks')
          .update({ sprint_id: newSprint.id, updated_at: new Date().toISOString() })
          .eq('sprint_id', prevSprint.id)
          .eq('created_by', profile.id)
          .neq('status', 'done')
          .neq('status', 'archived');
      }

      // Also adopt any orphaned tasks in sprint-column statuses that have no sprint
      await supabase
        .from('personal_tasks')
        .update({ sprint_id: newSprint.id, updated_at: new Date().toISOString() })
        .eq('created_by', profile.id)
        .is('sprint_id', null)
        .in('status', ['ready', 'in_progress', 'holding']);
    }

    if (week.start === selectedWeek.start) {
      fetchSprintForWeek();
    }
    if (week.start === planWeek.start) {
      fetchPlanSprint();
      setPlanExpanded(false);
    }
    fetchTasks();
    if (onBoardChange) onBoardChange();
  }

  // ── Complete sprint ──
  async function completeSprint() {
    if (!activeSprint) return;

    const { data: sprintTasks } = await supabase
      .from('personal_tasks')
      .select('id, status, priority')
      .eq('sprint_id', activeSprint.id);

    const pts = (t) => parseInt(t.priority) || 0;
    // Count both 'done' and 'archived' as completed (nightly snapshot archives done tasks)
    const isCompleted = (t) => t.status === 'done' || t.status === 'archived';
    const completedPoints = (sprintTasks || []).filter(isCompleted).reduce((sum, t) => sum + pts(t), 0);
    const completedCount = (sprintTasks || []).filter(isCompleted).length;
    const incompleteTasks = (sprintTasks || []).filter(t => !isCompleted(t));

    // Update sprint: set velocity, archived_at, complete
    await supabase
      .from('sprints')
      .update({ status: 'completed', velocity: completedPoints, archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', activeSprint.id);

    // Roll incomplete tasks (ready, in_progress, holding) back to backlog
    if (incompleteTasks.length > 0) {
      await supabase
        .from('personal_tasks')
        .update({ sprint_id: null, status: 'backlog', updated_at: new Date().toISOString() })
        .in('id', incompleteTasks.map(t => t.id));
    }

    setCloseResult({ completedCount, completedPoints, rolledBackCount: incompleteTasks.length, sprint: { ...activeSprint } });
    setShowRetro(true);
  }

  function handleRetroSaved() {
    setShowRetro(false);
    setCloseResult(null);
    fetchSprintForWeek();
    fetchTasks();
    if (onBoardChange) onBoardChange();
  }

  // ── Quick capture — create + open detail modal ──
  async function addTask() {
    if (!profile?.id) return;

    const inboxTasks = tasks.filter(t => t.status === 'inbox');
    const minPos = inboxTasks.length > 0 ? Math.min(...inboxTasks.map(t => t.position)) : 10;

    try {
      const { data, error } = await supabase.from('personal_tasks').insert({
        created_by: profile.id,
        content: '',
        status: 'inbox',
        position: minPos - 10,
      }).select().single();
      if (error) throw error;
      setTasks(prev => [...prev, data]);
      setEditingTask(data);
      isNewTaskRef.current = true;
    } catch (err) {
      console.error('Error creating task:', err);
    }
  }

  // ── Update task ──
  async function updateTask(id, updates) {
    const snapshot = tasksRef.current.find(t => t.id === id);
    setTasks(ts => ts.map(t => t.id === id ? { ...t, ...updates, updated_at: new Date().toISOString() } : t));
    try {
      const { error } = await supabase
        .from('personal_tasks')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    } catch (err) {
      console.error('Error updating task:', err);
      // Roll back only this task, not the entire array
      if (snapshot) {
        setTasks(ts => ts.map(t => t.id === id ? snapshot : t));
      }
    }
  }

  // ── Delete task ──
  async function deleteTask(id) {
    const snapshot = tasksRef.current.find(t => t.id === id);
    setTasks(ts => ts.filter(t => t.id !== id));
    try {
      const { error } = await supabase.from('personal_tasks').delete().eq('id', id);
      if (error) throw error;
    } catch (err) {
      console.error('Error deleting task:', err);
      if (snapshot) {
        setTasks(ts => [...ts, snapshot]);
      }
    }
  }


  // ── Drag-and-drop handler ──
  // Reindexes the entire destination column so positions never collide.
  async function onDragEnd(result) {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    const newStatus = destination.droppableId;
    const currentTasks = tasksRef.current;
    const task = currentTasks.find(t => t.id === draggableId);
    if (!task) return;

    const isSprint = ['ready', 'in_progress', 'holding', 'done'].includes(newStatus);

    // Build the destination column's ordered list with the dragged task inserted
    const destTasks = currentTasks
      .filter(t => t.status === newStatus && t.id !== draggableId)
      .sort((a, b) => a.position - b.position);
    destTasks.splice(destination.index, 0, task);

    // Assign evenly-spaced positions (10, 20, 30, ...)
    const reindexed = destTasks.map((t, i) => ({ id: t.id, position: (i + 1) * 10 }));

    // Build updates for the dragged task
    const draggedPosition = reindexed.find(r => r.id === draggableId).position;
    const taskUpdates = {
      status: newStatus,
      position: draggedPosition,
      ...(newStatus === 'done' && !task.completed_at ? { completed_at: new Date().toISOString() } : {}),
      ...(newStatus !== 'done' ? { completed_at: null } : {}),
      ...(isSprint && activeSprint && !task.sprint_id ? { sprint_id: activeSprint.id } : {}),
      ...(!isSprint && task.sprint_id ? { sprint_id: null } : {}),
    };

    // Optimistically update ALL reindexed positions + dragged task fields in local state
    setTasks(ts => ts.map(t => {
      const ri = reindexed.find(r => r.id === t.id);
      if (t.id === draggableId) return { ...t, ...taskUpdates, updated_at: new Date().toISOString() };
      if (ri) return { ...t, position: ri.position };
      return t;
    }));

    // Persist: update the dragged task, then batch-reindex the rest
    try {
      const { error } = await supabase
        .from('personal_tasks')
        .update({ ...taskUpdates, updated_at: new Date().toISOString() })
        .eq('id', draggableId);
      if (error) throw error;

      // Reindex sibling positions in parallel
      const siblings = reindexed.filter(r => r.id !== draggableId);
      if (siblings.length > 0) {
        await Promise.all(siblings.map(r =>
          supabase.from('personal_tasks').update({ position: r.position }).eq('id', r.id)
        ));
      }
    } catch (err) {
      console.error('Error persisting drag:', err);
      fetchTasks(); // recover from DB truth
    }


    if (task.bd_task_id) {
      if (newStatus === 'done') {
        supabase.from('bd_tasks').update({ completed_at: new Date().toISOString() }).eq('id', task.bd_task_id);
      } else if (task.status === 'done') {
        supabase.from('bd_tasks').update({ completed_at: null }).eq('id', task.bd_task_id);
      }
    }

    // Workflow/project task completion: fire sign-off or complete when moved to done.
    if (task.task_id && newStatus === 'done' && task.linked_task) {
      const lt = task.linked_task;
      // Re-read the linked task's current status — the pre-drag snapshot can be
      // stale (e.g. someone else already signed it off), which would otherwise
      // fire sign_off on a non-active task (server 400 + console noise).
      (async () => {
        let cur = lt;
        if (lt.id) {
          const { data: fresh } = await supabase.from('tasks')
            .select('status, requires_sign_off').eq('id', lt.id).maybeSingle();
          if (fresh) cur = fresh;
        }
        if (cur.status === 'active') {
          const action = cur.requires_sign_off ? 'sign_off' : undefined;
          callWorkflowFn('workflow-complete-task', { task_id: task.task_id, action }).catch(err =>
            console.error('Sprint done → workflow-complete-task failed:', err)
          );
        }
      })();
    }

    if (onBoardChange) onBoardChange();
  }

  // ── Get visible tasks for a column ──
  function getVisibleTasks(columnId) {
    let colTasks = tasks.filter(t => t.status === columnId).sort((a, b) => a.position - b.position);

    // For sprint columns, only show tasks from the viewed sprint (or unassigned for current week)
    if (['ready', 'in_progress', 'holding', 'done'].includes(columnId) && sprintForWeek) {
      colTasks = colTasks.filter(t => t.sprint_id === sprintForWeek.id);
    }

    if (columnId !== 'done' || showAllDone) return colTasks;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return colTasks.filter(t => !t.completed_at || new Date(t.completed_at) >= sevenDaysAgo);
  }

  function getDoneHiddenCount() {
    const allDone = tasks.filter(t => t.status === 'done' && (!sprintForWeek || t.sprint_id === sprintForWeek.id));
    const visible = getVisibleTasks('done');
    return allDone.length - visible.length;
  }

  // ── Sprint task points for progress bar ──
  const sprintTaskPoints = (() => {
    if (!sprintForWeek) return { total: 0, completed: 0 };
    const sTasks = tasks.filter(t => t.sprint_id === sprintForWeek.id);
    const pts = (t) => parseInt(t.priority) || 0;
    return {
      total: sTasks.reduce((sum, t) => sum + pts(t), 0),
      completed: sTasks.filter(t => t.status === 'done' || t.status === 'archived').reduce((sum, t) => sum + pts(t), 0),
    };
  })();

  if (loading) {
    return (
      <div style={sectionStyle}>
        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '13px' }}>Loading...</p>
      </div>
    );
  }

  return (
    <div style={sectionStyle}>
      {/* ── Header: Sprint title + week selector ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {isArchived && (
            <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Archived
            </span>
          )}
          {activeSprint && (
            <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Active
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button onClick={() => navigateWeek(-1)} style={weekNavBtnStyle}>{'\u2190'}</button>
          <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)', fontWeight: 500, minWidth: '140px', textAlign: 'center' }}>
            {fmtWeekRange(selectedWeek.start, selectedWeek.end)}
          </span>
          <button onClick={() => navigateWeek(1)} style={weekNavBtnStyle}>{'\u2192'}</button>
          {!isViewingCurrentWeek && (
            <button onClick={() => setSelectedWeek(getSprintWeek())} style={{ ...weekNavBtnStyle, fontSize: '11px', padding: '4px 10px' }}>
              Today
            </button>
          )}
        </div>
      </div>

      {/* ── Sprint progress bar (when sprint exists) ── */}
      {sprintForWeek && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
          <div style={{ flex: 1, height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              background: '#6366f1',
              borderRadius: '3px',
              transition: 'width 0.3s ease',
              width: sprintTaskPoints.total > 0 ? `${(sprintTaskPoints.completed / sprintTaskPoints.total) * 100}%` : '0%',
            }} />
          </div>
          <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>
            {sprintTaskPoints.completed}/{sprintTaskPoints.total} pts
          </span>
          {activeSprint && (
            <button onClick={completeSprint} style={completeSprintBtnStyle}>
              Complete Sprint
            </button>
          )}
          {isArchived && sprintForWeek.velocity != null && (
            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)' }}>
              Velocity: {sprintForWeek.velocity} pts
            </span>
          )}
        </div>
      )}

      {/* ── No sprint for this week ── */}
      {!sprintLoading && !sprintForWeek && isViewingCurrentWeek && (
        <div style={{ textAlign: 'center', padding: '16px', marginBottom: '12px' }}>
          <button onClick={() => startSprint(selectedWeek)} style={startSprintBtnStyle}>
            Start Sprint for This Week
          </button>
        </div>
      )}

      {/* ── Kanban: single DragDropContext for sprint + buckets ── */}
      <DragDropContext onDragEnd={onDragEnd}>
        {/* Sprint columns (4-column grid) */}
        <div style={sprintGridStyle}>
          {SPRINT_COLUMNS.map(col => {
            const colTasks = getVisibleTasks(col.id);
            const totalCount = colTasks.length;
            const hiddenCount = col.id === 'done' ? getDoneHiddenCount() : 0;

            return (
              <Droppable droppableId={col.id} key={col.id} isDropDisabled={isArchived}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    style={{
                      ...columnStyle,
                      background: snapshot.isDraggingOver ? 'rgba(99,102,241,0.06)' : 'rgba(255,255,255,0.02)',
                      ...(isArchived ? { opacity: 0.7 } : {}),
                    }}
                  >
                    <div style={columnHeaderStyle}>
                      <div style={{ ...columnDotStyle, background: col.color }} />
                      <span style={{ fontSize: '12px', fontWeight: 700, color: col.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {col.label}
                      </span>
                      <span style={columnCountStyle}>{totalCount}</span>
                    </div>
                    <div style={columnBodyStyle}>
                      {colTasks.map((task, i) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          index={i}
                          onClick={setEditingTask}
                          projectsMap={projectsMap}
                          campaignsMap={campaignsMap}
                          bucketMap={bucketMap}
                          readOnly={isArchived}
                        />
                      ))}
                      {provided.placeholder}
                      {col.id === 'done' && hiddenCount > 0 && (
                        <button onClick={() => setShowAllDone(!showAllDone)} style={showAllBtnStyle}>
                          {showAllDone ? 'Show recent only' : `Show ${hiddenCount} older`}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </Droppable>
            );
          })}
        </div>

        {/* ── Plan a Sprint (collapsible) ── */}
        <div style={{ marginTop: '16px', marginBottom: '16px' }}>
          <button
            onClick={() => setPlanExpanded(!planExpanded)}
            style={{
              background: 'none', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px',
              color: 'rgba(255,255,255,0.5)', fontSize: '12px', fontWeight: 600, padding: '8px 16px',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', width: '100%',
              justifyContent: 'center',
            }}
          >
            <span style={{ transform: planExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', display: 'inline-block' }}>
              {'\u25B6'}
            </span>
            Plan a Sprint
          </button>
          {planExpanded && (
            <div style={{ marginTop: '12px', padding: '16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '14px' }}>
              {/* Plan week selector */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '14px' }}>
                <button onClick={() => setPlanWeek(prev => offsetWeek(prev.start, -1))} style={weekNavBtnStyle}>{'\u2190'}</button>
                <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)', fontWeight: 500, minWidth: '140px', textAlign: 'center' }}>
                  {fmtWeekRange(planWeek.start, planWeek.end)}
                </span>
                <button onClick={() => setPlanWeek(prev => offsetWeek(prev.start, 1))} style={weekNavBtnStyle}>{'\u2192'}</button>
              </div>

              {planSprint ? (
                <div>
                  <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', textAlign: 'center', marginBottom: '10px' }}>
                    Sprint already {planSprint.status === 'active' ? 'active' : 'exists'} for this week.
                  </div>
                  {planSprint.status !== 'completed' && (
                    <SprintGoals goals={planGoals} sprintId={planSprint.id} onUpdate={fetchPlanGoals} />
                  )}
                </div>
              ) : (
                <div style={{ textAlign: 'center' }}>
                  <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', margin: '0 0 12px' }}>
                    No sprint planned for this week yet.
                  </p>
                  <button onClick={() => startSprint(planWeek)} style={startSprintBtnStyle}>
                    Start Sprint
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Quick capture (below Plan a Sprint) */}
        <div style={captureRowStyle}>
          <button onClick={addTask} style={captureButtonStyle}>
            + New Task
          </button>
        </div>

        {/* ── Bucket columns (Inbox + Backlog side by side) ── */}
        <div style={bucketGridStyle}>
          {BUCKET_COLUMNS.map(col => {
            const colTasks = getVisibleTasks(col.id);
            const totalCount = colTasks.length;

            return (
              <Droppable droppableId={col.id} key={col.id}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    style={{
                      ...columnStyle,
                      background: snapshot.isDraggingOver ? 'rgba(99,102,241,0.06)' : 'rgba(255,255,255,0.02)',
                      minHeight: '120px',
                    }}
                  >
                    <div style={columnHeaderStyle}>
                      <div style={{ ...columnDotStyle, background: col.color }} />
                      <span style={{ fontSize: '12px', fontWeight: 700, color: col.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {col.label}
                      </span>
                      <span style={columnCountStyle}>{totalCount}</span>
                    </div>
                    <div style={{ ...columnBodyStyle, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' }}>
                      {colTasks.map((task, i) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          index={i}
                          onClick={setEditingTask}
                          projectsMap={projectsMap}
                          campaignsMap={campaignsMap}
                          readOnly={false}
                        />
                      ))}
                      {provided.placeholder}
                    </div>
                  </div>
                )}
              </Droppable>
            );
          })}
        </div>
      </DragDropContext>

      {/* Detail modals */}
      {editingTask && (
        <TaskDetailModal
          task={editingTask}
          onClose={() => {
            // If this was a newly created task and content is still empty, delete it
            if (isNewTaskRef.current) {
              isNewTaskRef.current = false;
              const current = tasksRef.current.find(t => t.id === editingTask.id);
              if (current && !current.content?.trim()) {
                deleteTask(editingTask.id);
              }
            }
            setEditingTask(null);
          }}
          onSave={(id, updates) => {
            isNewTaskRef.current = false;
            updateTask(id, updates);
          }}
          onDelete={(id) => {
            isNewTaskRef.current = false;
            deleteTask(id);
          }}
          projects={projects}
          categoryOptions={categoryOptions}
          subcategoryOptions={subcategoryOptions}
          bucketOptions={bucketOptions}
          onAddOption={addUserOption}
          activeSprint={activeSprint}
          isNew={isNewTaskRef.current}
          templates={templates}
          onSaveTemplate={saveTemplate}
          onDeleteTemplate={deleteTemplate}
        />
      )}
      {/* Retro modal */}
      {showRetro && closeResult && (
        <SprintRetroModal
          sprint={closeResult.sprint}
          completedCount={closeResult.completedCount}
          completedPoints={closeResult.completedPoints}
          rolledBackCount={closeResult.rolledBackCount}
          onClose={handleRetroSaved}
          onSaved={handleRetroSaved}
        />
      )}
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────
const sectionStyle = {
  marginBottom: '32px',
};

const sectionTitleStyle = {
  fontSize: '18px',
  fontWeight: 700,
  color: '#fff',
  marginBottom: '16px',
};

const captureRowStyle = {
  display: 'flex',
  gap: '8px',
  marginBottom: '16px',
};

const captureButtonStyle = {
  background: '#6366f1',
  color: '#fff',
  border: 'none',
  borderRadius: '10px',
  padding: '10px 20px',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
};

const sprintGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: '12px',
};

const bucketGridStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '12px',
};

const columnStyle = {
  borderRadius: '10px',
  border: '1px solid rgba(255,255,255,0.06)',
  minHeight: '200px',
  display: 'flex',
  flexDirection: 'column',
};

const columnHeaderStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '12px 12px 8px',
};

const columnDotStyle = {
  width: '8px',
  height: '8px',
  borderRadius: '50%',
};

const columnCountStyle = {
  fontSize: '11px',
  color: 'rgba(255,255,255,0.3)',
  marginLeft: 'auto',
};

const columnBodyStyle = {
  flex: 1,
  padding: '4px 8px 8px',
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
};

const cardStyle = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: '8px',
  padding: '10px 10px 8px',
  cursor: 'pointer',
  transition: 'background 0.15s',
};

const showAllBtnStyle = {
  background: 'none',
  border: 'none',
  color: 'rgba(255,255,255,0.35)',
  fontSize: '11px',
  cursor: 'pointer',
  padding: '6px 0',
  textAlign: 'center',
};

const weekNavBtnStyle = {
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '6px',
  color: 'rgba(255,255,255,0.5)',
  fontSize: '14px',
  cursor: 'pointer',
  padding: '4px 10px',
  lineHeight: 1,
};

const startSprintBtnStyle = {
  background: '#6366f1',
  color: '#fff',
  border: 'none',
  borderRadius: '8px',
  padding: '8px 18px',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
};

const completeSprintBtnStyle = {
  background: 'rgba(34,197,94,0.12)',
  color: '#22c55e',
  border: '1px solid rgba(34,197,94,0.2)',
  borderRadius: '8px',
  padding: '6px 14px',
  fontSize: '11px',
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

// Modal styles
const overlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const modalStyle = {
  background: '#1a1a2e',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '14px',
  padding: '24px',
  width: '440px',
  maxWidth: '90vw',
  maxHeight: '85vh',
  overflowY: 'auto',
};

const labelStyle = {
  display: 'block',
  fontSize: '11px',
  fontWeight: 600,
  color: 'rgba(255,255,255,0.45)',
  marginBottom: '4px',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const inputStyle = {
  width: '100%',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '8px',
  padding: '8px 10px',
  color: '#fff',
  fontSize: '13px',
  outline: 'none',
  boxSizing: 'border-box',
};

const closeBtnStyle = {
  background: 'none',
  border: 'none',
  color: 'rgba(255,255,255,0.4)',
  fontSize: '18px',
  cursor: 'pointer',
  padding: '4px 8px',
};

const deleteBtnStyle = {
  background: 'rgba(239,68,68,0.15)',
  color: '#ef4444',
  border: '1px solid rgba(239,68,68,0.2)',
  borderRadius: '8px',
  padding: '8px 16px',
  fontSize: '13px',
  cursor: 'pointer',
};

const cancelBtnStyle = {
  background: 'rgba(255,255,255,0.05)',
  color: 'rgba(255,255,255,0.6)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '8px',
  padding: '8px 16px',
  fontSize: '13px',
  cursor: 'pointer',
};

const saveBtnStyle = {
  background: '#6366f1',
  color: '#fff',
  border: 'none',
  borderRadius: '8px',
  padding: '8px 20px',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
};
