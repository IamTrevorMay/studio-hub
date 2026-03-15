import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useSupabaseQuery } from '../hooks/useSupabaseQuery';
import { supabase } from '../services/supabase';
import { colors, spacing, radius, fontSize } from '../utils/theme';

export default function ChannelsScreen({ navigation }) {
  const { unreadMentionChannelIds } = useAuth();
  const { safeQuery } = useSupabaseQuery();
  const [channels, setChannels] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchChannels = useCallback(async () => {
    const { data } = await safeQuery(() =>
      supabase.from('channels')
        .select('*')
        .order('name')
    );
    if (data) setChannels(data);
  }, [safeQuery]);

  useEffect(() => { fetchChannels(); }, [fetchChannels]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchChannels();
    setRefreshing(false);
  }, [fetchChannels]);

  function renderChannel({ item }) {
    const hasUnread = unreadMentionChannelIds.includes(item.id);
    return (
      <TouchableOpacity
        style={styles.channelRow}
        onPress={() => navigation.navigate('ChannelDetail', { channelId: item.id, channelName: item.name })}
      >
        <Text style={styles.hash}>#</Text>
        <Text style={[styles.channelName, hasUnread && styles.channelNameUnread]}>{item.name}</Text>
        {hasUnread && <View style={styles.unreadDot} />}
      </TouchableOpacity>
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={channels}
      keyExtractor={item => item.id}
      renderItem={renderChannel}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      ListEmptyComponent={
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No channels</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  hash: { fontSize: fontSize.lg, color: colors.textTertiary, marginRight: spacing.sm, fontWeight: '700' },
  channelName: { fontSize: fontSize.base, color: colors.textSecondary, flex: 1 },
  channelNameUnread: { color: colors.text, fontWeight: '600' },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  emptyCard: { padding: spacing.xxxl, alignItems: 'center' },
  emptyText: { fontSize: fontSize.md, color: colors.textTertiary },
});
