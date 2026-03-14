import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useSupabaseQuery } from '../hooks/useSupabaseQuery';
import { supabase } from '../services/supabase';
import { colors, spacing, radius, fontSize, fontWeight } from '../utils/theme';

export default function MessagesScreen() {
  const { user } = useAuth();
  const { safeQuery } = useSupabaseQuery();
  const [conversations, setConversations] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchConversations = useCallback(async () => {
    if (!user) return;
    const { data } = await safeQuery(() =>
      supabase.from('direct_conversations')
        .select('*, participant1:participant1_id(full_name), participant2:participant2_id(full_name)')
        .or(`participant1_id.eq.${user.id},participant2_id.eq.${user.id}`)
        .order('last_message_at', { ascending: false })
    );
    if (data) setConversations(data);
  }, [safeQuery, user]);

  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchConversations();
    setRefreshing(false);
  }, [fetchConversations]);

  function renderConversation({ item }) {
    const other = item.participant1_id === user?.id ? item.participant2 : item.participant1;
    const name = other?.full_name || 'Unknown';
    return (
      <TouchableOpacity style={styles.row}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{name[0]?.toUpperCase()}</Text>
        </View>
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          {item.last_message_preview ? (
            <Text style={styles.preview} numberOfLines={1}>{item.last_message_preview}</Text>
          ) : null}
        </View>
        {item.last_message_at ? (
          <Text style={styles.time}>
            {new Date(item.last_message_at).toLocaleDateString()}
          </Text>
        ) : null}
      </TouchableOpacity>
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={conversations}
      keyExtractor={item => item.id}
      renderItem={renderConversation}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      ListEmptyComponent={
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No conversations yet</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceHover,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.textSecondary },
  info: { flex: 1 },
  name: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.text },
  preview: { fontSize: fontSize.sm, color: colors.textTertiary, marginTop: 2 },
  time: { fontSize: fontSize.xs, color: colors.textTertiary },
  emptyCard: { padding: spacing.xxxl, alignItems: 'center' },
  emptyText: { fontSize: fontSize.md, color: colors.textTertiary },
});
