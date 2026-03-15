import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  TextInput, ScrollView, RefreshControl, ActivityIndicator, Alert,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useSupabaseQuery } from '../hooks/useSupabaseQuery';
import { supabase } from '../services/supabase';
import { colors, spacing, radius, fontSize } from '../utils/theme';

function formatTimestamp(seconds) {
  if (seconds == null) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function ReviewDetailScreen({ route }) {
  const { reviewId } = route.params;
  const { profile } = useAuth();
  const { safeQuery } = useSupabaseQuery();

  const [versions, setVersions] = useState([]);
  const [selectedVersionId, setSelectedVersionId] = useState(null);
  const [filter, setFilter] = useState('all'); // all | open | resolved
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedComment, setExpandedComment] = useState(null);
  const [replies, setReplies] = useState({}); // commentId -> reply[]
  const [replyText, setReplyText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Fetch versions
  const fetchVersions = useCallback(async () => {
    const { data } = await safeQuery(() =>
      supabase.from('review_versions')
        .select('*')
        .eq('review_id', reviewId)
        .order('version_number', { ascending: true })
    );
    if (data && data.length > 0) {
      setVersions(data);
      if (!selectedVersionId) setSelectedVersionId(data[data.length - 1].id);
    }
  }, [safeQuery, reviewId, selectedVersionId]);

  // Fetch comments for selected version
  const fetchComments = useCallback(async () => {
    if (!selectedVersionId) return;
    setLoading(true);
    const { data } = await safeQuery(() =>
      supabase.from('review_comments')
        .select('*, author:profiles!review_comments_profile_fk(full_name)')
        .eq('version_id', selectedVersionId)
        .order('timestamp_seconds', { ascending: true })
    );
    if (data) setComments(data);
    setLoading(false);
  }, [safeQuery, selectedVersionId]);

  // Fetch replies for a specific comment
  const fetchReplies = useCallback(async (commentId) => {
    const { data } = await safeQuery(() =>
      supabase.from('review_replies')
        .select('*, author:profiles!review_replies_profile_fk(full_name)')
        .eq('comment_id', commentId)
        .order('created_at', { ascending: true })
    );
    if (data) setReplies(prev => ({ ...prev, [commentId]: data }));
  }, [safeQuery]);

  useEffect(() => { fetchVersions(); }, [fetchVersions]);
  useEffect(() => { fetchComments(); }, [fetchComments]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchComments();
    setRefreshing(false);
  }, [fetchComments]);

  // Toggle expand + load replies
  function toggleExpand(commentId) {
    if (expandedComment === commentId) {
      setExpandedComment(null);
    } else {
      setExpandedComment(commentId);
      if (!replies[commentId]) fetchReplies(commentId);
    }
    setReplyText('');
  }

  // Submit reply
  async function handleReply(commentId) {
    if (!replyText.trim() || submitting) return;
    setSubmitting(true);
    await safeQuery(() =>
      supabase.from('review_replies').insert({
        comment_id: commentId,
        user_id: profile.id,
        content: replyText.trim(),
      })
    );
    setReplyText('');
    await fetchReplies(commentId);
    setSubmitting(false);
  }

  // Toggle resolve
  async function toggleResolve(comment) {
    const newResolved = !comment.is_resolved;
    await safeQuery(() =>
      supabase.from('review_comments')
        .update({
          is_resolved: newResolved,
          resolved_by: newResolved ? profile.id : null,
          resolved_at: newResolved ? new Date().toISOString() : null,
        })
        .eq('id', comment.id)
    );
    await fetchComments();
  }

  const filteredComments = comments.filter(c => {
    if (filter === 'open') return !c.is_resolved;
    if (filter === 'resolved') return c.is_resolved;
    return true;
  });

  const openCount = comments.filter(c => !c.is_resolved).length;
  const resolvedCount = comments.filter(c => c.is_resolved).length;

  function renderComment({ item: comment }) {
    const isExpanded = expandedComment === comment.id;
    const commentReplies = replies[comment.id] || [];

    return (
      <View style={[styles.commentCard, comment.is_resolved && styles.commentResolved]}>
        <TouchableOpacity onPress={() => toggleExpand(comment.id)} activeOpacity={0.7}>
          <View style={styles.commentHeader}>
            <Text style={styles.commentTimestamp}>{formatTimestamp(comment.timestamp_seconds)}</Text>
            <Text style={styles.commentAuthor}>{comment.author?.full_name || 'Unknown'}</Text>
            {comment.is_resolved && <Text style={styles.resolvedBadge}>Resolved</Text>}
          </View>
          <Text style={styles.commentContent}>{comment.content}</Text>
        </TouchableOpacity>

        {isExpanded && (
          <View style={styles.expandedSection}>
            {/* Replies */}
            {commentReplies.map(reply => (
              <View key={reply.id} style={styles.replyRow}>
                <Text style={styles.replyAuthor}>{reply.author?.full_name || 'Unknown'}</Text>
                <Text style={styles.replyContent}>{reply.content}</Text>
                <Text style={styles.replyDate}>{formatDate(reply.created_at)}</Text>
              </View>
            ))}

            {/* Reply input */}
            <View style={styles.replyInputRow}>
              <TextInput
                style={styles.replyInput}
                placeholder="Write a reply..."
                placeholderTextColor={colors.textTertiary}
                value={replyText}
                onChangeText={setReplyText}
                multiline
              />
              <TouchableOpacity
                style={[styles.replyBtn, (!replyText.trim() || submitting) && styles.disabledBtn]}
                onPress={() => handleReply(comment.id)}
                disabled={!replyText.trim() || submitting}
              >
                <Text style={styles.replyBtnText}>{submitting ? '...' : 'Send'}</Text>
              </TouchableOpacity>
            </View>

            {/* Resolve toggle */}
            <TouchableOpacity
              style={[styles.resolveBtn, comment.is_resolved && styles.unresolveBtn]}
              onPress={() => toggleResolve(comment)}
            >
              <Text style={[styles.resolveBtnText, comment.is_resolved && styles.unresolveBtnText]}>
                {comment.is_resolved ? 'Unresolve' : 'Resolve'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Version selector */}
      {versions.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.versionRow}
        >
          {versions.map(v => (
            <TouchableOpacity
              key={v.id}
              style={[styles.versionChip, selectedVersionId === v.id && styles.versionChipActive]}
              onPress={() => setSelectedVersionId(v.id)}
            >
              <Text style={[styles.versionText, selectedVersionId === v.id && styles.versionTextActive]}>
                V{v.version_number}{v.label ? ` — ${v.label}` : ''}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Filter toggle */}
      <View style={styles.filterRow}>
        {[
          { key: 'all', label: `All (${comments.length})` },
          { key: 'open', label: `Open (${openCount})` },
          { key: 'resolved', label: `Resolved (${resolvedCount})` },
        ].map(f => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Comments list */}
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxxl }} />
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={filteredComments}
          keyExtractor={item => item.id}
          renderItem={renderComment}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                {filter === 'all' ? 'No comments on this version' : `No ${filter} comments`}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  versionRow: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, gap: spacing.sm },
  versionChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: spacing.sm,
  },
  versionChipActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  versionText: { fontSize: fontSize.sm, color: colors.textSecondary },
  versionTextActive: { color: colors.primary, fontWeight: '600' },
  filterRow: { flexDirection: 'row', paddingHorizontal: spacing.xl, gap: spacing.sm, marginBottom: spacing.sm },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  filterChipActive: { backgroundColor: colors.primaryLight },
  filterText: { fontSize: fontSize.xs, color: colors.textSecondary },
  filterTextActive: { color: colors.primary, fontWeight: '600' },
  listContent: { padding: spacing.xl },
  commentCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  commentResolved: { opacity: 0.6 },
  commentHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  commentTimestamp: { fontSize: fontSize.sm, fontWeight: '700', color: colors.primary, fontVariant: ['tabular-nums'] },
  commentAuthor: { fontSize: fontSize.sm, color: colors.textSecondary },
  resolvedBadge: { fontSize: fontSize.xs, color: colors.green, fontWeight: '600', marginLeft: 'auto' },
  commentContent: { fontSize: fontSize.base, color: colors.text, lineHeight: 20 },
  expandedSection: { marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  replyRow: {
    paddingLeft: spacing.md,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    marginBottom: spacing.sm,
  },
  replyAuthor: { fontSize: fontSize.xs, fontWeight: '600', color: colors.textSecondary },
  replyContent: { fontSize: fontSize.sm, color: colors.text, marginTop: 2 },
  replyDate: { fontSize: fontSize.xs, color: colors.textTertiary, marginTop: 2 },
  replyInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
  replyInput: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    color: colors.text,
    fontSize: fontSize.sm,
    maxHeight: 80,
  },
  replyBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
  },
  disabledBtn: { opacity: 0.4 },
  replyBtnText: { fontSize: fontSize.sm, fontWeight: '600', color: '#fff' },
  resolveBtn: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.greenLight,
    borderRadius: radius.md,
    alignSelf: 'flex-start',
  },
  unresolveBtn: { backgroundColor: colors.amberLight },
  resolveBtnText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.green },
  unresolveBtnText: { color: colors.amber },
  emptyCard: { padding: spacing.xxxl, alignItems: 'center' },
  emptyText: { fontSize: fontSize.md, color: colors.textTertiary },
});
