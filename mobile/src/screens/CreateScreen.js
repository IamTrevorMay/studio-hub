import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  TextInput, RefreshControl, Alert,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useSupabaseQuery } from '../hooks/useSupabaseQuery';
import { supabase } from '../services/supabase';
import { colors, spacing, radius, fontSize } from '../utils/theme';

const COLOR_OPTIONS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b',
  '#22c55e', '#3b82f6', '#ef4444', '#14b8a6',
];

export default function CreateScreen({ navigation }) {
  const { profile } = useAuth();
  const { safeQuery } = useSupabaseQuery();
  const [concepts, setConcepts] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedColor, setSelectedColor] = useState(COLOR_OPTIONS[0]);
  const [creating, setCreating] = useState(false);

  const fetchConcepts = useCallback(async () => {
    const { data } = await safeQuery(() =>
      supabase.from('concepts')
        .select('*, creator:profiles!concepts_profile_fk(full_name)')
        .order('created_at', { ascending: false })
    );
    if (data) setConcepts(data);
  }, [safeQuery]);

  useEffect(() => { fetchConcepts(); }, [fetchConcepts]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchConcepts();
    setRefreshing(false);
  }, [fetchConcepts]);

  async function handleCreate() {
    if (!name.trim() || creating) return;
    setCreating(true);
    const { error } = await safeQuery(() =>
      supabase.from('concepts').insert({
        name: name.trim(),
        description: description.trim() || null,
        color: selectedColor,
        created_by: profile.id,
      })
    );
    if (error) {
      Alert.alert('Error', 'Failed to create concept');
    } else {
      setName('');
      setDescription('');
      setSelectedColor(COLOR_OPTIONS[0]);
      setShowForm(false);
      await fetchConcepts();
    }
    setCreating(false);
  }

  function renderConcept({ item }) {
    return (
      <TouchableOpacity
        style={styles.conceptCard}
        onPress={() => navigation.navigate('ConceptDetail', {
          conceptId: item.id,
          name: item.name,
          color: item.color,
        })}
      >
        <View style={[styles.colorDot, { backgroundColor: item.color || colors.primary }]} />
        <View style={styles.conceptInfo}>
          <Text style={styles.conceptName}>{item.name}</Text>
          {item.description ? (
            <Text style={styles.conceptDesc} numberOfLines={1}>{item.description}</Text>
          ) : null}
          <Text style={styles.conceptMeta}>{item.creator?.full_name || 'Unknown'}</Text>
        </View>
        <Text style={styles.arrow}>&rsaquo;</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={styles.content}
        data={concepts}
        keyExtractor={item => item.id}
        renderItem={renderConcept}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        ListHeaderComponent={
          <>
            {/* Create toggle */}
            {!showForm && (
              <TouchableOpacity style={styles.addBtn} onPress={() => setShowForm(true)}>
                <Text style={styles.addBtnText}>+ New Concept</Text>
              </TouchableOpacity>
            )}

            {/* Inline create form */}
            {showForm && (
              <View style={styles.formCard}>
                <TextInput
                  style={styles.input}
                  placeholder="Concept name"
                  placeholderTextColor={colors.textTertiary}
                  value={name}
                  onChangeText={setName}
                />
                <TextInput
                  style={[styles.input, styles.multiInput]}
                  placeholder="Description (optional)"
                  placeholderTextColor={colors.textTertiary}
                  value={description}
                  onChangeText={setDescription}
                  multiline
                />

                {/* Color picker */}
                <View style={styles.colorRow}>
                  {COLOR_OPTIONS.map(c => (
                    <TouchableOpacity
                      key={c}
                      style={[
                        styles.colorSwatch,
                        { backgroundColor: c },
                        selectedColor === c && styles.colorSwatchSelected,
                      ]}
                      onPress={() => setSelectedColor(c)}
                    />
                  ))}
                </View>

                <View style={styles.formActions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowForm(false)}>
                    <Text style={styles.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.createBtn, (!name.trim() || creating) && styles.disabledBtn]}
                    onPress={handleCreate}
                    disabled={!name.trim() || creating}
                  >
                    <Text style={styles.createText}>{creating ? 'Creating...' : 'Create'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </>
        }
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No concepts yet</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl },
  addBtn: {
    padding: spacing.lg,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.lg,
    alignItems: 'center',
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    borderStyle: 'dashed',
  },
  addBtnText: { fontSize: fontSize.base, fontWeight: '600', color: colors.primary },
  formCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  input: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    color: colors.text,
    fontSize: fontSize.base,
  },
  multiInput: { minHeight: 60, textAlignVertical: 'top' },
  colorRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  colorSwatch: { width: 32, height: 32, borderRadius: 16 },
  colorSwatchSelected: { borderWidth: 3, borderColor: '#fff' },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.xs },
  cancelBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.md },
  cancelText: { fontSize: fontSize.sm, color: colors.textSecondary },
  createBtn: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
  },
  disabledBtn: { opacity: 0.4 },
  createText: { fontSize: fontSize.sm, fontWeight: '600', color: '#fff' },
  conceptCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  colorDot: { width: 12, height: 12, borderRadius: 6, marginRight: spacing.md },
  conceptInfo: { flex: 1 },
  conceptName: { fontSize: fontSize.base, fontWeight: '600', color: colors.text },
  conceptDesc: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  conceptMeta: { fontSize: fontSize.xs, color: colors.textTertiary, marginTop: 2 },
  arrow: { fontSize: fontSize.xl, color: colors.textTertiary },
  emptyCard: { padding: spacing.xxxl, alignItems: 'center' },
  emptyText: { fontSize: fontSize.md, color: colors.textTertiary },
});
