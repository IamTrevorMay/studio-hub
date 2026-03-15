import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  TextInput, RefreshControl, Alert,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useSupabaseQuery } from '../hooks/useSupabaseQuery';
import { supabase } from '../services/supabase';
import { colors, spacing, radius, fontSize } from '../utils/theme';

const DOC_TYPES = [
  { key: 'document', label: 'Document', color: colors.blue },
  { key: 'screenplay', label: 'Screenplay', color: colors.purple },
];

function getDefaultContent(type) {
  if (type === 'screenplay') return { titlePage: { title: '', author: '' }, elements: [], notes: [] };
  return { html: '' };
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function ConceptDetailScreen({ route, navigation }) {
  const { conceptId, color } = route.params;
  const { profile } = useAuth();
  const { safeQuery } = useSupabaseQuery();
  const [documents, setDocuments] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [docType, setDocType] = useState('document');
  const [creating, setCreating] = useState(false);

  const fetchDocuments = useCallback(async () => {
    const { data } = await safeQuery(() =>
      supabase.from('concept_documents')
        .select('id, concept_id, type, title, created_at, updated_at, created_by')
        .eq('concept_id', conceptId)
        .order('updated_at', { ascending: false })
    );
    if (data) setDocuments(data);
  }, [safeQuery, conceptId]);

  useEffect(() => { fetchDocuments(); }, [fetchDocuments]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchDocuments();
    setRefreshing(false);
  }, [fetchDocuments]);

  async function handleCreate() {
    if (!title.trim() || creating) return;
    setCreating(true);
    const { data, error } = await safeQuery(() =>
      supabase.from('concept_documents').insert({
        concept_id: conceptId,
        type: docType,
        title: title.trim(),
        content: getDefaultContent(docType),
        created_by: profile.id,
      }).select().single()
    );
    if (error) {
      Alert.alert('Error', 'Failed to create document');
    } else {
      setTitle('');
      setShowForm(false);
      await fetchDocuments();
      if (data) {
        navigation.navigate('DocumentEditor', {
          documentId: data.id,
          title: data.title,
          type: data.type,
        });
      }
    }
    setCreating(false);
  }

  function renderDocument({ item }) {
    const typeInfo = DOC_TYPES.find(t => t.key === item.type) || DOC_TYPES[0];
    return (
      <TouchableOpacity
        style={styles.docCard}
        onPress={() => navigation.navigate('DocumentEditor', {
          documentId: item.id,
          title: item.title,
          type: item.type,
        })}
      >
        <View style={[styles.typeBadge, { backgroundColor: typeInfo.color + '22' }]}>
          <Text style={[styles.typeBadgeText, { color: typeInfo.color }]}>{typeInfo.label}</Text>
        </View>
        <Text style={styles.docTitle}>{item.title}</Text>
        <Text style={styles.docMeta}>
          {item.updated_at ? `Updated ${formatDate(item.updated_at)}` : `Created ${formatDate(item.created_at)}`}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={styles.content}
        data={documents}
        keyExtractor={item => item.id}
        renderItem={renderDocument}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        ListHeaderComponent={
          <>
            {!showForm && (
              <TouchableOpacity style={styles.addBtn} onPress={() => setShowForm(true)}>
                <Text style={styles.addBtnText}>+ New Document</Text>
              </TouchableOpacity>
            )}

            {showForm && (
              <View style={styles.formCard}>
                <TextInput
                  style={styles.input}
                  placeholder="Document title"
                  placeholderTextColor={colors.textTertiary}
                  value={title}
                  onChangeText={setTitle}
                />

                {/* Type picker */}
                <View style={styles.typeRow}>
                  {DOC_TYPES.map(t => (
                    <TouchableOpacity
                      key={t.key}
                      style={[styles.typeChip, docType === t.key && { backgroundColor: t.color + '22', borderColor: t.color }]}
                      onPress={() => setDocType(t.key)}
                    >
                      <Text style={[styles.typeChipText, docType === t.key && { color: t.color }]}>{t.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={styles.formActions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowForm(false)}>
                    <Text style={styles.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.createBtn, (!title.trim() || creating) && styles.disabledBtn]}
                    onPress={handleCreate}
                    disabled={!title.trim() || creating}
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
            <Text style={styles.emptyText}>No documents yet</Text>
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
  typeRow: { flexDirection: 'row', gap: spacing.sm },
  typeChip: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typeChipText: { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: '600' },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
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
  docCard: {
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  typeBadge: { alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm, marginBottom: spacing.xs },
  typeBadgeText: { fontSize: fontSize.xs, fontWeight: '600' },
  docTitle: { fontSize: fontSize.base, fontWeight: '600', color: colors.text },
  docMeta: { fontSize: fontSize.xs, color: colors.textTertiary, marginTop: spacing.xs },
  emptyCard: { padding: spacing.xxxl, alignItems: 'center' },
  emptyText: { fontSize: fontSize.md, color: colors.textTertiary },
});
