import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { ptDateToUtcISO } from '../lib/ptDate';

// ── Pay Period Helpers ────────────────────────────────────────────

function getCurrentPayPeriod() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();

  if (day <= 14) {
    const start = new Date(year, month, 1);
    const end = new Date(year, month, 14);
    const payday = new Date(year, month, 15);
    return {
      start: start.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0],
      payday: payday.toISOString().split('T')[0],
      label: start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) + ' 1–14',
    };
  } else {
    const lastDay = new Date(year, month + 1, 0).getDate();
    const start = new Date(year, month, 15);
    const end = new Date(year, month, lastDay);
    const payday = new Date(year, month + 1, 1);
    return {
      start: start.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0],
      payday: payday.toISOString().split('T')[0],
      label: start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) + ` 15–${lastDay}`,
    };
  }
}

function getPayPeriodHistory(count = 6) {
  const periods = [];
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth();
  let isFirstHalf = now.getDate() <= 14;

  // Start from previous period
  if (isFirstHalf) {
    month--;
    if (month < 0) { month = 11; year--; }
    isFirstHalf = false;
  } else {
    isFirstHalf = true;
  }

  for (let i = 0; i < count; i++) {
    if (isFirstHalf) {
      const start = new Date(year, month, 1);
      const end = new Date(year, month, 14);
      const payday = new Date(year, month, 15);
      periods.push({
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0],
        payday: payday.toISOString().split('T')[0],
        label: start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) + ' 1–14',
      });
    } else {
      const lastDay = new Date(year, month + 1, 0).getDate();
      const start = new Date(year, month, 15);
      const end = new Date(year, month, lastDay);
      const payday = new Date(year, month + 1, 1);
      periods.push({
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0],
        payday: payday.toISOString().split('T')[0],
        label: start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) + ` 15–${lastDay}`,
      });
    }
    if (isFirstHalf) {
      month--;
      if (month < 0) { month = 11; year--; }
      isFirstHalf = false;
    } else {
      isFirstHalf = true;
    }
  }
  return periods;
}

function countBusinessDays(startStr, endStr) {
  let count = 0;
  const start = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  const cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function daysUntil(dateStr) {
  const target = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}

function formatCents(cents) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Component ────────────────────────────────────────────────────

export default function Payroll() {
  const { profile } = useAuth();

  const [selectedPeriod, setSelectedPeriod] = useState(getCurrentPayPeriod());
  const [showHistory, setShowHistory] = useState(false);
  const historyPeriods = getPayPeriodHistory(6);

  // Data
  const [contractors, setContractors] = useState([]);
  const [freelancerProfiles, setFreelancerProfiles] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [salariedMembers, setSalariedMembers] = useState([]);
  const [salaries, setSalaries] = useState([]);
  const [oneOffs, setOneOffs] = useState([]);
  const [paidMap, setPaidMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Expand state
  const [expandedContractors, setExpandedContractors] = useState(new Set());

  // Salary form
  const [editingSalary, setEditingSalary] = useState(null); // profile_id
  const [salaryForm, setSalaryForm] = useState({ salary_type: 'yearly', amount: '' });
  const [savingSalary, setSavingSalary] = useState(false);

  // Pay method edit
  const [payMethodEditing, setPayMethodEditing] = useState(null); // profile_id
  const [payMethodForm, setPayMethodForm] = useState({ method: '', detail: '' });

  // One-off item form (scoped to the current pay period)
  const [addingOneOff, setAddingOneOff] = useState(false);
  const [oneOffForm, setOneOffForm] = useState({ label: '', payee: '', amount: '' });
  const [savingOneOff, setSavingOneOff] = useState(false);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    const [contractorsRes, fpRes, assignmentsRes, membersRes, salariesRes, oneOffsRes, paidRes] = await Promise.all([
      supabase.from('profiles').select('id, full_name, avatar_url, title, pay_method, pay_method_detail').eq('role', 'freelancer'),
      supabase.from('freelancer_profiles').select('id, payment_type, rate'),
      supabase.from('freelancer_assignments')
        .select('id, freelancer_id, title, pay_amount, hours_spent, completed_at, status')
        .eq('status', 'completed')
        .gte('completed_at', ptDateToUtcISO(selectedPeriod.start))
        .lt('completed_at', ptDateToUtcISO(selectedPeriod.end, true)),
      supabase.from('profiles').select('id, full_name, role, avatar_url, pay_method, pay_method_detail').in('role', ['admin', 'assistant', 'member', 'director_creative', 'director_comms']),
      supabase.from('payroll_salaries').select('*').is('ended_at', null),
      supabase.from('payroll_one_offs').select('*').eq('period_start', selectedPeriod.start).order('created_at'),
      supabase.from('payroll_paid').select('profile_id').eq('period_start', selectedPeriod.start),
    ]);
    const HIDDEN = ['Test1', 'Test2'];
    const notHidden = p => !HIDDEN.includes(p.full_name);
    setContractors((contractorsRes.data || []).filter(notHidden));
    setFreelancerProfiles(fpRes.data || []);
    setAssignments(assignmentsRes.data || []);
    setSalariedMembers((membersRes.data || []).filter(notHidden));
    setSalaries(salariesRes.data || []);
    setOneOffs(oneOffsRes.data || []);
    // Build paid map
    const pm = {};
    (paidRes.data || []).forEach(r => { pm[r.profile_id] = true; });
    setPaidMap(pm);
    setLoading(false);
    setRefreshing(false);
  }, [selectedPeriod]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Computed payroll ────────────────────────────────────────────

  const fpMap = {};
  freelancerProfiles.forEach(fp => { fpMap[fp.id] = fp; });

  const salaryMap = {};
  salaries.forEach(s => { salaryMap[s.profile_id] = s; });

  const businessDays = countBusinessDays(selectedPeriod.start, selectedPeriod.end);

  // Group assignments by contractor
  const contractorPayroll = contractors.map(c => {
    const fp = fpMap[c.id] || {};
    const myAssignments = assignments.filter(a => a.freelancer_id === c.id);
    let total = 0;
    const rows = myAssignments.map(a => {
      let amount = 0;
      if (fp.payment_type === 'hourly' && a.hours_spent) {
        amount = Math.round((a.hours_spent * (fp.rate || 0)) * 100);
      } else if (a.pay_amount) {
        amount = Math.round(a.pay_amount * 100);
      }
      total += amount;
      return { ...a, amount };
    });
    return { ...c, fp, assignments: rows, total };
  });

  // Salaried member payroll
  const memberPayroll = salariedMembers.map(m => {
    const salary = salaryMap[m.id];
    let periodPay = 0;
    if (salary) {
      if (salary.salary_type === 'per_period') {
        periodPay = salary.amount_cents;
      } else {
        // yearly: (amount / 260) * business days in period
        const dailyRate = salary.amount_cents / 260;
        periodPay = Math.round(dailyRate * businessDays);
      }
    }
    return { ...m, salary, periodPay };
  });

  const contractorTotal = contractorPayroll.reduce((sum, c) => sum + c.total, 0);
  const salariedTotal = memberPayroll.reduce((sum, m) => sum + m.periodPay, 0);
  const oneOffTotal = oneOffs.reduce((sum, o) => sum + (o.amount_cents || 0), 0);
  const grandTotal = contractorTotal + salariedTotal + oneOffTotal;

  // ── Salary CRUD ─────────────────────────────────────────────────

  async function handleSaveSalary(profileId) {
    setSavingSalary(true);
    const amountCents = Math.round(parseFloat(salaryForm.amount) * 100);
    if (isNaN(amountCents) || amountCents <= 0) { setSavingSalary(false); return; }

    // End existing salary if any
    const existing = salaryMap[profileId];
    if (existing) {
      await supabase.from('payroll_salaries')
        .update({ ended_at: new Date().toISOString().split('T')[0], updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    }

    // Insert new
    await supabase.from('payroll_salaries').insert({
      profile_id: profileId,
      salary_type: salaryForm.salary_type,
      amount_cents: amountCents,
      effective_date: new Date().toISOString().split('T')[0],
      created_by: profile.id,
    });

    setEditingSalary(null);
    setSalaryForm({ salary_type: 'yearly', amount: '' });
    setSavingSalary(false);
    fetchData();
  }

  async function handleRemoveSalary(salaryId) {
    await supabase.from('payroll_salaries')
      .update({ ended_at: new Date().toISOString().split('T')[0], updated_at: new Date().toISOString() })
      .eq('id', salaryId);
    fetchData();
  }

  // ── Pay method CRUD ───────────────────────────────────────────────

  async function handleSavePayMethod(profileId) {
    await supabase.from('profiles')
      .update({
        pay_method: payMethodForm.method || null,
        pay_method_detail: payMethodForm.detail.trim() || null,
      })
      .eq('id', profileId);
    setPayMethodEditing(null);
    setPayMethodForm({ method: '', detail: '' });
    fetchData(true);
  }

  // ── Paid toggle ───────────────────────────────────────────────────

  const togglingPaid = useRef(new Set());
  async function handleTogglePaid(profileId) {
    // Guard against a fast double-tap firing two concurrent writes (duplicate
    // payroll_paid rows) before paidMap updates.
    const key = `${profileId}|${selectedPeriod.start}`;
    if (togglingPaid.current.has(key)) return;
    togglingPaid.current.add(key);
    try {
      if (paidMap[profileId]) {
        await supabase.from('payroll_paid')
          .delete()
          .eq('profile_id', profileId)
          .eq('period_start', selectedPeriod.start);
        setPaidMap(prev => { const next = { ...prev }; delete next[profileId]; return next; });
      } else {
        await supabase.from('payroll_paid').insert({
          profile_id: profileId,
          period_start: selectedPeriod.start,
          paid_by: profile.id,
        });
        setPaidMap(prev => ({ ...prev, [profileId]: true }));
      }
    } finally {
      togglingPaid.current.delete(key);
    }
  }

  // ── One-off items (current period only) ─────────────────────────

  async function handleAddOneOff() {
    const amountCents = Math.round(parseFloat(oneOffForm.amount) * 100);
    if (isNaN(amountCents) || amountCents <= 0 || !oneOffForm.label.trim()) return;
    setSavingOneOff(true);
    await supabase.from('payroll_one_offs').insert({
      period_start: selectedPeriod.start,
      label: oneOffForm.label.trim(),
      payee: oneOffForm.payee.trim() || null,
      amount_cents: amountCents,
      created_by: profile.id,
    });
    setOneOffForm({ label: '', payee: '', amount: '' });
    setAddingOneOff(false);
    setSavingOneOff(false);
    fetchData(true);
  }

  async function handleRemoveOneOff(id) {
    await supabase.from('payroll_one_offs').delete().eq('id', id);
    fetchData(true);
  }

  function toggleContractor(id) {
    setExpandedContractors(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── Pay method / paid rendering helpers ──────────────────────────

  function renderPayControls(person) {
    const isPaid = !!paidMap[person.id];
    const method = person.pay_method;
    const detail = person.pay_method_detail;

    return (
      <>
        {/* Pay method badge */}
        <span
          style={{
            ...styles.payMethodBadge,
            ...(method === 'auto' ? styles.payMethodAuto : {}),
            ...(method === 'venmo' || method === 'paypal' ? styles.payMethodBlue : {}),
            ...(!method ? styles.payMethodNone : {}),
          }}
          onClick={(e) => {
            e.stopPropagation();
            setPayMethodEditing(person.id);
            setPayMethodForm({ method: method || '', detail: detail || '' });
          }}
        >
          {method === 'auto' ? 'Auto' : method === 'venmo' ? 'Venmo' : method === 'paypal' ? 'PayPal' : 'Set Pay'}
        </span>

        {/* Pay button */}
        {method === 'auto' ? (
          <span style={styles.payAutoLabel}>Auto</span>
        ) : method === 'venmo' ? (
          <button
            style={styles.payBtn}
            onClick={(e) => { e.stopPropagation(); window.open(detail || 'https://venmo.com', '_blank'); }}
          >
            Pay
          </button>
        ) : method === 'paypal' ? (
          <button
            style={styles.payBtn}
            onClick={(e) => { e.stopPropagation(); window.open('https://www.paypal.com', '_blank'); }}
          >
            Pay
          </button>
        ) : (
          <button style={styles.payBtnDisabled} disabled>Pay</button>
        )}

        {/* Paid toggle */}
        <button
          style={isPaid ? styles.paidBtnActive : styles.paidBtn}
          onClick={(e) => { e.stopPropagation(); handleTogglePaid(person.id); }}
        >
          Paid
        </button>
      </>
    );
  }

  function renderPayMethodEditRow(personId) {
    if (payMethodEditing !== personId) return null;
    return (
      <div style={styles.payMethodFormRow}>
        <select
          style={styles.salarySelect}
          value={payMethodForm.method}
          onChange={(e) => setPayMethodForm(f => ({ ...f, method: e.target.value }))}
        >
          <option value="">None</option>
          <option value="auto">Auto</option>
          <option value="venmo">Venmo</option>
          <option value="paypal">PayPal</option>
        </select>
        {payMethodForm.method === 'venmo' && (
          <input
            type="text"
            placeholder="Venmo profile URL"
            value={payMethodForm.detail}
            onChange={(e) => setPayMethodForm(f => ({ ...f, detail: e.target.value }))}
            style={styles.oneOffInput}
          />
        )}
        <button style={styles.saveBtn} onClick={(e) => { e.stopPropagation(); handleSavePayMethod(personId); }}>
          Save
        </button>
        <button style={styles.cancelBtn} onClick={(e) => { e.stopPropagation(); setPayMethodEditing(null); }}>
          Cancel
        </button>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────

  const paydayDays = daysUntil(selectedPeriod.payday);
  const isCurrentPeriod = selectedPeriod.start === getCurrentPayPeriod().start;

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>Payroll</h1>
        <button
          type="button"
          onClick={() => fetchData(true)}
          disabled={refreshing || loading}
          style={{ ...styles.refreshBtn, ...(refreshing || loading ? styles.refreshBtnDisabled : {}) }}
          title="Refresh payroll"
        >
          <span style={{ ...styles.refreshIcon, ...(refreshing ? styles.refreshIconSpin : {}) }}>↻</span>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* Period bar */}
      <div style={styles.periodBar}>
        <div style={styles.periodInfo}>
          <span style={styles.periodLabel}>{selectedPeriod.label}</span>
          {isCurrentPeriod && (
            <span style={styles.paydayBadge}>
              Payday in {paydayDays} day{paydayDays !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div style={styles.grandTotal}>{formatCents(grandTotal)}</div>
      </div>

      {/* History toggle */}
      <div style={styles.historyToggle}>
        <button
          style={styles.historyBtn}
          onClick={() => setShowHistory(!showHistory)}
        >
          {showHistory ? 'Hide History' : 'Past Periods'}
        </button>
        {isCurrentPeriod ? null : (
          <button style={styles.historyBtn} onClick={() => setSelectedPeriod(getCurrentPayPeriod())}>
            Current Period
          </button>
        )}
      </div>

      {showHistory && (
        <div style={styles.historyRow}>
          {historyPeriods.map(p => (
            <button
              key={p.start}
              style={{
                ...styles.historyPill,
                ...(selectedPeriod.start === p.start ? styles.historyPillActive : {}),
              }}
              onClick={() => setSelectedPeriod(p)}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {loading && <p style={styles.loadingText}>Loading payroll...</p>}

      {!loading && (
        <>
          {/* CONTRACTORS */}
          <div style={styles.sectionHeader}>
            <span style={styles.sectionTitle}>CONTRACTORS</span>
            <span style={styles.sectionTotal}>{formatCents(contractorTotal)}</span>
          </div>

          {contractorPayroll.length === 0 && (
            <p style={styles.emptyText}>No completed contractor work this period.</p>
          )}

          {contractorPayroll.map(c => {
            const isExpanded = expandedContractors.has(c.id);
            const isPaid = !!paidMap[c.id];
            return (
              <div key={c.id} style={{
                ...styles.card,
                ...(isPaid ? styles.cardPaid : {}),
              }}>
                <div style={styles.cardHeader} onClick={() => toggleContractor(c.id)}>
                  <div style={styles.cardLeft}>
                    <div style={styles.avatar}>
                      {c.full_name?.[0]?.toUpperCase() || '?'}
                    </div>
                    <div>
                      <span style={styles.cardName}>{c.full_name}</span>
                      {c.title && <span style={styles.cardRole}>{c.title}</span>}
                    </div>
                    <span style={{
                      ...styles.typeBadge,
                      ...(c.fp.payment_type === 'hourly' ? styles.typeBadgeHourly : styles.typeBadgeProject),
                    }}>
                      {c.fp.payment_type === 'hourly' ? 'Hourly' : 'Per Project'}
                    </span>
                  </div>
                  <div style={styles.cardRight}>
                    {renderPayControls(c)}
                    <span style={styles.cardCount}>{c.assignments.length} completed</span>
                    <span style={styles.cardTotal}>{formatCents(c.total)}</span>
                    <span style={styles.expandArrow}>{isExpanded ? '▾' : '▸'}</span>
                  </div>
                </div>

                {renderPayMethodEditRow(c.id)}

                {isExpanded && (
                  <div style={styles.cardExpanded}>
                    {c.assignments.map(a => (
                      <div key={a.id} style={styles.assignmentRow}>
                        <span style={styles.assignmentTitle}>{a.title}</span>
                        {a.completed_at && (
                          <span style={styles.assignmentDate}>
                            {new Date(a.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                        )}
                        {c.fp.payment_type === 'hourly' && a.hours_spent && (
                          <span style={styles.assignmentHours}>{a.hours_spent}h</span>
                        )}
                        <span style={styles.assignmentAmount}>{formatCents(a.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* SALARIED MEMBERS */}
          <div style={{ ...styles.sectionHeader, marginTop: 36 }}>
            <span style={styles.sectionTitle}>SALARIED MEMBERS</span>
            <span style={styles.sectionTotal}>{formatCents(salariedTotal)}</span>
          </div>

          {memberPayroll.map(m => {
            const isEditing = editingSalary === m.id;
            const isPaid = !!paidMap[m.id];
            return (
              <div key={m.id} style={{
                ...styles.card,
                ...(isPaid ? styles.cardPaid : {}),
              }}>
                <div style={styles.cardHeader}>
                  <div style={styles.cardLeft}>
                    <div style={styles.avatar}>
                      {m.full_name?.[0]?.toUpperCase() || '?'}
                    </div>
                    <div>
                      <span style={styles.cardName}>{m.full_name}</span>
                      <span style={styles.cardRole}>{m.role}</span>
                    </div>
                    {m.salary && (
                      <span style={styles.salaryInfo}>
                        {m.salary.salary_type === 'yearly'
                          ? `${formatCents(m.salary.amount_cents)}/yr`
                          : `${formatCents(m.salary.amount_cents)}/period`}
                      </span>
                    )}
                  </div>
                  <div style={styles.cardRight}>
                    {renderPayControls(m)}
                    <span style={styles.cardTotal}>{formatCents(m.periodPay)}</span>
                    {!isEditing && (
                      <button
                        style={styles.editBtn}
                        onClick={() => {
                          setEditingSalary(m.id);
                          setSalaryForm({
                            salary_type: m.salary?.salary_type || 'yearly',
                            amount: m.salary ? (m.salary.amount_cents / 100).toString() : '',
                          });
                        }}
                      >
                        {m.salary ? 'Edit' : 'Set Up'}
                      </button>
                    )}
                  </div>
                </div>

                {renderPayMethodEditRow(m.id)}

                {isEditing && (
                  <div style={styles.salaryFormRow}>
                    <select
                      style={styles.salarySelect}
                      value={salaryForm.salary_type}
                      onChange={(e) => setSalaryForm(f => ({ ...f, salary_type: e.target.value }))}
                    >
                      <option value="yearly">Yearly</option>
                      <option value="per_period">Per Period</option>
                    </select>
                    <div style={styles.salaryInputWrap}>
                      <span style={styles.dollarSign}>$</span>
                      <input
                        type="number"
                        step="0.01"
                        placeholder={salaryForm.salary_type === 'yearly' ? 'Annual salary' : 'Per period amount'}
                        value={salaryForm.amount}
                        onChange={(e) => setSalaryForm(f => ({ ...f, amount: e.target.value }))}
                        style={styles.salaryInput}
                      />
                    </div>
                    <button
                      style={styles.saveBtn}
                      disabled={savingSalary || !salaryForm.amount}
                      onClick={() => handleSaveSalary(m.id)}
                    >
                      Save
                    </button>
                    <button style={styles.cancelBtn} onClick={() => setEditingSalary(null)}>
                      Cancel
                    </button>
                    {m.salary && (
                      <button style={styles.removeBtn} onClick={() => handleRemoveSalary(m.salary.id)}>
                        Remove
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* ONE-OFF ITEMS */}
          <div style={{ ...styles.sectionHeader, marginTop: 36 }}>
            <span style={styles.sectionTitle}>ONE-OFF ITEMS</span>
            <span style={styles.sectionTotal}>{formatCents(oneOffTotal)}</span>
          </div>

          {oneOffs.length === 0 && !addingOneOff && (
            <p style={styles.emptyText}>No one-off items this period.</p>
          )}

          {oneOffs.map(o => (
            <div key={o.id} style={styles.card}>
              <div style={styles.cardHeader}>
                <div style={styles.cardLeft}>
                  <div>
                    <span style={styles.cardName}>{o.label}</span>
                    {o.payee && <span style={styles.cardRole}>{o.payee}</span>}
                  </div>
                </div>
                <div style={styles.cardRight}>
                  <span style={styles.cardTotal}>{formatCents(o.amount_cents)}</span>
                  <button style={styles.removeBtn} onClick={() => handleRemoveOneOff(o.id)}>Remove</button>
                </div>
              </div>
            </div>
          ))}

          {isCurrentPeriod && (
            addingOneOff ? (
              <div style={styles.oneOffForm}>
                <input
                  type="text"
                  placeholder="Label (e.g. Bonus, Reimbursement)"
                  value={oneOffForm.label}
                  onChange={(e) => setOneOffForm(f => ({ ...f, label: e.target.value }))}
                  style={styles.oneOffInput}
                  autoFocus
                />
                <input
                  type="text"
                  placeholder="Payee (optional)"
                  value={oneOffForm.payee}
                  onChange={(e) => setOneOffForm(f => ({ ...f, payee: e.target.value }))}
                  style={styles.oneOffInput}
                />
                <div style={styles.salaryInputWrap}>
                  <span style={styles.dollarSign}>$</span>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Amount"
                    value={oneOffForm.amount}
                    onChange={(e) => setOneOffForm(f => ({ ...f, amount: e.target.value }))}
                    style={styles.salaryInput}
                  />
                </div>
                <button
                  style={styles.saveBtn}
                  disabled={savingOneOff || !oneOffForm.label.trim() || !oneOffForm.amount}
                  onClick={handleAddOneOff}
                >
                  Add
                </button>
                <button
                  style={styles.cancelBtn}
                  onClick={() => { setAddingOneOff(false); setOneOffForm({ label: '', payee: '', amount: '' }); }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button style={styles.addOneOffBtn} onClick={() => setAddingOneOff(true)}>
                + Add one-off item
              </button>
            )
          )}

          {/* Period total bar */}
          <div style={styles.totalBar}>
            <span style={styles.totalLabel}>Period Total</span>
            <span style={styles.totalAmount}>{formatCents(grandTotal)}</span>
          </div>
        </>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────

const styles = {
  page: {
    minHeight: '100vh',
    background: '#0f0f1a',
    padding: '32px 24px',
    fontFamily: 'DM Sans, sans-serif',
    color: 'rgba(255,255,255,0.9)',
    maxWidth: 900,
    margin: '0 auto',
  },
  header: {
    marginBottom: 24,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
    color: '#fff',
    margin: 0,
  },
  refreshBtn: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '7px 14px', fontSize: 13, borderRadius: 8,
    background: 'rgba(99,102,241,0.18)', color: '#fff',
    border: '1px solid rgba(99,102,241,0.5)', cursor: 'pointer',
    fontFamily: 'inherit',
  },
  refreshBtnDisabled: { opacity: 0.6, cursor: 'default' },
  refreshIcon: { fontSize: 15, display: 'inline-block', lineHeight: 1 },
  refreshIconSpin: { animation: 'spin 0.8s linear infinite' },
  oneOffForm: {
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 12, padding: '12px 16px', marginBottom: 8,
  },
  oneOffInput: {
    flex: 1, minWidth: 140,
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8, padding: '8px 10px', color: '#fff', fontSize: 13, fontFamily: 'inherit',
  },
  addOneOffBtn: {
    background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.7)',
    border: '1px dashed rgba(255,255,255,0.18)', borderRadius: 10,
    padding: '10px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
    fontFamily: 'inherit', width: '100%',
  },

  // Period bar
  periodBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: '16px 20px',
    marginBottom: 12,
  },
  periodInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  periodLabel: {
    fontSize: 16,
    fontWeight: 600,
    color: '#fff',
  },
  paydayBadge: {
    fontSize: 12,
    fontWeight: 600,
    background: 'rgba(99,102,241,0.15)',
    color: '#a5b4fc',
    padding: '4px 10px',
    borderRadius: 12,
  },
  grandTotal: {
    fontSize: 22,
    fontWeight: 700,
    color: '#fff',
  },

  // History
  historyToggle: {
    display: 'flex',
    gap: 8,
    marginBottom: 12,
  },
  historyBtn: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: 500,
    color: 'rgba(255,255,255,0.6)',
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
  },
  historyRow: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 20,
  },
  historyPill: {
    padding: '6px 14px',
    borderRadius: 20,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.04)',
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
  },
  historyPillActive: {
    background: '#6366f1',
    color: '#fff',
    borderColor: '#6366f1',
  },

  loadingText: {
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    padding: '40px 0',
    fontSize: 14,
  },
  emptyText: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 13,
    padding: '16px 0',
  },

  // Section
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    marginTop: 28,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  sectionTotal: {
    fontSize: 14,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.7)',
  },

  // Card
  card: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 12,
    marginBottom: 8,
    overflow: 'hidden',
  },
  cardPaid: {
    background: 'rgba(34,197,94,0.06)',
    border: '1px solid rgba(34,197,94,0.25)',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 18px',
    cursor: 'pointer',
    gap: 12,
  },
  cardLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: '50%',
    background: '#6366f1',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    fontWeight: 700,
    flexShrink: 0,
  },
  cardName: {
    fontSize: 14,
    fontWeight: 600,
    color: '#fff',
    display: 'block',
  },
  cardRole: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    display: 'block',
    marginTop: 1,
  },
  typeBadge: {
    fontSize: 10,
    fontWeight: 600,
    padding: '3px 8px',
    borderRadius: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    flexShrink: 0,
  },
  typeBadgeHourly: {
    background: 'rgba(96,165,250,0.15)',
    color: '#60a5fa',
  },
  typeBadgeProject: {
    background: 'rgba(251,191,36,0.15)',
    color: '#fbbf24',
  },
  cardRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexShrink: 0,
  },
  cardCount: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
  },
  cardTotal: {
    fontSize: 15,
    fontWeight: 700,
    color: '#fff',
  },
  expandArrow: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.3)',
  },

  // Expanded assignments
  cardExpanded: {
    borderTop: '1px solid rgba(255,255,255,0.06)',
    padding: '12px 18px',
  },
  assignmentRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 0',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    gap: 12,
  },
  assignmentTitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  assignmentDate: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    flexShrink: 0,
  },
  assignmentHours: {
    fontSize: 12,
    color: 'rgba(96,165,250,0.8)',
    flexShrink: 0,
  },
  assignmentAmount: {
    fontSize: 13,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.8)',
    flexShrink: 0,
  },

  // Salary
  salaryInfo: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    flexShrink: 0,
  },
  editBtn: {
    padding: '5px 12px',
    borderRadius: 6,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
  },
  salaryFormRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 18px',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    flexWrap: 'wrap',
  },
  salarySelect: {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.05)',
    color: '#fff',
    fontSize: 13,
    fontFamily: 'DM Sans, sans-serif',
    outline: 'none',
  },
  salaryInputWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8,
    padding: '0 12px',
  },
  dollarSign: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
  },
  salaryInput: {
    padding: '8px 4px',
    border: 'none',
    background: 'transparent',
    color: '#fff',
    fontSize: 14,
    fontFamily: 'DM Sans, sans-serif',
    outline: 'none',
    width: 120,
  },
  saveBtn: {
    padding: '7px 16px',
    borderRadius: 8,
    border: 'none',
    background: '#6366f1',
    color: '#fff',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
  },
  cancelBtn: {
    padding: '7px 14px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'transparent',
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
  },
  removeBtn: {
    padding: '7px 14px',
    borderRadius: 8,
    border: '1px solid rgba(239,68,68,0.2)',
    background: 'rgba(239,68,68,0.08)',
    color: '#f87171',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
  },

  // Pay method & paid controls
  payMethodBadge: {
    fontSize: 11,
    fontWeight: 600,
    padding: '3px 10px',
    borderRadius: 10,
    cursor: 'pointer',
    flexShrink: 0,
  },
  payMethodAuto: {
    color: '#22c55e',
    background: 'rgba(34,197,94,0.12)',
  },
  payMethodBlue: {
    color: '#60a5fa',
    background: 'rgba(96,165,250,0.12)',
  },
  payMethodNone: {
    color: 'rgba(255,255,255,0.35)',
    background: 'rgba(255,255,255,0.06)',
  },
  payAutoLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: '#22c55e',
    flexShrink: 0,
  },
  payBtn: {
    padding: '4px 12px',
    borderRadius: 6,
    border: '1px solid rgba(96,165,250,0.3)',
    background: 'rgba(96,165,250,0.12)',
    color: '#60a5fa',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
    flexShrink: 0,
  },
  payBtnDisabled: {
    padding: '4px 12px',
    borderRadius: 6,
    border: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(255,255,255,0.04)',
    color: 'rgba(255,255,255,0.25)',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'default',
    fontFamily: 'DM Sans, sans-serif',
    flexShrink: 0,
  },
  paidBtn: {
    padding: '4px 12px',
    borderRadius: 6,
    border: '1px solid rgba(255,255,255,0.15)',
    background: 'transparent',
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
    flexShrink: 0,
  },
  paidBtnActive: {
    padding: '4px 12px',
    borderRadius: 6,
    border: '1px solid rgba(34,197,94,0.4)',
    background: 'rgba(34,197,94,0.2)',
    color: '#22c55e',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'DM Sans, sans-serif',
    flexShrink: 0,
  },
  payMethodFormRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 18px',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    flexWrap: 'wrap',
  },

  // Total bar
  totalBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: 'rgba(99,102,241,0.08)',
    border: '1px solid rgba(99,102,241,0.2)',
    borderRadius: 12,
    padding: '16px 20px',
    marginTop: 32,
  },
  totalLabel: {
    fontSize: 14,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.7)',
  },
  totalAmount: {
    fontSize: 22,
    fontWeight: 700,
    color: '#fff',
  },
};
