import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { colors, spacing, radius, fontSize } from '../utils/theme';

const MENU_ITEMS = [
  { key: 'resources', label: 'Resources', icon: 'folder' },
  { key: 'ideation', label: 'Create', icon: 'lightbulb' },
  { key: 'analytics', label: 'Analytics', icon: 'chart', adminOnly: true },
  { key: 'research', label: 'Research', icon: 'search' },
  { key: 'reviews', label: 'Reviews', icon: 'star' },
  { key: 'goals', label: 'Goals', icon: 'target' },
  { key: 'tools', label: 'Toolbox', icon: 'wrench' },
];

export default function MoreScreen({ navigation }) {
  const { profile, signOut, isAdmin } = useAuth();

  const visibleItems = MENU_ITEMS.filter(item => !item.adminOnly || isAdmin);

  function handleSignOut() {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Profile card */}
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(profile?.full_name || '?')[0].toUpperCase()}
          </Text>
        </View>
        <View style={styles.profileInfo}>
          <Text style={styles.profileName}>{profile?.full_name || 'User'}</Text>
          <Text style={styles.profileRole}>{profile?.role || 'Member'}</Text>
        </View>
      </View>

      {/* Menu items */}
      <View style={styles.menuSection}>
        {visibleItems.map(item => (
          <TouchableOpacity
            key={item.key}
            style={styles.menuRow}
            onPress={() => {
              // Navigate to dedicated screen when built, or show coming soon
              Alert.alert(item.label, 'This section is available on the web dashboard. Mobile version coming soon.');
            }}
          >
            <Text style={styles.menuLabel}>{item.label}</Text>
            <Text style={styles.menuArrow}>›</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Sign out */}
      <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>

      <Text style={styles.version}>Mayday Studio Mobile v1.0.0</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.xxl,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: fontSize.xl, fontWeight: '700', color: colors.primary },
  profileInfo: { flex: 1 },
  profileName: { fontSize: fontSize.lg, fontWeight: '700', color: colors.text },
  profileRole: { fontSize: fontSize.sm, color: colors.textSecondary, textTransform: 'capitalize', marginTop: 2 },
  menuSection: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: spacing.xxl,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  menuLabel: { fontSize: fontSize.base, color: colors.text },
  menuArrow: { fontSize: fontSize.xl, color: colors.textTertiary },
  signOutBtn: {
    padding: spacing.lg,
    backgroundColor: colors.redLight,
    borderRadius: radius.lg,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  signOutText: { fontSize: fontSize.base, fontWeight: '600', color: colors.red },
  version: { fontSize: fontSize.xs, color: colors.textTertiary, textAlign: 'center' },
});
