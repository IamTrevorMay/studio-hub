import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';

const SECTIONS = ['news', 'newsletters', 'reports'];

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function renderMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/^## (.+)$/gm, '<h2 style="font-size:18px;font-weight:700;color:#e2e8f0;margin:24px 0 12px;">$1</h2>')
    .replace(/^### (.+)$/gm, '<h3 style="font-size:15px;font-weight:600;color:#e2e8f0;margin:20px 0 8px;">$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#e2e8f0">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li style="margin:4px 0;margin-left:16px;">$1</li>')
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g, '<br/>');
}

export default function Research() {
  const { profile } = useAuth();
  const [view, setView] = useState('feed'); // feed | reader | report
  const [section, setSection] = useState('news');
  const [articles, setArticles] = useState([]);
  const [feeds, setFeeds] = useState([]);
  const [newsletters, setNewsletters] = useState([]);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all');
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [generatedReport, setGeneratedReport] = useState(null);

  const fetchArticles = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const response = await fetch(
        `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/fetch-rss`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': process.env.REACT_APP_SUPABASE_ANON_KEY,
          },
        }
      );
      const result = await response.json();
      if (response.ok) {
        setArticles(result.articles || []);
        setFeeds(result.feeds || []);
      }
    } catch (err) {
      console.error('Error fetching articles:', err);
    }
  }, []);

  const fetchNewsletters = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('research_newsletters')
        .select('*')
        .order('received_at', { ascending: false })
        .limit(100);
      if (!error) setNewsletters(data || []);
    } catch (err) {
      console.error('Error fetching newsletters:', err);
    }
  }, []);

  const fetchReports = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('research_reports')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (!error) setReports(data || []);
    } catch (err) {
      console.error('Error fetching reports:', err);
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => setLoading(false), 5000);
    Promise.all([fetchArticles(), fetchNewsletters(), fetchReports()])
      .finally(() => { setLoading(false); clearTimeout(timeout); });
    return () => clearTimeout(timeout);
  }, [fetchArticles, fetchNewsletters, fetchReports]);

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([fetchArticles(), fetchNewsletters(), fetchReports()]);
    setRefreshing(false);
  }

  function openItem(item, type) {
    setSelectedItem({ ...item, _type: type });
    setView('reader');
  }

  function toggleSelect(item, type) {
    const key = `${type}-${item.id}`;
    setSelectedItems(prev => {
      const exists = prev.find(s => s._key === key);
      if (exists) return prev.filter(s => s._key !== key);
      return [...prev, { ...item, _key: key, _type: type }];
    });
  }

  function isSelected(item, type) {
    return selectedItems.some(s => s._key === `${type}-${item.id}`);
  }

  async function handleGenerateReport() {
    setGenerating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const articleItems = selectedItems.filter(s => s._type === 'article').map(a => ({
        id: a.id,
        title: a.title,
        description: a.description,
        content: a.content,
        pub_date: a.pub_date,
        source: a.feed?.name || 'Unknown',
      }));
      const newsletterItems = selectedItems.filter(s => s._type === 'newsletter').map(n => ({
        id: n.id,
        from_name: n.from_name,
        from_address: n.from_address,
        subject: n.subject,
        text_content: n.text_content,
      }));

      const response = await fetch(
        `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/generate-report`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': process.env.REACT_APP_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ articles: articleItems, newsletters: newsletterItems, save: true }),
        }
      );
      const result = await response.json();
      if (response.ok) {
        setGeneratedReport(result);
        setView('report');
        setSelectMode(false);
        setSelectedItems([]);
        fetchReports();
      } else {
        alert('Error generating report: ' + (result.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('Error generating report:', err);
      alert('Error generating report');
    } finally {
      setGenerating(false);
    }
  }

  async function handleDeleteReport(reportId, e) {
    if (e) e.stopPropagation();
    if (!window.confirm('Delete this report?')) return;
    const { error } = await supabase.from('research_reports').delete().eq('id', reportId);
    if (!error) {
      setReports(prev => prev.filter(r => r.id !== reportId));
      if (view === 'reader' && selectedItem?.id === reportId) {
        setView('feed');
        setSelectedItem(null);
      }
    }
  }

  const filteredArticles = activeFilter === 'all'
    ? articles
    : articles.filter(a => a.feed?.id === activeFilter);

  // --- Reader View ---
  if (view === 'reader' && selectedItem) {
    return (
      <div style={s.container}>
        <button onClick={() => { setView('feed'); setSelectedItem(null); }} style={s.backBtn}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 3L5 8l5 5" /></svg>
          Back
        </button>
        <div style={s.readerWrap}>
          {selectedItem._type === 'article' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                {selectedItem.feed && (
                  <span style={{ ...s.sourceBadge, background: selectedItem.feed.color + '22', color: selectedItem.feed.color }}>
                    {selectedItem.feed.icon_emoji} {selectedItem.feed.name}
                  </span>
                )}
                <span style={s.metaText}>{timeAgo(selectedItem.pub_date)}</span>
                {selectedItem.author && <span style={s.metaText}>by {selectedItem.author}</span>}
              </div>
              <h1 style={s.readerTitle}>{selectedItem.title}</h1>
              {selectedItem.image_url && (
                <img src={selectedItem.image_url} alt="" style={s.readerImage} onError={e => e.target.style.display = 'none'} />
              )}
              <div
                style={s.readerContent}
                dangerouslySetInnerHTML={{ __html: selectedItem.content || selectedItem.description || '' }}
              />
              {selectedItem.link && (
                <a href={selectedItem.link} target="_blank" rel="noopener noreferrer" style={s.readOriginal}>
                  Read original article →
                </a>
              )}
            </>
          )}
          {selectedItem._type === 'newsletter' && (
            <>
              <div style={{ marginBottom: '16px' }}>
                <span style={s.metaText}>{selectedItem.from_name || selectedItem.from_address}</span>
                <span style={{ ...s.metaText, marginLeft: '12px' }}>{timeAgo(selectedItem.received_at)}</span>
              </div>
              <h1 style={s.readerTitle}>{selectedItem.subject}</h1>
              {selectedItem.html_content ? (
                <iframe
                  title="Newsletter content"
                  srcDoc={selectedItem.html_content}
                  style={s.newsletterFrame}
                  sandbox="allow-same-origin"
                />
              ) : (
                <div style={s.readerContent}>{selectedItem.text_content}</div>
              )}
            </>
          )}
          {selectedItem._type === 'report' && (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' }}>
                <h1 style={s.readerTitle}>{selectedItem.title}</h1>
                <button
                  onClick={() => handleDeleteReport(selectedItem.id)}
                  style={s.deleteBtn}
                  title="Delete report"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 011.34-1.34h2.66a1.33 1.33 0 011.34 1.34V4M12.67 4v9.33a1.33 1.33 0 01-1.34 1.34H4.67a1.33 1.33 0 01-1.34-1.34V4" />
                  </svg>
                </button>
              </div>
              <span style={s.metaText}>{timeAgo(selectedItem.created_at)}</span>
              <div style={{ ...s.readerContent, marginTop: '20px' }} dangerouslySetInnerHTML={{ __html: renderMarkdown(selectedItem.content) }} />
            </>
          )}
        </div>
      </div>
    );
  }

  // --- Report View (freshly generated) ---
  if (view === 'report' && generatedReport) {
    return (
      <div style={s.container}>
        <button onClick={() => { setView('feed'); setGeneratedReport(null); }} style={s.backBtn}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 3L5 8l5 5" /></svg>
          Back
        </button>
        <div style={s.readerWrap}>
          <h1 style={s.readerTitle}>{generatedReport.title}</h1>
          <div style={{ ...s.readerContent, marginTop: '20px' }} dangerouslySetInnerHTML={{ __html: renderMarkdown(generatedReport.content) }} />
        </div>
      </div>
    );
  }

  // --- Feed View ---
  return (
    <div style={s.container}>
      {/* Header */}
      <div style={s.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <h1 style={s.title}>Research</h1>
          <button
            onClick={() => { setSelectMode(!selectMode); if (selectMode) setSelectedItems([]); }}
            style={{ ...s.toggleBtn, ...(selectMode ? s.toggleBtnActive : {}) }}
          >
            {selectMode ? 'Cancel Selection' : 'Select for Report'}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {selectMode && selectedItems.length > 0 && (
            <button onClick={handleGenerateReport} disabled={generating} style={s.generateBtn}>
              {generating ? 'Generating...' : `Generate Report (${selectedItems.length})`}
            </button>
          )}
          <button onClick={handleRefresh} disabled={refreshing} style={s.refreshBtn}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }}>
              <path d="M2 8a6 6 0 0110.47-4M14 8a6 6 0 01-10.47 4" />
              <path d="M14 2v4h-4M2 14v-4h4" />
            </svg>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Section tabs */}
      <div style={s.sectionTabs}>
        {SECTIONS.map(sec => (
          <button
            key={sec}
            onClick={() => setSection(sec)}
            style={{ ...s.sectionTab, ...(section === sec ? s.sectionTabActive : {}) }}
          >
            {sec === 'news' ? 'News' : sec === 'newsletters' ? 'Newsletters' : 'Reports'}
            {sec === 'newsletters' && newsletters.filter(n => !n.read).length > 0 && (
              <span style={s.unreadBadge}>{newsletters.filter(n => !n.read).length}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={s.emptyState}>Loading...</div>
      ) : (
        <>
          {/* News Section */}
          {section === 'news' && (
            <>
              {/* Source filter chips */}
              <div style={s.filterRow}>
                <button
                  onClick={() => setActiveFilter('all')}
                  style={{ ...s.filterChip, ...(activeFilter === 'all' ? s.filterChipActive : {}) }}
                >
                  All Sources
                </button>
                {feeds.map(feed => (
                  <button
                    key={feed.id}
                    onClick={() => setActiveFilter(feed.id)}
                    style={{
                      ...s.filterChip,
                      ...(activeFilter === feed.id ? { background: feed.color + '22', color: feed.color, borderColor: feed.color + '44' } : {}),
                    }}
                  >
                    {feed.icon_emoji} {feed.name}
                  </button>
                ))}
              </div>

              {filteredArticles.length === 0 ? (
                <div style={s.emptyState}>No articles yet. Click Refresh to fetch RSS feeds.</div>
              ) : (
                <div style={s.articleGrid}>
                  {filteredArticles.map(article => (
                    <div
                      key={article.id}
                      style={{ ...s.articleCard, ...(isSelected(article, 'article') ? s.articleCardSelected : {}) }}
                      onClick={() => selectMode ? toggleSelect(article, 'article') : openItem(article, 'article')}
                    >
                      {selectMode && (
                        <div style={{ ...s.checkbox, ...(isSelected(article, 'article') ? s.checkboxChecked : {}) }}>
                          {isSelected(article, 'article') && '✓'}
                        </div>
                      )}
                      {article.image_url && (
                        <div style={s.articleImageWrap}>
                          <img src={article.image_url} alt="" style={s.articleImage} onError={e => e.target.parentElement.style.display = 'none'} />
                        </div>
                      )}
                      <div style={s.articleBody}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                          {article.feed && (
                            <span style={{ ...s.sourceBadgeSmall, background: article.feed.color + '22', color: article.feed.color }}>
                              {article.feed.icon_emoji} {article.feed.name}
                            </span>
                          )}
                          <span style={s.timeText}>{timeAgo(article.pub_date)}</span>
                        </div>
                        <h3 style={s.articleTitle}>{article.title}</h3>
                        <p style={s.articleDesc}>{(article.description || '').replace(/<[^>]*>/g, '').substring(0, 150)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Newsletters Section */}
          {section === 'newsletters' && (
            <div style={s.listContainer}>
              {newsletters.length === 0 ? (
                <div style={s.emptyState}>No newsletters yet. Configure Mailgun inbound routing to start receiving newsletters.</div>
              ) : (
                newsletters.map(nl => (
                  <div
                    key={nl.id}
                    style={{ ...s.listItem, ...(isSelected(nl, 'newsletter') ? s.articleCardSelected : {}) }}
                    onClick={() => selectMode ? toggleSelect(nl, 'newsletter') : openItem(nl, 'newsletter')}
                  >
                    {selectMode && (
                      <div style={{ ...s.checkbox, ...(isSelected(nl, 'newsletter') ? s.checkboxChecked : {}) }}>
                        {isSelected(nl, 'newsletter') && '✓'}
                      </div>
                    )}
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        {!nl.read && <span style={s.unreadDot} />}
                        <span style={s.nlFrom}>{nl.from_name || nl.from_address}</span>
                        <span style={s.timeText}>{timeAgo(nl.received_at)}</span>
                      </div>
                      <div style={s.nlSubject}>{nl.subject}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Reports Section */}
          {section === 'reports' && (
            <div style={s.listContainer}>
              {reports.length === 0 ? (
                <div style={s.emptyState}>No reports yet. Select articles and newsletters to generate an AI analysis report.</div>
              ) : (
                reports.map(report => (
                  <div
                    key={report.id}
                    style={s.listItem}
                    onClick={() => openItem(report, 'report')}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={s.reportTitle}>{report.title}</div>
                      <div style={s.timeText}>{timeAgo(report.created_at)}</div>
                    </div>
                    <button
                      onClick={(e) => handleDeleteReport(report.id, e)}
                      style={s.deleteBtn}
                      title="Delete report"
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 011.34-1.34h2.66a1.33 1.33 0 011.34 1.34V4M12.67 4v9.33a1.33 1.33 0 01-1.34 1.34H4.67a1.33 1.33 0 01-1.34-1.34V4" />
                      </svg>
                    </button>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5"><path d="M6 3l5 5-5 5" /></svg>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const s = {
  container: {
    padding: '32px 40px',
    maxWidth: '1400px',
    minHeight: '100vh',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '24px',
  },
  title: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#ffffff',
    margin: 0,
  },
  toggleBtn: {
    padding: '6px 14px',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '8px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.6)',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.15s',
  },
  toggleBtnActive: {
    background: 'rgba(99,102,241,0.15)',
    borderColor: '#6366f1',
    color: '#a5b4fc',
  },
  generateBtn: {
    padding: '8px 20px',
    border: 'none',
    borderRadius: '8px',
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.15s',
  },
  refreshBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 14px',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    background: 'rgba(255,255,255,0.03)',
    color: 'rgba(255,255,255,0.7)',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.15s',
  },
  sectionTabs: {
    display: 'flex',
    gap: '4px',
    marginBottom: '20px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    paddingBottom: '0',
  },
  sectionTab: {
    padding: '10px 20px',
    border: 'none',
    borderBottom: '2px solid transparent',
    background: 'transparent',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.15s',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  sectionTabActive: {
    color: '#a5b4fc',
    borderBottomColor: '#6366f1',
  },
  unreadBadge: {
    padding: '1px 7px',
    borderRadius: '10px',
    background: '#6366f1',
    color: '#fff',
    fontSize: '11px',
    fontWeight: 600,
  },
  filterRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    marginBottom: '20px',
  },
  filterChip: {
    padding: '6px 12px',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '20px',
    background: 'rgba(255,255,255,0.03)',
    color: 'rgba(255,255,255,0.6)',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.15s',
    whiteSpace: 'nowrap',
  },
  filterChipActive: {
    background: 'rgba(99,102,241,0.15)',
    borderColor: 'rgba(99,102,241,0.3)',
    color: '#a5b4fc',
  },
  articleGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
    gap: '16px',
  },
  articleCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '14px',
    overflow: 'hidden',
    cursor: 'pointer',
    transition: 'all 0.15s',
    position: 'relative',
  },
  articleCardSelected: {
    borderColor: '#6366f1',
    background: 'rgba(99,102,241,0.08)',
  },
  checkbox: {
    position: 'absolute',
    top: '12px',
    right: '12px',
    width: '22px',
    height: '22px',
    borderRadius: '6px',
    border: '2px solid rgba(255,255,255,0.2)',
    background: 'rgba(0,0,0,0.3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: 700,
    color: '#fff',
    zIndex: 2,
  },
  checkboxChecked: {
    background: '#6366f1',
    borderColor: '#6366f1',
  },
  articleImageWrap: {
    width: '100%',
    height: '160px',
    overflow: 'hidden',
    background: 'rgba(255,255,255,0.02)',
  },
  articleImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  articleBody: {
    padding: '16px',
  },
  sourceBadge: {
    padding: '4px 10px',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  sourceBadgeSmall: {
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  timeText: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.35)',
  },
  articleTitle: {
    fontSize: '15px',
    fontWeight: 600,
    color: '#e2e8f0',
    margin: '0 0 6px',
    lineHeight: 1.4,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  },
  articleDesc: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.45)',
    margin: 0,
    lineHeight: 1.5,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  },
  listContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  listItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '14px 16px',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.04)',
    borderRadius: '10px',
    cursor: 'pointer',
    transition: 'all 0.15s',
    position: 'relative',
  },
  unreadDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: '#6366f1',
    flexShrink: 0,
  },
  nlFrom: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#e2e8f0',
  },
  nlSubject: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.5)',
  },
  reportTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#e2e8f0',
    marginBottom: '4px',
  },
  emptyState: {
    textAlign: 'center',
    padding: '60px 20px',
    color: 'rgba(255,255,255,0.35)',
    fontSize: '14px',
  },
  backBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 14px',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    background: 'rgba(255,255,255,0.03)',
    color: 'rgba(255,255,255,0.7)',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    marginBottom: '24px',
  },
  readerWrap: {
    maxWidth: '800px',
  },
  readerTitle: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#ffffff',
    margin: '0 0 12px',
    lineHeight: 1.3,
  },
  readerImage: {
    width: '100%',
    maxHeight: '400px',
    objectFit: 'cover',
    borderRadius: '12px',
    marginBottom: '24px',
  },
  readerContent: {
    fontSize: '15px',
    lineHeight: 1.7,
    color: 'rgba(255,255,255,0.75)',
  },
  readOriginal: {
    display: 'inline-block',
    marginTop: '24px',
    padding: '10px 20px',
    borderRadius: '8px',
    background: 'rgba(99,102,241,0.12)',
    color: '#a5b4fc',
    fontSize: '13px',
    fontWeight: 600,
    textDecoration: 'none',
  },
  metaText: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.4)',
  },
  deleteBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '6px',
    border: 'none',
    borderRadius: '6px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.3)',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'all 0.15s',
  },
  newsletterFrame: {
    width: '100%',
    minHeight: '600px',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '8px',
    background: '#fff',
    marginTop: '16px',
  },
};
