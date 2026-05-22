import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import VelocityChart from './VelocityChart';
import SprintGoals from './SprintGoals';

function getSprintWeek(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    start: monday.toISOString().split('T')[0],
    end: sunday.toISOString().split('T')[0],
  };
}

function fmtDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function SprintPanel({ profile, boardVersion, onSprintChange }) {
  const [activeSprint, setActiveSprint] = useState(null);
  const [sprintTasks, setSprintTasks] = useState({ total: 0, completed: 0 });
  const [pastSprints, setPastSprints] = useState([]);
  const [sprintGoals, setSprintGoals] = useState([]);
  const [loading, setLoading] = useState(true);

  // ── Fetch active sprint ──
  const fetchActiveSprint = useCallback(async () => {
    if (!profile?.id) return;
    const { data, error } = await supabase
      .from('sprints')
      .select('*')
      .eq('user_id', profile.id)
      .eq('status', 'active')
      .maybeSingle();
    if (!error) setActiveSprint(data);
    setLoading(false);
  }, [profile?.id]);

  // ── Fetch sprint task points ──
  const fetchSprintTasks = useCallback(async () => {
    if (!activeSprint) { setSprintTasks({ total: 0, completed: 0 }); return; }
    const { data, error } = await supabase
      .from('personal_tasks')
      .select('id, status, priority')
      .eq('sprint_id', activeSprint.id);
    if (!error && data) {
      const pts = (t) => parseInt(t.priority) || 0;
      setSprintTasks({
        total: data.reduce((sum, t) => sum + pts(t), 0),
        completed: data.filter(t => t.status === 'done' || t.status === 'archived').reduce((sum, t) => sum + pts(t), 0),
      });
    }
  }, [activeSprint]);

  // ── Fetch past sprints for velocity chart ──
  const fetchPastSprints = useCallback(async () => {
    if (!profile?.id) return;
    const { data, error } = await supabase
      .from('sprints')
      .select('id, start_date, velocity')
      .eq('user_id', profile.id)
      .eq('status', 'completed')
      .not('velocity', 'is', null)
      .order('start_date', { ascending: true })
      .limit(8);
    if (!error) setPastSprints(data || []);
  }, [profile?.id]);

  // ── Fetch sprint goals ──
  const fetchSprintGoals = useCallback(async () => {
    if (!activeSprint) { setSprintGoals([]); return; }
    const { data, error } = await supabase
      .from('sprint_goals')
      .select('*')
      .eq('sprint_id', activeSprint.id)
      .order('position');
    if (!error) setSprintGoals(data || []);
  }, [activeSprint]);

  useEffect(() => { fetchActiveSprint(); fetchPastSprints(); }, [fetchActiveSprint, fetchPastSprints]);
  useEffect(() => { fetchSprintTasks(); fetchSprintGoals(); }, [fetchSprintTasks, fetchSprintGoals]);
  useEffect(() => { if (boardVersion > 0) { fetchSprintTasks(); fetchActiveSprint(); fetchPastSprints(); fetchSprintGoals(); } }, [boardVersion, fetchSprintTasks, fetchActiveSprint, fetchPastSprints, fetchSprintGoals]);

  if (loading) return null;

  // If no active sprint and no past sprints, hide the panel entirely
  if (!activeSprint && pastSprints.length === 0) return null;

  return (
    <div style={rowStyle}>
      {/* Left: Sprint Summary */}
      <div style={summaryPanelStyle}>
        {/* Header row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '1px' }}>
            Sprint Summary
          </span>
          {activeSprint && (
            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>
              {fmtDate(activeSprint.start_date)} – {fmtDate(activeSprint.end_date)}
            </span>
          )}
        </div>

        {/* Active sprint progress */}
        {activeSprint && (
          <div style={{ marginBottom: pastSprints.length > 0 ? '14px' : '0' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
              Progress
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={progressTrackStyle}>
                <div style={{
                  ...progressFillStyle,
                  width: sprintTasks.total > 0 ? `${(sprintTasks.completed / sprintTasks.total) * 100}%` : '0%',
                }} />
              </div>
              <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap' }}>
                {sprintTasks.completed}/{sprintTasks.total} pts
              </span>
            </div>
          </div>
        )}

        {/* Velocity chart */}
        {pastSprints.length > 0 && (
          <div style={{ paddingTop: activeSprint ? '14px' : '0', borderTop: activeSprint ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>
              Velocity
            </div>
            <VelocityChart sprints={pastSprints} />
          </div>
        )}
      </div>

      {/* Right: Sprint Goals */}
      {activeSprint && (
        <div style={goalsPanelStyle}>
          <SprintGoals goals={sprintGoals} sprintId={activeSprint.id} onUpdate={fetchSprintGoals} />
        </div>
      )}
    </div>
  );
}

const rowStyle = {
  display: 'flex',
  gap: '20px',
  marginBottom: '24px',
};

const summaryPanelStyle = {
  flex: 1,
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: '14px',
  padding: '20px',
  minWidth: 0,
};

const goalsPanelStyle = {
  flex: 1,
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: '14px',
  padding: '20px',
};

const progressTrackStyle = {
  flex: 1,
  height: '8px',
  background: 'rgba(255,255,255,0.08)',
  borderRadius: '4px',
  overflow: 'hidden',
};

const progressFillStyle = {
  height: '100%',
  background: '#6366f1',
  borderRadius: '4px',
  transition: 'width 0.3s ease',
};
