import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  RefreshControl, Image,
} from 'react-native';
import { useSupabaseQuery } from '../hooks/useSupabaseQuery';
import { supabase } from '../services/supabase';
import { colors, spacing, radius, fontSize } from '../utils/theme';

export default function ReviewsScreen({ navigation }) {
  const { safeQuery } = useSupabaseQuery();
  const [reviews, setReviews] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchReviews = useCallback(async () => {
    const { data } = await safeQuery(() =>
      supabase.from('reviews')
        .select('*, creator:profiles!reviews_profile_fk(full_name)')
        .order('created_at', { ascending: false })
    );
    if (data) setReviews(data);
  }, [safeQuery]);

  useEffect(() => { fetchReviews(); }, [fetchReviews]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchReviews();
    setRefreshing(false);
  }, [fetchReviews]);

  function getThumbnailUrl(videoId) {
    if (!videoId) return null;
    return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function renderReview({ item }) {
    const thumbUrl = getThumbnailUrl(item.youtube_video_id);
    return (
      <TouchableOpacity
        style={styles.reviewCard}
        onPress={() => navigation.navigate('ReviewDetail', { reviewId: item.id, title: item.title })}
      >
        {thumbUrl ? (
          <Image source={{ uri: thumbUrl }} style={styles.thumbnail} />
        ) : (
          <View style={[styles.thumbnail, styles.noThumb]}>
            <Text style={styles.noThumbText}>No Preview</Text>
          </View>
        )}
        <View style={styles.reviewInfo}>
          <Text style={styles.reviewTitle} numberOfLines={2}>{item.title}</Text>
          <Text style={styles.reviewMeta}>
            {item.creator?.full_name || 'Unknown'}  ·  {formatDate(item.created_at)}
          </Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={reviews}
      keyExtractor={item => item.id}
      renderItem={renderReview}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      ListEmptyComponent={
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No reviews yet</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl },
  reviewCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  thumbnail: {
    width: 120,
    height: 80,
    backgroundColor: colors.surfaceHover,
  },
  noThumb: { alignItems: 'center', justifyContent: 'center' },
  noThumbText: { fontSize: fontSize.xs, color: colors.textTertiary },
  reviewInfo: { flex: 1, padding: spacing.md, justifyContent: 'center' },
  reviewTitle: { fontSize: fontSize.base, fontWeight: '600', color: colors.text },
  reviewMeta: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: spacing.xs },
  emptyCard: { padding: spacing.xxxl, alignItems: 'center' },
  emptyText: { fontSize: fontSize.md, color: colors.textTertiary },
});
