import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import SprintGoals from './SprintGoals';
import SprintRetroModal from './SprintRetroModal';
import VelocityChart from './VelocityChart';

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
  const [goals, setGoals] = useState([]);
  const [pastSprints, setPastSprints] = useState([]);
  const [sprintTasks, setSprintTasks] = useState({ total: 0, completed: 0 });
  const [loading, setLoading] = useState(true);
  const [showRetro, setShowRetro] = useState(false);
  const [closeResult, setCloseResult] = useState(null);

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

  // ── Fetch goals for active sprint ──
  const fetchGoals = useCallback(async () => {
    if (!activeSprint) { setGoals([]); return; }
    const { data, error } = await supabase
      .from('sprint_goals')
      .select('*')
      .eq('sprint_id', activeSprint.id)
      .order('position');
    if (!error) setGoals(data || []);
  }, [activeSprint]);

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
        completed: data.filter(t => t.status === 'done').reduce((sum, t) => sum + pts(t), 0),
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

  useEffect(() => { fetchActiveSprint(); fetchPastSprints(); }, [fetchActiveSprint, fetchPastSprints]);
  useEffect(() => { fetchGoals(); fetchSprintTasks(); }, [fetchGoals, fetchSprintTasks]);
  useEffect(() => { if (boardVersion > 0) fetchSprintTasks(); }, [boardVersion, fetchSprintTasks]);

  // ── Start sprint ──
  async function startSprint() {
    if (!profile?.id) return;
    const week = getSprintWeek();
    const { error } = await supabase.from('sprints').insert({
      user_id: profile.id,
      start_date: week.start,
      end_date: week.end,
      status: 'active',
    });
    if (!error) {
      fetchActiveSprint();
    }
  }

  // ── Complete sprint ──
  async function completeSprint() {
    if (!activeSprint) return;

    // Get all sprint tasks
    const { data: tasks } = await supabase
      .from('personal_tasks')
      .select('id, status, priority')
      .eq('sprint_id', activeSprint.id);

    const pts = (t) => parseInt(t.priority) || 0;
    const completedPoints = (tasks || []).filter(t => t.status === 'done').reduce((sum, t) => sum + pts(t), 0);
    const completedCount = (tasks || []).filter(t => t.status === 'done').length;
    const incompleteTasks = (tasks || []).filter(t => t.status !== 'done');

    // Update sprint: set velocity (points) and complete
    await supabase
      .from('sprints')
      .update({ status: 'completed', velocity: completedPoints, updated_at: new Date().toISOString() })
      .eq('id', activeSprint.id);

    // Roll incomplete tasks back to backlog
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
    setActiveSprint(null);
    fetchActiveSprint();
    fetchPastSprints();
  }

  // Check if sprint is overdue
  const isOverdue = activeSprint && new Date(activeSprint.end_date + 'T23:59:59') < new Date();

  if (loading) return null;

  return (
    <div style={panelStyle}>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: activeSprint ? '16px' : '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '1px' }}>
            {activeSprint ? 'Current Sprint' : 'Sprint Planning'}
          </span>
          {activeSprint && isOverdue && (
            <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(245,158,11,0.15)', color: '#f59e0b', fontWeight: 600 }}>
              Overdue
            </span>
          )}
        </div>
        {activeSprint ? (
          <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>
            {fmtDate(activeSprint.start_date)} – {fmtDate(activeSprint.end_date)}
          </span>
        ) : (
          <button onClick={startSprint} style={startBtnStyle}>
            Start Sprint
          </button>
        )}
      </div>

      {/* Active sprint content */}
      {activeSprint && (
        <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
          {/* Left: Goals */}
          <div style={{ flex: '1 1 220px', minWidth: '200px' }}>
            <SprintGoals goals={goals} sprintId={activeSprint.id} onUpdate={fetchGoals} />
          </div>

          {/* Right: Progress + complete */}
          <div style={{ flex: '1 1 200px', minWidth: '180px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
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
            <button onClick={completeSprint} style={completeBtnStyle}>
              Complete Sprint
            </button>
          </div>
        </div>
      )}

      {/* Velocity chart */}
      {pastSprints.length > 0 && (
        <div style={{ marginTop: activeSprint ? '16px' : '0', paddingTop: activeSprint ? '14px' : '0', borderTop: activeSprint ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>
            Velocity
          </div>
          <VelocityChart sprints={pastSprints} />
        </div>
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

const panelStyle = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: '14px',
  padding: '20px',
  marginBottom: '24px',
};

const startBtnStyle = {
  background: '#6366f1',
  color: '#fff',
  border: 'none',
  borderRadius: '8px',
  padding: '8px 18px',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
};

const completeBtnStyle = {
  background: 'rgba(34,197,94,0.12)',
  color: '#22c55e',
  border: '1px solid rgba(34,197,94,0.2)',
  borderRadius: '8px',
  padding: '8px 16px',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
  alignSelf: 'flex-start',
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
