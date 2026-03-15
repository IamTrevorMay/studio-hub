import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ScrollView, RefreshControl, ActivityIndicator, Linking,
  Image, Modal, Dimensions, Alert,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { useSupabaseQuery } from '../hooks/useSupabaseQuery';
import { supabase } from '../services/supabase';
import { tritonSupabase } from '../services/tritonClient';
import { colors, spacing, radius, fontSize } from '../utils/theme';

const SECTIONS = ['news', 'briefs', 'cards'];
const CARD_IMAGE_BASE = 'https://www.tritonapex.io/api/card-image';
const { width: SCREEN_WIDTH } = Dimensions.get('window');

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatIP(ip) {
  const full = Math.floor(ip);
  const partial = Math.round((ip - full) * 3);
  return `${full}.${partial}`;
}

// ── HTML to RN components parser ──
// Handles: h2, h3, p, strong, em, a, br, li, tables, divs
function HtmlContent({ html, collapsedSections, onToggleSection }) {
  if (!html) return null;

  // Split HTML into block-level sections by h2/h3 headers
  const sections = [];
  let current = { heading: null, level: 0, content: '' };

  // Normalize some HTML
  const cleaned = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  // Split by h2/h3 tags
  const parts = cleaned.split(/(<h[23][^>]*>.*?<\/h[23]>)/gi);

  for (const part of parts) {
    const h2Match = part.match(/<h2[^>]*>(.*?)<\/h2>/i);
    const h3Match = part.match(/<h3[^>]*>(.*?)<\/h3>/i);
    if (h2Match) {
      if (current.heading || current.content.trim()) sections.push({ ...current });
      current = { heading: stripTags(h2Match[1]), level: 2, content: '' };
    } else if (h3Match) {
      if (current.heading || current.content.trim()) sections.push({ ...current });
      current = { heading: stripTags(h3Match[1]), level: 3, content: '' };
    } else {
      current.content += part;
    }
  }
  if (current.heading || current.content.trim()) sections.push({ ...current });

  return (
    <View>
      {sections.map((sec, i) => {
        const sectionKey = sec.heading || `section-${i}`;
        const isCollapsed = sec.heading && collapsedSections?.[sectionKey];
        const isCollapsible = sec.heading && sec.level === 2 && sec.content.trim().length > 0;

        return (
          <View key={i} style={{ marginBottom: spacing.md }}>
            {sec.heading && (
              <TouchableOpacity
                onPress={isCollapsible ? () => onToggleSection(sectionKey) : undefined}
                activeOpacity={isCollapsible ? 0.6 : 1}
                style={styles.briefSectionHeader}
              >
                <Text style={sec.level === 2 ? styles.briefH2 : styles.briefH3}>
                  {sec.heading}
                </Text>
                {isCollapsible && (
                  <Text style={styles.collapseArrow}>{isCollapsed ? '+' : '-'}</Text>
                )}
              </TouchableOpacity>
            )}
            {!isCollapsed && sec.content.trim() ? (
              <InlineContent html={sec.content} />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function stripTags(html) {
  return html.replace(/<[^>]*>/g, '').trim();
}

// Parse inline HTML into Text/Touchable elements
function InlineContent({ html }) {
  if (!html) return null;

  // Extract links, bold, italic, and list items
  const elements = [];
  // Simple regex-based tokenizer
  const tokens = html.split(/(<a[^>]*>.*?<\/a>|<strong>.*?<\/strong>|<b>.*?<\/b>|<em>.*?<\/em>|<i>.*?<\/i>|<li[^>]*>.*?<\/li>|<table[\s\S]*?<\/table>)/gi);

  for (let t = 0; t < tokens.length; t++) {
    const token = tokens[t];
    if (!token) continue;

    const linkMatch = token.match(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/i);
    if (linkMatch) {
      elements.push(
        <Text
          key={t}
          style={styles.briefLink}
          onPress={() => Linking.openURL(linkMatch[1])}
        >
          {stripTags(linkMatch[2])}
        </Text>
      );
      continue;
    }

    const boldMatch = token.match(/<(?:strong|b)>(.*?)<\/(?:strong|b)>/i);
    if (boldMatch) {
      elements.push(<Text key={t} style={styles.briefBold}>{stripTags(boldMatch[1])}</Text>);
      continue;
    }

    const emMatch = token.match(/<(?:em|i)>(.*?)<\/(?:em|i)>/i);
    if (emMatch) {
      elements.push(<Text key={t} style={styles.briefItalic}>{stripTags(emMatch[1])}</Text>);
      continue;
    }

    const liMatch = token.match(/<li[^>]*>(.*?)<\/li>/i);
    if (liMatch) {
      elements.push(
        <Text key={t} style={styles.briefListItem}>{'\u2022  '}{stripTags(liMatch[1])}</Text>
      );
      continue;
    }

    // Table rendering — extract rows
    const tableMatch = token.match(/<table[\s\S]*?<\/table>/i);
    if (tableMatch) {
      elements.push(<TableContent key={t} html={tableMatch[0]} />);
      continue;
    }

    // Plain text
    const text = stripTags(token).replace(/\n{3,}/g, '\n\n').trim();
    if (text) {
      elements.push(<Text key={t} style={styles.briefText}>{text}</Text>);
    }
  }

  return <View>{elements}</View>;
}

// Render HTML tables as grid rows (for box scores)
function TableContent({ html }) {
  const rows = [];
  const rowMatches = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const rowHtml of rowMatches) {
    const cells = [];
    const cellMatches = rowHtml.match(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi) || [];
    for (const cellHtml of cellMatches) {
      const content = stripTags(cellHtml.replace(/<(?:td|th)[^>]*>/i, '').replace(/<\/(?:td|th)>/i, ''));
      const isHeader = /<th/i.test(cellHtml);
      cells.push({ content, isHeader });
    }
    rows.push(cells);
  }

  if (rows.length === 0) return null;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tableScroll}>
      <View>
        {rows.map((row, ri) => (
          <View key={ri} style={[styles.tableRow, ri === 0 && styles.tableHeaderRow]}>
            {row.map((cell, ci) => (
              <Text
                key={ci}
                style={[
                  styles.tableCell,
                  cell.isHeader && styles.tableCellHeader,
                  ci === 0 && styles.tableCellFirst,
                ]}
                numberOfLines={1}
              >
                {cell.content}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// ── Card Preview Modal ──
function CardPreviewModal({ card, visible, onClose }) {
  const [saving, setSaving] = useState(false);

  async function handleSaveToPhotos() {
    setSaving(true);
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow photo library access to save card images.');
        setSaving(false);
        return;
      }
      const uri = `${CARD_IMAGE_BASE}?id=${card.id}`;
      const filename = `${card.pitcher_name.replace(/\s+/g, '-')}-${card.date}.png`;
      const fileUri = FileSystem.cacheDirectory + filename;
      const download = await FileSystem.downloadAsync(uri, fileUri);
      await MediaLibrary.saveToLibraryAsync(download.uri);
      Alert.alert('Saved', 'Card image saved to Photos.');
    } catch (err) {
      console.error('Save error:', err);
      Alert.alert('Error', 'Failed to save image.');
    } finally {
      setSaving(false);
    }
  }

  if (!card) return null;

  const ipDisplay = formatIP(card.ip);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <TouchableOpacity style={styles.modalClose} onPress={onClose}>
          <Text style={styles.modalCloseText}>Close</Text>
        </TouchableOpacity>

        <Image
          source={{ uri: `${CARD_IMAGE_BASE}?id=${card.id}` }}
          style={styles.modalImage}
          resizeMode="contain"
        />

        <View style={styles.modalInfo}>
          <Text style={styles.modalName}>{card.pitcher_name}</Text>
          <Text style={styles.modalMeta}>
            {card.game_info}  ·  {ipDisplay} IP  ·  {card.pitch_count}P
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.5 }]}
          onPress={handleSaveToPhotos}
          disabled={saving}
        >
          <Text style={styles.saveBtnText}>{saving ? 'Saving...' : 'Save to Photos'}</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

export default function ResearchScreen() {
  const { safeQuery } = useSupabaseQuery();
  const [section, setSection] = useState('news');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // News state
  const [articles, setArticles] = useState([]);
  const [feeds, setFeeds] = useState([]);
  const [activeFilter, setActiveFilter] = useState('all');

  // Briefs state
  const [briefs, setBriefs] = useState([]);
  const [currentBrief, setCurrentBrief] = useState(null);
  const [currentBriefDate, setCurrentBriefDate] = useState(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState({});

  // Cards state
  const [cardsArchive, setCardsArchive] = useState([]);
  const [currentCards, setCurrentCards] = useState([]);
  const [currentCardDate, setCurrentCardDate] = useState(null);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [selectedCard, setSelectedCard] = useState(null);

  function toggleSection(key) {
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }));
  }

  // ── News: fetch RSS via edge function ──
  const fetchArticles = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
      const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
      const response = await fetch(`${url}/functions/v1/fetch-rss`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': anonKey,
        },
      });
      const result = await response.json();
      if (response.ok) {
        setArticles(result.articles || []);
        setFeeds(result.feeds || []);
      }
    } catch (err) {
      console.error('Error fetching articles:', err);
    }
  }, []);

  // ── Briefs ──
  const fetchBriefs = useCallback(async () => {
    if (!tritonSupabase) return;
    try {
      const { data, error } = await tritonSupabase
        .from('briefs')
        .select('id, date, title, summary, metadata')
        .order('date', { ascending: false })
        .limit(30);
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
    setCollapsedSections({});
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

  // ── Cards ──
  const fetchCardsArchive = useCallback(async () => {
    if (!tritonSupabase) return;
    try {
      const { data, error } = await tritonSupabase
        .from('daily_cards')
        .select('id, date, pitcher_id, pitcher_name, game_pk, game_info, ip, pitch_count, rank')
        .order('date', { ascending: false })
        .order('rank', { ascending: true })
        .limit(150);
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
      }
    } catch (err) {
      console.error('Error fetching cards:', err);
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

  // ── Initial load ──
  useEffect(() => {
    const timeout = setTimeout(() => setLoading(false), 5000);
    Promise.all([fetchArticles(), fetchBriefs(), fetchCardsArchive()])
      .finally(() => { setLoading(false); clearTimeout(timeout); });
    return () => clearTimeout(timeout);
  }, [fetchArticles, fetchBriefs, fetchCardsArchive]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (section === 'news') await fetchArticles();
    else if (section === 'briefs') { await fetchBriefs(); if (currentBriefDate) await fetchFullBrief(currentBriefDate); }
    else if (section === 'cards') { await fetchCardsArchive(); if (currentCardDate) await fetchCardsForDate(currentCardDate); }
    setRefreshing(false);
  }, [section, fetchArticles, fetchBriefs, fetchFullBrief, currentBriefDate, fetchCardsArchive, fetchCardsForDate, currentCardDate]);

  const filteredArticles = activeFilter === 'all'
    ? articles
    : articles.filter(a => a.feedTitle === activeFilter);

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Section tabs */}
      <View style={styles.tabRow}>
        {SECTIONS.map(s => (
          <TouchableOpacity
            key={s}
            style={[styles.tab, section === s && styles.tabActive]}
            onPress={() => setSection(s)}
          >
            <Text style={[styles.tabText, section === s && styles.tabTextActive]}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── NEWS ── */}
      {section === 'news' && (
        <FlatList
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={
            feeds.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
                <TouchableOpacity
                  style={[styles.filterChip, activeFilter === 'all' && styles.filterChipActive]}
                  onPress={() => setActiveFilter('all')}
                >
                  <Text style={[styles.filterText, activeFilter === 'all' && styles.filterTextActive]}>All</Text>
                </TouchableOpacity>
                {feeds.map(f => (
                  <TouchableOpacity
                    key={f.title}
                    style={[styles.filterChip, activeFilter === f.title && styles.filterChipActive]}
                    onPress={() => setActiveFilter(f.title)}
                  >
                    <Text style={[styles.filterText, activeFilter === f.title && styles.filterTextActive]}>{f.title}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : null
          }
          data={filteredArticles}
          keyExtractor={(item, i) => item.link || String(i)}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.articleCard}
              onPress={() => item.link && Linking.openURL(item.link)}
            >
              <Text style={styles.articleTitle} numberOfLines={2}>{item.title}</Text>
              {item.contentSnippet ? (
                <Text style={styles.articleSnippet} numberOfLines={2}>{item.contentSnippet}</Text>
              ) : null}
              <Text style={styles.articleMeta}>
                {item.feedTitle || 'Unknown'}  ·  {timeAgo(item.pubDate || item.isoDate)}
              </Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.emptyCard}><Text style={styles.emptyText}>No articles found</Text></View>
          }
        />
      )}

      {/* ── BRIEFS ── */}
      {section === 'briefs' && (
        <View style={{ flex: 1 }}>
          {!tritonSupabase ? (
            <View style={styles.emptyCard}><Text style={styles.emptyText}>Triton not configured</Text></View>
          ) : (
            <>
              {/* Date selector */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dateScrollOuter} contentContainerStyle={styles.dateScrollInner}>
                {briefs.map(b => (
                  <TouchableOpacity
                    key={b.date}
                    style={[styles.dateChip, currentBriefDate === b.date && styles.dateChipActive]}
                    onPress={() => setCurrentBriefDate(b.date)}
                  >
                    <Text style={[styles.dateChipText, currentBriefDate === b.date && styles.dateChipTextActive]}>
                      {formatDate(b.date)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Brief content */}
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.content}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
              >
                {briefLoading ? (
                  <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxxl }} />
                ) : currentBrief ? (
                  <View style={styles.briefCard}>
                    {/* Header */}
                    <Text style={styles.briefTitle}>{currentBrief.title}</Text>
                    {currentBrief.summary ? (
                      <Text style={styles.briefSummary}>{currentBrief.summary}</Text>
                    ) : null}

                    {/* Metadata badges */}
                    {currentBrief.metadata && (
                      <View style={styles.badgeRow}>
                        {currentBrief.metadata.finished_count !== undefined && (
                          <View style={styles.badge}>
                            <Text style={styles.badgeText}>{currentBrief.metadata.finished_count || 0} games</Text>
                          </View>
                        )}
                        {currentBrief.metadata.is_off_day && (
                          <View style={[styles.badge, { backgroundColor: colors.amberLight }]}>
                            <Text style={[styles.badgeText, { color: colors.amber }]}>Off Day</Text>
                          </View>
                        )}
                      </View>
                    )}

                    {/* Full HTML content */}
                    <View style={styles.briefDivider} />
                    <HtmlContent
                      html={currentBrief.content}
                      collapsedSections={collapsedSections}
                      onToggleSection={toggleSection}
                    />
                  </View>
                ) : (
                  <View style={styles.emptyCard}><Text style={styles.emptyText}>No brief for this date</Text></View>
                )}
              </ScrollView>
            </>
          )}
        </View>
      )}

      {/* ── CARDS ── */}
      {section === 'cards' && (
        <View style={{ flex: 1 }}>
          {!tritonSupabase ? (
            <View style={styles.emptyCard}><Text style={styles.emptyText}>Triton not configured</Text></View>
          ) : (
            <>
              {/* Date selector */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dateScrollOuter} contentContainerStyle={styles.dateScrollInner}>
                {cardsArchive.map(a => (
                  <TouchableOpacity
                    key={a.date}
                    style={[styles.dateChip, currentCardDate === a.date && styles.dateChipActive]}
                    onPress={() => setCurrentCardDate(a.date)}
                  >
                    <Text style={[styles.dateChipText, currentCardDate === a.date && styles.dateChipTextActive]}>
                      {formatDate(a.date)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Cards grid */}
              {cardsLoading ? (
                <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxxl }} />
              ) : (
                <FlatList
                  contentContainerStyle={styles.content}
                  refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
                  data={currentCards}
                  keyExtractor={item => item.id}
                  renderItem={({ item }) => {
                    const ipDisplay = formatIP(item.ip);
                    return (
                      <TouchableOpacity
                        style={styles.cardItem}
                        onPress={() => setSelectedCard(item)}
                        activeOpacity={0.8}
                      >
                        <Image
                          source={{ uri: `${CARD_IMAGE_BASE}?id=${item.id}` }}
                          style={styles.cardImage}
                          resizeMode="cover"
                        />
                        <View style={styles.cardOverlay}>
                          <Text style={styles.cardRankBig}>{item.rank}</Text>
                          <View style={styles.cardDetails}>
                            <Text style={styles.cardName}>{item.pitcher_name}</Text>
                            <Text style={styles.cardGame}>
                              {item.game_info}  ·  {ipDisplay} IP  ·  {item.pitch_count}P
                            </Text>
                          </View>
                        </View>
                      </TouchableOpacity>
                    );
                  }}
                  ListEmptyComponent={
                    <View style={styles.emptyCard}><Text style={styles.emptyText}>No cards for this date</Text></View>
                  }
                />
              )}

              {/* Card preview modal */}
              <CardPreviewModal
                card={selectedCard}
                visible={!!selectedCard}
                onClose={() => setSelectedCard(null)}
              />
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl },
  tabRow: { flexDirection: 'row', paddingHorizontal: spacing.xl, paddingTop: spacing.md, gap: spacing.sm },
  tab: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  tabActive: { backgroundColor: colors.primaryLight },
  tabText: { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: '600' },
  tabTextActive: { color: colors.primary },
  filterScroll: { marginBottom: spacing.md },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    marginRight: spacing.sm,
  },
  filterChipActive: { backgroundColor: colors.primaryLight },
  filterText: { fontSize: fontSize.xs, color: colors.textSecondary },
  filterTextActive: { color: colors.primary, fontWeight: '600' },
  dateScrollOuter: { flexGrow: 0, paddingVertical: spacing.sm },
  dateScrollInner: { paddingHorizontal: spacing.xl, gap: spacing.sm },
  dateChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    marginRight: spacing.sm,
  },
  dateChipActive: { backgroundColor: colors.primaryLight },
  dateChipText: { fontSize: fontSize.xs, color: colors.textSecondary },
  dateChipTextActive: { color: colors.primary, fontWeight: '600' },

  // News
  articleCard: {
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  articleTitle: { fontSize: fontSize.base, fontWeight: '600', color: colors.text },
  articleSnippet: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: spacing.xs, lineHeight: 18 },
  articleMeta: { fontSize: fontSize.xs, color: colors.textTertiary, marginTop: spacing.sm },

  // Briefs
  briefCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
  },
  briefTitle: { fontSize: fontSize.xxl, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  briefSummary: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 20 },
  badgeRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.sm,
  },
  badgeText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.primary },
  briefDivider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.lg },
  briefSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  briefH2: { fontSize: fontSize.lg, fontWeight: '700', color: colors.text },
  briefH3: { fontSize: fontSize.base, fontWeight: '600', color: colors.text },
  collapseArrow: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textTertiary, paddingHorizontal: spacing.sm },
  briefText: { fontSize: fontSize.sm, color: colors.text, lineHeight: 22, marginBottom: spacing.sm },
  briefBold: { fontSize: fontSize.sm, fontWeight: '700', color: colors.text },
  briefItalic: { fontSize: fontSize.sm, fontStyle: 'italic', color: colors.textSecondary },
  briefLink: { fontSize: fontSize.sm, color: colors.blue, textDecorationLine: 'underline', lineHeight: 22 },
  briefListItem: { fontSize: fontSize.sm, color: colors.text, lineHeight: 22, marginBottom: spacing.xs, paddingLeft: spacing.md },

  // Brief tables (box scores)
  tableScroll: { marginBottom: spacing.md },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tableHeaderRow: { backgroundColor: 'rgba(99,102,241,0.1)' },
  tableCell: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    fontSize: fontSize.xs,
    color: colors.text,
    minWidth: 40,
    textAlign: 'center',
  },
  tableCellHeader: { fontWeight: '700', color: colors.textSecondary, fontSize: fontSize.xs },
  tableCellFirst: { minWidth: 60, textAlign: 'left', fontWeight: '600' },

  // Cards
  cardItem: {
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  cardImage: {
    width: '100%',
    height: SCREEN_WIDTH * 0.75,
    backgroundColor: colors.surfaceHover,
  },
  cardOverlay: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md,
  },
  cardRankBig: { fontSize: fontSize.lg, fontWeight: '800', color: colors.primary },
  cardDetails: { flex: 1 },
  cardName: { fontSize: fontSize.base, fontWeight: '600', color: colors.text },
  cardGame: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },

  // Card modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  modalClose: {
    position: 'absolute',
    top: 60,
    right: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    zIndex: 10,
  },
  modalCloseText: { fontSize: fontSize.base, fontWeight: '600', color: '#fff' },
  modalImage: {
    width: SCREEN_WIDTH - spacing.xl * 2,
    height: (SCREEN_WIDTH - spacing.xl * 2) * 1.2,
    borderRadius: radius.xl,
  },
  modalInfo: { marginTop: spacing.lg, alignItems: 'center' },
  modalName: { fontSize: fontSize.lg, fontWeight: '700', color: '#fff' },
  modalMeta: { fontSize: fontSize.sm, color: 'rgba(255,255,255,0.5)', marginTop: spacing.xs },
  saveBtn: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
  },
  saveBtnText: { fontSize: fontSize.base, fontWeight: '600', color: '#fff' },

  emptyCard: { padding: spacing.xxxl, alignItems: 'center' },
  emptyText: { fontSize: fontSize.md, color: colors.textTertiary },
});
