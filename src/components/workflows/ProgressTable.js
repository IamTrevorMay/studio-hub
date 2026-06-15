import React from 'react';

// Workflows-page Progress table. Used twice:
//   1. Main view, with all team + contractor profiles.
//   2. Drilled-into-a-workflow view, filtered to the people who actually
//      have tasks tied to that workflow's instances.
//
// Props:
//   - groups: [{ key, label, profiles, byAssignee }] — each group renders
//     under its own divider row. byAssignee[id] = { pending: [], done: [] }
//   - onTaskClick(task, person, groupKey) — fired when a pending/done
//     row's title is clicked. Mirror rows (id starts with "progress-")
//     are skipped (no underlying tasks row to edit).
//   - showHeader: when true, wrap in the rounded card + Progress h2
//     (matches the main view). Set false when the parent already supplies
//     a section header.

function fmtSnoozeEnd(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  if (diffMs <= 0) return 'now';
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `til ${time}`;
  if (isTomorrow) return `til tmrw ${time}`;
  const within7 = diffMs < 7 * 24 * 3600 * 1000;
  if (within7) return `til ${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
  return `til ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}

const tdBase = { padding: '10px 12px', verticalAlign: 'top', borderBottom: '1px solid rgba(255,255,255,0.04)' };

export default function ProgressTable({ groups, onTaskClick, showHeader = true }) {
  const visibleGroups = (groups || []).filter((g) => (g.profiles || []).length > 0);
  if (visibleGroups.length === 0) return null;

  const inner = (
    <>
      <style>{`@keyframes wf-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }`}</style>
      <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Name', 'Role', 'Pending', 'Done · 7d'].map((h) => (
                <th key={h} style={{
                  textAlign: 'left', padding: '8px 12px', fontSize: 10, fontWeight: 800,
                  color: 'rgba(255,255,255,0.4)', letterSpacing: 0.5, textTransform: 'uppercase',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleGroups.map((g) => (
              <React.Fragment key={g.key}>
                <tr>
                  <td colSpan={4} style={{
                    padding: '6px 12px', fontSize: 10, fontWeight: 800,
                    color: 'rgba(255,255,255,0.35)', letterSpacing: 0.6, textTransform: 'uppercase',
                    background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.04)',
                  }}>{g.label}</td>
                </tr>
                {g.profiles.map((p) => (
                  <PersonRow
                    key={p.id}
                    person={p}
                    data={g.byAssignee?.[p.id]}
                    groupKey={g.key}
                    onTaskClick={onTaskClick}
                  />
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );

  if (!showHeader) return inner;
  return (
    <div style={{ marginTop: 32 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: '#ffffff', margin: '0 0 12px' }}>Progress</h2>
      {inner}
    </div>
  );
}

function PersonRow({ person, data, groupKey, onTaskClick }) {
  const d = data || { pending: [], done: [] };
  const pending = d.pending || [];
  const done = d.done || [];
  const nowMs = Date.now();

  const activeTasks = pending.filter((t) => {
    const snoozed = t.snoozed_until && new Date(t.snoozed_until).getTime() > nowMs;
    return !snoozed && t.status !== 'on_hold' && !t.planned_date;
  });
  const plannedTasks = pending.filter((t) => {
    const snoozed = t.snoozed_until && new Date(t.snoozed_until).getTime() > nowMs;
    return !snoozed && t.planned_date;
  });
  const snoozedTasks = pending.filter((t) => t.snoozed_until && new Date(t.snoozed_until).getTime() > nowMs);
  const holdTasks = pending.filter((t) => {
    const snoozed = t.snoozed_until && new Date(t.snoozed_until).getTime() > nowMs;
    return !snoozed && t.status === 'on_hold';
  });

  const doneShown = done.slice(0, 4);

  function clickable(task) {
    // Mirror-only rows (e.g. progress_cards proxied into a person's list)
    // aren't editable through the normal task editor; skip the click.
    if (!task || typeof task.id !== 'string') return false;
    if (task.id.startsWith('progress-')) return false;
    return !!onTaskClick;
  }

  function handleClick(task) {
    if (!clickable(task)) return;
    onTaskClick(task, person, groupKey);
  }

  return (
    <tr>
      <td style={{ ...tdBase, whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{person.name}</span>
      </td>
      <td style={{ ...tdBase, whiteSpace: 'nowrap' }}>
        <span style={{
          fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.5)',
          background: 'rgba(255,255,255,0.06)', borderRadius: 4, padding: '2px 7px',
          textTransform: 'uppercase', letterSpacing: 0.4,
        }}>{person.role}</span>
      </td>
      <td style={tdBase}>
        {pending.length === 0 ? (
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', fontStyle: 'italic' }}>—</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: pending.length > 0 ? 4 : 0 }}>
              {activeTasks.length > 0 && (
                <span style={{ fontSize: 10, fontWeight: 700, color: '#facc15', background: 'rgba(250,204,21,0.1)', borderRadius: 3, padding: '1px 6px' }}>
                  {activeTasks.length} active
                </span>
              )}
              {plannedTasks.length > 0 && (
                <span style={{ fontSize: 10, fontWeight: 700, color: '#facc15', background: 'rgba(250,204,21,0.1)', borderRadius: 3, padding: '1px 6px' }}>
                  {plannedTasks.length} planned
                </span>
              )}
              {snoozedTasks.length > 0 && (
                <span style={{ fontSize: 10, fontWeight: 700, color: '#c084fc', background: 'rgba(168,85,247,0.1)', borderRadius: 3, padding: '1px 6px' }}>
                  {snoozedTasks.length} snoozed
                </span>
              )}
              {holdTasks.length > 0 && (
                <span style={{ fontSize: 10, fontWeight: 700, color: '#fdba74', background: 'rgba(251,146,60,0.1)', borderRadius: 3, padding: '1px 6px' }}>
                  {holdTasks.length} on hold
                </span>
              )}
            </div>
            {pending.map((t) => {
              const snoozed = t.snoozed_until && new Date(t.snoozed_until).getTime() > nowMs;
              const onHold = !snoozed && t.status === 'on_hold';
              const color = snoozed ? '#a855f7' : onHold ? '#fb923c' : '#facc15';
              const glow = snoozed ? 'rgba(168,85,247,0.7)' : onHold ? 'rgba(251,146,60,0.7)' : 'rgba(250,204,21,0.7)';
              const isClickable = clickable(t);
              return (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
                  <span style={{
                    display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
                    background: color, boxShadow: `0 0 5px ${glow}`,
                    animation: 'wf-blink 1.2s ease-in-out infinite', flexShrink: 0,
                  }} />
                  <button
                    onClick={() => handleClick(t)}
                    disabled={!isClickable}
                    title={isClickable ? 'Click to edit' : ''}
                    style={{
                      background: 'transparent', border: 'none', padding: 0, margin: 0,
                      textAlign: 'left', flex: 1, minWidth: 0,
                      color: 'rgba(255,255,255,0.8)', fontSize: 12,
                      fontFamily: 'inherit',
                      cursor: isClickable ? 'pointer' : 'default',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      textDecoration: isClickable ? 'underline dotted rgba(255,255,255,0.2)' : 'none',
                      textUnderlineOffset: 3,
                    }}
                  >
                    {t.title}
                  </button>
                  {snoozed && (
                    <span style={{ fontSize: 9, fontWeight: 600, color: '#c084fc', flexShrink: 0 }}>
                      💤 {fmtSnoozeEnd(t.snoozed_until)}
                    </span>
                  )}
                  {onHold && (
                    <span title={t.hold_reason || ''} style={{ fontSize: 9, fontWeight: 600, color: '#fdba74', flexShrink: 0 }}>hold</span>
                  )}
                  {t.planned_date && !snoozed && (
                    <span style={{ fontSize: 9, fontWeight: 600, color: '#facc15', flexShrink: 0 }}>
                      {new Date(t.planned_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </td>
      <td style={tdBase}>
        {done.length === 0 ? (
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', fontStyle: 'italic' }}>—</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {doneShown.map((t) => {
              const isClickable = clickable(t);
              return (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
                  <span style={{ color: '#22c55e', fontSize: 11, flexShrink: 0 }}>✓</span>
                  <button
                    onClick={() => handleClick(t)}
                    disabled={!isClickable}
                    title={isClickable ? 'Click to edit' : ''}
                    style={{
                      background: 'transparent', border: 'none', padding: 0, margin: 0,
                      textAlign: 'left', flex: 1, minWidth: 0,
                      color: 'rgba(255,255,255,0.5)', fontSize: 12,
                      fontFamily: 'inherit',
                      cursor: isClickable ? 'pointer' : 'default',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      textDecoration: isClickable ? 'underline dotted rgba(255,255,255,0.15)' : 'none',
                      textUnderlineOffset: 3,
                    }}
                  >
                    {t.title}
                  </button>
                </div>
              );
            })}
            {done.length > doneShown.length && (
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', paddingLeft: 16 }}>
                +{done.length - doneShown.length} more
              </div>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}
