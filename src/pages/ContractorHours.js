import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { colors } from '../lib/styleTokens';
import { ptDayKey } from '../lib/ptDate';

// Build YYYY-MM-DD from local parts (m is 0-based). toISOString() converts to
// UTC, which lands period boundaries on the wrong day for UTC+ users.
const ymd = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function getPayPeriods(count = 6) {
  const periods = [];
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth();
  let isFirstHalf = now.getDate() <= 15;

  for (let i = 0; i < count; i++) {
    if (isFirstHalf) {
      periods.push({
        start: ymd(year, month, 1),
        end: ymd(year, month, 15),
        label: new Date(year, month, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) + ' 1\u201315',
      });
    } else {
      const lastDay = new Date(year, month + 1, 0).getDate();
      periods.push({
        start: ymd(year, month, 16),
        end: ymd(year, month, lastDay),
        label: new Date(year, month, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) + ` 16\u2013${lastDay}`,
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

export default function ContractorHours() {
  const { profile } = useAuth();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formState, setFormState] = useState({});
  const [submitting, setSubmitting] = useState(null);
  // Auto-computed hours per period, keyed by `${start}_${end}` →
  // { hours, count }. Prefilled from the sum of hours_spent on assignments
  // completed within the period (attributed by completed_at, PT).
  const [autoByPeriod, setAutoByPeriod] = useState({});

  const periods = getPayPeriods(6);

  const fetchHours = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from('contractor_hours')
      .select('*, reviewer:profiles!reviewed_by(full_name)')
      .eq('contractor_id', profile.id)
      .order('period_start', { ascending: false });
    setRecords(data || []);

    // Auto-sum hours_spent from completed assignments, bucketed by the pay
    // period their completed_at (PT calendar day) falls into.
    const { data: asgs } = await supabase
      .from('contractor_assignments')
      .select('hours_spent, completed_at')
      .eq('contractor_id', profile.id)
      .not('hours_spent', 'is', null)
      .not('completed_at', 'is', null);
    const auto = {};
    for (const p of getPayPeriods(6)) {
      const key = p.start + '_' + p.end;
      let sum = 0;
      let count = 0;
      for (const a of asgs || []) {
        const day = ptDayKey(a.completed_at); // 'YYYY-MM-DD' in PT
        if (day >= p.start && day <= p.end) {
          sum += Number(a.hours_spent) || 0;
          count += 1;
        }
      }
      if (count > 0) auto[key] = { hours: Math.round(sum * 100) / 100, count };
    }
    setAutoByPeriod(auto);
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => {
    fetchHours();
  }, [fetchHours]);

  function getRecord(period) {
    return records.find(r => r.period_start === period.start && r.period_end === period.end);
  }

  function getFormValue(periodKey, field) {
    if (formState[periodKey] && formState[periodKey][field] !== undefined) {
      return formState[periodKey][field];
    }
    return undefined;
  }

  function setFormValue(periodKey, field, value) {
    setFormState(prev => ({
      ...prev,
      [periodKey]: { ...(prev[periodKey] || {}), [field]: value },
    }));
  }

  async function handleSubmit(period) {
    const key = period.start + '_' + period.end;
    const record = getRecord(period);
    // Total is always the PT-bucketed sum of completed-assignment hours for the
    // period — never a hand-typed number. Submitting is an attestation that
    // snapshots that derived value.
    const auto = autoByPeriod[key];
    const totalHours = auto ? auto.hours : 0;
    const notes = getFormValue(key, 'notes') ?? (record ? record.notes : '');

    setSubmitting(key);
    await supabase.from('contractor_hours').upsert({
      contractor_id: profile.id,
      period_start: period.start,
      period_end: period.end,
      total_hours: totalHours,
      notes: notes || null,
      submitted_at: new Date().toISOString(),
    }, { onConflict: 'contractor_id,period_start,period_end' });
    supabase.functions.invoke('send-notification-email', {
      body: {
        trigger_key: 'fl_hours_submitted',
        recipient_id: '__all_admins__',
        context: {
          person_name: profile.full_name,
          hours: totalHours,
          period: `${period.start} – ${period.end}`,
        },
      },
    }).catch(() => {});

    setFormState(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    await fetchHours();
    setSubmitting(null);
  }

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <h1 style={styles.title}>Hours</h1>
        </div>
        <p style={styles.loadingText}>Loading...</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Hours</h1>
        <p style={styles.subtitle}>Review and confirm your assignment-reported hours for each pay period</p>
      </div>

      {periods.map((period, idx) => {
        const key = period.start + '_' + period.end;
        const record = getRecord(period);
        const isCurrent = idx === 0;
        const isReviewed = record && record.reviewed_at;
        const auto = autoByPeriod[key];
        // The pay-period total is always the PT-bucketed sum of completed
        // assignments in the period — read-only, never hand-typed.
        const computedHours = auto ? auto.hours : 0;
        const assignmentCount = auto ? auto.count : 0;
        const notes = getFormValue(key, 'notes') ?? (record ? record.notes || '' : '');

        return (
          <div
            key={key}
            style={{
              ...styles.periodCard,
              ...(isCurrent ? styles.currentPeriodCard : {}),
            }}
          >
            <div style={styles.periodHeader}>
              <div style={styles.periodLabelRow}>
                <span style={styles.periodLabel}>{period.label}</span>
                {isCurrent && <span style={styles.currentBadge}>Current Period</span>}
                {isReviewed && (
                  <span style={styles.reviewedBadge}>
                    <span style={{ marginRight: 4 }}>&#10003;</span>
                    Reviewed by {record.reviewer?.full_name || 'Admin'}
                    {record.reviewed_at && (
                      <span style={styles.reviewDate}>
                        {' \u2014 '}
                        {new Date(record.reviewed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                  </span>
                )}
              </div>
              {record && record.submitted_at && (
                <span style={styles.submittedAt}>
                  Submitted {new Date(record.submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
              )}
            </div>

            {isReviewed ? (
              <div style={styles.readOnlyRow}>
                <div style={styles.readOnlyField}>
                  <span style={styles.fieldLabel}>Hours</span>
                  <span style={styles.readOnlyValue}>{record.total_hours}</span>
                </div>
                {record.notes && (
                  <div style={styles.readOnlyField}>
                    <span style={styles.fieldLabel}>Notes</span>
                    <span style={styles.readOnlyValue}>{record.notes}</span>
                  </div>
                )}
              </div>
            ) : (
              <div style={styles.formRow}>
                <div style={styles.computedField}>
                  <span style={styles.fieldLabel}>Total Hours</span>
                  <div style={styles.computedTotal}>{computedHours}h</div>
                  <span style={styles.computedCaption}>
                    From {assignmentCount} completed assignment{assignmentCount === 1 ? '' : 's'} this period
                  </span>
                </div>
                <div style={styles.notesField}>
                  <label style={styles.fieldLabel}>Notes</label>
                  <textarea
                    value={notes}
                    onChange={e => setFormValue(key, 'notes', e.target.value)}
                    placeholder="Optional notes about this period..."
                    style={styles.textarea}
                    rows={2}
                  />
                </div>
                <div style={styles.submitCol}>
                  <button
                    onClick={() => handleSubmit(period)}
                    disabled={submitting === key}
                    style={{
                      ...styles.submitBtn,
                      ...(submitting === key ? styles.submitBtnDisabled : {}),
                    }}
                  >
                    {submitting === key ? 'Saving...' : record ? 'Update' : 'Confirm'}
                  </button>
                </div>
              </div>
            )}

            {!record && !isCurrent && (
              <p style={styles.noRecord}>No hours submitted for this period</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

const styles = {
  container: {
    padding: '32px 40px',
    maxWidth: 800,
    margin: '0 auto',
    fontFamily: 'DM Sans, sans-serif',
  },
  header: {
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.95)',
    margin: 0,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 6,
  },
  loadingText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
  },
  periodCard: {
    background: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    padding: '20px 24px',
    marginBottom: 16,
    border: '1px solid rgba(255,255,255,0.06)',
  },
  currentPeriodCard: {
    borderLeft: '3px solid #5b8fc7',
    background: colors.accentA06,
  },
  periodHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
    flexWrap: 'wrap',
    gap: 8,
  },
  periodLabelRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  periodLabel: {
    fontSize: 16,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.9)',
  },
  currentBadge: {
    fontSize: 11,
    fontWeight: 600,
    color: colors.accent,
    background: colors.accentA15,
    padding: '2px 8px',
    borderRadius: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  reviewedBadge: {
    fontSize: 12,
    color: '#22c55e',
    display: 'flex',
    alignItems: 'center',
    gap: 2,
  },
  reviewDate: {
    color: 'rgba(255,255,255,0.4)',
  },
  submittedAt: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.35)',
  },
  formRow: {
    display: 'flex',
    gap: 16,
    alignItems: 'flex-end',
    flexWrap: 'wrap',
  },
  hoursField: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    minWidth: 100,
    flex: '0 0 120px',
  },
  notesField: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    flex: 1,
    minWidth: 200,
  },
  submitCol: {
    display: 'flex',
    alignItems: 'flex-end',
    paddingBottom: 1,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: 500,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    padding: '8px 12px',
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
    fontFamily: 'DM Sans, sans-serif',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  },
  textarea: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    padding: '8px 12px',
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
    fontFamily: 'DM Sans, sans-serif',
    outline: 'none',
    resize: 'vertical',
    width: '100%',
    boxSizing: 'border-box',
  },
  submitBtn: {
    background: colors.accent,
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '8px 20px',
    fontSize: 13,
    fontWeight: 600,
    fontFamily: 'DM Sans, sans-serif',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  submitBtnDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  computedField: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    flex: '0 0 200px',
    minWidth: 160,
  },
  computedTotal: {
    fontSize: 22,
    fontWeight: 700,
    color: colors.text,
    lineHeight: 1.1,
  },
  computedCaption: {
    fontSize: 11,
    color: colors.accentFg,
    lineHeight: 1.4,
  },
  readOnlyRow: {
    display: 'flex',
    gap: 32,
    flexWrap: 'wrap',
  },
  readOnlyField: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  readOnlyValue: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
  },
  noRecord: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.3)',
    fontStyle: 'italic',
    margin: 0,
  },
};
