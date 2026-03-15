import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { useSupabaseQuery } from '../hooks/useSupabaseQuery';
import { supabase } from '../services/supabase';
import { colors, spacing, radius, fontSize } from '../utils/theme';

const STATUSES = ['concept', 'script', 'production', 'edit', 'review', 'published'];
const STATUS_LABELS = {
  concept: 'Concept', script: 'Script', production: 'Production',
  edit: 'Edit', review: 'Review', published: 'Published',
};
const STATUS_COLORS = {
  concept: '#8b5cf6', script: '#3b82f6', production: '#f59e0b',
  edit: '#f97316', review: '#ec4899', published: '#22c55e',
};

export default function ProjectsScreen() {
  const { safeQuery } = useSupabaseQuery();
  const [projects, setProjects] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [filterStatus, setFilterStatus] = useState('all');

  const fetchProjects = useCallback(async () => {
    const query = supabase
      .from('projects')
      .select('*')
      .order('updated_at', { ascending: false });

    const { data } = await safeQuery(() => query);
    if (data) setProjects(data);
  }, [safeQuery]);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchProjects();
    setRefreshing(false);
  }, [fetchProjects]);

  const filtered = filterStatus === 'all'
    ? projects
    : projects.filter(p => p.status === filterStatus);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {/* Status filter chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.chip, filterStatus === 'all' && styles.chipActive]}
          onPress={() => setFilterStatus('all')}
        >
          <Text style={[styles.chipText, filterStatus === 'all' && styles.chipTextActive]}>All</Text>
        </TouchableOpacity>
        {STATUSES.map(s => (
          <TouchableOpacity
            key={s}
            style={[styles.chip, filterStatus === s && { ...styles.chipActive, borderColor: STATUS_COLORS[s] }]}
            onPress={() => setFilterStatus(s)}
          >
            <Text style={[styles.chipText, filterStatus === s && { color: STATUS_COLORS[s] }]}>
              {STATUS_LABELS[s]}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Project list */}
      {filtered.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No projects found</Text>
        </View>
      ) : (
        filtered.map(project => (
          <TouchableOpacity key={project.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle} numberOfLines={1}>{project.title}</Text>
              <View style={[styles.badge, { backgroundColor: STATUS_COLORS[project.status] + '22' }]}>
                <Text style={[styles.badgeText, { color: STATUS_COLORS[project.status] }]}>
                  {STATUS_LABELS[project.status]}
                </Text>
              </View>
            </View>
            {project.description ? (
              <Text style={styles.cardDesc} numberOfLines={2}>{project.description}</Text>
            ) : null}
            <Text style={styles.cardMeta}>
              Updated {new Date(project.updated_at).toLocaleDateString()}
            </Text>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl },
  filterRow: { marginBottom: spacing.lg, flexGrow: 0 },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: spacing.sm,
  },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  chipText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textSecondary },
  chipTextActive: { color: colors.primary },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  cardTitle: { fontSize: fontSize.base, fontWeight: '600', color: colors.text, flex: 1, marginRight: spacing.sm },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  badgeText: { fontSize: fontSize.xs, fontWeight: '600' },
  cardDesc: { fontSize: fontSize.md, color: colors.textSecondary, marginBottom: spacing.sm, lineHeight: 18 },
  cardMeta: { fontSize: fontSize.xs, color: colors.textTertiary },
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
