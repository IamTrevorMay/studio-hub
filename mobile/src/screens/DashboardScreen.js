import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useSupabaseQuery } from '../hooks/useSupabaseQuery';
import { supabase } from '../services/supabase';
import { colors, spacing, radius, fontSize } from '../utils/theme';

export default function DashboardScreen() {
  const { user, profile } = useAuth();
  const { safeQuery } = useSupabaseQuery();
  const [refreshing, setRefreshing] = useState(false);
  const [announcements, setAnnouncements] = useState([]);
  const [itinerary, setItinerary] = useState([]);
  const [teamPresence, setTeamPresence] = useState([]);

  const fetchData = useCallback(async () => {
    const todayStr = new Date().toISOString().split('T')[0];

    const [announcementsResult, itineraryResult, presenceResult] = await Promise.all([
      safeQuery(() =>
        supabase.from('announcements')
          .select('*')
          .eq('target_date', todayStr)
          .order('created_at', { ascending: false })
      ),
      safeQuery(() =>
        supabase.from('daily_itinerary')
          .select('*')
          .eq('target_date', todayStr)
          .order('time_slot', { ascending: true })
      ),
      safeQuery(() =>
        supabase.from('profiles')
          .select('id, full_name, avatar_url, status, last_seen_at')
          .order('full_name')
      ),
    ]);

    if (announcementsResult.data) setAnnouncements(announcementsResult.data);
    if (itineraryResult.data) setItinerary(itineraryResult.data);
    if (presenceResult.data) setTeamPresence(presenceResult.data);
  }, [safeQuery]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {/* Welcome */}
      <Text style={styles.greeting}>
        Welcome back{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}
      </Text>

      {/* Announcements */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Announcements</Text>
        {announcements.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No announcements today</Text>
          </View>
        ) : (
          announcements.map(a => (
            <View key={a.id} style={styles.card}>
              <Text style={styles.cardTitle}>{a.title}</Text>
              <Text style={styles.cardBody}>{a.content}</Text>
            </View>
          ))
        )}
      </View>

      {/* Itinerary */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Today's Itinerary</Text>
        {itinerary.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No items scheduled</Text>
          </View>
        ) : (
          itinerary.map(item => (
            <View key={item.id} style={styles.itineraryRow}>
              <Text style={styles.timeSlot}>{item.time_slot}</Text>
              <View style={styles.itineraryInfo}>
                <Text style={styles.itineraryTitle}>{item.title}</Text>
                {item.description ? <Text style={styles.itineraryDesc}>{item.description}</Text> : null}
              </View>
            </View>
          ))
        )}
      </View>

      {/* Team Presence */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Team</Text>
        <View style={styles.presenceGrid}>
          {teamPresence.map(member => {
            const isOnline = member.status === 'active';
            return (
              <View key={member.id} style={styles.presenceItem}>
                <View style={[styles.avatar, isOnline && styles.avatarOnline]}>
                  <Text style={styles.avatarText}>
                    {(member.full_name || '?')[0].toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.memberName} numberOfLines={1}>
                  {member.full_name || 'Unknown'}
                </Text>
                <View style={[styles.statusDot, { backgroundColor: isOnline ? colors.green : colors.textTertiary }]} />
              </View>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl },
  greeting: {
    fontSize: fontSize.xxl,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xxl,
  },
  section: { marginBottom: spacing.xxl },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  cardTitle: {
    fontSize: fontSize.base,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  cardBody: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  emptyCard: {
    padding: spacing.xxl,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  emptyText: { fontSize: fontSize.md, color: colors.textTertiary },
  itineraryRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  timeSlot: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.primary,
    width: 60,
    paddingTop: 2,
  },
  itineraryInfo: { flex: 1 },
  itineraryTitle: { fontSize: fontSize.md, fontWeight: '500', color: colors.text },
  itineraryDesc: { fontSize: fontSize.sm, color: colors.textTertiary, marginTop: 2 },
  presenceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  presenceItem: { alignItems: 'center', width: 64 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceHover,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  avatarOnline: { borderWidth: 2, borderColor: colors.green },
  avatarText: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textSecondary },
  memberName: { fontSize: fontSize.xs, color: colors.textSecondary, textAlign: 'center' },
  statusDot: { width: 6, height: 6, borderRadius: 3, marginTop: 2 },
});
