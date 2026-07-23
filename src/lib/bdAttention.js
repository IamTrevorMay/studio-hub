// Shared Business Dev (Roadmap) helpers used by BusinessDev.js and
// BusinessDevMobile.js so the two twins can't drift:
//
// 1. Tag / status metadata — single source of truth for both clients
//    (module-level *_COLORS-style maps, same convention as the pages).
// 2. PT-correct date helpers for due-date buckets. bd_tasks.due_date is a
//    plain date column ('YYYY-MM-DD' strings), so bucket comparisons are
//    string compares against the *Pacific* calendar day — never against
//    new Date().toISOString() (UTC day; see src/lib/ptDate.js).
// 3. computeBdAttention() — the "Needs Attention" strip buckets.
// 4. syncBdTaskToBacklog() — mirrors a bd_task into the owner's
//    personal_tasks backlog; call it after every bd_tasks write that touches
//    completed_at / due_date / owner / title / tag.

import { supabase } from '../supabaseClient';
import { ptDayKey } from './ptDate';

// ── Shared metadata (desktop values are canonical) ──────────────
export const BD_TAGS = [
  { key: 'mayday',  label: 'Mayday',  color: '#5b8fc7', bg: 'rgba(91,143,199,0.15)'  },
  { key: 'neptune', label: 'Neptune', color: '#06b6d4', bg: 'rgba(6,182,212,0.15)'   },
  { key: 'shared',  label: 'Shared',  color: '#a78bfa', bg: 'rgba(167,139,250,0.15)' },
];
export const BD_TAG_MAP = Object.fromEntries(BD_TAGS.map(t => [t.key, t]));

export const BD_STATUSES = [
  { key: 'ideas',   label: 'Ideas',   color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' },
  { key: 'planned', label: 'Planned', color: '#60a5fa', bg: 'rgba(96,165,250,0.15)'  },
  { key: 'active',  label: 'Active',  color: '#22c55e', bg: 'rgba(34,197,94,0.15)'   },
  { key: 'waiting', label: 'Waiting', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)'  },
  { key: 'done',    label: 'Done',    color: '#a3a3a3', bg: 'rgba(163,163,163,0.15)' },
];
export const BD_STATUS_MAP = Object.fromEntries(BD_STATUSES.map(s => [s.key, s]));

// ── PT-safe date helpers ────────────────────────────────────────
// Today's Pacific calendar day as 'YYYY-MM-DD'.
export function bdTodayPT() { return ptDayKey(new Date()); }

// Pure calendar math on a 'YYYY-MM-DD' string — no timezone involved
// because everything stays in UTC internally.
export function addDaysToDateStr(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Whole days elapsed since a timestamptz ISO value (duration, not a
// calendar boundary — so raw ms math is correct here).
export function daysSince(iso) {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

function olderThanDays(iso, days) {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() > days * 86400000;
}

// ── "Needs Attention" buckets ───────────────────────────────────
export const WAITING_AGE_DAYS = 7;
export const STALE_ACTIVE_DAYS = 14;

// tasks / initiatives / phases are the raw fetched arrays. Returns:
//   overdue / dueSoon: [{ task, initiative, phase }]   (open tasks, PT-day compared)
//   waiting / stale:   [{ initiative, phase, ageDays }]
export function computeBdAttention({ tasks, initiatives, phases }) {
  const today = bdTodayPT();
  const weekEnd = addDaysToDateStr(today, 6); // 7-day window including today
  const initsById = Object.fromEntries(initiatives.map(i => [i.id, i]));
  const phasesById = Object.fromEntries(phases.map(p => [p.id, p]));

  const overdue = [];
  const dueSoon = [];
  for (const t of tasks) {
    if (t.completed_at || !t.due_date) continue;
    const initiative = initsById[t.initiative_id] || null;
    const phase = initiative ? (phasesById[initiative.phase_id] || null) : null;
    const row = { task: t, initiative, phase };
    if (t.due_date < today) overdue.push(row);
    else if (t.due_date <= weekEnd) dueSoon.push(row);
  }
  overdue.sort((a, b) => a.task.due_date.localeCompare(b.task.due_date));
  dueSoon.sort((a, b) => a.task.due_date.localeCompare(b.task.due_date));

  const waiting = [];
  const stale = [];
  for (const i of initiatives) {
    if (i.status === 'waiting' && olderThanDays(i.updated_at, WAITING_AGE_DAYS)) {
      waiting.push({ initiative: i, phase: phasesById[i.phase_id] || null, ageDays: daysSince(i.updated_at) });
    } else if (i.status === 'active' && olderThanDays(i.updated_at, STALE_ACTIVE_DAYS)) {
      stale.push({ initiative: i, phase: phasesById[i.phase_id] || null, ageDays: daysSince(i.updated_at) });
    }
  }
  waiting.sort((a, b) => b.ageDays - a.ageDays);
  stale.sort((a, b) => b.ageDays - a.ageDays);

  return {
    overdue, dueSoon, waiting, stale,
    total: overdue.length + dueSoon.length + waiting.length + stale.length,
  };
}

// ── personal_tasks backlog mirror ───────────────────────────────
// Mirror a bd_task into the owner's personal_tasks backlog (idempotent).
// Pass the bd_task object you just wrote (with its id) plus the current
// initiatives array (for title/tag inheritance). Handles insert, owner
// change, field updates, owner removal, and completion.
export async function syncBdTaskToBacklog(bdTask, initiatives) {
  try {
    const parentInit = initiatives.find(i => i.id === bdTask.initiative_id);
    const initiativeTitle = parentInit?.title || 'BD Task';
    const content = `${bdTask.title} | ${initiativeTitle}`;
    const tag = bdTask.tag || parentInit?.tag || 'shared';
    const tagInfo = BD_TAG_MAP[tag] || BD_TAG_MAP.shared;

    const { data: existing } = await supabase
      .from('personal_tasks')
      .select('id, created_by')
      .eq('bd_task_id', bdTask.id)
      .maybeSingle();

    // No owner or task is done -> remove from backlog
    if (!bdTask.owner_id || bdTask.completed_at) {
      if (existing) await supabase.from('personal_tasks').delete().eq('id', existing.id);
      return;
    }

    // Owner unchanged -> just update fields
    if (existing && existing.created_by === bdTask.owner_id) {
      await supabase.from('personal_tasks').update({
        content, bucket: tag, due_date: bdTask.due_date,
      }).eq('id', existing.id);
      return;
    }

    // Owner changed -> drop old row first
    if (existing) {
      await supabase.from('personal_tasks').delete().eq('id', existing.id);
    }

    // Ensure the bucket option exists for the new owner
    await supabase.from('user_task_options').upsert(
      { user_id: bdTask.owner_id, kind: 'bucket', value: tag, label: tagInfo.label, color: tagInfo.color },
      { onConflict: 'user_id,kind,value' }
    );

    await supabase.from('personal_tasks').insert({
      created_by: bdTask.owner_id,
      content,
      status: 'backlog',
      category: 'business_development',
      bucket: tag,
      due_date: bdTask.due_date,
      position: 0,
      bd_task_id: bdTask.id,
    });
  } catch (err) {
    console.error('syncBdTaskToBacklog failed:', err);
  }
}
