import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import FullScreenSheet from '../components/mobile/FullScreenSheet';
import { mobileTokens } from '../utils/mobileTokens';
import usePersistedTab from '../hooks/usePersistedTab';

// Must mirror desktop Projects.js exactly — the DB status enum is
// queue/write/pre_production/film/review/edit/post_production/publish. The old
// mobile values (concept/script/production/published) matched no real rows, so
// published projects leaked into "Active" and the status chips matched nothing.
const STATUSES = ['queue', 'research', 'write', 'pre_production', 'film', 'review', 'edit', 'post_production', 'publish'];
const STATUS_LABELS = {
  queue: 'Queue', research: 'Research', write: 'Write', pre_production: 'Pre-Production', film: 'Film',
  review: 'Review', edit: 'Edit', post_production: 'Post-Production', publish: 'Published',
};
const STATUS_COLORS = {
  queue: '#8b5cf6', research: '#14b8a6', write: '#3b82f6', pre_production: '#0ea5e9', film: '#f59e0b',
  review: '#ec4899', edit: '#f97316', post_production: '#a855f7', publish: '#22c55e',
};
const TYPE_LABELS = {
  mayday_video: 'Mayday Video', tm_baseball_video: 'TM Baseball Video',
  podcast: 'Podcast', short_form: 'Short Form',
};

// Default filter shows everything except published/archived (matches the
// "active projects only by default" mobile behaviour).
const DEFAULT_FILTER = 'active';

export default function ProjectsMobile() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = usePersistedTab('projects-filter-mobile', DEFAULT_FILTER, ['active', 'all', ...STATUSES]);
  const [selected, setSelected] = useState(null);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('projects')
        .select(`
          *,
          creator:profiles!created_by(id, full_name),
          project_assignments(*, profile:profiles(id, full_name, title))
        `)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setProjects(data || []);
    } catch (err) {
      console.error('Projects fetch failed:', err);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  const visible = useMemo(() => {
    return projects.filter((p) => {
      if (p.is_archived) return false;
      if (filter === 'active') return p.status !== 'publish';
      if (filter === 'all') return true;
      return p.status === filter;
    });
  }, [projects, filter]);

  return (
    <div style={styles.root}>
      <div style={styles.filterBar}>
        <div style={styles.chipScroll}>
          <Chip label="Active" active={filter === 'active'} onClick={() => setFilter('active')} />
          <Chip label="All" active={filter === 'all'} onClick={() => setFilter('all')} />
          {STATUSES.map((s) => (
            <Chip
              key={s}
              label={STATUS_LABELS[s]}
              active={filter === s}
              accent={STATUS_COLORS[s]}
              onClick={() => setFilter(s)}
            />
          ))}
        </div>
      </div>

      {loading ? (
        <p style={styles.empty}>Loading…</p>
      ) : visible.length === 0 ? (
        <div style={styles.emptyCard}>
          <p style={styles.emptyTitle}>No projects in this view</p>
          <p style={styles.emptyHint}>Try a different filter.</p>
        </div>
      ) : (
        <div style={styles.list}>
          {visible.map((p) => (
            <button key={p.id} onClick={() => setSelected(p)} style={styles.card}>
              <div style={{ ...styles.statusBar, background: STATUS_COLORS[p.status] || '#6366f1' }} />
              <div style={styles.cardBody}>
                <div style={styles.cardHeader}>
                  <span style={styles.cardName}>{p.name || 'Untitled'}</span>
                  <span style={{
                    ...styles.statusPill,
                    background: `${STATUS_COLORS[p.status] || '#6366f1'}22`,
                    color: STATUS_COLORS[p.status] || '#a5b4fc',
                    borderColor: `${STATUS_COLORS[p.status] || '#6366f1'}55`,
                  }}>
                    {STATUS_LABELS[p.status] || p.status}
                  </span>
                </div>
                <div style={styles.cardMeta}>
                  {p.project_type && <span>{TYPE_LABELS[p.project_type] || p.project_type}</span>}
                  {p.channel && <span>· {p.channel}</span>}
                  {p.creator?.full_name && <span>· {p.creator.full_name}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <FullScreenSheet
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name || 'Project'}
      >
        {selected && <ProjectDetail project={selected} />}
      </FullScreenSheet>
    </div>
  );
}

function Chip({ label, active, accent, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...styles.chip,
        background: active
          ? accent ? `${accent}22` : 'rgba(99,102,241,0.16)'
          : 'rgba(255,255,255,0.05)',
        color: active
          ? accent || '#a5b4fc'
          : 'rgba(255,255,255,0.7)',
        borderColor: active
          ? accent ? `${accent}55` : 'rgba(99,102,241,0.4)'
          : 'rgba(255,255,255,0.1)',
        fontWeight: active ? 600 : 500,
      }}
    >
      {label}
    </button>
  );
}

function ProjectDetail({ project }) {
  return (
    <div style={detailStyles.root}>
      <div style={{
        ...detailStyles.statusPill,
        background: `${STATUS_COLORS[project.status] || '#6366f1'}22`,
        color: STATUS_COLORS[project.status] || '#a5b4fc',
        borderColor: `${STATUS_COLORS[project.status] || '#6366f1'}55`,
      }}>
        {STATUS_LABELS[project.status] || project.status}
      </div>
      <h3 style={detailStyles.title}>{project.name || 'Untitled'}</h3>

      {project.description && (
        <DetailRow label="Description" value={project.description} multiline />
      )}
      {project.project_type && <DetailRow label="Type" value={TYPE_LABELS[project.project_type] || project.project_type} />}
      {project.channel && <DetailRow label="Channel" value={project.channel} />}
      {project.creator?.full_name && <DetailRow label="Created by" value={project.creator.full_name} />}
      {project.created_at && <DetailRow label="Created" value={new Date(project.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} />}

      {project.project_assignments?.length > 0 && (
        <div style={detailStyles.section}>
          <div style={detailStyles.sectionHeader}>Team</div>
          <div style={detailStyles.assigneeList}>
            {project.project_assignments.map((a) => (
              <div key={a.id} style={detailStyles.assignee}>
                <div style={detailStyles.assigneeAvatar}>{(a.profile?.full_name || '?').charAt(0).toUpperCase()}</div>
                <div>
                  <div style={detailStyles.assigneeName}>{a.profile?.full_name || 'Unknown'}</div>
                  {a.role && <div style={detailStyles.assigneeRole}>{a.role}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p style={detailStyles.footer}>To edit this project, open Mayday Studio on desktop.</p>
    </div>
  );
}

function DetailRow({ label, value, multiline }) {
  return (
    <div style={detailStyles.row}>
      <div style={detailStyles.label}>{label}</div>
      <div style={{ ...detailStyles.value, whiteSpace: multiline ? 'pre-wrap' : 'normal' }}>{value}</div>
    </div>
  );
}

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100%',
    background: '#0f0f1a',
  },
  filterBar: {
    padding: `${mobileTokens.space.md}px 0 ${mobileTokens.space.sm}px`,
    borderBottom: '1px solid rgba(255,255,255,0.04)',
  },
  chipScroll: {
    display: 'flex',
    gap: mobileTokens.space.sm,
    padding: `0 ${mobileTokens.space.lg}px`,
    overflowX: 'auto',
    WebkitOverflowScrolling: 'touch',
    scrollbarWidth: 'none',
  },
  chip: {
    flexShrink: 0,
    padding: `${mobileTokens.space.sm}px ${mobileTokens.space.md}px`,
    minHeight: 36,
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: mobileTokens.radius.pill,
    color: 'rgba(255,255,255,0.7)',
    fontSize: mobileTokens.font.sm,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.sm,
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.lg}px ${mobileTokens.space.xxxl}px`,
  },
  card: {
    display: 'flex',
    width: '100%',
    background: 'rgba(255,255,255,0.04)',
    border: 'none',
    borderRadius: mobileTokens.radius.md,
    overflow: 'hidden',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
    color: '#e2e8f0',
    minHeight: mobileTokens.tap + 16,
  },
  statusBar: {
    width: 4,
    flexShrink: 0,
  },
  cardBody: {
    flex: 1,
    padding: mobileTokens.space.md,
    minWidth: 0,
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: mobileTokens.space.sm,
  },
  cardName: {
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    color: '#fff',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
  },
  statusPill: {
    fontSize: 10,
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: mobileTokens.radius.pill,
    border: '1px solid',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    flexShrink: 0,
  },
  cardMeta: {
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 4,
    display: 'flex',
    gap: 4,
    flexWrap: 'wrap',
  },
  empty: {
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    fontSize: mobileTokens.font.md,
    padding: mobileTokens.space.xxl,
    margin: 0,
  },
  emptyCard: {
    margin: mobileTokens.space.lg,
    padding: mobileTokens.space.xl,
    background: 'rgba(255,255,255,0.04)',
    borderRadius: mobileTokens.radius.lg,
    textAlign: 'center',
  },
  emptyTitle: {
    fontSize: mobileTokens.font.lg,
    fontWeight: 600,
    color: '#fff',
    margin: 0,
  },
  emptyHint: {
    fontSize: mobileTokens.font.sm,
    color: 'rgba(255,255,255,0.5)',
    margin: `${mobileTokens.space.sm}px 0 0`,
  },
};

const detailStyles = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.md,
  },
  statusPill: {
    alignSelf: 'flex-start',
    padding: `4px 10px`,
    borderRadius: mobileTokens.radius.pill,
    border: '1px solid',
    fontSize: mobileTokens.font.xs,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  title: {
    margin: 0,
    fontSize: mobileTokens.font.xl,
    fontWeight: 700,
    color: '#fff',
    letterSpacing: '-0.3px',
    lineHeight: 1.2,
  },
  row: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: `${mobileTokens.space.sm}px 0`,
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  label: {
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    fontWeight: 600,
  },
  value: {
    fontSize: mobileTokens.font.md,
    color: '#e2e8f0',
    lineHeight: 1.45,
    wordBreak: 'break-word',
  },
  section: {
    paddingTop: mobileTokens.space.md,
  },
  sectionHeader: {
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    fontWeight: 600,
    marginBottom: mobileTokens.space.sm,
  },
  assigneeList: {
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.sm,
  },
  assignee: {
    display: 'flex',
    alignItems: 'center',
    gap: mobileTokens.space.md,
  },
  assigneeAvatar: {
    width: 36,
    height: 36,
    borderRadius: mobileTokens.radius.sm,
    background: 'rgba(99,102,241,0.2)',
    color: '#a5b4fc',
    fontSize: mobileTokens.font.md,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  assigneeName: {
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    color: '#e2e8f0',
  },
  assigneeRole: {
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.45)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginTop: 1,
  },
  footer: {
    margin: `${mobileTokens.space.md}px 0 0`,
    padding: mobileTokens.space.md,
    background: 'rgba(99,102,241,0.08)',
    border: '1px solid rgba(99,102,241,0.2)',
    borderRadius: mobileTokens.radius.sm,
    color: 'rgba(255,255,255,0.6)',
    fontSize: mobileTokens.font.sm,
    textAlign: 'center',
  },
};
