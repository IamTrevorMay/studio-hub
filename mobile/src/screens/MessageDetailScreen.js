import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, FlatList, TextInput, StyleSheet, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useSupabaseQuery } from '../hooks/useSupabaseQuery';
import { supabase } from '../services/supabase';
import { colors, spacing, radius, fontSize } from '../utils/theme';

export default function MessageDetailScreen({ route }) {
  const { conversationId, conversationName } = route.params;
  const { user } = useAuth();
  const { safeQuery } = useSupabaseQuery();
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const flatListRef = useRef(null);

  const fetchMessages = useCallback(async () => {
    const { data } = await safeQuery(() =>
      supabase.from('direct_messages')
        .select('*, profile:profiles(id, full_name, title)')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(100)
    );
    if (data) setMessages(data);
  }, [safeQuery, conversationId]);

  useEffect(() => { fetchMessages(); }, [fetchMessages]);

  // Realtime subscription for new DMs
  useEffect(() => {
    const channel = supabase.channel(`dm-${conversationId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'direct_messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, async (payload) => {
        // Fetch the full message with profile join
        const { data } = await supabase
          .from('direct_messages')
          .select('*, profile:profiles(id, full_name, title)')
          .eq('id', payload.new.id)
          .single();
        if (data) setMessages(prev => [...prev, data]);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [conversationId]);

  async function handleSend() {
    if (!newMessage.trim() || sending) return;
    setSending(true);
    try {
      await supabase.from('direct_messages').insert({
        conversation_id: conversationId,
        user_id: user.id,
        content: newMessage.trim(),
      });
      setNewMessage('');
    } catch (err) {
      console.error('Send failed:', err);
    } finally {
      setSending(false);
    }
  }

  function renderMessage({ item }) {
    const isMe = item.user_id === user?.id;
    const senderName = item.profile?.full_name || 'Unknown';
    return (
      <View style={[styles.msgRow, isMe && styles.msgRowMe]}>
        <Text style={styles.msgSender}>{senderName}</Text>
        <Text style={styles.msgContent}>{item.content}</Text>
        <Text style={styles.msgTime}>
          {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        ref={flatListRef}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={messages}
        keyExtractor={item => item.id}
        renderItem={renderMessage}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
      />

      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          placeholder={`Message ${conversationName}`}
          placeholderTextColor={colors.textTertiary}
          value={newMessage}
          onChangeText={setNewMessage}
          multiline
          maxLength={2000}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!newMessage.trim() || sending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!newMessage.trim() || sending}
        >
          <Text style={styles.sendBtnText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  list: { flex: 1 },
  listContent: { padding: spacing.lg },
  msgRow: { marginBottom: spacing.md },
  msgRowMe: {},
  msgSender: { fontSize: fontSize.sm, fontWeight: '600', color: colors.text, marginBottom: 2 },
  msgContent: { fontSize: fontSize.base, color: colors.textSecondary, lineHeight: 20 },
  msgTime: { fontSize: fontSize.xs, color: colors.textTertiary, marginTop: 2 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.lg,
    padding: spacing.md,
    fontSize: fontSize.base,
    color: colors.text,
    maxHeight: 100,
  },
  sendBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { fontSize: fontSize.md, fontWeight: '600', color: '#fff' },
});
