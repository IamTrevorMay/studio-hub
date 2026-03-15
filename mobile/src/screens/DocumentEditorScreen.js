import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { useSupabaseQuery } from '../hooks/useSupabaseQuery';
import { supabase } from '../services/supabase';
import { colors, spacing, radius, fontSize } from '../utils/theme';

const ELEMENT_TYPES = [
  { key: 'sceneHeading', label: 'Scene Heading', uppercase: true },
  { key: 'action', label: 'Action', uppercase: false },
  { key: 'character', label: 'Character', uppercase: true },
  { key: 'dialogue', label: 'Dialogue', uppercase: false },
  { key: 'parenthetical', label: 'Parenthetical', uppercase: false },
  { key: 'transition', label: 'Transition', uppercase: true },
];

export default function DocumentEditorScreen({ route, navigation }) {
  const { documentId, type } = route.params;
  const { safeQuery } = useSupabaseQuery();
  const [content, setContent] = useState(null);
  const [saveStatus, setSaveStatus] = useState('saved'); // saved | saving | error
  const [showTypePicker, setShowTypePicker] = useState(false);
  const saveTimer = useRef(null);
  const isScreenplay = type === 'screenplay';

  // Fetch document content
  useEffect(() => {
    (async () => {
      const { data } = await safeQuery(() =>
        supabase.from('concept_documents')
          .select('content')
          .eq('id', documentId)
          .single()
      );
      if (data) setContent(data.content);
    })();
  }, [documentId, safeQuery]);

  // Update header with save status
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Text style={[headerStyles.status, saveStatus === 'saving' && headerStyles.saving]}>
          {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'error' ? 'Error' : 'Saved'}
        </Text>
      ),
    });
  }, [navigation, saveStatus]);

  // Auto-save with debounce
  const scheduleSave = useCallback((newContent) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveStatus('saving');
    saveTimer.current = setTimeout(async () => {
      const { error } = await safeQuery(() =>
        supabase.from('concept_documents')
          .update({ content: newContent, updated_at: new Date().toISOString() })
          .eq('id', documentId)
      );
      setSaveStatus(error ? 'error' : 'saved');
    }, 2000);
  }, [documentId, safeQuery]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  if (content === null) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  // ── Document mode ──
  if (!isScreenplay) {
    const text = content?.html || '';
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={100}
      >
        <TextInput
          style={styles.documentInput}
          value={text}
          onChangeText={(val) => {
            const newContent = { html: val };
            setContent(newContent);
            scheduleSave(newContent);
          }}
          multiline
          placeholder="Start writing..."
          placeholderTextColor={colors.textTertiary}
          textAlignVertical="top"
        />
      </KeyboardAvoidingView>
    );
  }

  // ── Screenplay mode ──
  const elements = content?.elements || [];

  function updateElement(index, field, value) {
    const updated = [...elements];
    updated[index] = { ...updated[index], [field]: value };
    const newContent = { ...content, elements: updated };
    setContent(newContent);
    scheduleSave(newContent);
  }

  function removeElement(index) {
    const updated = elements.filter((_, i) => i !== index);
    const newContent = { ...content, elements: updated };
    setContent(newContent);
    scheduleSave(newContent);
  }

  function addElement(typeKey) {
    const updated = [...elements, { type: typeKey, text: '' }];
    const newContent = { ...content, elements: updated };
    setContent(newContent);
    scheduleSave(newContent);
    setShowTypePicker(false);
  }

  function renderElement({ item, index }) {
    const typeInfo = ELEMENT_TYPES.find(t => t.key === item.type) || ELEMENT_TYPES[1];
    return (
      <View style={styles.elementRow}>
        <View style={styles.elementHeader}>
          <View style={styles.typeChip}>
            <Text style={styles.typeChipLabel}>{typeInfo.label}</Text>
          </View>
          <TouchableOpacity onPress={() => removeElement(index)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.removeBtn}>x</Text>
          </TouchableOpacity>
        </View>
        <TextInput
          style={[
            styles.elementInput,
            typeInfo.uppercase && styles.uppercaseInput,
            item.type === 'dialogue' && styles.dialogueInput,
            item.type === 'parenthetical' && styles.parentheticalInput,
          ]}
          value={item.text || ''}
          onChangeText={(val) => updateElement(index, 'text', val)}
          multiline
          placeholder={`${typeInfo.label}...`}
          placeholderTextColor={colors.textTertiary}
          autoCapitalize={typeInfo.uppercase ? 'characters' : 'sentences'}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={100}
    >
      <FlatList
        contentContainerStyle={styles.content}
        data={elements}
        keyExtractor={(_, i) => String(i)}
        renderItem={renderElement}
        ListFooterComponent={
          <View style={styles.addSection}>
            {showTypePicker ? (
              <View style={styles.pickerCard}>
                {ELEMENT_TYPES.map(t => (
                  <TouchableOpacity
                    key={t.key}
                    style={styles.pickerOption}
                    onPress={() => addElement(t.key)}
                  >
                    <Text style={styles.pickerOptionText}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={styles.pickerCancel} onPress={() => setShowTypePicker(false)}>
                  <Text style={styles.pickerCancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.addElementBtn} onPress={() => setShowTypePicker(true)}>
                <Text style={styles.addElementText}>+ Add Element</Text>
              </TouchableOpacity>
            )}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No elements yet. Add your first scene element below.</Text>
          </View>
        }
      />
    </KeyboardAvoidingView>
  );
}

const headerStyles = StyleSheet.create({
  status: { fontSize: fontSize.sm, color: colors.green, marginRight: spacing.lg },
  saving: { color: colors.amber },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, paddingBottom: 100 },
  loadingText: { fontSize: fontSize.base, color: colors.textTertiary, textAlign: 'center', marginTop: spacing.xxxl },
  documentInput: {
    flex: 1,
    padding: spacing.xl,
    color: colors.text,
    fontSize: fontSize.base,
    lineHeight: 22,
  },
  // Screenplay elements
  elementRow: {
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  elementHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surfaceHover,
  },
  typeChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.sm,
  },
  typeChipLabel: { fontSize: fontSize.xs, fontWeight: '600', color: colors.primary },
  removeBtn: { fontSize: fontSize.base, color: colors.red, fontWeight: '700', paddingHorizontal: spacing.sm },
  elementInput: {
    padding: spacing.md,
    color: colors.text,
    fontSize: fontSize.base,
    minHeight: 40,
  },
  uppercaseInput: { textTransform: 'uppercase' },
  dialogueInput: { paddingHorizontal: spacing.xxxl },
  parentheticalInput: { paddingHorizontal: spacing.xxl, fontStyle: 'italic' },
  // Add element
  addSection: { marginTop: spacing.md },
  addElementBtn: {
    padding: spacing.lg,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primary,
    borderStyle: 'dashed',
  },
  addElementText: { fontSize: fontSize.base, fontWeight: '600', color: colors.primary },
  pickerCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  pickerOption: {
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pickerOptionText: { fontSize: fontSize.base, color: colors.text },
  pickerCancel: { padding: spacing.lg, alignItems: 'center' },
  pickerCancelText: { fontSize: fontSize.sm, color: colors.textSecondary },
  emptyCard: { padding: spacing.xxxl, alignItems: 'center' },
  emptyText: { fontSize: fontSize.md, color: colors.textTertiary, textAlign: 'center' },
});
