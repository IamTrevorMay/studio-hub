import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { tritonSupabase } from '../tritonClient';
import { useAuth } from '../contexts/AuthContext';

const SECTIONS = ['briefs', 'cards', 'news', 'newsletters', 'reports'];

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
  const [section, setSection] = useState('briefs');
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

  // Briefs state
  const [briefs, setBriefs] = useState([]);
  const [currentBrief, setCurrentBrief] = useState(null);
  const [currentBriefDate, setCurrentBriefDate] = useState(null);
  const [briefLoading, setBriefLoading] = useState(false);

  // Cards state
  const [cardsArchive, setCardsArchive] = useState([]); // [{date, cards: [...]}]
  const [currentCards, setCurrentCards] = useState([]);
  const [currentCardDate, setCurrentCardDate] = useState(null);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [selectedCard, setSelectedCard] = useState(null);
  const [regeneratingBrief, setRegeneratingBrief] = useState(false);
  const [regeneratingCards, setRegeneratingCards] = useState(false);
  const [confirmRegenCards, setConfirmRegenCards] = useState(false);

  // Cards config state
  const [cardsConfig, setCardsConfig] = useState(null);
  const [availableTemplates, setAvailableTemplates] = useState([]);
  const [showCardsConfig, setShowCardsConfig] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  const fetchCardsConfig = useCallback(async () => {
    try {
      const res = await fetch('https://www.tritonapex.io/api/daily-cards-config');
      if (!res.ok) return;
      const data = await res.json();
      setCardsConfig(data.config);
      setAvailableTemplates(data.templates || []);
    } catch (err) {
      console.error('Error fetching cards config:', err);
    }
  }, []);

  const updateCardsConfig = async (templateId, topN) => {
    setSavingConfig(true);
    try {
      const res = await fetch('https://www.tritonapex.io/api/daily-cards-config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.REACT_APP_TRITON_CRON_SECRET}`,
        },
        body: JSON.stringify({ template_id: templateId, ...(topN !== undefined ? { top_n: topN } : {}) }),
      });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error || 'Failed to update config');
      }
      await fetchCardsConfig();
    } catch (err) {
      alert('Failed to save config: ' + err.message);
    } finally {
      setSavingConfig(false);
    }
  };

  const handleRegenerateBrief = async () => {
    setRegeneratingBrief(true);
    try {
      const res = await fetch('https://www.tritonapex.io/api/cron/briefs?force=true', {
        headers: { Authorization: `Bearer ${process.env.REACT_APP_TRITON_CRON_SECRET}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to regenerate brief');
      await fetchBriefs();
      if (currentBriefDate) await fetchFullBrief(currentBriefDate);
    } catch (err) {
      console.error('Error regenerating brief:', err);
      alert('Failed to regenerate brief: ' + err.message);
    } finally {
      setRegeneratingBrief(false);
    }
  };

  const [regenerateError, setRegenerateError] = useState(null);

  const handleRegenerateCards = async () => {
    setConfirmRegenCards(false);
    setRegeneratingCards(true);
    setRegenerateError(null);
    try {
      const res = await fetch('https://www.tritonapex.io/api/cron/daily-cards?force=true', {
        headers: { Authorization: `Bearer ${process.env.REACT_APP_TRITON_CRON_SECRET}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || `Server error ${res.status}`);
      }
      if (json.skipped) {
        setRegenerateError(`Skipped: ${json.reason === 'no_games' ? 'No finished games for this date' : json.reason === 'no_starters' ? 'No starting pitchers found' : json.reason || 'unknown'}`);
      } else {
        setRegenerateError(null);
      }
      await fetchCardsArchive();
      // Use the date from the cron response (the date it actually generated for)
      const generatedDate = json.date || currentCardDate;
      if (generatedDate) {
        setCurrentCardDate(generatedDate);
        await fetchCardsForDate(generatedDate);
      }
    } catch (err) {
      console.error('Error regenerating cards:', err);
      setRegenerateError(err.message);
    } finally {
      setRegeneratingCards(false);
    }
  };

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

  const fetchBriefs = useCallback(async () => {
    if (!tritonSupabase) return;
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 5);
      const cutoffDate = cutoff.toISOString().slice(0, 10);
      const { data, error } = await tritonSupabase
        .from('briefs')
        .select('id, date, title, summary, metadata')
        .gte('date', cutoffDate)
        .order('date', { ascending: false });
      if (!error && data) {
        setBriefs(data);
        if (data.length > 0 && !currentBriefDate) {
          setCurrentBriefDate(data[0].date);
        }
      }
    } catch (err) {
      console.error('Error fetching briefs:', err);
    }
  }, [currentBriefDate]);

  const fetchFullBrief = useCallback(async (date) => {
    if (!tritonSupabase || !date) return;
    setBriefLoading(true);
    try {
      const { data, error } = await tritonSupabase
        .from('briefs')
        .select('*')
        .eq('date', date)
        .maybeSingle();
      if (!error) setCurrentBrief(data);
    } catch (err) {
      console.error('Error fetching brief:', err);
    } finally {
      setBriefLoading(false);
    }
  }, []);

  useEffect(() => {
    if (currentBriefDate) fetchFullBrief(currentBriefDate);
  }, [currentBriefDate, fetchFullBrief]);

  const fetchCardsArchive = useCallback(async () => {
    if (!tritonSupabase) return [];
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 5);
      const cutoffDate = cutoff.toISOString().slice(0, 10);
      const { data, error } = await tritonSupabase
        .from('daily_cards')
        .select('id, date, pitcher_id, pitcher_name, game_pk, game_info, ip, pitch_count, rank')
        .gte('date', cutoffDate)
        .order('date', { ascending: false })
        .order('rank', { ascending: true });
      if (!error && data) {
        // Group by date
        const byDate = {};
        for (const card of data) {
          if (!byDate[card.date]) byDate[card.date] = [];
          byDate[card.date].push(card);
        }
        const archive = Object.entries(byDate)
          .sort(([a], [b]) => b.localeCompare(a))
          .slice(0, 30)
          .map(([date, cards]) => ({ date, cards }));
        setCardsArchive(archive);
        if (archive.length > 0 && !currentCardDate) {
          setCurrentCardDate(archive[0].date);
        }
        return archive;
      }
      return [];
    } catch (err) {
      console.error('Error fetching cards archive:', err);
      return [];
    }
  }, [currentCardDate]);

  const fetchCardsForDate = useCallback(async (date) => {
    if (!tritonSupabase || !date) return;
    setCardsLoading(true);
    try {
      const { data, error } = await tritonSupabase
        .from('daily_cards')
        .select('id, date, pitcher_id, pitcher_name, game_pk, game_info, ip, pitch_count, rank')
        .eq('date', date)
        .order('rank', { ascending: true });
      if (!error) setCurrentCards(data || []);
    } catch (err) {
      console.error('Error fetching cards:', err);
    } finally {
      setCardsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (currentCardDate) fetchCardsForDate(currentCardDate);
  }, [currentCardDate, fetchCardsForDate]);

  useEffect(() => {
    const timeout = setTimeout(() => setLoading(false), 5000);
    Promise.all([fetchArticles(), fetchNewsletters(), fetchReports(), fetchBriefs(), fetchCardsArchive(), fetchCardsConfig()])
      .finally(() => { setLoading(false); clearTimeout(timeout); });
    return () => clearTimeout(timeout);
  }, [fetchArticles, fetchNewsletters, fetchReports, fetchBriefs, fetchCardsArchive, fetchCardsConfig]);

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([fetchArticles(), fetchNewsletters(), fetchReports(), fetchBriefs(), fetchCardsArchive(), fetchCardsConfig()]);
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
          {selectedItem._type === 'brief' && (
            <>
              <div style={{ marginBottom: '12px' }}>
                <span style={s.metaText}>
                  {new Date(selectedItem.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                </span>
              </div>
              <h1 style={s.readerTitle}>{selectedItem.title}</h1>
              <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.55)', marginBottom: '20px', lineHeight: 1.6 }}>{selectedItem.summary}</p>
              {selectedItem.metadata && (
                <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
                  {selectedItem.metadata.finished_count !== undefined && (
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.45)', background: 'rgba(255,255,255,0.06)', padding: '3px 10px', borderRadius: '6px' }}>
                      {selectedItem.metadata.finished_count || 0} games
                    </span>
                  )}
                  {selectedItem.metadata.is_off_day && (
                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#f59e0b', background: 'rgba(245,158,11,0.1)', padding: '3px 10px', borderRadius: '6px' }}>
                      Off Day
                    </span>
                  )}
                </div>
              )}
              <div style={s.readerContent} dangerouslySetInnerHTML={{ __html: selectedItem.content || '' }} />
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
            {sec === 'news' ? 'News' : sec === 'newsletters' ? 'Newsletters' : sec === 'reports' ? 'Reports' : sec === 'briefs' ? 'Briefs' : 'Cards'}
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

          {/* Briefs Section */}
          {section === 'briefs' && (
            <div>
              {/* Date navigation + Regenerate */}
              {currentBriefDate && (
                <div style={s.briefDateNav}>
                  <button
                    onClick={() => {
                      const idx = briefs.findIndex(b => b.date === currentBriefDate);
                      if (idx < briefs.length - 1) setCurrentBriefDate(briefs[idx + 1].date);
                    }}
                    disabled={briefs.findIndex(b => b.date === currentBriefDate) >= briefs.length - 1}
                    style={s.briefNavBtn}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 3L5 8l5 5" /></svg>
                  </button>
                  <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>
                    {new Date(currentBriefDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })}
                  </span>
                  <button
                    onClick={() => {
                      const idx = briefs.findIndex(b => b.date === currentBriefDate);
                      if (idx > 0) setCurrentBriefDate(briefs[idx - 1].date);
                    }}
                    disabled={briefs.findIndex(b => b.date === currentBriefDate) <= 0}
                    style={s.briefNavBtn}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 3l5 5-5 5" /></svg>
                  </button>
                  <button onClick={handleRegenerateBrief} disabled={regeneratingBrief} style={{ ...s.briefActionBtn, marginLeft: 'auto', opacity: regeneratingBrief ? 0.5 : 1 }}>
                    {regeneratingBrief ? (
                      <><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite', marginRight: '4px' }}><path d="M14 8a6 6 0 11-1.5-4" /><path d="M14 2v4h-4" /></svg>Regenerating…</>
                    ) : (
                      <><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '4px' }}><path d="M14 8a6 6 0 11-1.5-4" /><path d="M14 2v4h-4" /></svg>Regenerate</>
                    )}
                  </button>
                </div>
              )}

              {/* Current brief */}
              {briefLoading ? (
                <div style={s.briefCard}>
                  <div style={{ height: '20px', width: '60%', background: 'rgba(255,255,255,0.06)', borderRadius: '6px', marginBottom: '12px' }} />
                  <div style={{ height: '14px', width: '100%', background: 'rgba(255,255,255,0.04)', borderRadius: '4px', marginBottom: '8px' }} />
                  <div style={{ height: '14px', width: '80%', background: 'rgba(255,255,255,0.04)', borderRadius: '4px' }} />
                </div>
              ) : currentBrief ? (
                <div style={s.briefCard}>
                  <div style={s.briefCardHeader}>
                    <h2 style={s.briefTitle}>{currentBrief.title}</h2>
                    <p style={s.briefSummary}>{currentBrief.summary}</p>
                    {currentBrief.metadata && (
                      <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                        {currentBrief.metadata.finished_count !== undefined && (
                          <span style={s.briefBadge}>{currentBrief.metadata.finished_count || 0} games</span>
                        )}
                        {currentBrief.metadata.is_off_day && (
                          <span style={s.briefBadgeOffDay}>Off Day</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div style={s.briefContent} dangerouslySetInnerHTML={{ __html: currentBrief.content || '' }} />
                  <div style={s.briefActions}>
                    <button
                      onClick={() => {
                        if (!currentBrief.content) return;
                        const text = currentBrief.content
                          .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n## $1\n')
                          .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n### $1\n')
                          .replace(/<strong>(.*?)<\/strong>/gi, '**$1**')
                          .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
                          .replace(/<br\s*\/?>/gi, '\n')
                          .replace(/<\/p>/gi, '\n\n')
                          .replace(/<[^>]*>/g, '')
                          .replace(/\n{3,}/g, '\n\n')
                          .trim();
                        navigator.clipboard.writeText(`# ${currentBrief.title}\n\n${currentBrief.summary}\n\n${text}`);
                      }}
                      style={s.briefActionBtn}
                    >
                      Copy Markdown
                    </button>
                    <button onClick={() => openItem(currentBrief, 'brief')} style={s.briefActionBtn}>
                      Full View
                    </button>
                  </div>
                </div>
              ) : currentBriefDate ? (
                <div style={s.emptyState}>No brief available for this date.</div>
              ) : null}

              {/* Archive grid */}
              {briefs.length > 0 && (
                <div style={{ marginTop: '32px' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#fff', marginBottom: '16px' }}>Archive</h3>
                  <div style={s.briefArchiveGrid}>
                    {briefs.map(brief => (
                      <div
                        key={brief.id}
                        onClick={() => setCurrentBriefDate(brief.date)}
                        style={{
                          ...s.briefArchiveCard,
                          ...(brief.date === currentBriefDate ? s.briefArchiveCardActive : {}),
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                          <span style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            {new Date(brief.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                          </span>
                          {brief.metadata?.is_off_day && (
                            <span style={{ fontSize: '9px', fontWeight: 600, color: '#f59e0b', background: 'rgba(245,158,11,0.1)', padding: '2px 6px', borderRadius: '4px' }}>Off Day</span>
                          )}
                        </div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {brief.title}
                        </div>
                        <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                          {brief.summary}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!tritonSupabase && (
                <div style={s.emptyState}>Briefs are not configured. Add Triton Supabase credentials to .env.</div>
              )}
            </div>
          )}

          {/* Cards Section */}
          {section === 'cards' && (
            <div>
              {/* Full-size card modal */}
              {selectedCard && (
                <div
                  style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                  onClick={() => setSelectedCard(null)}
                >
                  <div style={{ position: 'relative', maxWidth: '95vw', maxHeight: '95vh' }} onClick={e => e.stopPropagation()}>
                    <img
                      src={`https://www.tritonapex.io/api/card-image?id=${selectedCard.id}`}
                      alt={selectedCard.pitcher_name}
                      style={{ maxWidth: '95vw', maxHeight: '85vh', borderRadius: '12px', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginTop: '16px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>{selectedCard.pitcher_name}</span>
                      <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>{selectedCard.game_info}</span>
                      <a
                        href={`https://www.tritonapex.io/api/card-image?id=${selectedCard.id}`}
                        download={`${selectedCard.pitcher_name.replace(/\s+/g, '-')}-${selectedCard.date}.png`}
                        style={{ padding: '6px 14px', background: '#6366f1', color: '#fff', borderRadius: '6px', fontSize: '12px', fontWeight: 600, textDecoration: 'none', marginLeft: '8px' }}
                        onClick={e => e.stopPropagation()}
                      >
                        Download PNG
                      </a>
                      <button
                        onClick={() => setSelectedCard(null)}
                        style={{ padding: '6px 14px', background: 'rgba(255,255,255,0.1)', color: '#fff', borderRadius: '6px', fontSize: '12px', border: 'none', cursor: 'pointer' }}
                      >
                        Close
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Date navigation */}
              {currentCardDate && (
                <div style={s.briefDateNav}>
                  <button
                    onClick={() => {
                      const dates = cardsArchive.map(a => a.date);
                      const idx = dates.indexOf(currentCardDate);
                      if (idx < dates.length - 1) setCurrentCardDate(dates[idx + 1]);
                    }}
                    disabled={(() => { const dates = cardsArchive.map(a => a.date); return dates.indexOf(currentCardDate) >= dates.length - 1; })()}
                    style={s.briefNavBtn}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 3L5 8l5 5" /></svg>
                  </button>
                  <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>
                    {new Date(currentCardDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })}
                  </span>
                  <button
                    onClick={() => {
                      const dates = cardsArchive.map(a => a.date);
                      const idx = dates.indexOf(currentCardDate);
                      if (idx > 0) setCurrentCardDate(dates[idx - 1]);
                    }}
                    disabled={(() => { const dates = cardsArchive.map(a => a.date); return dates.indexOf(currentCardDate) <= 0; })()}
                    style={s.briefNavBtn}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 3l5 5-5 5" /></svg>
                  </button>
                  {confirmRegenCards ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '12px' }}>
                      <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>Sure?</span>
                      <button onClick={handleRegenerateCards} style={{ ...s.briefActionBtn, borderColor: 'rgba(239,68,68,0.4)', color: '#ef4444' }}>Yes, regenerate</button>
                      <button onClick={() => setConfirmRegenCards(false)} style={s.briefActionBtn}>Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmRegenCards(true)} disabled={regeneratingCards} style={{ ...s.briefActionBtn, marginLeft: '12px', opacity: regeneratingCards ? 0.5 : 1 }}>
                      {regeneratingCards ? (
                        <><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite', marginRight: '4px' }}><path d="M14 8a6 6 0 11-1.5-4" /><path d="M14 2v4h-4" /></svg>Regenerating…</>
                      ) : (
                        <><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '4px' }}><path d="M14 8a6 6 0 11-1.5-4" /><path d="M14 2v4h-4" /></svg>Regenerate</>
                      )}
                    </button>
                  )}
                  <div style={{ position: 'relative', marginLeft: '4px' }}>
                    <button
                      onClick={() => setShowCardsConfig(!showCardsConfig)}
                      style={{ ...s.briefActionBtn, background: showCardsConfig ? 'rgba(99,102,241,0.2)' : undefined }}
                      title="Card settings"
                    >
                      <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <circle cx="10" cy="10" r="3" />
                        <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.93 4.93l1.41 1.41M13.66 13.66l1.41 1.41M4.93 15.07l1.41-1.41M13.66 6.34l1.41-1.41" />
                      </svg>
                    </button>
                    {showCardsConfig && (
                      <div style={s.cardsConfigPanel}>
                        <div style={{ fontSize: '13px', fontWeight: 700, color: '#e2e8f0', marginBottom: '12px' }}>Card Generation Settings</div>
                        <label style={s.configLabel}>Template</label>
                        <select
                          value={cardsConfig?.template_id || ''}
                          onChange={e => updateCardsConfig(e.target.value, cardsConfig?.top_n)}
                          disabled={savingConfig}
                          style={s.configSelect}
                        >
                          <option value="" disabled>Select template...</option>
                          {availableTemplates.map(t => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                        {cardsConfig?.template_id && (
                          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', marginTop: '4px' }}>
                            {availableTemplates.find(t => t.id === cardsConfig.template_id)?.name || 'Unknown'}
                          </div>
                        )}
                        <label style={{ ...s.configLabel, marginTop: '14px' }}>Cards per day</label>
                        <select
                          value={cardsConfig?.top_n || 5}
                          onChange={e => updateCardsConfig(cardsConfig?.template_id, parseInt(e.target.value))}
                          disabled={savingConfig || !cardsConfig?.template_id}
                          style={s.configSelect}
                        >
                          {[3, 5, 8, 10].map(n => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                        {savingConfig && <div style={{ fontSize: '11px', color: '#a5b4fc', marginTop: '8px' }}>Saving...</div>}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {regenerateError && (
                <div style={{ padding: '8px 14px', borderRadius: '8px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#fca5a5', fontSize: '12px', marginBottom: '12px' }}>
                  {regenerateError}
                </div>
              )}

              {/* Current day's cards as images */}
              {cardsLoading ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '16px' }}>
                  {[1,2,3,4,5].map(i => (
                    <div key={i} style={{ aspectRatio: '16/9', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)' }} />
                  ))}
                </div>
              ) : currentCards.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '16px' }}>
                  {currentCards.map(card => {
                    const ipFull = Math.floor(card.ip);
                    const ipPartial = Math.round((card.ip - ipFull) * 3);
                    const ipDisplay = `${ipFull}.${ipPartial}`;
                    return (
                      <div
                        key={card.id}
                        onClick={() => setSelectedCard(card)}
                        style={{ cursor: 'pointer', borderRadius: '12px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', transition: 'border-color 0.2s, transform 0.2s' }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)'; e.currentTarget.style.transform = 'scale(1.02)'; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.transform = 'scale(1)'; }}
                      >
                        <img
                          src={`https://www.tritonapex.io/api/card-image?id=${card.id}`}
                          alt={card.pitcher_name}
                          style={{ width: '100%', display: 'block', borderRadius: '12px 12px 0 0' }}
                          loading="lazy"
                        />
                        <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(255,255,255,0.02)' }}>
                          <span style={{ fontSize: '16px', fontWeight: 800, color: '#6366f1', minWidth: '20px' }}>{card.rank}</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0' }}>{card.pitcher_name}</div>
                            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>{card.game_info} &middot; {ipDisplay} IP &middot; {card.pitch_count}P</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : currentCardDate ? (
                <div style={s.emptyState}>No cards available for this date.</div>
              ) : null}

              {/* Archive grid */}
              {cardsArchive.length > 0 && (
                <div style={{ marginTop: '32px' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#fff', marginBottom: '16px' }}>Archive</h3>
                  <div style={s.briefArchiveGrid}>
                    {cardsArchive.map(entry => (
                      <div
                        key={entry.date}
                        onClick={() => setCurrentCardDate(entry.date)}
                        style={{
                          ...s.briefArchiveCard,
                          ...(entry.date === currentCardDate ? s.briefArchiveCardActive : {}),
                        }}
                      >
                        <div style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
                          {new Date(entry.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </div>
                        {entry.cards.map((c, i) => {
                          const ipF = Math.floor(c.ip);
                          const ipP = Math.round((c.ip - ipF) * 3);
                          return (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                              <span style={{ fontSize: '11px', fontWeight: 700, color: '#6366f1', width: '14px' }}>{c.rank}</span>
                              <span style={{ fontSize: '12px', color: '#e2e8f0' }}>{c.pitcher_name}</span>
                              <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', marginLeft: 'auto' }}>{ipF}.{ipP} IP</span>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!tritonSupabase && (
                <div style={s.emptyState}>Cards are not configured. Add Triton Supabase credentials to .env.</div>
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
  // Briefs styles
  briefDateNav: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
    marginBottom: '20px',
  },
  briefNavBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    background: 'rgba(255,255,255,0.03)',
    color: 'rgba(255,255,255,0.6)',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  briefCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '14px',
    overflow: 'hidden',
  },
  briefCardHeader: {
    padding: '24px 28px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  briefTitle: {
    fontSize: '20px',
    fontWeight: 700,
    color: '#ffffff',
    margin: '0 0 8px',
    lineHeight: 1.3,
  },
  briefSummary: {
    fontSize: '14px',
    color: 'rgba(255,255,255,0.5)',
    margin: 0,
    lineHeight: 1.6,
  },
  briefBadge: {
    fontSize: '11px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.45)',
    background: 'rgba(255,255,255,0.06)',
    padding: '3px 10px',
    borderRadius: '6px',
  },
  briefBadgeOffDay: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#f59e0b',
    background: 'rgba(245,158,11,0.1)',
    padding: '3px 10px',
    borderRadius: '6px',
  },
  briefContent: {
    padding: '24px 28px',
    fontSize: '15px',
    lineHeight: 1.7,
    color: 'rgba(255,255,255,0.75)',
  },
  briefActions: {
    padding: '16px 28px',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    display: 'flex',
    gap: '8px',
  },
  briefActionBtn: {
    padding: '6px 14px',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    background: 'rgba(255,255,255,0.03)',
    color: 'rgba(255,255,255,0.6)',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.15s',
  },
  cardsConfigPanel: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: '8px',
    width: '260px',
    padding: '16px',
    background: '#1a1a2e',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '12px',
    boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
    zIndex: 50,
  },
  configLabel: {
    display: 'block',
    fontSize: '11px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.45)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '6px',
  },
  configSelect: {
    width: '100%',
    padding: '8px 10px',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    background: 'rgba(255,255,255,0.04)',
    color: '#e2e8f0',
    fontSize: '13px',
    fontFamily: 'inherit',
    outline: 'none',
    cursor: 'pointer',
  },
  briefArchiveGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '12px',
  },
  briefArchiveCard: {
    padding: '16px',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '12px',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  briefArchiveCardActive: {
    borderColor: '#6366f1',
    background: 'rgba(99,102,241,0.06)',
  },
  // Cards styles
  cardsGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  cardSkeleton: {
    padding: '20px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '12px',
  },
  cardItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '16px 20px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '12px',
    transition: 'all 0.15s',
  },
  cardRank: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    fontWeight: 700,
    flexShrink: 0,
  },
  cardPitcher: {
    fontSize: '15px',
    fontWeight: 600,
    color: '#e2e8f0',
    marginBottom: '2px',
  },
  cardGame: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.4)',
    marginBottom: '6px',
  },
  cardStats: {
    display: 'flex',
    gap: '6px',
  },
  cardStatChip: {
    fontSize: '11px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.55)',
    background: 'rgba(255,255,255,0.06)',
    padding: '3px 10px',
    borderRadius: '6px',
  },
  cardLink: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.03)',
    color: 'rgba(255,255,255,0.4)',
    flexShrink: 0,
    transition: 'all 0.15s',
    textDecoration: 'none',
  },
};
