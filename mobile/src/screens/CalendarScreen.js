import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { useSupabaseQuery } from '../hooks/useSupabaseQuery';
import { supabase } from '../services/supabase';
import { colors, spacing, radius, fontSize, fontWeight } from '../utils/theme';

export default function CalendarScreen() {
  const { safeQuery } = useSupabaseQuery();
  const [events, setEvents] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchEvents = useCallback(async () => {
    const today = new Date().toISOString().split('T')[0];
    const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

    const { data } = await safeQuery(() =>
      supabase.from('calendar_events')
        .select('*')
        .gte('start_time', today)
        .lte('start_time', nextWeek + 'T23:59:59')
        .order('start_time', { ascending: true })
    );
    if (data) setEvents(data);
  }, [safeQuery]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchEvents();
    setRefreshing(false);
  }, [fetchEvents]);

  // Group events by date
  const grouped = {};
  events.forEach(event => {
    const dateKey = new Date(event.start_time).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push(event);
  });

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {Object.keys(grouped).length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No upcoming events this week</Text>
        </View>
      ) : (
        Object.entries(grouped).map(([date, dayEvents]) => (
          <View key={date} style={styles.dayGroup}>
            <Text style={styles.dateHeader}>{date}</Text>
            {dayEvents.map(event => (
              <View key={event.id} style={styles.eventCard}>
                <View style={[styles.eventStripe, { backgroundColor: event.color || colors.primary }]} />
                <View style={styles.eventInfo}>
                  <Text style={styles.eventTitle}>{event.title}</Text>
                  <Text style={styles.eventTime}>
                    {new Date(event.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {event.end_time && ` - ${new Date(event.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl },
  dayGroup: { marginBottom: spacing.xxl },
  dateHeader: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginBottom: spacing.md,
  },
  eventCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  eventStripe: { width: 4 },
  eventInfo: { flex: 1, padding: spacing.md },
  eventTitle: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  eventTime: { fontSize: fontSize.sm, color: colors.textTertiary, marginTop: 2 },
  emptyCard: {
    padding: spacing.xxxl,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  emptyText: { fontSize: fontSize.md, color: colors.textTertiary },
});
