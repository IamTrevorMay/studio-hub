import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';

const NETWORKS = [
  { key: 'twitter', label: 'Twitter/X', icon: '\uD83D\uDC26' },
  { key: 'instagram', label: 'Instagram', icon: '\uD83D\uDCF7' },
  { key: 'facebook', label: 'Facebook', icon: '\uD83D\uDCF1' },
  { key: 'tiktok', label: 'TikTok', icon: '\uD83C\uDFB5' },
];

const CHAR_LIMITS = { twitter: 280 };

function formatRelativeTime(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatScheduledTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function networkIcon(network) {
  const n = NETWORKS.find(x => x.key === network);
  return n ? n.icon : '\uD83C\uDF10';
}

export default function Posting() {
  const { profile, isAdmin, ensureSession } = useAuth();

  // Compose state
  const [text, setText] = useState('');
  const [selectedNetworks, setSelectedNetworks] = useState(['twitter']);
  const [scheduleMode, setScheduleMode] = useState(false);
  const [scheduledDate, setScheduledDate] = useState('');
  const [posting, setPosting] = useState(false);
  const [postStatus, setPostStatus] = useState(null); // { type: 'success'|'error', message }

  // Image attachment state
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  // Posts state
  const [recentPosts, setRecentPosts] = useState([]);
  const [scheduledPosts, setScheduledPosts] = useState([]);
  const [loadingPosts, setLoadingPosts] = useState(true);

  // Admin permissions state
  const [teamMembers, setTeamMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [savingPermission, setSavingPermission] = useState(null);

  // Character limit based on selected networks
  const charLimit = selectedNetworks.includes('twitter') ? CHAR_LIMITS.twitter : null;

  const fetchPosts = useCallback(async () => {
    setLoadingPosts(true);
    try {
      const session = await ensureSession();
      if (!session) return;

      const now = new Date();
      const threeDaysAgo = new Date(now);
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const thirtyDaysAhead = new Date(now);
      thirtyDaysAhead.setDate(thirtyDaysAhead.getDate() + 30);

      const formatParam = (d) => d.toISOString().split('T')[0];

      const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;

      // Fetch recent + upcoming in parallel
      const [recentRes, scheduledRes] = await Promise.all([
        fetch(
          `${supabaseUrl}/functions/v1/metricool-posts?start=${formatParam(threeDaysAgo)}&end=${formatParam(now)}&timezone=America/Los_Angeles`,
          { headers: { Authorization: `Bearer ${session.access_token}`, apikey: process.env.REACT_APP_SUPABASE_ANON_KEY } }
        ),
        fetch(
          `${supabaseUrl}/functions/v1/metricool-posts?start=${formatParam(now)}&end=${formatParam(thirtyDaysAhead)}&timezone=America/Los_Angeles`,
          { headers: { Authorization: `Bearer ${session.access_token}`, apikey: process.env.REACT_APP_SUPABASE_ANON_KEY } }
        ),
      ]);

      if (recentRes.ok) {
        const data = await recentRes.json();
        setRecentPosts((data.posts || []).sort((a, b) => new Date(b.publicationDate?.dateTime || 0) - new Date(a.publicationDate?.dateTime || 0)));
      }

      if (scheduledRes.ok) {
        const data = await scheduledRes.json();
        setScheduledPosts(
          (data.posts || [])
            .filter(p => p.status !== 'PUBLISHED')
            .sort((a, b) => new Date(a.publicationDate?.dateTime || 0) - new Date(b.publicationDate?.dateTime || 0))
        );
      }
    } catch (err) {
      console.error('Error fetching posts:', err);
    } finally {
      setLoadingPosts(false);
    }
  }, [ensureSession]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  // Fetch team members for admin permissions widget
  useEffect(() => {
    if (!isAdmin) return;
    async function loadMembers() {
      setLoadingMembers(true);
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, role, posting_allowed')
        .order('full_name');
      setTeamMembers(data || []);
      setLoadingMembers(false);
    }
    loadMembers();
  }, [isAdmin]);

  function toggleNetwork(key) {
    setSelectedNetworks(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  }

  function handleImageSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate type
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowed.includes(file.type)) {
      setPostStatus({ type: 'error', message: 'Only JPG, PNG, GIF, and WebP images are supported' });
      return;
    }

    // Validate size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      setPostStatus({ type: 'error', message: 'Image must be under 10 MB' });
      return;
    }

    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setPostStatus(null);
    // Reset the input so the same file can be re-selected
    e.target.value = '';
  }

  function removeImage() {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(null);
    setImagePreview(null);
  }

  async function handlePost() {
    if (!text.trim() || selectedNetworks.length === 0) return;
    setPosting(true);
    setPostStatus(null);

    try {
      const session = await ensureSession();
      if (!session) throw new Error('Not authenticated');

      const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
      const body = {
        text: text.trim(),
        networks: selectedNetworks,
      };

      if (scheduleMode && scheduledDate) {
        body.scheduledDate = scheduledDate;
        body.scheduledTimezone = 'America/Los_Angeles';
      }

      // Upload image to Supabase Storage if attached
      if (imageFile) {
        setUploading(true);
        const ext = imageFile.name.split('.').pop() || 'jpg';
        const filePath = `${profile.id}/${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from('posting-media')
          .upload(filePath, imageFile);
        setUploading(false);

        if (uploadErr) throw new Error(`Image upload failed: ${uploadErr.message}`);

        const { data: urlData } = supabase.storage
          .from('posting-media')
          .getPublicUrl(filePath);
        body.mediaUrl = urlData.publicUrl;
      }

      const res = await fetch(`${supabaseUrl}/functions/v1/metricool-create-post`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: process.env.REACT_APP_SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Failed (${res.status})`);
      }

      setPostStatus({ type: 'success', message: scheduleMode ? 'Post scheduled!' : 'Post sent!' });
      setText('');
      setScheduleMode(false);
      setScheduledDate('');
      removeImage();

      // Refresh posts after a short delay to let Metricool process
      setTimeout(fetchPosts, 2000);
    } catch (err) {
      setPostStatus({ type: 'error', message: err.message });
    } finally {
      setPosting(false);
      setUploading(false);
    }
  }

  async function togglePostingPermission(memberId, currentValue) {
    setSavingPermission(memberId);
    try {
      await supabase
        .from('profiles')
        .update({ posting_allowed: !currentValue })
        .eq('id', memberId);
      setTeamMembers(prev =>
        prev.map(m => m.id === memberId ? { ...m, posting_allowed: !currentValue } : m)
      );
    } catch (err) {
      console.error('Error updating permission:', err);
    } finally {
      setSavingPermission(null);
    }
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Posting</h1>
          <p style={styles.subtitle}>Compose and schedule social media posts</p>
        </div>
      </div>

      {/* Compose Form */}
      <div style={styles.composeCard}>
        <textarea
          style={styles.textarea}
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="What do you want to share?"
          rows={4}
        />
        <div style={styles.composeFooter}>
          <div style={styles.charCount}>
            {charLimit && (
              <span style={{ color: text.length > charLimit ? '#ef4444' : 'rgba(255,255,255,0.4)' }}>
                {text.length}/{charLimit}
              </span>
            )}
          </div>
        </div>

        {/* Image preview */}
        {imagePreview && (
          <div style={styles.imagePreviewWrap}>
            <img src={imagePreview} alt="Attachment" style={styles.imagePreview} />
            <button onClick={removeImage} style={styles.imageRemoveBtn} title="Remove image">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <path d="M11 3L3 11M3 3l8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
              </svg>
            </button>
            <span style={styles.imageFileName}>{imageFile?.name}</span>
          </div>
        )}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          onChange={handleImageSelect}
          style={{ display: 'none' }}
        />

        {/* Network checkboxes */}
        <div style={styles.networkRow}>
          {NETWORKS.map(n => (
            <button
              key={n.key}
              onClick={() => toggleNetwork(n.key)}
              style={{
                ...styles.networkBtn,
                ...(selectedNetworks.includes(n.key) ? styles.networkBtnActive : {}),
              }}
            >
              <span>{n.icon}</span>
              <span>{n.label}</span>
            </button>
          ))}
        </div>

        {/* Action buttons */}
        <div style={styles.actionRow}>
          <button
            onClick={handlePost}
            disabled={posting || !text.trim() || selectedNetworks.length === 0 || (scheduleMode && !scheduledDate)}
            style={{
              ...styles.postBtn,
              opacity: (posting || !text.trim() || selectedNetworks.length === 0) ? 0.5 : 1,
            }}
          >
            {uploading ? 'Uploading image...' : posting ? 'Sending...' : scheduleMode ? 'Schedule' : 'Post Now'}
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={posting}
            style={styles.attachBtn}
            title="Attach image"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="1" y="2" width="14" height="11" rx="2" />
              <circle cx="5" cy="6" r="1.5" />
              <path d="M1 11l3.5-4 2.5 3 3-4L14 11" />
            </svg>
            {imageFile ? '1 image' : 'Image'}
          </button>

          <button
            onClick={() => setScheduleMode(!scheduleMode)}
            style={{
              ...styles.scheduleToggle,
              ...(scheduleMode ? styles.scheduleToggleActive : {}),
            }}
          >
            {scheduleMode ? 'Cancel Schedule' : 'Schedule'}
          </button>

          {scheduleMode && (
            <input
              type="datetime-local"
              value={scheduledDate}
              onChange={e => setScheduledDate(e.target.value)}
              style={styles.datetimeInput}
              min={new Date().toISOString().slice(0, 16)}
            />
          )}
        </div>

        {/* Status message */}
        {postStatus && (
          <div style={{
            ...styles.statusMsg,
            background: postStatus.type === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            color: postStatus.type === 'success' ? '#22c55e' : '#ef4444',
            border: `1px solid ${postStatus.type === 'success' ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
          }}>
            {postStatus.message}
          </div>
        )}
      </div>

      {/* Posts columns */}
      <div style={styles.columnsRow}>
        {/* Recent Posts */}
        <div style={styles.column}>
          <h2 style={styles.columnTitle}>Recent Posts</h2>
          <p style={styles.columnSubtitle}>Last 3 days</p>
          {loadingPosts ? (
            <p style={styles.emptyText}>Loading...</p>
          ) : recentPosts.length === 0 ? (
            <p style={styles.emptyText}>No recent posts</p>
          ) : (
            recentPosts.map((post, i) => (
              <div key={post.id || i} style={styles.postCard}>
                <div style={styles.postHeader}>
                  <span style={styles.postNetwork}>{networkIcon(post.network)}</span>
                  <span style={styles.postStatus}>{post.status}</span>
                </div>
                <p style={styles.postText}>{post.text || '(no text)'}</p>
                <div style={styles.postMeta}>
                  <span>{formatRelativeTime(post.publicationDate?.dateTime || post.publicationDate)}</span>
                  {post.publicUrl && (
                    <a href={post.publicUrl} target="_blank" rel="noopener noreferrer" style={styles.postLink}>
                      View
                    </a>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Scheduled Posts */}
        <div style={styles.column}>
          <h2 style={styles.columnTitle}>Scheduled</h2>
          <p style={styles.columnSubtitle}>Upcoming</p>
          {loadingPosts ? (
            <p style={styles.emptyText}>Loading...</p>
          ) : scheduledPosts.length === 0 ? (
            <p style={styles.emptyText}>No scheduled posts</p>
          ) : (
            scheduledPosts.map((post, i) => (
              <div key={post.id || i} style={styles.postCard}>
                <div style={styles.postHeader}>
                  <span style={styles.postNetwork}>{networkIcon(post.network)}</span>
                  <span style={styles.postStatusScheduled}>{post.status}</span>
                </div>
                <p style={styles.postText}>{post.text || '(no text)'}</p>
                <div style={styles.postMeta}>
                  <span>{formatScheduledTime(post.publicationDate?.dateTime || post.publicationDate)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Admin Permissions Widget */}
      {isAdmin && (
        <div style={styles.permissionsCard}>
          <h2 style={styles.columnTitle}>Posting Permissions</h2>
          <p style={styles.columnSubtitle}>Control who can compose and schedule posts</p>
          {loadingMembers ? (
            <p style={styles.emptyText}>Loading team...</p>
          ) : (
            <div style={styles.membersList}>
              {teamMembers.map(member => (
                <div key={member.id} style={styles.memberRow}>
                  <div style={styles.memberInfo}>
                    <span style={styles.memberName}>{member.full_name || 'Unnamed'}</span>
                    {member.role === 'admin' && <span style={styles.adminBadge}>Admin</span>}
                  </div>
                  {member.role === 'admin' ? (
                    <span style={styles.alwaysAllowed}>Always allowed</span>
                  ) : (
                    <button
                      onClick={() => togglePostingPermission(member.id, member.posting_allowed)}
                      disabled={savingPermission === member.id}
                      style={{
                        ...styles.toggleBtn,
                        background: member.posting_allowed ? '#22c55e' : 'rgba(255,255,255,0.1)',
                      }}
                    >
                      <div style={{
                        ...styles.toggleKnob,
                        transform: member.posting_allowed ? 'translateX(18px)' : 'translateX(0)',
                      }} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    padding: '32px',
    maxWidth: '960px',
    margin: '0 auto',
  },
  header: {
    marginBottom: '24px',
  },
  title: {
    fontSize: '28px',
    fontWeight: 700,
    color: '#e2e8f0',
    margin: 0,
  },
  subtitle: {
    fontSize: '14px',
    color: 'rgba(255,255,255,0.45)',
    margin: '4px 0 0',
  },
  composeCard: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '14px',
    padding: '20px',
    marginBottom: '24px',
  },
  textarea: {
    width: '100%',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '10px',
    color: '#e2e8f0',
    fontSize: '15px',
    padding: '14px',
    fontFamily: 'inherit',
    resize: 'vertical',
    minHeight: '100px',
    outline: 'none',
    boxSizing: 'border-box',
  },
  composeFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    padding: '6px 0',
  },
  charCount: {
    fontSize: '12px',
  },
  imagePreviewWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '10px',
    marginBottom: '12px',
  },
  imagePreview: {
    width: '64px',
    height: '64px',
    objectFit: 'cover',
    borderRadius: '8px',
    flexShrink: 0,
  },
  imageRemoveBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    borderRadius: '6px',
    border: 'none',
    background: 'rgba(239,68,68,0.15)',
    color: '#ef4444',
    cursor: 'pointer',
    flexShrink: 0,
  },
  imageFileName: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.4)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  attachBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '10px 16px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '10px',
    color: 'rgba(255,255,255,0.6)',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.15s',
  },
  networkRow: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    marginBottom: '14px',
  },
  networkBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '7px 14px',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.15s',
  },
  networkBtnActive: {
    background: 'rgba(99,102,241,0.15)',
    border: '1px solid rgba(99,102,241,0.4)',
    color: '#a5b4fc',
  },
  actionRow: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  postBtn: {
    padding: '10px 24px',
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    border: 'none',
    borderRadius: '10px',
    color: '#fff',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'opacity 0.15s',
  },
  scheduleToggle: {
    padding: '10px 18px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '10px',
    color: 'rgba(255,255,255,0.6)',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.15s',
  },
  scheduleToggleActive: {
    background: 'rgba(239,68,68,0.1)',
    border: '1px solid rgba(239,68,68,0.3)',
    color: '#ef4444',
  },
  datetimeInput: {
    padding: '9px 12px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '8px',
    color: '#e2e8f0',
    fontSize: '13px',
    fontFamily: 'inherit',
    outline: 'none',
    colorScheme: 'dark',
  },
  statusMsg: {
    marginTop: '12px',
    padding: '10px 14px',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 500,
  },
  columnsRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '20px',
    marginBottom: '24px',
  },
  column: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '14px',
    padding: '18px',
  },
  columnTitle: {
    fontSize: '16px',
    fontWeight: 700,
    color: '#e2e8f0',
    margin: '0 0 2px',
  },
  columnSubtitle: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.35)',
    margin: '0 0 14px',
  },
  emptyText: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: '13px',
    textAlign: 'center',
    padding: '24px 0',
    margin: 0,
  },
  postCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '10px',
    padding: '12px',
    marginBottom: '8px',
  },
  postHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '6px',
  },
  postNetwork: {
    fontSize: '16px',
  },
  postStatus: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#22c55e',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  postStatusScheduled: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#f59e0b',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  postText: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.7)',
    margin: '0 0 8px',
    lineHeight: 1.4,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: '-webkit-box',
    WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical',
  },
  postMeta: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: '11px',
    color: 'rgba(255,255,255,0.3)',
  },
  postLink: {
    color: '#818cf8',
    textDecoration: 'none',
    fontWeight: 500,
    fontSize: '11px',
  },
  permissionsCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '14px',
    padding: '18px',
  },
  membersList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  memberRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 12px',
    borderRadius: '8px',
    background: 'rgba(255,255,255,0.02)',
  },
  memberInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  memberName: {
    fontSize: '14px',
    fontWeight: 500,
    color: '#e2e8f0',
  },
  adminBadge: {
    fontSize: '10px',
    fontWeight: 700,
    color: '#a5b4fc',
    background: 'rgba(99,102,241,0.15)',
    padding: '2px 8px',
    borderRadius: '4px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  alwaysAllowed: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.3)',
    fontStyle: 'italic',
  },
  toggleBtn: {
    width: '40px',
    height: '22px',
    borderRadius: '11px',
    border: 'none',
    cursor: 'pointer',
    padding: '2px',
    transition: 'background 0.2s',
    position: 'relative',
  },
  toggleKnob: {
    width: '18px',
    height: '18px',
    borderRadius: '50%',
    background: '#fff',
    transition: 'transform 0.2s',
  },
};
