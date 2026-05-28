import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { callWorkflowFn } from '../lib/workflowApi';

// ─── Constants ───────────────────────────────────────────────

const SOURCE_COLORS = {
  code: { bg: 'rgba(255,255,255,0.06)', text: 'rgba(255,255,255,0.5)' },
  data: { bg: 'rgba(99,102,241,0.15)', text: '#818cf8' },
};

const OUTCOME_STYLE_COLORS = {
  default: { bg: 'rgba(255,255,255,0.06)', text: 'rgba(255,255,255,0.6)', border: 'rgba(255,255,255,0.1)' },
  success: { bg: 'rgba(34,197,94,0.1)', text: '#22c55e', border: 'rgba(34,197,94,0.3)' },
  danger: { bg: 'rgba(239,68,68,0.1)', text: '#ef4444', border: 'rgba(239,68,68,0.3)' },
  warning: { bg: 'rgba(234,179,8,0.1)', text: '#eab308', border: 'rgba(234,179,8,0.3)' },
};

const SIM_STATUS_COLORS = {
  active: '#6366f1',
  complete: '#22c55e',
  pending: 'rgba(255,255,255,0.3)',
  on_hold: '#eab308',
  skipped: 'rgba(255,255,255,0.2)',
};

const ACTION_TYPES = ['complete', 'navigate', 'modal', 'custom'];
const ASSIGNEE_TYPES = ['static', 'context'];
const TRIGGER_MODES = ['manual', 'auto', 'both'];
const OUTCOME_STYLES = ['default', 'success', 'danger', 'warning'];

// ─── Helpers ─────────────────────────────────────────────────

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 60);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ─── Component ───────────────────────────────────────────────

export default function Workflows() {
  const { isAdmin, profile } = useAuth();

  // ── Workflow list state ──
  const [workflows, setWorkflows] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [listLoading, setListLoading] = useState(true);

  // ── Builder state ──
  const [steps, setSteps] = useState([]);
  const [outcomes, setOutcomes] = useState({}); // { stepId: [outcome, ...] }
  const [workflowForm, setWorkflowForm] = useState(null);
  const [builderLoading, setBuilderLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [toast, setToast] = useState(null);
  const [deleteConfirmStepId, setDeleteConfirmStepId] = useState(null);

  // ── Version state ──
  const [versions, setVersions] = useState([]);
  const [showVersions, setShowVersions] = useState(false);

  // ── Simulator state ──
  const [showSimulator, setShowSimulator] = useState(false);
  const [simContext, setSimContext] = useState('{}');
  const [simInstanceId, setSimInstanceId] = useState(null);
  const [simTasks, setSimTasks] = useState([]);
  const [simStatus, setSimStatus] = useState(null); // 'active', 'complete'
  const [simRunning, setSimRunning] = useState(false);
  const [simPayloads, setSimPayloads] = useState({}); // { taskId: jsonString }
  const [simOutcomeSelections, setSimOutcomeSelections] = useState({}); // { taskId: outcomeKey }
  const [simCompletingId, setSimCompletingId] = useState(null);
  const [simCleaning, setSimCleaning] = useState(false);
  const [simInstanceContext, setSimInstanceContext] = useState(null);

  // ── New workflow state ──
  const [showNewModal, setShowNewModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');

  const toastTimerRef = useRef(null);

  // ─── Toast helper ──────────────────────────────────────────

  const showToast = useCallback((message, type = 'success') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // ─── Fetch workflows ──────────────────────────────────────

  const fetchWorkflows = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('workflows')
        .select('id, slug, name, description, source, is_active, first_step_key, trigger_mode, trigger_config, current_version_id')
        .order('created_at', { ascending: true });
      if (error) throw error;
      setWorkflows(data || []);
    } catch (err) {
      console.error('Error fetching workflows:', err);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) fetchWorkflows();
  }, [isAdmin, fetchWorkflows]);

  // ─── Select workflow and load builder ─────────────────────

  const selectedWorkflow = workflows.find(w => w.id === selectedId);

  const loadBuilder = useCallback(async (wf) => {
    if (!wf) return;
    setBuilderLoading(true);
    setSteps([]);
    setOutcomes({});
    setVersions([]);
    setShowVersions(false);
    resetSimulator();

    setWorkflowForm({
      name: wf.name,
      slug: wf.slug,
      description: wf.description || '',
      trigger_mode: wf.trigger_mode || 'manual',
      trigger_config: wf.trigger_config || {},
      first_step_key: wf.first_step_key || '',
      source: wf.source,
    });

    try {
      // Load steps
      const { data: stepRows, error: sErr } = await supabase
        .from('workflow_steps')
        .select('*')
        .eq('workflow_id', wf.id)
        .order('position');

      if (sErr) throw sErr;
      const loadedSteps = stepRows || [];
      setSteps(loadedSteps);

      // Load outcomes for all steps
      if (loadedSteps.length > 0) {
        const stepIds = loadedSteps.map(s => s.id);
        const { data: outcomeRows, error: oErr } = await supabase
          .from('workflow_step_outcomes')
          .select('*')
          .in('step_id', stepIds)
          .order('position');

        if (oErr) throw oErr;
        const grouped = {};
        for (const o of (outcomeRows || [])) {
          if (!grouped[o.step_id]) grouped[o.step_id] = [];
          grouped[o.step_id].push(o);
        }
        setOutcomes(grouped);
      }

      // Load versions
      const { data: vRows } = await supabase
        .from('workflow_versions')
        .select('id, version_number, published_at, published_by')
        .eq('workflow_id', wf.id)
        .order('version_number', { ascending: false });
      setVersions(vRows || []);
    } catch (err) {
      console.error('Error loading builder:', err);
      showToast('Failed to load workflow steps', 'error');
    } finally {
      setBuilderLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (selectedId) {
      const wf = workflows.find(w => w.id === selectedId);
      if (wf) loadBuilder(wf);
    }
  }, [selectedId, workflows, loadBuilder]);

  // ─── Toggle active ────────────────────────────────────────

  const toggleActive = async (wf) => {
    const newVal = !wf.is_active;
    const { error } = await supabase
      .from('workflows')
      .update({ is_active: newVal })
      .eq('id', wf.id);
    if (error) {
      showToast('Failed to toggle active state', 'error');
      return;
    }
    setWorkflows(prev => prev.map(w => w.id === wf.id ? { ...w, is_active: newVal } : w));
    showToast(newVal ? 'Activated' : 'Deactivated');
  };

  // ─── Create new workflow ──────────────────────────────────

  const handleCreateWorkflow = async () => {
    if (!newName.trim() || !newSlug.trim()) return;
    const { data, error } = await supabase
      .from('workflows')
      .insert({
        name: newName.trim(),
        slug: newSlug.trim(),
        description: '',
        source: 'data',
        is_active: false,
        trigger_mode: 'manual',
        trigger_config: {},
      })
      .select()
      .single();

    if (error) {
      showToast(error.message.includes('duplicate') ? 'Slug already exists' : error.message, 'error');
      return;
    }

    setShowNewModal(false);
    setNewName('');
    setNewSlug('');
    await fetchWorkflows();
    setSelectedId(data.id);
    showToast('Workflow created');
  };

  // ─── Save workflow header ─────────────────────────────────

  const saveWorkflowHeader = async () => {
    if (!selectedId || !workflowForm) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('workflows')
        .update({
          name: workflowForm.name,
          description: workflowForm.description,
          trigger_mode: workflowForm.trigger_mode,
          trigger_config: workflowForm.trigger_config,
          first_step_key: workflowForm.first_step_key || null,
        })
        .eq('id', selectedId);

      if (error) throw error;
      await fetchWorkflows();
      showToast('Saved');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // ─── Step CRUD ────────────────────────────────────────────

  const addStep = async () => {
    if (!selectedId) return;
    const newPosition = steps.length;
    const stepKey = `step_${Date.now()}`;
    const { data, error } = await supabase
      .from('workflow_steps')
      .insert({
        workflow_id: selectedId,
        step_key: stepKey,
        title_template: '',
        assignee_type: 'static',
        assignee_value: '',
        action_type: 'complete',
        action_label: 'Mark Complete',
        action_config: {},
        depends_on_step_keys: [],
        position: newPosition,
      })
      .select()
      .single();

    if (error) {
      showToast('Failed to add step: ' + error.message, 'error');
      return;
    }
    setSteps(prev => [...prev, data]);
  };

  const updateStep = async (stepId, updates) => {
    const { error } = await supabase
      .from('workflow_steps')
      .update(updates)
      .eq('id', stepId);

    if (error) {
      showToast('Failed to update step: ' + error.message, 'error');
      return;
    }
    setSteps(prev => prev.map(s => s.id === stepId ? { ...s, ...updates } : s));
  };

  const deleteStep = async (stepId) => {
    const { error } = await supabase
      .from('workflow_steps')
      .delete()
      .eq('id', stepId);

    if (error) {
      showToast('Failed to delete step: ' + error.message, 'error');
      return;
    }
    setSteps(prev => prev.filter(s => s.id !== stepId));
    setOutcomes(prev => {
      const next = { ...prev };
      delete next[stepId];
      return next;
    });
    setDeleteConfirmStepId(null);
    showToast('Step deleted');
  };

  // ─── Outcome CRUD ────────────────────────────────────────

  const addOutcome = async (stepId) => {
    const existing = outcomes[stepId] || [];
    const pos = existing.length;
    const { data, error } = await supabase
      .from('workflow_step_outcomes')
      .insert({
        step_id: stepId,
        outcome_key: `outcome_${Date.now()}`,
        label: '',
        next_step_key: null,
        style: 'default',
        position: pos,
      })
      .select()
      .single();

    if (error) {
      showToast('Failed to add outcome: ' + error.message, 'error');
      return;
    }
    setOutcomes(prev => ({
      ...prev,
      [stepId]: [...(prev[stepId] || []), data],
    }));
  };

  const updateOutcome = async (outcomeId, stepId, updates) => {
    const { error } = await supabase
      .from('workflow_step_outcomes')
      .update(updates)
      .eq('id', outcomeId);

    if (error) {
      showToast('Failed to update outcome: ' + error.message, 'error');
      return;
    }
    setOutcomes(prev => ({
      ...prev,
      [stepId]: (prev[stepId] || []).map(o =>
        o.id === outcomeId ? { ...o, ...updates } : o
      ),
    }));
  };

  const deleteOutcome = async (outcomeId, stepId) => {
    const { error } = await supabase
      .from('workflow_step_outcomes')
      .delete()
      .eq('id', outcomeId);

    if (error) {
      showToast('Failed to delete outcome: ' + error.message, 'error');
      return;
    }
    setOutcomes(prev => ({
      ...prev,
      [stepId]: (prev[stepId] || []).filter(o => o.id !== outcomeId),
    }));
  };

  // ─── Version Publishing ───────────────────────────────────

  const publishVersion = async () => {
    if (!selectedId || !workflowForm) return;
    setPublishing(true);
    try {
      // First save the header
      await saveWorkflowHeader();

      // Fetch latest steps + outcomes for snapshot
      const { data: snapSteps } = await supabase
        .from('workflow_steps')
        .select('*')
        .eq('workflow_id', selectedId)
        .order('position');

      const stepIds = (snapSteps || []).map(s => s.id);
      let snapOutcomes = [];
      if (stepIds.length > 0) {
        const { data: oRows } = await supabase
          .from('workflow_step_outcomes')
          .select('*')
          .in('step_id', stepIds)
          .order('position');
        snapOutcomes = oRows || [];
      }

      // Determine version number
      const maxVer = versions.length > 0
        ? Math.max(...versions.map(v => v.version_number))
        : 0;
      const newVersionNum = maxVer + 1;

      // Create snapshot
      const snapshot = {
        steps: snapSteps || [],
        outcomes: snapOutcomes,
        firstStep: workflowForm.first_step_key,
      };

      // Insert version
      const { data: versionRow, error: vErr } = await supabase
        .from('workflow_versions')
        .insert({
          workflow_id: selectedId,
          version_number: newVersionNum,
          snapshot,
          published_by: profile.id,
        })
        .select()
        .single();

      if (vErr) throw vErr;

      // Update workflows.current_version_id
      const { error: wErr } = await supabase
        .from('workflows')
        .update({ current_version_id: versionRow.id })
        .eq('id', selectedId);

      if (wErr) throw wErr;

      await fetchWorkflows();
      setVersions(prev => [versionRow, ...prev]);
      showToast(`Published v${newVersionNum}`);
    } catch (err) {
      showToast('Publish failed: ' + err.message, 'error');
    } finally {
      setPublishing(false);
    }
  };

  const rollbackToVersion = async (version) => {
    try {
      const { error } = await supabase
        .from('workflows')
        .update({ current_version_id: version.id })
        .eq('id', selectedId);

      if (error) throw error;
      await fetchWorkflows();
      showToast(`Rolled back to v${version.version_number}`);
    } catch (err) {
      showToast('Rollback failed: ' + err.message, 'error');
    }
  };

  // ─── Simulator ────────────────────────────────────────────

  const resetSimulator = () => {
    setSimInstanceId(null);
    setSimTasks([]);
    setSimStatus(null);
    setSimRunning(false);
    setSimPayloads({});
    setSimOutcomeSelections({});
    setSimCompletingId(null);
    setSimInstanceContext(null);
  };

  const startSimulation = async () => {
    if (!selectedWorkflow) return;
    setSimRunning(true);
    try {
      let parsedCtx = {};
      try {
        parsedCtx = JSON.parse(simContext);
      } catch {
        showToast('Invalid JSON context', 'error');
        setSimRunning(false);
        return;
      }

      const result = await callWorkflowFn('workflow-start', {
        slug: selectedWorkflow.slug,
        context: parsedCtx,
        test_mode: true,
      });

      setSimInstanceId(result.instance_id);
      setSimStatus('active');
      await refreshSimTasks(result.instance_id);
    } catch (err) {
      showToast('Start failed: ' + err.message, 'error');
    } finally {
      setSimRunning(false);
    }
  };

  const refreshSimTasks = async (instId) => {
    const id = instId || simInstanceId;
    if (!id) return;

    const { data: tasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('workflow_instance_id', id)
      .order('position', { ascending: true });
    setSimTasks(tasks || []);

    const { data: inst } = await supabase
      .from('workflow_instances')
      .select('status, context')
      .eq('id', id)
      .single();
    if (inst) {
      setSimStatus(inst.status);
      setSimInstanceContext(inst.context);
    }
  };

  const completeSimTask = async (taskId) => {
    setSimCompletingId(taskId);
    try {
      let payload = {};
      try {
        payload = JSON.parse(simPayloads[taskId] || '{}');
      } catch {
        showToast('Invalid JSON payload', 'error');
        setSimCompletingId(null);
        return;
      }

      // Include outcome if selected
      const outcomeKey = simOutcomeSelections[taskId];
      if (outcomeKey) {
        payload.outcome = outcomeKey;
      }

      await callWorkflowFn('workflow-complete-task', {
        task_id: taskId,
        payload,
      });

      await refreshSimTasks();
    } catch (err) {
      showToast('Complete failed: ' + err.message, 'error');
    } finally {
      setSimCompletingId(null);
    }
  };

  const cleanupSimulation = async () => {
    if (!simInstanceId) return;
    setSimCleaning(true);
    try {
      await callWorkflowFn('workflow-cleanup-test', {
        instance_id: simInstanceId,
      });
      resetSimulator();
      showToast('Simulation cleaned up');
    } catch (err) {
      showToast('Cleanup failed: ' + err.message, 'error');
    } finally {
      setSimCleaning(false);
    }
  };

  // Find outcomes for a step_key from the loaded outcomes map
  const getOutcomesForStepKey = (stepKey) => {
    const step = steps.find(s => s.step_key === stepKey);
    if (!step) return [];
    return outcomes[step.id] || [];
  };

  // ─── Guard: admin only ─────────────────────────────────────

  if (!isAdmin) {
    return (
      <div style={styles.page}>
        <p style={{ color: 'rgba(255,255,255,0.5)' }}>Admin access required.</p>
      </div>
    );
  }

  // ─── Determine if builder is editable ──────────────────────
  const isEditable = workflowForm?.source === 'data';

  // ─── Render ─────────────────────────────────────────────────

  return (
    <div style={styles.page}>
      {/* Toast */}
      {toast && (
        <div style={{
          ...styles.toast,
          background: toast.type === 'error' ? 'rgba(239,68,68,0.9)' : 'rgba(34,197,94,0.9)',
        }}>
          {toast.message}
        </div>
      )}

      <div style={styles.layout}>
        {/* ── Left Panel: Workflow List ── */}
        <div style={styles.leftPanel}>
          <div style={styles.listHeader}>
            <h2 style={styles.listTitle}>Workflows</h2>
            <button style={styles.newBtn} onClick={() => {
              setShowNewModal(true);
              setNewName('');
              setNewSlug('');
            }}>
              + New
            </button>
          </div>

          {listLoading ? (
            <div style={styles.listLoading}>
              <div style={styles.spinner} />
            </div>
          ) : workflows.length === 0 ? (
            <p style={styles.listEmpty}>No workflows yet</p>
          ) : (
            <div style={styles.listItems}>
              {workflows.map(wf => (
                <div
                  key={wf.id}
                  style={{
                    ...styles.listItem,
                    ...(selectedId === wf.id ? styles.listItemSelected : {}),
                  }}
                  onClick={() => setSelectedId(wf.id)}
                >
                  <div style={styles.listItemTop}>
                    <span style={styles.listItemName}>{wf.name}</span>
                    <button
                      style={{
                        ...styles.activeDot,
                        background: wf.is_active ? '#22c55e' : 'rgba(255,255,255,0.2)',
                      }}
                      onClick={(e) => { e.stopPropagation(); toggleActive(wf); }}
                      title={wf.is_active ? 'Active - click to deactivate' : 'Inactive - click to activate'}
                    />
                  </div>
                  <div style={styles.listItemBottom}>
                    <span style={{
                      ...styles.sourceBadge,
                      background: SOURCE_COLORS[wf.source]?.bg,
                      color: SOURCE_COLORS[wf.source]?.text,
                    }}>
                      {wf.source}
                    </span>
                    <span style={styles.slugText}>{wf.slug}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Right Panel: Builder Canvas ── */}
        <div style={styles.rightPanel}>
          {!selectedId ? (
            <div style={styles.emptyCanvas}>
              <p style={styles.emptyCanvasText}>Select a workflow to view or edit</p>
            </div>
          ) : builderLoading ? (
            <div style={styles.canvasLoading}>
              <div style={styles.spinner} />
            </div>
          ) : workflowForm ? (
            <div style={styles.canvas}>
              {/* ── Header Bar ── */}
              <div style={styles.canvasHeader}>
                <div style={styles.headerFields}>
                  <div style={styles.fieldGroup}>
                    <label style={styles.fieldLabel}>Name</label>
                    {isEditable ? (
                      <input
                        style={styles.headerInput}
                        value={workflowForm.name}
                        onChange={e => setWorkflowForm(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="Workflow name"
                      />
                    ) : (
                      <span style={styles.readonlyValue}>{workflowForm.name}</span>
                    )}
                  </div>

                  <div style={styles.fieldGroup}>
                    <label style={styles.fieldLabel}>Slug</label>
                    <span style={styles.readonlyValue}>{workflowForm.slug}</span>
                  </div>

                  <div style={styles.fieldGroup}>
                    <label style={styles.fieldLabel}>Trigger</label>
                    {isEditable ? (
                      <select
                        style={styles.headerSelect}
                        value={workflowForm.trigger_mode}
                        onChange={e => setWorkflowForm(prev => ({ ...prev, trigger_mode: e.target.value }))}
                      >
                        {TRIGGER_MODES.map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    ) : (
                      <span style={styles.readonlyValue}>{workflowForm.trigger_mode}</span>
                    )}
                  </div>

                  {(workflowForm.trigger_mode === 'auto' || workflowForm.trigger_mode === 'both') && isEditable && (
                    <>
                      <div style={styles.fieldGroup}>
                        <label style={styles.fieldLabel}>Entity type</label>
                        <input
                          style={styles.headerInput}
                          value={workflowForm.trigger_config?.entity_type || ''}
                          onChange={e => setWorkflowForm(prev => ({
                            ...prev,
                            trigger_config: { ...prev.trigger_config, entity_type: e.target.value },
                          }))}
                          placeholder="e.g. ad_read_proposals"
                        />
                      </div>
                      <div style={styles.fieldGroup}>
                        <label style={styles.fieldLabel}>Field condition</label>
                        <input
                          style={styles.headerInput}
                          value={workflowForm.trigger_config?.field_condition || ''}
                          onChange={e => setWorkflowForm(prev => ({
                            ...prev,
                            trigger_config: { ...prev.trigger_config, field_condition: e.target.value },
                          }))}
                          placeholder="e.g. status=pending"
                        />
                      </div>
                    </>
                  )}

                  <div style={styles.fieldGroup}>
                    <label style={styles.fieldLabel}>First step key</label>
                    {isEditable ? (
                      <select
                        style={styles.headerSelect}
                        value={workflowForm.first_step_key || ''}
                        onChange={e => setWorkflowForm(prev => ({ ...prev, first_step_key: e.target.value }))}
                      >
                        <option value="">-- select --</option>
                        {steps.map(s => (
                          <option key={s.id} value={s.step_key}>{s.step_key}</option>
                        ))}
                      </select>
                    ) : (
                      <span style={styles.readonlyValue}>{workflowForm.first_step_key || '(none)'}</span>
                    )}
                  </div>
                </div>

                <div style={styles.headerActions}>
                  {isEditable && (
                    <>
                      <button
                        style={styles.saveDraftBtn}
                        onClick={saveWorkflowHeader}
                        disabled={saving}
                      >
                        {saving ? 'Saving...' : 'Save Draft'}
                      </button>
                      <button
                        style={styles.publishBtn}
                        onClick={publishVersion}
                        disabled={publishing || steps.length === 0}
                      >
                        {publishing ? 'Publishing...' : 'Publish'}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {!isEditable && (
                <div style={styles.readonlyBanner}>
                  This is a code-sourced workflow. Steps are defined in server code and shown here for reference only.
                </div>
              )}

              {/* ── Step List ── */}
              <div style={styles.stepList}>
                {steps.map((step, idx) => {
                  const stepOutcomes = outcomes[step.id] || [];
                  const isConfirmingDelete = deleteConfirmStepId === step.id;
                  const hasFanOut = !!step.fan_out_context_key;

                  return (
                    <React.Fragment key={step.id}>
                      {/* Connector line */}
                      {idx > 0 && (
                        <div style={styles.connectorContainer}>
                          <div style={styles.connectorLine} />
                          {/* Show outcome labels from previous step */}
                          {(() => {
                            const prevStep = steps[idx - 1];
                            const prevOutcomes = outcomes[prevStep.id] || [];
                            const pointingHere = prevOutcomes.filter(o => o.next_step_key === step.step_key);
                            if (pointingHere.length === 0) return null;
                            return pointingHere.map(o => (
                              <span
                                key={o.id}
                                style={{
                                  ...styles.connectorLabel,
                                  color: OUTCOME_STYLE_COLORS[o.style || 'default']?.text,
                                  background: OUTCOME_STYLE_COLORS[o.style || 'default']?.bg,
                                  border: `1px solid ${OUTCOME_STYLE_COLORS[o.style || 'default']?.border}`,
                                }}
                              >
                                {o.label || o.outcome_key}
                              </span>
                            ));
                          })()}
                        </div>
                      )}

                      {/* Step card */}
                      <div style={{
                        ...styles.stepCard,
                        ...(workflowForm.first_step_key === step.step_key ? styles.stepCardFirst : {}),
                      }}>
                        <div style={styles.stepCardHeader}>
                          <span style={styles.stepIndex}>#{idx + 1}</span>
                          {workflowForm.first_step_key === step.step_key && (
                            <span style={styles.firstBadge}>START</span>
                          )}
                          {hasFanOut && (
                            <span style={styles.fanOutBadge}>FAN-OUT</span>
                          )}
                          {step.depends_on_step_keys && step.depends_on_step_keys.length > 0 && (
                            <span style={styles.fanInBadge}>FAN-IN</span>
                          )}
                        </div>

                        {/* Step key */}
                        <div style={styles.stepFieldRow}>
                          <label style={styles.stepFieldLabel}>Step key</label>
                          {isEditable ? (
                            <input
                              style={styles.stepInput}
                              value={step.step_key}
                              onChange={e => updateStep(step.id, { step_key: e.target.value })}
                              placeholder="unique_step_key"
                            />
                          ) : (
                            <span style={styles.stepReadonly}>{step.step_key}</span>
                          )}
                        </div>

                        {/* Title template */}
                        <div style={styles.stepFieldRow}>
                          <label style={styles.stepFieldLabel}>Title template</label>
                          {isEditable ? (
                            <input
                              style={styles.stepInput}
                              value={step.title_template}
                              onChange={e => updateStep(step.id, { title_template: e.target.value })}
                              placeholder="e.g. Review proposal: {{brand_name}}"
                            />
                          ) : (
                            <span style={styles.stepReadonly}>{step.title_template}</span>
                          )}
                        </div>

                        {/* Description template */}
                        <div style={styles.stepFieldRow}>
                          <label style={styles.stepFieldLabel}>Description</label>
                          {isEditable ? (
                            <input
                              style={styles.stepInput}
                              value={step.description_template || ''}
                              onChange={e => updateStep(step.id, { description_template: e.target.value || null })}
                              placeholder="Optional description template"
                            />
                          ) : (
                            <span style={styles.stepReadonly}>{step.description_template || '--'}</span>
                          )}
                        </div>

                        {/* Assignee */}
                        <div style={styles.stepFieldRow}>
                          <label style={styles.stepFieldLabel}>Assignee</label>
                          {isEditable ? (
                            <div style={styles.assigneeRow}>
                              <select
                                style={styles.stepSelectSmall}
                                value={step.assignee_type}
                                onChange={e => updateStep(step.id, { assignee_type: e.target.value })}
                              >
                                {ASSIGNEE_TYPES.map(t => (
                                  <option key={t} value={t}>{t === 'static' ? 'Static user' : 'From context'}</option>
                                ))}
                              </select>
                              <input
                                style={styles.stepInputFlex}
                                value={step.assignee_value || ''}
                                onChange={e => updateStep(step.id, { assignee_value: e.target.value })}
                                placeholder={step.assignee_type === 'static' ? 'User UUID' : 'Context key name'}
                              />
                            </div>
                          ) : (
                            <span style={styles.stepReadonly}>
                              {step.assignee_type}: {step.assignee_value || '(none)'}
                            </span>
                          )}
                        </div>

                        {/* Action */}
                        <div style={styles.stepFieldRow}>
                          <label style={styles.stepFieldLabel}>Action</label>
                          {isEditable ? (
                            <div style={styles.actionRow}>
                              <select
                                style={styles.stepSelectSmall}
                                value={step.action_type}
                                onChange={e => updateStep(step.id, { action_type: e.target.value })}
                              >
                                {ACTION_TYPES.map(t => (
                                  <option key={t} value={t}>{t}</option>
                                ))}
                              </select>
                              <input
                                style={styles.stepInputFlex}
                                value={step.action_label}
                                onChange={e => updateStep(step.id, { action_label: e.target.value })}
                                placeholder="Button label"
                              />
                            </div>
                          ) : (
                            <span style={styles.stepReadonly}>
                              {step.action_type}: {step.action_label}
                            </span>
                          )}
                        </div>

                        {/* Action config (for navigate/modal/custom) */}
                        {(step.action_type === 'navigate' || step.action_type === 'modal' || step.action_type === 'custom') && (
                          <div style={styles.stepFieldRow}>
                            <label style={styles.stepFieldLabel}>Action config</label>
                            {isEditable ? (
                              <textarea
                                style={styles.stepTextarea}
                                value={JSON.stringify(step.action_config || {}, null, 2)}
                                onChange={e => {
                                  try {
                                    const parsed = JSON.parse(e.target.value);
                                    updateStep(step.id, { action_config: parsed });
                                  } catch {
                                    // Let user continue typing; don't save invalid JSON
                                  }
                                }}
                                rows={3}
                                placeholder='{"tab": "deliverables"}'
                              />
                            ) : (
                              <pre style={styles.stepPre}>{JSON.stringify(step.action_config || {}, null, 2)}</pre>
                            )}
                          </div>
                        )}

                        {/* Fan-out toggle */}
                        {isEditable && (
                          <div style={styles.stepFieldRow}>
                            <label style={styles.stepFieldLabel}>Fan-out</label>
                            <div style={styles.checkboxRow}>
                              <input
                                type="checkbox"
                                checked={hasFanOut}
                                onChange={e => {
                                  if (e.target.checked) {
                                    updateStep(step.id, {
                                      fan_out_context_key: '',
                                      fan_out_title_template: '',
                                      fan_out_entity_type: '',
                                      fan_out_entity_id_key: 'id',
                                    });
                                  } else {
                                    updateStep(step.id, {
                                      fan_out_context_key: null,
                                      fan_out_title_template: null,
                                      fan_out_entity_type: null,
                                      fan_out_entity_id_key: null,
                                    });
                                  }
                                }}
                              />
                              <span style={styles.checkboxLabel}>Enable dynamic fan-out</span>
                            </div>
                          </div>
                        )}

                        {hasFanOut && (
                          <div style={styles.fanOutFields}>
                            <div style={styles.stepFieldRow}>
                              <label style={styles.stepFieldLabel}>Context key</label>
                              {isEditable ? (
                                <input
                                  style={styles.stepInput}
                                  value={step.fan_out_context_key || ''}
                                  onChange={e => updateStep(step.id, { fan_out_context_key: e.target.value })}
                                  placeholder="Array key in context"
                                />
                              ) : (
                                <span style={styles.stepReadonly}>{step.fan_out_context_key}</span>
                              )}
                            </div>
                            <div style={styles.stepFieldRow}>
                              <label style={styles.stepFieldLabel}>Title template</label>
                              {isEditable ? (
                                <input
                                  style={styles.stepInput}
                                  value={step.fan_out_title_template || ''}
                                  onChange={e => updateStep(step.id, { fan_out_title_template: e.target.value })}
                                  placeholder="Per-item title"
                                />
                              ) : (
                                <span style={styles.stepReadonly}>{step.fan_out_title_template}</span>
                              )}
                            </div>
                            <div style={styles.stepFieldRow}>
                              <label style={styles.stepFieldLabel}>Entity type</label>
                              {isEditable ? (
                                <input
                                  style={styles.stepInput}
                                  value={step.fan_out_entity_type || ''}
                                  onChange={e => updateStep(step.id, { fan_out_entity_type: e.target.value })}
                                  placeholder="e.g. deliverable"
                                />
                              ) : (
                                <span style={styles.stepReadonly}>{step.fan_out_entity_type}</span>
                              )}
                            </div>
                            <div style={styles.stepFieldRow}>
                              <label style={styles.stepFieldLabel}>Entity ID key</label>
                              {isEditable ? (
                                <input
                                  style={styles.stepInput}
                                  value={step.fan_out_entity_id_key || ''}
                                  onChange={e => updateStep(step.id, { fan_out_entity_id_key: e.target.value })}
                                  placeholder="id"
                                />
                              ) : (
                                <span style={styles.stepReadonly}>{step.fan_out_entity_id_key}</span>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Dependencies */}
                        <div style={styles.stepFieldRow}>
                          <label style={styles.stepFieldLabel}>Dependencies</label>
                          {isEditable ? (
                            <input
                              style={styles.stepInput}
                              value={(step.depends_on_step_keys || []).join(', ')}
                              onChange={e => {
                                const keys = e.target.value
                                  .split(',')
                                  .map(k => k.trim())
                                  .filter(Boolean);
                                updateStep(step.id, { depends_on_step_keys: keys });
                              }}
                              placeholder="Comma-separated step keys"
                            />
                          ) : (
                            <span style={styles.stepReadonly}>
                              {(step.depends_on_step_keys || []).join(', ') || '--'}
                            </span>
                          )}
                        </div>

                        {/* Condition expression */}
                        <div style={styles.stepFieldRow}>
                          <label style={styles.stepFieldLabel}>Condition</label>
                          {isEditable ? (
                            <input
                              style={styles.stepInput}
                              value={step.condition_expression || ''}
                              onChange={e => updateStep(step.id, { condition_expression: e.target.value || null })}
                              placeholder="e.g. has:campaign_id or eq:status:approved"
                            />
                          ) : (
                            <span style={styles.stepReadonly}>{step.condition_expression || '--'}</span>
                          )}
                        </div>

                        {/* On-complete handler */}
                        <div style={styles.stepFieldRow}>
                          <label style={styles.stepFieldLabel}>On-complete handler</label>
                          {isEditable ? (
                            <input
                              style={styles.stepInput}
                              value={step.on_complete_handler || ''}
                              onChange={e => updateStep(step.id, { on_complete_handler: e.target.value || null })}
                              placeholder="Action registry slug"
                            />
                          ) : (
                            <span style={styles.stepReadonly}>{step.on_complete_handler || '--'}</span>
                          )}
                        </div>

                        {/* Outcomes */}
                        <div style={styles.outcomesSection}>
                          <div style={styles.outcomesSectionHeader}>
                            <label style={styles.stepFieldLabel}>Outcomes</label>
                            {isEditable && (
                              <button style={styles.addOutcomeBtn} onClick={() => addOutcome(step.id)}>
                                + Add
                              </button>
                            )}
                          </div>

                          {stepOutcomes.length === 0 && (
                            <p style={styles.noOutcomes}>
                              No outcomes defined (step will end the workflow branch on completion)
                            </p>
                          )}

                          {stepOutcomes.map((oc, oi) => (
                            <div key={oc.id} style={styles.outcomeRow}>
                              <div style={styles.outcomeFields}>
                                {isEditable ? (
                                  <>
                                    <input
                                      style={styles.outcomeInput}
                                      value={oc.outcome_key}
                                      onChange={e => updateOutcome(oc.id, step.id, { outcome_key: e.target.value })}
                                      placeholder="outcome_key"
                                    />
                                    <input
                                      style={styles.outcomeInput}
                                      value={oc.label}
                                      onChange={e => updateOutcome(oc.id, step.id, { label: e.target.value })}
                                      placeholder="Label"
                                    />
                                    <input
                                      style={styles.outcomeInput}
                                      value={oc.next_step_key || ''}
                                      onChange={e => updateOutcome(oc.id, step.id, { next_step_key: e.target.value || null })}
                                      placeholder="Next step key"
                                    />
                                    <select
                                      style={styles.outcomeSelect}
                                      value={oc.style || 'default'}
                                      onChange={e => updateOutcome(oc.id, step.id, { style: e.target.value })}
                                    >
                                      {OUTCOME_STYLES.map(s => (
                                        <option key={s} value={s}>{s}</option>
                                      ))}
                                    </select>
                                    <button
                                      style={styles.outcomeDeleteBtn}
                                      onClick={() => deleteOutcome(oc.id, step.id)}
                                      title="Remove outcome"
                                    >
                                      x
                                    </button>
                                  </>
                                ) : (
                                  <div style={styles.outcomeReadonly}>
                                    <span style={{
                                      ...styles.outcomeKeyBadge,
                                      background: OUTCOME_STYLE_COLORS[oc.style || 'default']?.bg,
                                      color: OUTCOME_STYLE_COLORS[oc.style || 'default']?.text,
                                    }}>
                                      {oc.outcome_key}
                                    </span>
                                    <span style={styles.outcomeLabel}>{oc.label}</span>
                                    <span style={styles.outcomeArrow}>
                                      {oc.next_step_key ? `-> ${oc.next_step_key}` : '-> (end)'}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Delete step */}
                        {isEditable && (
                          <div style={styles.stepDeleteRow}>
                            {isConfirmingDelete ? (
                              <div style={styles.deleteConfirm}>
                                <span style={styles.deleteConfirmText}>Delete this step?</span>
                                <button
                                  style={styles.deleteConfirmYes}
                                  onClick={() => deleteStep(step.id)}
                                >
                                  Yes, delete
                                </button>
                                <button
                                  style={styles.deleteConfirmNo}
                                  onClick={() => setDeleteConfirmStepId(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                style={styles.deleteStepBtn}
                                onClick={() => setDeleteConfirmStepId(step.id)}
                              >
                                Delete step
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </React.Fragment>
                  );
                })}

                {/* Add step button */}
                {isEditable && (
                  <button style={styles.addStepBtn} onClick={addStep}>
                    + Add Step
                  </button>
                )}
              </div>

              {/* ── Version History ── */}
              <div style={styles.sectionContainer}>
                <button
                  style={styles.sectionToggle}
                  onClick={() => setShowVersions(!showVersions)}
                >
                  <span>Version History ({versions.length})</span>
                  <span style={styles.chevron}>{showVersions ? '\u25B2' : '\u25BC'}</span>
                </button>

                {showVersions && (
                  <div style={styles.versionList}>
                    {versions.length === 0 ? (
                      <p style={styles.noVersions}>No published versions yet</p>
                    ) : versions.map(v => {
                      const isCurrent = selectedWorkflow?.current_version_id === v.id;
                      return (
                        <div key={v.id} style={{
                          ...styles.versionRow,
                          ...(isCurrent ? styles.versionRowCurrent : {}),
                        }}>
                          <div style={styles.versionInfo}>
                            <span style={styles.versionNum}>v{v.version_number}</span>
                            {isCurrent && <span style={styles.currentBadge}>CURRENT</span>}
                            <span style={styles.versionDate}>{formatDate(v.published_at)}</span>
                          </div>
                          {!isCurrent && (
                            <button
                              style={styles.rollbackBtn}
                              onClick={() => rollbackToVersion(v)}
                            >
                              Rollback
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ── Simulator ── */}
              <div style={styles.sectionContainer}>
                <button
                  style={styles.sectionToggle}
                  onClick={() => setShowSimulator(!showSimulator)}
                >
                  <span>Simulator</span>
                  <span style={styles.chevron}>{showSimulator ? '\u25B2' : '\u25BC'}</span>
                </button>

                {showSimulator && (
                  <div style={styles.simPanel}>
                    {!simInstanceId ? (
                      /* Pre-start config */
                      <div style={styles.simConfig}>
                        <label style={styles.fieldLabel}>Initial context (JSON)</label>
                        <textarea
                          style={styles.simContextInput}
                          value={simContext}
                          onChange={e => setSimContext(e.target.value)}
                          rows={5}
                          placeholder="{}"
                        />
                        <button
                          style={styles.simStartBtn}
                          onClick={startSimulation}
                          disabled={simRunning}
                        >
                          {simRunning ? 'Starting...' : 'Start Simulation'}
                        </button>
                      </div>
                    ) : (
                      /* Running simulation */
                      <div style={styles.simRunning}>
                        <div style={styles.simStatusBar}>
                          <span style={styles.simStatusLabel}>
                            Status: <span style={{ color: SIM_STATUS_COLORS[simStatus] || '#fff', fontWeight: 700 }}>
                              {simStatus}
                            </span>
                          </span>
                          <span style={styles.simStatusLabel}>
                            Steps: {simTasks.length}
                          </span>
                          <button
                            style={styles.simRefreshBtn}
                            onClick={() => refreshSimTasks()}
                          >
                            Refresh
                          </button>
                        </div>

                        {/* Task timeline */}
                        <div style={styles.simTimeline}>
                          {simTasks.map((task, ti) => {
                            const taskOutcomes = getOutcomesForStepKey(task.step_key);
                            const isActive = task.status === 'active';
                            const isComplete = task.status === 'complete';
                            const isCompleting = simCompletingId === task.id;

                            return (
                              <div key={task.id} style={styles.simTaskCard}>
                                <div style={styles.simTaskHeader}>
                                  <span style={{
                                    ...styles.simTaskDot,
                                    background: SIM_STATUS_COLORS[task.status] || 'rgba(255,255,255,0.3)',
                                  }} />
                                  <span style={styles.simTaskKey}>{task.step_key}</span>
                                  <span style={{
                                    ...styles.simTaskStatus,
                                    color: SIM_STATUS_COLORS[task.status],
                                  }}>
                                    {task.status}
                                  </span>
                                </div>

                                <div style={styles.simTaskTitle}>{task.title}</div>

                                {task.assignee_id && (
                                  <div style={styles.simTaskAssignee}>
                                    Assignee: {task.assignee_id.substring(0, 8)}...
                                  </div>
                                )}

                                {isComplete && task.completion_payload && Object.keys(task.completion_payload).length > 0 && (
                                  <pre style={styles.simPayloadPreview}>
                                    {JSON.stringify(task.completion_payload, null, 2)}
                                  </pre>
                                )}

                                {isActive && (
                                  <div style={styles.simTaskActions}>
                                    {/* Outcome selector */}
                                    {taskOutcomes.length > 0 && (
                                      <div style={styles.simOutcomeSelector}>
                                        <label style={styles.simSmallLabel}>Outcome:</label>
                                        <select
                                          style={styles.simOutcomeSelect}
                                          value={simOutcomeSelections[task.id] || ''}
                                          onChange={e => setSimOutcomeSelections(prev => ({
                                            ...prev,
                                            [task.id]: e.target.value,
                                          }))}
                                        >
                                          <option value="">-- select outcome --</option>
                                          {taskOutcomes.map(o => (
                                            <option key={o.id} value={o.outcome_key}>
                                              {o.label || o.outcome_key}
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                    )}

                                    {/* Payload editor */}
                                    <div style={styles.simPayloadEditor}>
                                      <label style={styles.simSmallLabel}>Payload (JSON):</label>
                                      <textarea
                                        style={styles.simPayloadInput}
                                        value={simPayloads[task.id] || '{}'}
                                        onChange={e => setSimPayloads(prev => ({
                                          ...prev,
                                          [task.id]: e.target.value,
                                        }))}
                                        rows={2}
                                      />
                                    </div>

                                    <button
                                      style={styles.simCompleteBtn}
                                      onClick={() => completeSimTask(task.id)}
                                      disabled={isCompleting}
                                    >
                                      {isCompleting ? 'Completing...' : 'Complete'}
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* Context after steps */}
                        {simInstanceContext && (
                          <div style={styles.simContextSection}>
                            <label style={styles.simSmallLabel}>Instance context:</label>
                            <pre style={styles.simContextPreview}>
                              {JSON.stringify(simInstanceContext, null, 2)}
                            </pre>
                          </div>
                        )}

                        {/* Result summary */}
                        {simStatus === 'complete' && (
                          <div style={styles.simResultSummary}>
                            <span style={styles.simResultIcon}>Done</span>
                            <span style={styles.simResultText}>
                              Workflow complete. {simTasks.length} step{simTasks.length !== 1 ? 's' : ''} executed.
                            </span>
                          </div>
                        )}

                        {/* Cleanup button */}
                        <button
                          style={styles.simCleanupBtn}
                          onClick={cleanupSimulation}
                          disabled={simCleaning}
                        >
                          {simCleaning ? 'Cleaning up...' : 'Cancel & Cleanup'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* ── New Workflow Modal ── */}
      {showNewModal && (
        <div style={styles.modalOverlay} onClick={() => setShowNewModal(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>New Workflow</h3>
            <div style={styles.modalField}>
              <label style={styles.fieldLabel}>Name</label>
              <input
                style={styles.modalInput}
                value={newName}
                onChange={e => {
                  setNewName(e.target.value);
                  setNewSlug(slugify(e.target.value));
                }}
                placeholder="My Workflow"
                autoFocus
              />
            </div>
            <div style={styles.modalField}>
              <label style={styles.fieldLabel}>Slug</label>
              <input
                style={styles.modalInput}
                value={newSlug}
                onChange={e => setNewSlug(e.target.value)}
                placeholder="my_workflow"
              />
              <p style={styles.modalHint}>Unique identifier. Cannot be changed after creation.</p>
            </div>
            <div style={styles.modalActions}>
              <button style={styles.cancelBtn} onClick={() => setShowNewModal(false)}>
                Cancel
              </button>
              <button
                style={styles.createBtn}
                onClick={handleCreateWorkflow}
                disabled={!newName.trim() || !newSlug.trim()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────

const styles = {
  page: {
    padding: '24px 32px',
    minHeight: '100vh',
    position: 'relative',
  },

  // Toast
  toast: {
    position: 'fixed',
    top: 20,
    right: 20,
    padding: '10px 20px',
    borderRadius: 8,
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    zIndex: 9999,
    boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
  },

  // Layout
  layout: {
    display: 'flex',
    gap: 24,
    minHeight: 'calc(100vh - 100px)',
  },

  // Left panel
  leftPanel: {
    width: 300,
    minWidth: 300,
    borderRight: '1px solid rgba(255,255,255,0.06)',
    paddingRight: 24,
    display: 'flex',
    flexDirection: 'column',
  },
  listHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  listTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: '#fff',
    margin: 0,
  },
  newBtn: {
    background: '#6366f1',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  listLoading: {
    display: 'flex',
    justifyContent: 'center',
    padding: 40,
  },
  spinner: {
    width: 22,
    height: 22,
    border: '2px solid rgba(255,255,255,0.1)',
    borderTopColor: '#6366f1',
    borderRadius: '50%',
    animation: 'spin 0.6s linear infinite',
  },
  listEmpty: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 13,
    textAlign: 'center',
    padding: 20,
  },
  listItems: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  listItem: {
    padding: '10px 12px',
    borderRadius: 8,
    cursor: 'pointer',
    border: '1px solid transparent',
    transition: 'background 0.15s',
  },
  listItemSelected: {
    background: 'rgba(99,102,241,0.1)',
    border: '1px solid rgba(99,102,241,0.3)',
  },
  listItemTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  listItemName: {
    fontSize: 14,
    fontWeight: 600,
    color: '#fff',
  },
  activeDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    border: 'none',
    cursor: 'pointer',
    flexShrink: 0,
  },
  listItemBottom: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  sourceBadge: {
    fontSize: 10,
    fontWeight: 700,
    padding: '1px 6px',
    borderRadius: 3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  slugText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.3)',
    fontFamily: 'monospace',
  },

  // Right panel
  rightPanel: {
    flex: 1,
    minWidth: 0,
  },
  emptyCanvas: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: 400,
  },
  emptyCanvasText: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 14,
  },
  canvasLoading: {
    display: 'flex',
    justifyContent: 'center',
    padding: 60,
  },

  // Canvas
  canvas: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },

  // Canvas header
  canvasHeader: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 10,
    padding: '16px 20px',
  },
  headerFields: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 16,
    marginBottom: 12,
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    minWidth: 140,
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  headerInput: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 5,
    padding: '6px 10px',
    color: '#fff',
    fontSize: 13,
    outline: 'none',
    minWidth: 140,
  },
  headerSelect: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 5,
    padding: '6px 10px',
    color: '#fff',
    fontSize: 13,
    outline: 'none',
    minWidth: 100,
  },
  readonlyValue: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    padding: '6px 0',
  },
  headerActions: {
    display: 'flex',
    gap: 8,
    justifyContent: 'flex-end',
  },
  saveDraftBtn: {
    background: 'rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.7)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    padding: '7px 16px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  publishBtn: {
    background: '#6366f1',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '7px 16px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },

  readonlyBanner: {
    background: 'rgba(234,179,8,0.08)',
    border: '1px solid rgba(234,179,8,0.2)',
    borderRadius: 8,
    padding: '10px 16px',
    fontSize: 12,
    color: '#eab308',
    fontWeight: 500,
  },

  // Step list
  stepList: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
  },

  // Connector
  connectorContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '4px 0',
    position: 'relative',
  },
  connectorLine: {
    width: 2,
    height: 24,
    background: 'rgba(99,102,241,0.3)',
  },
  connectorLabel: {
    fontSize: 10,
    fontWeight: 600,
    padding: '1px 6px',
    borderRadius: 3,
    marginTop: 2,
  },

  // Step card
  stepCard: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 10,
    padding: '16px 20px',
  },
  stepCardFirst: {
    borderLeft: '3px solid #6366f1',
  },
  stepCardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  stepIndex: {
    fontSize: 12,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.3)',
  },
  firstBadge: {
    fontSize: 9,
    fontWeight: 800,
    color: '#6366f1',
    background: 'rgba(99,102,241,0.15)',
    padding: '2px 6px',
    borderRadius: 3,
    letterSpacing: 0.5,
  },
  fanOutBadge: {
    fontSize: 9,
    fontWeight: 800,
    color: '#f59e0b',
    background: 'rgba(245,158,11,0.1)',
    padding: '2px 6px',
    borderRadius: 3,
    letterSpacing: 0.5,
  },
  fanInBadge: {
    fontSize: 9,
    fontWeight: 800,
    color: '#8b5cf6',
    background: 'rgba(139,92,246,0.1)',
    padding: '2px 6px',
    borderRadius: 3,
    letterSpacing: 0.5,
  },

  // Step fields
  stepFieldRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 8,
  },
  stepFieldLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.4)',
    minWidth: 110,
    paddingTop: 7,
    flexShrink: 0,
  },
  stepInput: {
    flex: 1,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 5,
    padding: '6px 10px',
    color: '#fff',
    fontSize: 12,
    outline: 'none',
    fontFamily: 'inherit',
  },
  stepInputFlex: {
    flex: 1,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 5,
    padding: '6px 10px',
    color: '#fff',
    fontSize: 12,
    outline: 'none',
    fontFamily: 'inherit',
  },
  stepSelectSmall: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 5,
    padding: '6px 8px',
    color: '#fff',
    fontSize: 12,
    outline: 'none',
    minWidth: 100,
  },
  stepReadonly: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    padding: '6px 0',
    fontFamily: 'monospace',
    flex: 1,
  },
  stepTextarea: {
    flex: 1,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 5,
    padding: '6px 10px',
    color: '#fff',
    fontSize: 12,
    outline: 'none',
    fontFamily: 'monospace',
    resize: 'vertical',
  },
  stepPre: {
    flex: 1,
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    fontFamily: 'monospace',
    margin: 0,
    padding: '6px 0',
    whiteSpace: 'pre-wrap',
  },

  // Assignee and action inline rows
  assigneeRow: {
    flex: 1,
    display: 'flex',
    gap: 8,
  },
  actionRow: {
    flex: 1,
    display: 'flex',
    gap: 8,
  },

  // Checkbox
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    paddingTop: 5,
  },
  checkboxLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
  },

  // Fan-out fields
  fanOutFields: {
    marginLeft: 122,
    marginBottom: 8,
    paddingLeft: 12,
    borderLeft: '2px solid rgba(245,158,11,0.2)',
  },

  // Outcomes
  outcomesSection: {
    marginTop: 8,
    padding: '10px 0 4px',
    borderTop: '1px solid rgba(255,255,255,0.04)',
  },
  outcomesSectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  addOutcomeBtn: {
    background: 'rgba(99,102,241,0.1)',
    color: '#818cf8',
    border: '1px solid rgba(99,102,241,0.2)',
    borderRadius: 4,
    padding: '3px 10px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
  },
  noOutcomes: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.25)',
    fontStyle: 'italic',
    margin: '0 0 4px',
  },
  outcomeRow: {
    marginBottom: 6,
  },
  outcomeFields: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  outcomeInput: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 4,
    padding: '5px 8px',
    color: '#fff',
    fontSize: 11,
    outline: 'none',
    minWidth: 80,
    flex: 1,
  },
  outcomeSelect: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 4,
    padding: '5px 6px',
    color: '#fff',
    fontSize: 11,
    outline: 'none',
    minWidth: 70,
  },
  outcomeDeleteBtn: {
    background: 'rgba(239,68,68,0.1)',
    color: '#ef4444',
    border: '1px solid rgba(239,68,68,0.2)',
    borderRadius: 4,
    padding: '4px 8px',
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
    flexShrink: 0,
  },
  outcomeReadonly: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  outcomeKeyBadge: {
    fontSize: 10,
    fontWeight: 700,
    padding: '2px 6px',
    borderRadius: 3,
  },
  outcomeLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
  },
  outcomeArrow: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.3)',
    fontFamily: 'monospace',
  },

  // Delete step
  stepDeleteRow: {
    marginTop: 10,
    paddingTop: 8,
    borderTop: '1px solid rgba(255,255,255,0.04)',
    display: 'flex',
    justifyContent: 'flex-end',
  },
  deleteStepBtn: {
    background: 'none',
    color: 'rgba(239,68,68,0.6)',
    border: 'none',
    fontSize: 11,
    cursor: 'pointer',
    padding: '4px 8px',
  },
  deleteConfirm: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  deleteConfirmText: {
    fontSize: 12,
    color: '#ef4444',
    fontWeight: 600,
  },
  deleteConfirmYes: {
    background: 'rgba(239,68,68,0.15)',
    color: '#ef4444',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 4,
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
  },
  deleteConfirmNo: {
    background: 'rgba(255,255,255,0.05)',
    color: 'rgba(255,255,255,0.5)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 4,
    padding: '4px 10px',
    fontSize: 11,
    cursor: 'pointer',
  },

  // Add step button
  addStepBtn: {
    marginTop: 12,
    background: 'rgba(99,102,241,0.08)',
    color: '#818cf8',
    border: '1px dashed rgba(99,102,241,0.3)',
    borderRadius: 8,
    padding: '12px 20px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    textAlign: 'center',
  },

  // Section containers
  sectionContainer: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 10,
    overflow: 'hidden',
  },
  sectionToggle: {
    width: '100%',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: 'none',
    border: 'none',
    padding: '12px 20px',
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    textAlign: 'left',
  },
  chevron: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.3)',
  },

  // Version list
  versionList: {
    padding: '0 20px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  noVersions: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.25)',
    fontStyle: 'italic',
    margin: 0,
  },
  versionRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    borderRadius: 6,
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.04)',
  },
  versionRowCurrent: {
    border: '1px solid rgba(99,102,241,0.3)',
    background: 'rgba(99,102,241,0.05)',
  },
  versionInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  versionNum: {
    fontSize: 13,
    fontWeight: 700,
    color: '#fff',
    fontFamily: 'monospace',
  },
  currentBadge: {
    fontSize: 9,
    fontWeight: 800,
    color: '#6366f1',
    background: 'rgba(99,102,241,0.15)',
    padding: '2px 6px',
    borderRadius: 3,
    letterSpacing: 0.5,
  },
  versionDate: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.3)',
  },
  rollbackBtn: {
    background: 'rgba(255,255,255,0.05)',
    color: 'rgba(255,255,255,0.5)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 5,
    padding: '4px 10px',
    fontSize: 11,
    cursor: 'pointer',
  },

  // Simulator
  simPanel: {
    padding: '0 20px 20px',
  },
  simConfig: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  simContextInput: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 6,
    padding: '10px 12px',
    color: '#fff',
    fontSize: 12,
    fontFamily: 'monospace',
    outline: 'none',
    resize: 'vertical',
  },
  simStartBtn: {
    background: '#6366f1',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '10px 20px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    alignSelf: 'flex-start',
  },

  // Sim running
  simRunning: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  simStatusBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '8px 12px',
    background: 'rgba(255,255,255,0.02)',
    borderRadius: 6,
  },
  simStatusLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
  },
  simRefreshBtn: {
    marginLeft: 'auto',
    background: 'rgba(255,255,255,0.05)',
    color: 'rgba(255,255,255,0.5)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 4,
    padding: '4px 10px',
    fontSize: 11,
    cursor: 'pointer',
  },

  // Sim timeline
  simTimeline: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  simTaskCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 8,
    padding: '12px 16px',
  },
  simTaskHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  simTaskDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
  simTaskKey: {
    fontSize: 12,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.7)',
    fontFamily: 'monospace',
  },
  simTaskStatus: {
    fontSize: 10,
    fontWeight: 700,
    marginLeft: 'auto',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  simTaskTitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: 4,
  },
  simTaskAssignee: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.25)',
    fontFamily: 'monospace',
  },
  simPayloadPreview: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.3)',
    fontFamily: 'monospace',
    background: 'rgba(0,0,0,0.2)',
    borderRadius: 4,
    padding: '4px 8px',
    margin: '4px 0 0',
    whiteSpace: 'pre-wrap',
    maxHeight: 80,
    overflow: 'auto',
  },

  // Sim task actions
  simTaskActions: {
    marginTop: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  simOutcomeSelector: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  simSmallLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.35)',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  simOutcomeSelect: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 4,
    padding: '4px 8px',
    color: '#fff',
    fontSize: 11,
    outline: 'none',
    flex: 1,
  },
  simPayloadEditor: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  simPayloadInput: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 4,
    padding: '6px 8px',
    color: '#fff',
    fontSize: 11,
    fontFamily: 'monospace',
    outline: 'none',
    resize: 'vertical',
  },
  simCompleteBtn: {
    background: '#22c55e',
    color: '#fff',
    border: 'none',
    borderRadius: 5,
    padding: '7px 16px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    alignSelf: 'flex-start',
  },

  // Sim context section
  simContextSection: {
    marginTop: 4,
  },
  simContextPreview: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.3)',
    fontFamily: 'monospace',
    background: 'rgba(0,0,0,0.2)',
    borderRadius: 4,
    padding: '8px 10px',
    margin: '4px 0 0',
    whiteSpace: 'pre-wrap',
    maxHeight: 150,
    overflow: 'auto',
  },

  // Sim result
  simResultSummary: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 14px',
    background: 'rgba(34,197,94,0.08)',
    border: '1px solid rgba(34,197,94,0.2)',
    borderRadius: 6,
  },
  simResultIcon: {
    fontSize: 12,
    fontWeight: 800,
    color: '#22c55e',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  simResultText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
  },

  // Sim cleanup
  simCleanupBtn: {
    background: 'rgba(239,68,68,0.1)',
    color: '#ef4444',
    border: '1px solid rgba(239,68,68,0.2)',
    borderRadius: 6,
    padding: '8px 16px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    alignSelf: 'flex-start',
  },

  // Modal
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  modal: {
    background: '#1a1a2e',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 12,
    padding: '24px 28px',
    width: 420,
    maxWidth: '90vw',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: '#fff',
    margin: '0 0 16px',
  },
  modalField: {
    marginBottom: 14,
  },
  modalInput: {
    width: '100%',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    padding: '8px 12px',
    color: '#fff',
    fontSize: 14,
    outline: 'none',
    marginTop: 4,
    boxSizing: 'border-box',
  },
  modalHint: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.3)',
    margin: '4px 0 0',
    fontStyle: 'italic',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 20,
  },
  cancelBtn: {
    background: 'rgba(255,255,255,0.05)',
    color: 'rgba(255,255,255,0.6)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    padding: '8px 16px',
    fontSize: 13,
    cursor: 'pointer',
  },
  createBtn: {
    background: '#6366f1',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
};
