import React, { useState } from 'react';
import { supabase } from '../../../supabaseClient';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { PLATFORM_META } from '../constants';
import { daysAgoStr, todayStr, getDaysInRange } from '../utils';
import { styles } from '../styles';

export default function ManualMetricsForm({ platform, fields, accounts }) {
  const confirm = useConfirm();
  const [startDate, setStartDate] = useState(daysAgoStr(30));
  const [endDate, setEndDate] = useState(todayStr());
  const [views, setViews] = useState('');
  const [revenue, setRevenue] = useState('');
  const [subscribers, setSubscribers] = useState('');
  const [followers, setFollowers] = useState('');
  const [supporters, setSupporters] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  // Manage entries state
  const [showManage, setShowManage] = useState(false);
  const [entries, setEntries] = useState([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [deleteStart, setDeleteStart] = useState('');
  const [deleteEnd, setDeleteEnd] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState(null);
  const [selectedDates, setSelectedDates] = useState(new Set());

  const account = accounts.find(a => a.platform === platform);
  const meta = PLATFORM_META[platform] || {};
  const color = meta.color || '#666';

  const hasViews = fields.includes('views');
  const hasRevenue = fields.includes('revenue');
  const hasSubscribers = fields.includes('subscribers');
  const hasFollowers = fields.includes('followers');
  const hasSupporters = fields.includes('supporters');

  async function loadEntries() {
    if (!account) return;
    setLoadingEntries(true);
    try {
      // Fetch platform_daily_metrics
      const { data: pdm } = await supabase.from('platform_daily_metrics')
        .select('id, date, views, likes, comments, shares')
        .eq('platform_account_id', account.id)
        .order('date', { ascending: false })
        .limit(200);

      // Fetch manual revenue_events
      const { data: rev } = await supabase.from('revenue_events')
        .select('id, stripe_event_id, occurred_at, net_amount_cents')
        .eq('platform_account_id', account.id)
        .like('stripe_event_id', `manual_${platform}_%`)
        .order('occurred_at', { ascending: false })
        .limit(200);

      // Fetch audience_snapshots
      const { data: aud } = await supabase.from('audience_snapshots')
        .select('id, date, followers_total, metadata')
        .eq('platform_account_id', account.id)
        .order('date', { ascending: false })
        .limit(200);

      // Merge by date
      const byDate = {};
      for (const row of (pdm || [])) {
        byDate[row.date] = { ...byDate[row.date], date: row.date, pdm_id: row.id, views: row.views, likes: row.likes, comments: row.comments, shares: row.shares };
      }
      for (const row of (rev || [])) {
        const d = row.occurred_at?.split('T')[0];
        if (d) byDate[d] = { ...byDate[d], date: d, rev_id: row.id, revenue_cents: row.net_amount_cents };
      }
      for (const row of (aud || [])) {
        byDate[row.date] = { ...byDate[row.date], date: row.date, aud_id: row.id, followers_total: row.followers_total, supporters: row.metadata?.supporters };
      }
      setEntries(Object.values(byDate).sort((a, b) => b.date.localeCompare(a.date)));
    } catch (err) {
      console.error('Error loading entries:', err);
    }
    setLoadingEntries(false);
  }

  async function handleDeleteRange() {
    if (!account || !deleteStart || !deleteEnd) return;
    if (deleteStart > deleteEnd) { setDeleteResult({ error: 'Start must be before end' }); return; }
    if (!(await confirm(`Delete all manual ${meta.label} data from ${deleteStart} to ${deleteEnd}?`))) return;
    setDeleting(true); setDeleteResult(null);
    try {
      let deleted = 0;
      // Delete platform_daily_metrics
      if (hasViews) {
        const { data } = await supabase.from('platform_daily_metrics')
          .delete()
          .eq('platform_account_id', account.id)
          .gte('date', deleteStart)
          .lte('date', deleteEnd)
          .select('id');
        deleted += data?.length || 0;
      }
      // Delete manual revenue_events
      if (hasRevenue) {
        const days = getDaysInRange(deleteStart, deleteEnd);
        const eventIds = days.map(d => `manual_${platform}_${account.id}_${d}`);
        for (let i = 0; i < eventIds.length; i += 100) {
          const batch = eventIds.slice(i, i + 100);
          const { data } = await supabase.from('revenue_events')
            .delete()
            .in('stripe_event_id', batch)
            .select('id');
          deleted += data?.length || 0;
        }
      }
      // Delete audience_snapshots
      if (hasSubscribers || hasFollowers || hasSupporters) {
        const { data } = await supabase.from('audience_snapshots')
          .delete()
          .eq('platform_account_id', account.id)
          .gte('date', deleteStart)
          .lte('date', deleteEnd)
          .select('id');
        deleted += data?.length || 0;
      }
      setDeleteResult({ success: true, count: deleted });
      loadEntries();
    } catch (err) {
      setDeleteResult({ error: err.message });
    }
    setDeleting(false);
  }

  async function handleDeleteSingleDay(entry) {
    if (!account) return;
    if (!(await confirm(`Delete ${meta.label} data for ${entry.date}?`))) return;
    try {
      if (entry.pdm_id) await supabase.from('platform_daily_metrics').delete().eq('id', entry.pdm_id);
      if (entry.rev_id) await supabase.from('revenue_events').delete().eq('id', entry.rev_id);
      if (entry.aud_id) await supabase.from('audience_snapshots').delete().eq('id', entry.aud_id);
      setEntries(prev => prev.filter(e => e.date !== entry.date));
      setSelectedDates(prev => { const n = new Set(prev); n.delete(entry.date); return n; });
    } catch (err) {
      console.error('Delete error:', err);
    }
  }

  async function handleDeleteSelected() {
    if (!account || selectedDates.size === 0) return;
    if (!(await confirm(`Delete ${selectedDates.size} selected ${meta.label} entr${selectedDates.size === 1 ? 'y' : 'ies'}?`))) return;
    setDeleting(true); setDeleteResult(null);
    try {
      const selected = entries.filter(e => selectedDates.has(e.date));
      const pdmIds = selected.map(e => e.pdm_id).filter(Boolean);
      const revIds = selected.map(e => e.rev_id).filter(Boolean);
      const audIds = selected.map(e => e.aud_id).filter(Boolean);
      let deleted = 0;
      if (pdmIds.length) { const { data } = await supabase.from('platform_daily_metrics').delete().in('id', pdmIds).select('id'); deleted += data?.length || 0; }
      if (revIds.length) { const { data } = await supabase.from('revenue_events').delete().in('id', revIds).select('id'); deleted += data?.length || 0; }
      if (audIds.length) { const { data } = await supabase.from('audience_snapshots').delete().in('id', audIds).select('id'); deleted += data?.length || 0; }
      setEntries(prev => prev.filter(e => !selectedDates.has(e.date)));
      setSelectedDates(new Set());
      setDeleteResult({ success: true, count: deleted });
    } catch (err) {
      setDeleteResult({ error: err.message });
    }
    setDeleting(false);
  }

  function toggleSelectDate(date) {
    setSelectedDates(prev => {
      const n = new Set(prev);
      if (n.has(date)) n.delete(date); else n.add(date);
      return n;
    });
  }

  function toggleSelectAll() {
    if (selectedDates.size === entries.length) setSelectedDates(new Set());
    else setSelectedDates(new Set(entries.map(e => e.date)));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!account) return;
    if (startDate > endDate) { setResult({ error: 'Start date must be before end date' }); return; }
    setSubmitting(true); setResult(null);
    let logEntry = null;

    try {
      // Create ingestion log entry
      const { data: logData } = await supabase.from('ingestion_logs')
        .insert({ platform_account_id: account.id, job_type: `manual_input_${platform}`, status: 'running' })
        .select().single();
      logEntry = logData;

      const days = getDaysInRange(startDate, endDate);
      const numDays = days.length;
      if (numDays === 0) throw new Error('Invalid date range'); // avoid /0 → Infinity/NaN metrics
      let recordsProcessed = 0;

      // Views: split total evenly across days, remainder goes to last day
      if (hasViews && views) {
        const totalViews = parseInt(views, 10) || 0;
        const perDay = Math.floor(totalViews / numDays);
        const remainder = totalViews - perDay * numDays;
        const rows = days.map((d, i) => ({
          platform_account_id: account.id,
          date: d,
          views: perDay + (i === numDays - 1 ? remainder : 0),
          metadata: {},
        }));
        for (let i = 0; i < rows.length; i += 100) {
          const batch = rows.slice(i, i + 100);
          const { error } = await supabase.from('platform_daily_metrics')
            .upsert(batch, { onConflict: 'platform_account_id,date' });
          if (error) throw new Error(`Views: ${error.message}`);
        }
        recordsProcessed += rows.length;
      }

      // Revenue: split total evenly across days
      if (hasRevenue && revenue) {
        const totalCents = Math.round(parseFloat(revenue) * 100);
        if (totalCents > 0) {
          const perDay = Math.floor(totalCents / numDays);
          const remainder = totalCents - perDay * numDays;
          const rows = days.map((d, i) => ({
            stripe_event_id: `manual_${platform}_${account.id}_${d}`,
            event_type: 'charge',
            amount_cents: perDay + (i === numDays - 1 ? remainder : 0),
            net_amount_cents: perDay + (i === numDays - 1 ? remainder : 0),
            currency: 'usd',
            product_category: 'ad_revenue',
            is_recurring: false,
            occurred_at: `${d}T00:00:00Z`,
            metadata: { source: 'manual_input', platform },
            platform_account_id: account.id,
          }));
          for (let i = 0; i < rows.length; i += 100) {
            const batch = rows.slice(i, i + 100);
            const { error } = await supabase.from('revenue_events')
              .upsert(batch, { onConflict: 'stripe_event_id' });
            if (error) throw new Error(`Revenue: ${error.message}`);
          }
          recordsProcessed += rows.length;
        }
      }

      // Followers / Supporters: audience_snapshots (snapshot, not split)
      const hasFollowersVal = hasFollowers && followers;
      const hasSupportersVal = hasSupporters && supporters;
      if (hasFollowersVal || hasSupportersVal) {
        const folNum = parseInt(followers, 10) || 0;
        const supNum = parseInt(supporters, 10) || 0;
        const rows = days.map(d => {
          const row = {
            platform_account_id: account.id,
            date: d,
            followers_gained: 0,
            demographics: {},
            metadata: { source: 'manual_input' },
          };
          if (hasFollowersVal) row.followers_total = folNum;
          if (hasSupportersVal) row.metadata.supporters = supNum;
          return row;
        });
        for (let i = 0; i < rows.length; i += 100) {
          const batch = rows.slice(i, i + 100);
          const { error } = await supabase.from('audience_snapshots')
            .upsert(batch, { onConflict: 'platform_account_id,date' });
          if (error) throw new Error(`Audience: ${error.message}`);
        }
        recordsProcessed += rows.length;
      }

      setResult({ success: true, days: numDays });
      setViews(''); setRevenue(''); setSubscribers(''); setFollowers(''); setSupporters('');

      if (logEntry?.id) await supabase.from('ingestion_logs').update({
        status: 'success', records_processed: recordsProcessed, records_created: recordsProcessed, completed_at: new Date().toISOString(),
      }).eq('id', logEntry.id);
    } catch (err) {
      setResult({ error: err.message });
      if (logEntry?.id) await supabase.from('ingestion_logs').update({
        status: 'failed', error_message: err.message, completed_at: new Date().toISOString(),
      }).eq('id', logEntry.id);
    }
    setSubmitting(false);
  }

  if (!account) return <p style={{ color: 'rgba(255,255,255,0.42)', fontSize: '13px', margin: 0 }}>No {meta.label} account found.</p>;

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.42)', margin: '0 0 10px' }}>
          Enter totals for the date range. Views and revenue are split evenly across days. Followers{hasSupporters ? ' and supporters are' : ' is'} set as a snapshot for each day.
        </p>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', color: 'rgba(255,255,255,0.42)', fontWeight: 600 }}>Start Date</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              style={{ ...styles.filterInput, padding: '8px 10px' }} required />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', color: 'rgba(255,255,255,0.42)', fontWeight: 600 }}>End Date</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              style={{ ...styles.filterInput, padding: '8px 10px' }} required />
          </div>
          {hasViews && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', color: 'rgba(255,255,255,0.42)', fontWeight: 600 }}>Total Views</label>
              <input type="text" inputMode="numeric" pattern="[0-9]*" value={views}
                onChange={e => setViews(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="0" style={{ ...styles.filterInput, padding: '8px 10px', width: '120px' }} />
            </div>
          )}
          {hasRevenue && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', color: 'rgba(255,255,255,0.42)', fontWeight: 600 }}>Total Revenue ($)</label>
              <input type="text" inputMode="decimal" value={revenue}
                onChange={e => setRevenue(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="0.00" style={{ ...styles.filterInput, padding: '8px 10px', width: '120px' }} />
            </div>
          )}
          {hasSubscribers && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', color: 'rgba(255,255,255,0.42)', fontWeight: 600 }}>Subscribers</label>
              <input type="text" inputMode="numeric" pattern="[0-9]*" value={subscribers}
                onChange={e => setSubscribers(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="0" style={{ ...styles.filterInput, padding: '8px 10px', width: '120px' }} />
            </div>
          )}
          {hasSupporters && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', color: 'rgba(255,255,255,0.42)', fontWeight: 600 }}>Supporters</label>
              <input type="text" inputMode="numeric" pattern="[0-9]*" value={supporters}
                onChange={e => setSupporters(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="0" style={{ ...styles.filterInput, padding: '8px 10px', width: '120px' }} />
            </div>
          )}
          {hasFollowers && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', color: 'rgba(255,255,255,0.42)', fontWeight: 600 }}>{platform === 'substack' ? 'Subscribers' : 'Followers'}</label>
              <input type="text" inputMode="numeric" pattern="[0-9]*" value={followers}
                onChange={e => setFollowers(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="0" style={{ ...styles.filterInput, padding: '8px 10px', width: '120px' }} />
            </div>
          )}
          <button type="submit" disabled={submitting}
            style={{ ...styles.uploadBtn, borderColor: color + '66', color, opacity: submitting ? 0.5 : 1 }}>
            {submitting ? 'Saving...' : 'Save'}
          </button>
          {result && (
            <span style={{ fontSize: '12px', fontWeight: 500, color: result.error ? '#f87171' : '#4ade80' }}>
              {result.error ? `Error: ${result.error}` : `Saved across ${result.days} day${result.days > 1 ? 's' : ''}`}
            </span>
          )}
        </div>
      </form>

      {/* Manage Entries */}
      <div style={{ marginTop: '16px' }}>
        <button onClick={() => { setShowManage(!showManage); if (!showManage) loadEntries(); }}
          style={{ ...styles.collapseBtn, width: 'auto', fontSize: '12px', padding: '6px 14px' }}>
          {showManage ? '▾' : '▸'} Manage Entries
        </button>
        {showManage && (
          <div style={{ marginTop: '10px', padding: '12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px' }}>
            {/* Delete range */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '12px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <label style={{ fontSize: '10px', color: 'rgba(255,255,255,0.42)', fontWeight: 600, textTransform: 'uppercase' }}>Delete from</label>
                <input type="date" value={deleteStart} onChange={e => setDeleteStart(e.target.value)}
                  style={{ ...styles.filterInput, padding: '6px 8px', fontSize: '11px' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <label style={{ fontSize: '10px', color: 'rgba(255,255,255,0.42)', fontWeight: 600, textTransform: 'uppercase' }}>to</label>
                <input type="date" value={deleteEnd} onChange={e => setDeleteEnd(e.target.value)}
                  style={{ ...styles.filterInput, padding: '6px 8px', fontSize: '11px' }} />
              </div>
              <button onClick={handleDeleteRange} disabled={deleting || !deleteStart || !deleteEnd}
                style={{ padding: '6px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#f87171', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: deleting ? 0.5 : 1 }}>
                {deleting ? 'Deleting...' : 'Delete Range'}
              </button>
              {selectedDates.size > 0 && (
                <button onClick={handleDeleteSelected} disabled={deleting}
                  style={{ padding: '6px 14px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '6px', color: '#f87171', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: deleting ? 0.5 : 1 }}>
                  {deleting ? 'Deleting...' : `Delete Selected (${selectedDates.size})`}
                </button>
              )}
              {deleteResult && (
                <span style={{ fontSize: '11px', fontWeight: 500, color: deleteResult.error ? '#f87171' : '#4ade80' }}>
                  {deleteResult.error ? deleteResult.error : `${deleteResult.count} record${deleteResult.count !== 1 ? 's' : ''} deleted`}
                </span>
              )}
            </div>

            {/* Entries table */}
            {loadingEntries ? (
              <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.42)', margin: 0 }}>Loading...</p>
            ) : entries.length === 0 ? (
              <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.42)', margin: 0 }}>No entries found.</p>
            ) : (
              <div style={{ maxHeight: '300px', overflow: 'auto', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '6px 6px 6px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', position: 'sticky', top: 0, background: 'rgba(255,255,255,0.03)', width: '28px' }}>
                        <input type="checkbox" checked={selectedDates.size === entries.length && entries.length > 0} onChange={toggleSelectAll}
                          style={{ cursor: 'pointer', accentColor: color }} />
                      </th>
                      <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: '10px', color: 'rgba(255,255,255,0.42)', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)', position: 'sticky', top: 0, background: 'rgba(255,255,255,0.03)' }}>Date</th>
                      {hasViews && <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: '10px', color: 'rgba(255,255,255,0.42)', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)', position: 'sticky', top: 0, background: 'rgba(255,255,255,0.03)' }}>Views</th>}
                      {hasRevenue && <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: '10px', color: 'rgba(255,255,255,0.42)', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)', position: 'sticky', top: 0, background: 'rgba(255,255,255,0.03)' }}>Revenue</th>}
                      {hasSupporters && <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: '10px', color: 'rgba(255,255,255,0.42)', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)', position: 'sticky', top: 0, background: 'rgba(255,255,255,0.03)' }}>Supporters</th>}
                      {(hasFollowers || hasSubscribers) && <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: '10px', color: 'rgba(255,255,255,0.42)', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)', position: 'sticky', top: 0, background: 'rgba(255,255,255,0.03)' }}>{platform === 'substack' ? 'Subs' : 'Followers'}</th>}
                      <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: '10px', color: 'rgba(255,255,255,0.42)', borderBottom: '1px solid rgba(255,255,255,0.06)', position: 'sticky', top: 0, background: 'rgba(255,255,255,0.03)', width: '40px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map(entry => (
                      <tr key={entry.date} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: selectedDates.has(entry.date) ? 'rgba(255,255,255,0.04)' : 'transparent' }}>
                        <td style={{ padding: '5px 6px 5px 10px' }}>
                          <input type="checkbox" checked={selectedDates.has(entry.date)} onChange={() => toggleSelectDate(entry.date)}
                            style={{ cursor: 'pointer', accentColor: color }} />
                        </td>
                        <td style={{ padding: '5px 10px', color: 'rgba(255,255,255,0.55)' }}>{entry.date}</td>
                        {hasViews && <td style={{ padding: '5px 10px', color: 'rgba(255,255,255,0.55)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{entry.views != null ? Number(entry.views).toLocaleString() : '—'}</td>}
                        {hasRevenue && <td style={{ padding: '5px 10px', color: 'rgba(255,255,255,0.55)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{entry.revenue_cents != null ? '$' + (entry.revenue_cents / 100).toFixed(2) : '—'}</td>}
                        {hasSupporters && <td style={{ padding: '5px 10px', color: 'rgba(255,255,255,0.55)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{entry.supporters != null ? Number(entry.supporters).toLocaleString() : '—'}</td>}
                        {(hasFollowers || hasSubscribers) && <td style={{ padding: '5px 10px', color: 'rgba(255,255,255,0.55)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{entry.followers_total != null ? Number(entry.followers_total).toLocaleString() : '—'}</td>}
                        <td style={{ padding: '5px 10px', textAlign: 'right' }}>
                          <button onClick={() => handleDeleteSingleDay(entry)}
                            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.32)', cursor: 'pointer', fontSize: '13px', padding: '2px 4px' }}
                            title={`Delete ${entry.date}`}>✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
