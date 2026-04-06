import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { tritonSupabase } from '../tritonClient';
import { useAuth } from '../contexts/AuthContext';


const SECTIONS = ['inbox', 'briefs', 'cards', 'news', 'trends', 'daily'];
const SECTION_LABELS = { inbox: 'Inbox', briefs: 'Briefs', cards: 'Cards', news: 'News', trends: 'Trends', daily: 'Daily' };

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function Research() {
  const { profile, refreshKey } = useAuth();
  const [view, setView] = useState('feed'); // feed | reader
  const [section, setSection] = useState('inbox');
  const [articles, setArticles] = useState([]);
  const [feeds, setFeeds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all');
  const [selectedItem, setSelectedItem] = useState(null);

  // Briefs state
  const [briefs, setBriefs] = useState([]);
  const [currentBrief, setCurrentBrief] = useState(null);
  const [currentBriefDate, setCurrentBriefDate] = useState(null);
  const [briefLoading, setBriefLoading] = useState(false);

  // Cards state
  const [cardsArchive, setCardsArchive] = useState([]);
  const [currentCards, setCurrentCards] = useState([]);
  const [currentCardDate, setCurrentCardDate] = useState(null);
  const [cardsBucket, setCardsBucket] = useState('top_ip');
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

  // Trends state
  const [trends, setTrends] = useState([]);
  const [currentTrend, setCurrentTrend] = useState(null);
  const [currentTrendDate, setCurrentTrendDate] = useState(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const [regeneratingTrends, setRegeneratingTrends] = useState(false);

  // Daily graphics state
  const [dailyGraphics, setDailyGraphics] = useState([]); // { type, date, url }
  const [dailyGraphicsDate, setDailyGraphicsDate] = useState(null);
  const [dailyDates, setDailyDates] = useState([]); // sorted desc
  const [dailyLoading, setDailyLoading] = useState(false);
  const [selectedGraphic, setSelectedGraphic] = useState(null);
  const [regeneratingDaily, setRegeneratingDaily] = useState(false);


  // Inbox state
  const [inboxState, setInboxState] = useState([]);

  // Add feed state
  const [showAddFeed, setShowAddFeed] = useState(null); // 'news' | 'newsletter' | null
  const [addFeedUrl, setAddFeedUrl] = useState('');
  const [addFeedName, setAddFeedName] = useState('');
  const [addFeedSaving, setAddFeedSaving] = useState(false);
  const [managingFeeds, setManagingFeeds] = useState(null); // 'news' | 'newsletter' | null

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

  const handleRegenerateDaily = async () => {
    setRegeneratingDaily(true);
    try {
      const res = await fetch(
        `https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/fetch-daily-graphics?secret=${process.env.REACT_APP_CRON_SECRET || '300897BA-1E26-4328-97E8-FFB11BCF2C6D'}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Server error ${res.status}`);
      await fetchDailyDates();
      if (json.date) {
        setDailyGraphicsDate(json.date);
        await fetchDailyGraphics(json.date);
      }
    } catch (err) {
      console.error('Error regenerating daily graphics:', err);
      alert('Failed to regenerate daily graphics: ' + err.message);
    } finally {
      setRegeneratingDaily(false);
    }
  };

  const handleRegenerateTrends = async () => {
    setRegeneratingTrends(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/generate-trends`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, apikey: process.env.REACT_APP_SUPABASE_ANON_KEY },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to generate trends');
      await fetchTrends();
      if (json.date) setCurrentTrendDate(json.date);
    } catch (err) {
      console.error('Error regenerating trends:', err);
      alert('Failed to regenerate trends: ' + err.message);
    } finally {
      setRegeneratingTrends(false);
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

  const handleAddFeed = async (sourceType) => {
    if (!addFeedUrl.trim()) return;
    setAddFeedSaving(true);
    try {
      const { error } = await supabase.from('research_feeds').insert({
        url: addFeedUrl.trim(),
        name: addFeedName.trim() || new URL(addFeedUrl.trim()).hostname.replace('www.', ''),
        enabled: true,
        source_type: sourceType,
      });
      if (error) throw error;
      setAddFeedUrl('');
      setAddFeedName('');
      setShowAddFeed(null);
      await fetchArticles();
    } catch (err) {
      console.error('Error adding feed:', err);
      alert('Failed to add feed: ' + err.message);
    } finally {
      setAddFeedSaving(false);
    }
  };

  const handleDeleteFeed = async (feedId) => {
    try {
      const { error } = await supabase.from('research_feeds').delete().eq('id', feedId);
      if (error) throw error;
      await fetchArticles();
    } catch (err) {
      console.error('Error deleting feed:', err);
    }
  };

  const allFeeds = feeds;
  const newsFeeds = useMemo(() => feeds.filter(f => !f.source_type || f.source_type === 'news'), [feeds]);
  const newsletterFeeds = useMemo(() => feeds.filter(f => f.source_type === 'newsletter'), [feeds]);

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

  const fetchCardsArchive = useCallback(async (bucket) => {
    if (!tritonSupabase) return [];
    const activeBucket = bucket || cardsBucket;
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 5);
      const cutoffDate = cutoff.toISOString().slice(0, 10);
      const { data, error } = await tritonSupabase
        .from('daily_cards')
        .select('id, date, pitcher_id, pitcher_name, game_pk, game_info, ip, pitch_count, rank, bucket')
        .gte('date', cutoffDate)
        .eq('bucket', activeBucket)
        .order('date', { ascending: false })
        .order('rank', { ascending: true });
      if (!error && data) {
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
  }, [currentCardDate, cardsBucket]);

  const fetchCardsForDate = useCallback(async (date, bucket) => {
    if (!tritonSupabase || !date) return;
    const activeBucket = bucket || cardsBucket;
    setCardsLoading(true);
    try {
      const { data, error } = await tritonSupabase
        .from('daily_cards')
        .select('id, date, pitcher_id, pitcher_name, game_pk, game_info, ip, pitch_count, rank, bucket')
        .eq('date', date)
        .eq('bucket', activeBucket)
        .order('rank', { ascending: true });
      if (!error) setCurrentCards(data || []);
    } catch (err) {
      console.error('Error fetching cards:', err);
    } finally {
      setCardsLoading(false);
    }
  }, [cardsBucket]);

  useEffect(() => {
    if (currentCardDate) fetchCardsForDate(currentCardDate);
  }, [currentCardDate, fetchCardsForDate]);

  // Re-fetch when bucket changes
  useEffect(() => {
    fetchCardsArchive(cardsBucket);
    if (currentCardDate) fetchCardsForDate(currentCardDate, cardsBucket);
  }, [cardsBucket]); // eslint-disable-line

  // Trends fetching
  const fetchTrends = useCallback(async () => {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);
      const cutoffDate = cutoff.toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from('research_trends')
        .select('*')
        .gte('date', cutoffDate)
        .order('date', { ascending: false });
      if (!error && data) {
        setTrends(data);
        if (data.length > 0 && !currentTrendDate) {
          setCurrentTrendDate(data[0].date);
          setCurrentTrend(data[0]);
        }
      }
    } catch (err) {
      console.error('Error fetching trends:', err);
    }
  }, [currentTrendDate]);

  useEffect(() => {
    if (currentTrendDate && trends.length > 0) {
      const trend = trends.find(t => t.date === currentTrendDate);
      if (trend) setCurrentTrend(trend);
    }
  }, [currentTrendDate, trends]);


  // Daily graphics fetching (from local cache table, populated by cron)
  const fetchDailyDates = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('daily_graphics')
        .select('date')
        .order('date', { ascending: false });
      if (!error && data) {
        const unique = [...new Set(data.map(r => r.date))];
        setDailyDates(unique);
        if (unique.length > 0 && !dailyGraphicsDate) {
          setDailyGraphicsDate(unique[0]);
        }
      }
    } catch (err) {
      console.error('Error fetching daily graphics dates:', err);
    }
  }, [dailyGraphicsDate]);

  const fetchDailyGraphics = useCallback(async (date) => {
    if (!date) return;
    setDailyLoading(true);
    try {
      const { data, error } = await supabase
        .from('daily_graphics')
        .select('*')
        .eq('date', date)
        .order('id', { ascending: true });
      if (!error) setDailyGraphics(data || []);
    } catch (err) {
      console.error('Error fetching daily graphics:', err);
      setDailyGraphics([]);
    } finally {
      setDailyLoading(false);
    }
  }, []);

  useEffect(() => {
    if (dailyGraphicsDate) fetchDailyGraphics(dailyGraphicsDate);
  }, [dailyGraphicsDate, fetchDailyGraphics]);

  // Inbox state fetching
  const fetchInboxState = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('research_inbox_state')
        .select('*')
        .is('archived_at', null);
      if (!error) setInboxState(data || []);
    } catch (err) {
      console.error('Error fetching inbox state:', err);
    }
  }, []);

  // Build inbox items from briefs, cards archive, and trends
  const inboxItems = useMemo(() => {
    const items = [];
    const stateMap = {};
    for (const row of inboxState) {
      stateMap[`${row.item_type}-${row.item_date}`] = row;
    }

    for (const brief of briefs) {
      const key = `brief-${brief.date}`;
      const state = stateMap[key];
      items.push({
        type: 'brief',
        date: brief.date,
        title: brief.title,
        summary: brief.summary,
        read: state?.read || false,
      });
    }

    const seenCardDates = new Set();
    for (const entry of cardsArchive) {
      if (seenCardDates.has(entry.date)) continue;
      seenCardDates.add(entry.date);
      const key = `cards-${entry.date}`;
      const state = stateMap[key];
      const topNames = entry.cards.slice(0, 3).map(c => c.pitcher_name).join(', ');
      items.push({
        type: 'cards',
        date: entry.date,
        title: `Daily Cards`,
        summary: topNames || `${entry.cards.length} cards`,
        read: state?.read || false,
      });
    }

    for (const trend of trends) {
      const key = `trends-${trend.date}`;
      const state = stateMap[key];
      items.push({
        type: 'trends',
        date: trend.date,
        title: 'Trends Report',
        summary: trend.summary || `${trend.source_count || 0} sources analyzed`,
        read: state?.read || false,
      });
    }

    items.sort((a, b) => b.date.localeCompare(a.date));
    return items;
  }, [briefs, cardsArchive, trends, inboxState]);

  const unreadInboxCount = useMemo(() => inboxItems.filter(i => !i.read).length, [inboxItems]);

  const markInboxRead = useCallback(async (type, date) => {
    // Optimistic update
    setInboxState(prev => {
      const key = `${type}-${date}`;
      const exists = prev.find(r => r.item_type === type && r.item_date === date);
      if (exists) return prev.map(r => r.item_type === type && r.item_date === date ? { ...r, read: true } : r);
      return [...prev, { item_type: type, item_date: date, read: true, archived_at: null }];
    });
    try {
      await supabase.from('research_inbox_state').upsert(
        { user_id: profile?.id, item_type: type, item_date: date, read: true },
        { onConflict: 'user_id,item_type,item_date' }
      );
    } catch (err) {
      console.error('Error marking inbox read:', err);
    }
  }, [profile?.id]);

  const archiveInboxItem = useCallback(async (type, date) => {
    setInboxState(prev => prev.filter(r => !(r.item_type === type && r.item_date === date)));
    try {
      await supabase.from('research_inbox_state').upsert(
        { user_id: profile?.id, item_type: type, item_date: date, read: true, archived_at: new Date().toISOString() },
        { onConflict: 'user_id,item_type,item_date' }
      );
    } catch (err) {
      console.error('Error archiving inbox item:', err);
    }
  }, [profile?.id]);

  const handleInboxItemClick = useCallback((item) => {
    markInboxRead(item.type, item.date);
    if (item.type === 'brief') {
      setSection('briefs');
      setCurrentBriefDate(item.date);
    } else if (item.type === 'cards') {
      setSection('cards');
      setCurrentCardDate(item.date);
    } else if (item.type === 'trends') {
      setSection('trends');
      setCurrentTrendDate(item.date);
    }
  }, [markInboxRead]);

  useEffect(() => {
    const timeout = setTimeout(() => setLoading(false), 5000);
    Promise.all([fetchArticles(), fetchBriefs(), fetchCardsArchive(), fetchCardsConfig(), fetchTrends(), fetchDailyDates(), fetchInboxState()])
      .finally(() => { setLoading(false); clearTimeout(timeout); });
    return () => clearTimeout(timeout);
  }, [fetchArticles, fetchBriefs, fetchCardsArchive, fetchCardsConfig, fetchTrends, fetchDailyDates, fetchInboxState, refreshKey]);

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([fetchArticles(), fetchBriefs(), fetchCardsArchive(), fetchCardsConfig(), fetchTrends(), fetchDailyDates(), fetchInboxState()]);
    setRefreshing(false);
  }

  function openItem(item, type) {
    setSelectedItem({ ...item, _type: type });
    setView('reader');
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

  // --- Feed View ---
  return (
    <div style={s.container}>
      {/* Header */}
      <div style={s.header}>
        <h1 style={s.title}>Research</h1>
        <button onClick={handleRefresh} disabled={refreshing} style={s.refreshBtn}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }}>
            <path d="M2 8a6 6 0 0110.47-4M14 8a6 6 0 01-10.47 4" />
            <path d="M14 2v4h-4M2 14v-4h4" />
          </svg>
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Section tabs */}
      <div style={s.sectionTabs}>
        {SECTIONS.map(sec => (
          <button
            key={sec}
            onClick={() => setSection(sec)}
            style={{ ...s.sectionTab, ...(section === sec ? s.sectionTabActive : {}) }}
          >
            {SECTION_LABELS[sec]}
            {sec === 'inbox' && unreadInboxCount > 0 && (
              <span style={s.unreadBadge}>{unreadInboxCount}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={s.emptyState}>Loading...</div>
      ) : (
        <>
          {/* Inbox Section */}
          {section === 'inbox' && (
            <div style={s.listContainer}>
              {inboxItems.length === 0 ? (
                <div style={s.emptyState}>No new items in your inbox.</div>
              ) : (
                inboxItems.map(item => (
                  <div
                    key={`${item.type}-${item.date}`}
                    style={s.listItem}
                    onClick={() => handleInboxItemClick(item)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                      {!item.read && <span style={s.unreadDot} />}
                      <span style={s.inboxTypeBadge}>
                        {item.type === 'brief' ? 'Brief' : item.type === 'cards' ? 'Cards' : 'Trends'}
                      </span>
                      <span style={s.inboxDate}>
                        {new Date(item.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={s.inboxTitle}>{item.title}</div>
                        <div style={s.inboxSummary}>{item.summary}</div>
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); archiveInboxItem(item.type, item.date); }}
                      style={s.archiveBtn}
                      title="Archive"
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

          {/* Daily Graphics Section */}
          {section === 'daily' && (
            <div>
              {dailyGraphicsDate && (
                <div style={s.briefDateNav}>
                  <button
                    onClick={() => {
                      const idx = dailyDates.indexOf(dailyGraphicsDate);
                      if (idx < dailyDates.length - 1) setDailyGraphicsDate(dailyDates[idx + 1]);
                    }}
                    disabled={dailyDates.indexOf(dailyGraphicsDate) >= dailyDates.length - 1}
                    style={s.briefNavBtn}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 3L5 8l5 5" /></svg>
                  </button>
                  <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>
                    {new Date(dailyGraphicsDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })}
                  </span>
                  <button
                    onClick={() => {
                      const idx = dailyDates.indexOf(dailyGraphicsDate);
                      if (idx > 0) setDailyGraphicsDate(dailyDates[idx - 1]);
                    }}
                    disabled={dailyDates.indexOf(dailyGraphicsDate) <= 0}
                    style={s.briefNavBtn}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 3l5 5-5 5" /></svg>
                  </button>
                  <button onClick={handleRegenerateDaily} disabled={regeneratingDaily} style={{ ...s.briefActionBtn, marginLeft: 'auto', opacity: regeneratingDaily ? 0.5 : 1 }}>
                    {regeneratingDaily ? (
                      <><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite', marginRight: '4px' }}><path d="M14 8a6 6 0 11-1.5-4" /><path d="M14 2v4h-4" /></svg>Fetching…</>
                    ) : (
                      <><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '4px' }}><path d="M14 8a6 6 0 11-1.5-4" /><path d="M14 2v4h-4" /></svg>Regenerate</>
                    )}
                  </button>
                </div>
              )}

              {dailyLoading ? (
                <div style={s.dailyGrid}>
                  {[1,2,3,4,5].map(i => (
                    <div key={i} style={{ aspectRatio: '1080/1350', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)' }} />
                  ))}
                </div>
              ) : dailyGraphics.length > 0 ? (
                <div style={s.dailyGrid}>
                  {dailyGraphics.map(g => (
                    <div
                      key={g.type}
                      onClick={() => setSelectedGraphic(g)}
                      style={s.dailyCard}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)'; e.currentTarget.style.transform = 'scale(1.02)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.transform = 'scale(1)'; }}
                    >
                      <img
                        src={g.url}
                        alt={g.type}
                        style={{ width: '100%', display: 'block', borderRadius: '12px 12px 0 0' }}
                        loading="lazy"
                      />
                      <div style={s.dailyCardLabel}>
                        {g.type.replace(/-/g, ' ')}
                      </div>
                    </div>
                  ))}
                </div>
              ) : dailyGraphicsDate ? (
                <div style={s.emptyState}>No graphics available for this date.</div>
              ) : (
                <div style={s.emptyState}>No daily graphics available.</div>
              )}

              {dailyDates.length > 1 && (
                <div style={{ marginTop: '32px' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#fff', marginBottom: '16px' }}>Archive</h3>
                  <div style={s.briefArchiveGrid}>
                    {dailyDates.map(date => (
                      <div
                        key={date}
                        onClick={() => setDailyGraphicsDate(date)}
                        style={{
                          ...s.briefArchiveCard,
                          ...(date === dailyGraphicsDate ? s.briefArchiveCardActive : {}),
                        }}
                      >
                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0' }}>
                          {new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Lightbox */}
              {selectedGraphic && (
                <div
                  style={s.dailyLightbox}
                  onClick={() => setSelectedGraphic(null)}
                >
                  <div style={s.dailyLightboxInner} onClick={e => e.stopPropagation()}>
                    <button onClick={() => setSelectedGraphic(null)} style={s.dailyLightboxClose}>
                      <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4l8 8M12 4l-8 8" /></svg>
                    </button>
                    <img
                      src={selectedGraphic.url}
                      alt={selectedGraphic.type}
                      style={{ maxWidth: '100%', maxHeight: '85vh', borderRadius: '12px', display: 'block' }}
                    />
                    <div style={{ textAlign: 'center', marginTop: '12px', fontSize: '14px', fontWeight: 600, color: 'rgba(255,255,255,0.7)', textTransform: 'capitalize' }}>
                      {selectedGraphic.type.replace(/-/g, ' ')}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* News Section */}
          {section === 'news' && (
            <>
              <div style={s.filterRow}>
                <button
                  onClick={() => setActiveFilter('all')}
                  style={{ ...s.filterChip, ...(activeFilter === 'all' ? s.filterChipActive : {}) }}
                >
                  All Sources
                </button>
                {allFeeds.map(feed => (
                  <button
                    key={feed.id}
                    onClick={() => setActiveFilter(feed.id)}
                    style={{
                      ...s.filterChip,
                      ...(activeFilter === feed.id ? { background: (feed.color || '#6366f1') + '22', color: feed.color || '#a5b4fc', borderColor: (feed.color || '#6366f1') + '44' } : {}),
                    }}
                  >
                    {feed.icon_emoji} {feed.name}
                    {feed.source_type === 'newsletter' && <span style={{ fontSize: '9px', opacity: 0.5, marginLeft: '4px' }}>NL</span>}
                  </button>
                ))}
                <button
                  onClick={() => { setShowAddFeed(showAddFeed === 'news' ? null : 'news'); setAddFeedUrl(''); setAddFeedName(''); }}
                  style={{ ...s.filterChip, ...(showAddFeed === 'news' ? s.filterChipActive : {}), display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v10M3 8h10" /></svg>
                  Add
                </button>
                <button
                  onClick={() => setManagingFeeds(managingFeeds === 'news' ? null : 'news')}
                  style={{ ...s.filterChip, ...(managingFeeds === 'news' ? s.filterChipActive : {}), display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6" /><path d="M6 8h4" /></svg>
                  Manage
                </button>
              </div>

              {showAddFeed === 'news' && (
                <div style={s.addFeedForm}>
                  <input
                    type="text"
                    placeholder="Feed URL (e.g. https://example.com/rss or newsletter.substack.com/feed)"
                    value={addFeedUrl}
                    onChange={e => setAddFeedUrl(e.target.value)}
                    style={s.addFeedInput}
                    autoFocus
                  />
                  <input
                    type="text"
                    placeholder="Name (optional)"
                    value={addFeedName}
                    onChange={e => setAddFeedName(e.target.value)}
                    style={{ ...s.addFeedInput, flex: '0 0 180px' }}
                  />
                  <button
                    onClick={() => handleAddFeed('news')}
                    disabled={addFeedSaving || !addFeedUrl.trim()}
                    style={{ ...s.addFeedBtn, opacity: addFeedSaving || !addFeedUrl.trim() ? 0.5 : 1 }}
                  >
                    {addFeedSaving ? 'Adding...' : 'Add Source'}
                  </button>
                  <button onClick={() => setShowAddFeed(null)} style={s.addFeedCancelBtn}>Cancel</button>
                </div>
              )}

              {managingFeeds === 'news' && allFeeds.length > 0 && (
                <div style={s.manageFeedsContainer}>
                  {allFeeds.map(feed => (
                    <div key={feed.id} style={s.manageFeedRow}>
                      <span style={{ fontSize: '13px', color: '#e2e8f0' }}>{feed.icon_emoji} {feed.name}</span>
                      <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{feed.url}</span>
                      <button onClick={() => handleDeleteFeed(feed.id)} style={s.manageFeedDeleteBtn}>Remove</button>
                    </div>
                  ))}
                </div>
              )}

              {filteredArticles.length === 0 ? (
                <div style={s.emptyState}>No articles yet. Add an RSS feed and click Refresh.</div>
              ) : (
                <div style={s.articleGrid}>
                  {filteredArticles.map(article => (
                    <div
                      key={article.id}
                      style={s.articleCard}
                      onClick={() => openItem(article, 'article')}
                    >
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

          {/* Briefs Section */}
          {section === 'briefs' && (
            <div>
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

              {/* Bucket sort tabs */}
              <div style={{ display: 'flex', gap: '4px', marginBottom: '14px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', padding: '3px', border: '1px solid rgba(255,255,255,0.04)', width: 'fit-content' }}>
                {[
                  { key: 'top_ip', label: 'Innings Pitched' },
                  { key: 'top_start', label: 'Overall Grade' },
                  { key: 'top_cmd', label: 'CnD+' },
                  { key: 'top_stuff', label: 'Stuff+' },
                ].map(b => (
                  <button
                    key={b.key}
                    onClick={() => setCardsBucket(b.key)}
                    style={{
                      padding: '5px 14px',
                      borderRadius: '6px',
                      border: 'none',
                      fontSize: '12px',
                      fontWeight: 600,
                      fontFamily: 'inherit',
                      cursor: 'pointer',
                      transition: 'background 0.12s, color 0.12s',
                      background: cardsBucket === b.key ? 'rgba(99,102,241,0.2)' : 'transparent',
                      color: cardsBucket === b.key ? '#a5b4fc' : 'rgba(255,255,255,0.4)',
                    }}
                  >
                    {b.label}
                  </button>
                ))}
              </div>

              {regenerateError && (
                <div style={{ padding: '8px 14px', borderRadius: '8px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#fca5a5', fontSize: '12px', marginBottom: '12px' }}>
                  {regenerateError}
                </div>
              )}

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

          {/* Trends Section */}
          {section === 'trends' && (
            <div>
              {trends.length === 0 ? (
                <div style={s.emptyState}>
                  No trends reports yet.
                  <button onClick={handleRegenerateTrends} disabled={regeneratingTrends} style={{ ...s.briefActionBtn, marginTop: '12px', opacity: regeneratingTrends ? 0.5 : 1 }}>
                    {regeneratingTrends ? (
                      <><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite', marginRight: '4px' }}><path d="M14 8a6 6 0 11-1.5-4" /><path d="M14 2v4h-4" /></svg>Generating…</>
                    ) : (
                      <><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '4px' }}><path d="M14 8a6 6 0 11-1.5-4" /><path d="M14 2v4h-4" /></svg>Generate Trends</>
                    )}
                  </button>
                </div>
              ) : (
                <>
                  {currentTrendDate && (
                    <div style={s.briefDateNav}>
                      <button
                        onClick={() => {
                          const idx = trends.findIndex(t => t.date === currentTrendDate);
                          if (idx < trends.length - 1) setCurrentTrendDate(trends[idx + 1].date);
                        }}
                        disabled={trends.findIndex(t => t.date === currentTrendDate) >= trends.length - 1}
                        style={s.briefNavBtn}
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 3L5 8l5 5" /></svg>
                      </button>
                      <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>
                        {new Date(currentTrendDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })}
                      </span>
                      <button
                        onClick={() => {
                          const idx = trends.findIndex(t => t.date === currentTrendDate);
                          if (idx > 0) setCurrentTrendDate(trends[idx - 1].date);
                        }}
                        disabled={trends.findIndex(t => t.date === currentTrendDate) <= 0}
                        style={s.briefNavBtn}
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 3l5 5-5 5" /></svg>
                      </button>
                      <button onClick={handleRegenerateTrends} disabled={regeneratingTrends} style={{ ...s.briefActionBtn, marginLeft: 'auto', opacity: regeneratingTrends ? 0.5 : 1 }}>
                        {regeneratingTrends ? (
                          <><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite', marginRight: '4px' }}><path d="M14 8a6 6 0 11-1.5-4" /><path d="M14 2v4h-4" /></svg>Regenerating…</>
                        ) : (
                          <><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '4px' }}><path d="M14 8a6 6 0 11-1.5-4" /><path d="M14 2v4h-4" /></svg>Regenerate</>
                        )}
                      </button>
                    </div>
                  )}

                  {currentTrend && (
                    <div style={s.briefCard}>
                      <div style={s.briefCardHeader}>
                        <p style={s.briefSummary}>{currentTrend.summary}</p>
                        {currentTrend.source_count > 0 && (
                          <span style={{ ...s.briefBadge, marginTop: '12px', display: 'inline-block' }}>
                            {currentTrend.source_count} sources
                          </span>
                        )}
                      </div>
                      <div style={{ padding: '24px 28px' }}>
                        {/* Current Events */}
                        {currentTrend.current_events && currentTrend.current_events.length > 0 && (
                          <div style={{ marginBottom: '28px' }}>
                            <h3 style={s.trendSectionHeader}>Current Events</h3>
                            <div style={s.trendItemGrid}>
                              {currentTrend.current_events.map((topic, i) => (
                                <div key={i} style={s.trendItem}>
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                    <div style={s.trendItemTitle}>{topic.title}</div>
                                    {topic.priority && (
                                      <span style={s.trendPriorityBadge}>{topic.priority}</span>
                                    )}
                                  </div>
                                  {topic.angle && <div style={s.trendItemAngle}>{topic.angle}</div>}
                                  {topic.reasoning && <div style={s.trendItemReasoning}>{topic.reasoning}</div>}
                                  {topic.sources && topic.sources.length > 0 && (
                                    <div style={{ marginTop: '8px', fontSize: '11px', color: 'rgba(255,255,255,0.3)' }}>
                                      {topic.sources.length} source{topic.sources.length !== 1 ? 's' : ''}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Evergreen */}
                        {currentTrend.evergreen && currentTrend.evergreen.length > 0 && (
                          <div>
                            <h3 style={s.trendSectionHeader}>Evergreen</h3>
                            <div style={s.trendItemGrid}>
                              {currentTrend.evergreen.map((topic, i) => (
                                <div key={i} style={s.trendItem}>
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                    <div style={s.trendItemTitle}>{topic.title}</div>
                                    {topic.priority && (
                                      <span style={s.trendPriorityBadge}>{topic.priority}</span>
                                    )}
                                  </div>
                                  {topic.angle && <div style={s.trendItemAngle}>{topic.angle}</div>}
                                  {topic.reasoning && <div style={s.trendItemReasoning}>{topic.reasoning}</div>}
                                  {topic.sources && topic.sources.length > 0 && (
                                    <div style={{ marginTop: '8px', fontSize: '11px', color: 'rgba(255,255,255,0.3)' }}>
                                      {topic.sources.length} source{topic.sources.length !== 1 ? 's' : ''}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Suggestions */}
                  {currentTrend && currentTrend.suggestions && currentTrend.suggestions.length > 0 && (
                    <div style={s.briefCard}>
                      <div style={{ padding: '24px 28px' }}>
                        <h3 style={s.trendSectionHeader}>Topic Suggestions</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          {currentTrend.suggestions.map((sug, i) => {
                            const gradeColor = sug.grade?.startsWith('A') ? '#22c55e'
                              : sug.grade?.startsWith('B') ? '#6366f1'
                              : sug.grade?.startsWith('C') ? '#f59e0b'
                              : sug.grade?.startsWith('D') ? '#f97316'
                              : '#ef4444';
                            return (
                              <div key={i} style={s.suggestionItem}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
                                  <span style={{ ...s.suggestionGrade, color: gradeColor, borderColor: gradeColor + '44', background: gradeColor + '15' }}>
                                    {sug.grade}
                                  </span>
                                  <div style={s.trendItemTitle}>{sug.title}</div>
                                </div>
                                {sug.description && <div style={s.trendItemAngle}>{sug.description}</div>}
                                {sug.reasoning && <div style={s.trendItemReasoning}>{sug.reasoning}</div>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Archive grid */}
                  {trends.length > 1 && (
                    <div style={{ marginTop: '32px' }}>
                      <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#fff', marginBottom: '16px' }}>Archive</h3>
                      <div style={s.briefArchiveGrid}>
                        {trends.map(trend => (
                          <div
                            key={trend.id}
                            onClick={() => setCurrentTrendDate(trend.date)}
                            style={{
                              ...s.briefArchiveCard,
                              ...(trend.date === currentTrendDate ? s.briefArchiveCardActive : {}),
                            }}
                          >
                            <div style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                              {new Date(trend.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                            </div>
                            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                              {trend.summary || 'No summary'}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* Reports section */}

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
  // Inbox styles
  inboxTypeBadge: {
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 600,
    background: 'rgba(99,102,241,0.15)',
    color: '#a5b4fc',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  inboxDate: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.4)',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  inboxTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#e2e8f0',
    marginBottom: '2px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  inboxSummary: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.4)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  archiveBtn: {
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
  // Trends styles
  trendSectionHeader: {
    fontSize: '15px',
    fontWeight: 700,
    color: '#a5b4fc',
    margin: '0 0 14px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  trendItemGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: '12px',
  },
  trendItem: {
    padding: '16px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '12px',
  },
  trendItemTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#e2e8f0',
  },
  trendItemAngle: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.6)',
    marginBottom: '6px',
    lineHeight: 1.5,
  },
  trendItemReasoning: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.35)',
    lineHeight: 1.5,
  },
  trendPriorityBadge: {
    fontSize: '10px',
    fontWeight: 700,
    color: '#f59e0b',
    background: 'rgba(245,158,11,0.1)',
    padding: '2px 8px',
    borderRadius: '4px',
    textTransform: 'uppercase',
    flexShrink: 0,
  },
  // Suggestion styles
  suggestionItem: {
    padding: '16px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '12px',
  },
  suggestionGrade: {
    fontSize: '14px',
    fontWeight: 800,
    padding: '4px 10px',
    borderRadius: '6px',
    border: '1px solid',
    flexShrink: 0,
    minWidth: '36px',
    textAlign: 'center',
  },
  // Add feed form
  addFeedForm: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 16px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '10px',
    marginBottom: '16px',
  },
  addFeedInput: {
    flex: 1,
    padding: '8px 12px',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    background: 'rgba(255,255,255,0.04)',
    color: '#e2e8f0',
    fontSize: '13px',
    fontFamily: 'inherit',
    outline: 'none',
  },
  addFeedBtn: {
    padding: '8px 16px',
    border: 'none',
    borderRadius: '8px',
    background: '#6366f1',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  addFeedCancelBtn: {
    padding: '8px 12px',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '13px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  manageFeedsContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    marginBottom: '16px',
    padding: '8px',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '10px',
  },
  manageFeedRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 10px',
    borderRadius: '6px',
  },
  manageFeedDeleteBtn: {
    padding: '4px 10px',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: '6px',
    background: 'transparent',
    color: '#ef4444',
    fontSize: '11px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    flexShrink: 0,
  },
  // Daily graphics styles
  dailyGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
    gap: '16px',
  },
  dailyCard: {
    cursor: 'pointer',
    borderRadius: '12px',
    overflow: 'hidden',
    border: '1px solid rgba(255,255,255,0.08)',
    transition: 'border-color 0.2s, transform 0.2s',
    background: 'rgba(255,255,255,0.02)',
  },
  dailyCardLabel: {
    padding: '10px 14px',
    fontSize: '13px',
    fontWeight: 600,
    color: '#e2e8f0',
    textTransform: 'capitalize',
    background: 'rgba(255,255,255,0.02)',
  },
  dailyLightbox: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '40px',
  },
  dailyLightboxInner: {
    position: 'relative',
    maxWidth: '500px',
  },
  dailyLightboxClose: {
    position: 'absolute',
    top: '-40px',
    right: '0',
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.7)',
    cursor: 'pointer',
    padding: '4px',
  },
};
