import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { colors, spacing, radius, fontSize } from '../utils/theme';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

const DATASETS = [
  { key: 'video', label: 'Video', color: colors.blue, path: '/video' },
  { key: 'audio', label: 'Audio', color: colors.purple, path: '/audio' },
  { key: 'images', label: 'Images', color: colors.green, path: '/images' },
  { key: 'projects', label: 'Projects', color: colors.amber, path: '/projects' },
];

function formatSize(bytes) {
  if (!bytes) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(dateStr) {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function AssetsScreen() {
  const [view, setView] = useState('datasets'); // datasets | directory | file
  const [nasOnline, setNasOnline] = useState(null);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [breadcrumbs, setBreadcrumbs] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/nas/health`);
      const data = await res.json();
      setNasOnline(!!data.connected);
    } catch {
      setNasOnline(false);
    }
  }, []);

  useEffect(() => { checkHealth(); }, [checkHealth]);

  const fetchDirectory = useCallback(async (path) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/nas/list?path=${encodeURIComponent(path)}&sort=name&order=asc`);
      const data = await res.json();
      setItems(data.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  function navigateToDataset(dataset) {
    setBreadcrumbs([{ label: dataset.label, path: dataset.path }]);
    setView('directory');
    fetchDirectory(dataset.path);
  }

  function navigateToDir(item) {
    const newCrumbs = [...breadcrumbs, { label: item.name, path: item.path }];
    setBreadcrumbs(newCrumbs);
    fetchDirectory(item.path);
  }

  function navigateToFile(item) {
    setSelectedFile(item);
    setView('file');
  }

  function navigateBack() {
    if (view === 'file') {
      setSelectedFile(null);
      setView('directory');
      return;
    }
    if (breadcrumbs.length <= 1) {
      setBreadcrumbs([]);
      setView('datasets');
      return;
    }
    const newCrumbs = breadcrumbs.slice(0, -1);
    setBreadcrumbs(newCrumbs);
    fetchDirectory(newCrumbs[newCrumbs.length - 1].path);
  }

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (view === 'datasets') {
      await checkHealth();
    } else if (view === 'directory' && breadcrumbs.length > 0) {
      await fetchDirectory(breadcrumbs[breadcrumbs.length - 1].path);
    }
    setRefreshing(false);
  }, [view, breadcrumbs, checkHealth, fetchDirectory]);

  // ── Dataset picker ──
  if (view === 'datasets') {
    return (
      <FlatList
        style={styles.container}
        contentContainerStyle={styles.content}
        data={DATASETS}
        keyExtractor={d => d.key}
        numColumns={2}
        columnWrapperStyle={styles.datasetRow}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        ListHeaderComponent={
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: nasOnline ? colors.green : nasOnline === false ? colors.red : colors.textTertiary }]} />
            <Text style={styles.statusText}>
              {nasOnline === null ? 'Checking NAS...' : nasOnline ? 'NAS Online' : 'NAS Offline'}
            </Text>
            {nasOnline === false && (
              <TouchableOpacity onPress={checkHealth} style={styles.retryBtn}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            )}
          </View>
        }
        renderItem={({ item: ds }) => (
          <TouchableOpacity
            style={[styles.datasetCard, { borderColor: ds.color }, !nasOnline && styles.disabledCard]}
            onPress={() => nasOnline && navigateToDataset(ds)}
            disabled={!nasOnline}
          >
            <View style={[styles.datasetIcon, { backgroundColor: ds.color + '22' }]}>
              <Text style={[styles.datasetIconText, { color: ds.color }]}>
                {ds.label[0]}
              </Text>
            </View>
            <Text style={styles.datasetLabel}>{ds.label}</Text>
          </TouchableOpacity>
        )}
      />
    );
  }

  // ── File detail ──
  if (view === 'file' && selectedFile) {
    return (
      <View style={styles.container}>
        <TouchableOpacity style={styles.backBtn} onPress={navigateBack}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <View style={styles.fileDetailCard}>
          <Text style={styles.fileDetailName}>{selectedFile.name}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Type</Text>
            <Text style={styles.metaValue}>{selectedFile.extension || 'Unknown'}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Size</Text>
            <Text style={styles.metaValue}>{formatSize(selectedFile.size)}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Modified</Text>
            <Text style={styles.metaValue}>{formatDate(selectedFile.modified)}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Path</Text>
            <Text style={[styles.metaValue, { fontSize: fontSize.xs }]}>{selectedFile.path}</Text>
          </View>
          <View style={styles.viewOnlyBanner}>
            <Text style={styles.viewOnlyText}>View only on mobile</Text>
          </View>
        </View>
      </View>
    );
  }

  // ── Directory listing ──
  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backBtn} onPress={navigateBack}>
        <Text style={styles.backText}>Back</Text>
      </TouchableOpacity>

      {/* Breadcrumbs */}
      <View style={styles.breadcrumbs}>
        {breadcrumbs.map((bc, i) => (
          <React.Fragment key={bc.path}>
            {i > 0 && <Text style={styles.breadSep}>/</Text>}
            <TouchableOpacity
              onPress={() => {
                const newCrumbs = breadcrumbs.slice(0, i + 1);
                setBreadcrumbs(newCrumbs);
                fetchDirectory(bc.path);
              }}
            >
              <Text style={[styles.breadLabel, i === breadcrumbs.length - 1 && styles.breadActive]}>{bc.label}</Text>
            </TouchableOpacity>
          </React.Fragment>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxxl }} />
      ) : (
        <FlatList
          contentContainerStyle={styles.content}
          data={items}
          keyExtractor={item => item.path}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.fileRow}
              onPress={() => item.type === 'directory' ? navigateToDir(item) : navigateToFile(item)}
            >
              <Text style={styles.fileIcon}>{item.type === 'directory' ? '/' : ''}</Text>
              <View style={styles.fileInfo}>
                <Text style={styles.fileName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.fileMeta}>
                  {item.type === 'directory' ? 'Folder' : formatSize(item.size)}
                  {item.modified ? `  ·  ${formatDate(item.modified)}` : ''}
                </Text>
              </View>
              <Text style={styles.menuArrow}>&rsaquo;</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No files found</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg, gap: spacing.sm },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: fontSize.sm, color: colors.textSecondary },
  retryBtn: { marginLeft: 'auto', paddingHorizontal: spacing.md, paddingVertical: spacing.xs, backgroundColor: colors.primaryLight, borderRadius: radius.sm },
  retryText: { fontSize: fontSize.sm, color: colors.primary, fontWeight: '600' },
  datasetRow: { gap: spacing.md, marginBottom: spacing.md },
  datasetCard: {
    flex: 1,
    padding: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    alignItems: 'center',
    gap: spacing.md,
  },
  disabledCard: { opacity: 0.4 },
  datasetIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  datasetIconText: { fontSize: fontSize.xl, fontWeight: '700' },
  datasetLabel: { fontSize: fontSize.base, fontWeight: '600', color: colors.text },
  backBtn: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  backText: { fontSize: fontSize.base, color: colors.primary, fontWeight: '600' },
  breadcrumbs: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xl, paddingBottom: spacing.sm, flexWrap: 'wrap', gap: spacing.xs },
  breadSep: { color: colors.textTertiary, fontSize: fontSize.sm },
  breadLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  breadActive: { color: colors.text, fontWeight: '600' },
  fileRow: {
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
  fileIcon: { fontSize: fontSize.base, color: colors.textTertiary, width: 16 },
  fileInfo: { flex: 1, marginLeft: spacing.sm },
  fileName: { fontSize: fontSize.base, color: colors.text },
  fileMeta: { fontSize: fontSize.xs, color: colors.textTertiary, marginTop: 2 },
  menuArrow: { fontSize: fontSize.xl, color: colors.textTertiary },
  fileDetailCard: {
    margin: spacing.xl,
    padding: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  fileDetailName: { fontSize: fontSize.lg, fontWeight: '700', color: colors.text },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  metaLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  metaValue: { fontSize: fontSize.sm, color: colors.text, flex: 1, textAlign: 'right' },
  viewOnlyBanner: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.amberLight,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  viewOnlyText: { fontSize: fontSize.sm, color: colors.amber, fontWeight: '600' },
  emptyCard: { padding: spacing.xxxl, alignItems: 'center' },
  emptyText: { fontSize: fontSize.md, color: colors.textTertiary },
});
