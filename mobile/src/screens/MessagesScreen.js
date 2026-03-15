import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useSupabaseQuery } from '../hooks/useSupabaseQuery';
import { supabase } from '../services/supabase';
import { colors, spacing, radius, fontSize } from '../utils/theme';

export default function MessagesScreen({ navigation }) {
  const { user } = useAuth();
  const { safeQuery } = useSupabaseQuery();
  const [conversations, setConversations] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchConversations = useCallback(async () => {
    if (!user) return;

    // 1. Get conversation IDs the user participates in
    const { data: participantData } = await safeQuery(() =>
      supabase.from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', user.id)
    );
    if (!participantData?.length) {
      setConversations([]);
      return;
    }

    const convoIds = participantData.map(p => p.conversation_id);

    // 2. Fetch conversation records
    const { data: convos } = await safeQuery(() =>
      supabase.from('conversations')
        .select('*')
        .in('id', convoIds)
        .order('created_at', { ascending: false })
    );
    if (!convos?.length) {
      setConversations([]);
      return;
    }

    // 3. Enrich each with participants and last message
    const enriched = await Promise.all(convos.map(async (convo) => {
      const { data: participants } = await safeQuery(() =>
        supabase.from('conversation_participants')
          .select('user_id, profile:profiles(id, full_name, title)')
          .eq('conversation_id', convo.id)
      );

      const { data: lastMsg } = await safeQuery(() =>
        supabase.from('direct_messages')
          .select('content, created_at, user_id')
          .eq('conversation_id', convo.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single()
      );

      return {
        ...convo,
        participants: participants || [],
        lastMessage: lastMsg,
      };
    }));

    // Sort by last message time
    enriched.sort((a, b) => {
      const aTime = a.lastMessage?.created_at || a.created_at;
      const bTime = b.lastMessage?.created_at || b.created_at;
      return new Date(bTime) - new Date(aTime);
    });

    setConversations(enriched);
  }, [safeQuery, user]);

  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchConversations();
    setRefreshing(false);
  }, [fetchConversations]);

  function getDisplayName(convo) {
    if (convo.name) return convo.name;
    const others = (convo.participants || [])
      .filter(p => p.user_id !== user?.id)
      .map(p => p.profile?.full_name || 'Unknown');
    return others.join(', ') || 'Conversation';
  }

  function renderConversation({ item }) {
    const name = getDisplayName(item);
    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => navigation.navigate('MessageDetail', {
          conversationId: item.id,
          conversationName: name,
        })}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{name[0]?.toUpperCase()}</Text>
        </View>
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          {item.lastMessage?.content ? (
            <Text style={styles.preview} numberOfLines={1}>{item.lastMessage.content}</Text>
          ) : null}
        </View>
        {item.lastMessage?.created_at ? (
          <Text style={styles.time}>
            {new Date(item.lastMessage.created_at).toLocaleDateString()}
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
  avatarText: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textSecondary },
  info: { flex: 1 },
  name: { fontSize: fontSize.base, fontWeight: '600', color: colors.text },
  preview: { fontSize: fontSize.sm, color: colors.textTertiary, marginTop: 2 },
  time: { fontSize: fontSize.xs, color: colors.textTertiary },
  emptyCard: { padding: spacing.xxxl, alignItems: 'center' },
  emptyText: { fontSize: fontSize.md, color: colors.textTertiary },
});
