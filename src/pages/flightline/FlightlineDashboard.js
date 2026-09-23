import React, { useEffect, useState } from 'react';
import { FLIGHTLINE_ORIGIN, FLIGHTLINE_DOWNLOAD, flightline, uploadFootage, completeFlightlineHandoff } from '../../lib/flightline';
import { colors, spacing, radii, fontSizes, fontFamily } from '../../lib/styleTokens';
import { button } from '../../lib/styleRecipes';

export default function FlightlineDashboard() {
  const [data, setData] = useState(null), [error, setError] = useState('');
  const [name, setName] = useState(''), [selected, setSelected] = useState('');
  const [jobs, setJobs] = useState([]), [busy, setBusy] = useState(false), [upload, setUpload] = useState(null);
  const handoff = new URLSearchParams(window.location.search).get('connect') === 'flightline';
  useEffect(() => {
    if (!handoff) return undefined;
    let active = true;
    completeFlightlineHandoff(window.location.search).then(url => { if (active) window.location.replace(url); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [handoff]);
  useEffect(() => {
    if (handoff || !FLIGHTLINE_ORIGIN) return undefined;
    let active = true;
    const refresh = async () => {
      try {
        const result = await flightline('/dashboard');
        if (active) { setData(result); setError(''); setSelected(id => id || result.projects[0]?.id || ''); }
      } catch (e) { if (active) { setData(null); setError(e.message); } }
    };
    refresh(); const timer = setInterval(refresh, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [handoff]);
  const connected = Boolean(data);
  useEffect(() => {
    setJobs([]);
    if (!selected || !connected) return undefined;
    let active = true;
    const refresh = () => flightline(`/jobs?project_id=${encodeURIComponent(selected)}`)
      .then(result => { if (active) setJobs(result); }).catch(e => { if (active) setError(e.message); });
    refresh(); const timer = setInterval(refresh, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [selected, connected]);

  const create = async event => {
    event.preventDefault(); setBusy(true);
    try {
      const project = await flightline('/projects', { method: 'POST', body: JSON.stringify({ name }) });
      setData(await flightline('/dashboard')); setSelected(project.id); setName('');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const send = async event => {
    const files = Array.from(event.target.files || []), destination = selected;
    event.target.value = '';
    try {
      for (const file of files) {
        setUpload({ name: file.name, progress: 0 });
        await uploadFootage(file, destination, progress => setUpload({ name: file.name, progress }));
      }
      if (destination === selected) setJobs(await flightline(`/jobs?project_id=${encodeURIComponent(destination)}`));
    } catch (e) { setError(e.message); } finally { setUpload(null); }
  };

  return <main style={styles.page}>
    <header style={styles.row}><div><a href="/dashboard" style={styles.link}>Mayday Studio</a><h1>Flightline</h1><p style={styles.muted}>Your tracer production workspace.</p></div>
      <div style={styles.row}>{FLIGHTLINE_DOWNLOAD && <a href={FLIGHTLINE_DOWNLOAD} style={styles.action}>Download for Mac</a>}
        {FLIGHTLINE_ORIGIN && <a href={`${FLIGHTLINE_ORIGIN}/?signin=mayday`} style={styles.action}>Open editing Terminal</a>}</div>
    </header>
    {error && <p role="alert" style={styles.error}>{error}</p>}
    {handoff ? <section style={styles.card}><h2>{error ? 'Unable to connect' : 'Connecting to Flightline…'}</h2><p>Using your Mayday Studio account.</p><a href="/flightline" style={styles.link}>Back to Flightline</a></section> : <>
      {!FLIGHTLINE_ORIGIN ? <section style={styles.card}><h2>Your workspace is being connected.</h2><p>The Dashboard will appear here when the studio connection is ready.</p></section> : !data ? <p>{error ? 'Workspace unavailable.' : 'Connecting to your studio…'}</p> : <>
        <section style={styles.row}><article style={styles.card}><h2>{data.projects.length} projects</h2><p>{data.workers.length} workers online</p></article><article style={styles.card}><h2>{data.tasks.filter(t => ['queued', 'running'].includes(t.status)).length} active jobs</h2><p>{data.host.media_online ? 'Media storage connected' : 'Media storage unavailable'}</p></article></section>
        <section style={styles.card}><h2>Projects</h2><form onSubmit={create} style={styles.row}><input aria-label="New project name" placeholder="Project name" value={name} onChange={e => setName(e.target.value)} required style={styles.input}/><button disabled={busy || !name.trim()} style={styles.action}>Create project</button></form>
          <div style={styles.row}><select aria-label="Project" disabled={!!upload} value={selected} onChange={e => setSelected(e.target.value)} style={styles.input}><option value="">Choose a project</option>{data.projects.map(p => <option key={p.id} value={p.id}>{p.name} ({p.clip_count} clips)</option>)}</select>
            {selected && <label style={styles.action}>Upload footage<input type="file" aria-label="Upload footage" accept="video/*,.mkv,.m4v" multiple disabled={!!upload} onChange={send}/></label>}</div>
          {upload && <p role="status">{upload.progress === 1 ? 'Validating' : 'Uploading'} {upload.name} <progress max={1} value={upload.progress}/></p>}
          <div style={styles.tableWrap}><table style={styles.table}><thead><tr><th>Footage</th><th>Status</th><th>Reviewer</th></tr></thead><tbody>{jobs.map(job => <tr key={job.id}><td>{job.name}</td><td>{job.approval ? 'Approved' : job.status}<p style={styles.muted}>{job.message}</p></td><td>{job.assigned_to || 'Unassigned'}</td></tr>)}</tbody></table></div>
          {selected && jobs.length === 0 && <p>No footage yet. Upload a clip to begin.</p>}
        </section>
        {data.tasks.some(t => t.status === 'failed') && <section style={styles.card}><h2>Needs attention</h2>{data.tasks.filter(t => t.status === 'failed').map(t => <p key={t.id}>{t.operation}: {t.error || t.message}</p>)}</section>}
      </>}
      {!FLIGHTLINE_DOWNLOAD && <p style={styles.muted}>The Mac app download will appear here when the release is ready.</p>}
    </>}
  </main>;
}
const styles = {
  page: { minHeight: '100vh', background: colors.bg, color: colors.text, fontFamily, padding: spacing.xxl, boxSizing: 'border-box' },
  row: { display: 'flex', flexWrap: 'wrap', gap: spacing.lg, alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  card: { background: colors.bgRaised, border: `1px solid ${colors.border}`, borderRadius: radii.lg, padding: spacing.xl, marginBottom: spacing.lg, flexGrow: 1 },
  action: { ...button({ variant: 'primary' }), textDecoration: 'none' },
  link: { color: colors.accentFg }, muted: { color: colors.textMuted, fontSize: fontSizes.sm },
  error: { color: colors.danger.fg }, input: { background: colors.bgInput, color: colors.text, padding: spacing.md, border: `1px solid ${colors.border}`, borderRadius: radii.md },
  tableWrap: { overflowX: 'auto' }, table: { width: '100%', textAlign: 'left', borderSpacing: spacing.md },
};
