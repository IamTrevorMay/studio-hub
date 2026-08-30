import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../supabaseClient';
import { fetchAllRows } from '../../../pages/analytics/utils';
import { trailing12, autoFieldKeys, FIELDS } from '../../../lib/marginModel';
import { computeBreakdown } from './computeAuto';

// Loading, saving and recalculating for Accounting → Breakdown.
//
// The window is trailing 12 months, fixed. Accounting's 30d/90d/YTD selector is
// deliberately ignored here: overhead is monthly, salaries are annual, and
// hours-per-unit needs a sample, so a short window makes all three swing on one
// slow month.

const SECTIONS = [...new Set(FIELDS.map(f => f.section))];

export default function useBreakdownData({ business }) {
  const [raw, setRaw] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const seededPeople = useRef(false);

  const period = useMemo(() => trailing12(), []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { start, end } = period;

      const [
        settingsRes, peopleRes, productsRes, inputsRes,
        expenses, revenue, assignments, tasks,
        profilesRes, salariesRes, contractorRes, memberRatesRes,
      ] = await Promise.all([
        supabase.from('margin_settings').select('data').eq('id', 1).maybeSingle(),
        supabase.from('margin_people').select('*').is('archived_at', null).order('position'),
        supabase.from('margin_products').select('*').is('archived_at', null).order('position'),
        supabase.from('margin_inputs').select('*'),

        // Same guards the rest of Accounting uses: inter-account transfers and
        // resolved duplicates are flagged rather than deleted, and must not
        // count as revenue or cost.
        fetchAllRows(supabase.from('expense_transactions')
          .select('date, category, amount_cents, business')
          .eq('is_transfer', false).eq('is_duplicate', false)
          .gte('date', start).lte('date', end).order('date', { ascending: false })),
        fetchAllRows(supabase.from('revenue_transactions')
          .select('date, category, amount_cents, business')
          .eq('is_transfer', false).eq('is_duplicate', false)
          .gte('date', start).lte('date', end).order('date', { ascending: false })),

        fetchAllRows(supabase.from('contractor_assignments')
          .select('id, contractor_id, created_by, content_type, assignment_type, hours_spent, completed_at')
          .eq('status', 'completed').not('hours_spent', 'is', null)
          .gte('completed_at', start).order('completed_at', { ascending: false })),
        fetchAllRows(supabase.from('tasks')
          .select('id, title, assignee_id, hours_spent, completed_at')
          .eq('requires_hours', true).not('hours_spent', 'is', null)
          .gte('completed_at', start).order('completed_at', { ascending: false })),

        supabase.from('profiles').select('id, full_name, role, sub_role'),
        supabase.from('payroll_salaries').select('profile_id, salary_type, amount_cents, effective_date, ended_at'),
        supabase.from('contractor_profiles').select('id, rate, payment_type'),
        // member_hourly_rates is not deployed on every environment — the
        // task-hours migration landed its `tasks` columns without the table.
        // Deliberately left out of the error check below so a missing table
        // degrades to "no hourly rate for staff" instead of an empty page.
        supabase.from('member_hourly_rates').select('profile_id, rate_cents'),
      ]);

      const firstError = [settingsRes, peopleRes, productsRes, inputsRes, profilesRes, salariesRes]
        .find(r => r?.error);
      if (firstError) throw firstError.error;

      const profiles = profilesRes.data || [];
      const profilesById = Object.fromEntries(profiles.map(p => [p.id, p]));

      // Rates in cents/hour. contractor_profiles.rate is dollars and only means
      // an hourly rate when payment_type says so — for project-rate contractors
      // it is a per-job fee and would be nonsense here.
      const hourlyRateByProfile = {};
      for (const c of contractorRes.data || []) {
        if (c.payment_type === 'hourly' && c.rate) hourlyRateByProfile[c.id] = Math.round(Number(c.rate) * 100);
      }
      for (const m of memberRatesRes.data || []) {
        if (m.rate_cents) hourlyRateByProfile[m.profile_id] = m.rate_cents;
      }

      let people = peopleRes.data || [];

      // First run: stand the roster up from whoever payroll already knows about,
      // so the Labour tab opens with real names instead of an empty table.
      if (!people.length && !seededPeople.current) {
        seededPeople.current = true;
        const paid = new Set([
          ...(salariesRes.data || []).filter(s => !s.ended_at).map(s => s.profile_id),
          ...Object.keys(hourlyRateByProfile),
        ]);
        const seed = [...paid]
          .filter(id => profilesById[id])
          .map((id, i) => ({ profile_id: id, label: profilesById[id].full_name || 'Unnamed', position: i + 1 }));
        if (seed.length) {
          // Two tabs opening at once would both try to seed; the unique index on
          // profile_id stops the duplicate, so treat a failure as "someone else
          // got there first" and read back what landed rather than erroring out.
          const { data: inserted, error: seedErr } = await supabase.from('margin_people').insert(seed).select();
          if (seedErr) {
            const { data: existing } = await supabase.from('margin_people')
              .select('*').is('archived_at', null).order('position');
            people = existing || [];
          } else {
            people = inserted || [];
          }
        }
      }

      setRaw({
        settings: settingsRes.data?.data || {},
        people,
        products: productsRes.data || [],
        inputs: inputsRes.data || [],
        expenses, revenue, assignments, tasks,
        profiles, profilesById,
        salaryRows: salariesRes.data || [],
        hourlyRateByProfile,
      });
    } catch (e) {
      setError(e.message || 'Failed to load the margin model');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { load(); }, [load]);

  const model = useMemo(() => {
    if (!raw) return null;
    return computeBreakdown({ ...raw, business });
  }, [raw, business]);

  // ── Writes ───────────────────────────────────────────────────────
  // Every mutation reloads. The model is one interlocked pass — a person's
  // utilisation moves overhead-per-hour, which moves every product price — so
  // patching one field in local state would leave the rest of the page stale.

  const run = useCallback(async (fn) => {
    setSaving(true);
    try {
      const { error: e } = await fn();
      if (e) throw e;
      await load();
    } catch (e) {
      setError(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [load]);

  // subject_id is '' for page-level fields — see the migration's note on why it
  // is a sentinel rather than NULL.
  const setInput = useCallback((section, fieldKey, subjectId, value) => {
    const subject = subjectId ?? '';
    if (value === null) {
      return run(() => supabase.from('margin_inputs').delete()
        .eq('section', section).eq('field_key', fieldKey).eq('subject_id', subject));
    }
    return run(() => supabase.from('margin_inputs').upsert(
      { section, field_key: fieldKey, subject_id: subject, value },
      { onConflict: 'section,field_key,subject_id' },
    ));
  }, [run]);

  const clearInput = useCallback((section, fieldKey, subjectId) =>
    setInput(section, fieldKey, subjectId, null), [setInput]);

  /**
   * Recalculate: force the derived value to win again.
   *
   * Only fields that HAVE an auto source are cleared. Membership assumptions,
   * SaaS tiers and merch costs have nothing behind them, so wiping those would
   * destroy work nothing could put back — they are left exactly as typed.
   */
  const recalculate = useCallback((section) => {
    const sections = section ? [section] : SECTIONS;
    return run(async () => {
      for (const sec of sections) {
        const keys = autoFieldKeys(sec);
        if (!keys.length) continue;
        const { error: e } = await supabase.from('margin_inputs')
          .delete().eq('section', sec).in('field_key', keys);
        if (e) return { error: e };
      }
      return { error: null };
    });
  }, [run]);

  const saveSettings = useCallback((patch) => run(async () => {
    const next = { ...(raw?.settings || {}), ...patch };
    return supabase.from('margin_settings').update({ data: next }).eq('id', 1);
  }), [run, raw]);

  const setCategoryTag = useCallback((category, classification) => {
    const map = { ...(raw?.settings?.category_map || {}) };
    if (classification) map[category] = classification; else delete map[category];
    return saveSettings({ category_map: map });
  }, [raw, saveSettings]);

  // Revenue categories map to readout rows. Same escape hatch as the expense
  // tagging: a category added to Tiller later gets pointed at a bucket here
  // rather than in a deploy.
  const setRevenueTag = useCallback((category, bucket) => {
    const map = { ...(raw?.settings?.revenue_map || {}) };
    if (bucket) map[category] = bucket; else delete map[category];
    return saveSettings({ revenue_map: map });
  }, [raw, saveSettings]);

  const updateProduct = useCallback((id, patch) =>
    run(() => supabase.from('margin_products').update(patch).eq('id', id)), [run]);

  const addProduct = useCallback((product) =>
    run(() => supabase.from('margin_products').insert({
      position: (raw?.products?.length || 0) + 1, ...product,
    })), [run, raw]);

  const archiveProduct = useCallback((id) =>
    run(() => supabase.from('margin_products').update({ archived_at: new Date().toISOString() }).eq('id', id)), [run]);

  const addPerson = useCallback((person) =>
    run(() => supabase.from('margin_people').insert({
      position: (raw?.people?.length || 0) + 1, ...person,
    })), [run, raw]);

  const updatePerson = useCallback((id, patch) =>
    run(() => supabase.from('margin_people').update(patch).eq('id', id)), [run]);

  const archivePerson = useCallback((id) =>
    run(() => supabase.from('margin_people').update({ archived_at: new Date().toISOString() }).eq('id', id)), [run]);

  const closeQuarter = useCallback((label, data) =>
    run(() => supabase.from('margin_snapshots').upsert(
      { period_end: period.end, label, data }, { onConflict: 'period_end' },
    )), [run, period]);

  const addDecision = useCallback((decision) =>
    run(() => supabase.from('margin_decisions').insert(decision)), [run]);

  const deleteDecision = useCallback((id) =>
    run(() => supabase.from('margin_decisions').delete().eq('id', id)), [run]);

  return {
    loading, saving, error, period, raw, model,
    reload: load,
    setInput, clearInput, recalculate, saveSettings, setCategoryTag, setRevenueTag,
    addProduct, updateProduct, archiveProduct,
    addPerson, updatePerson, archivePerson,
    closeQuarter, addDecision, deleteDecision,
  };
}
