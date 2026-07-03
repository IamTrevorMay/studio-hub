import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { canAccessBroadcast } from '../lib/rolePermissions';
import { useAuth } from '../contexts/AuthContext';

// Some pages are admin-only by default but should also be visible to a
// specific non-admin role. Add overrides here as more producer-tier
// pages land.
function itemAllowedForUser(item, isAdmin, profile) {
  if (!item.adminOnly) return true;
  if (isAdmin) return true;
  if (item.key === 'broadcast' && canAccessBroadcast(profile?.role)) return true;
  return false;
}

/**
 * Hook to fetch, save, and subscribe to sidebar nav config from Supabase.
 * Merges DB config with hardcoded NAV_ITEMS so new code items appear automatically.
 */
export default function useNavConfig() {
  const [config, setConfig] = useState(null); // null = loading, {} = default
  const [rowId, setRowId] = useState(null);
  const [saving, setSaving] = useState(false);
  const channelRef = useRef(null);

  // Rebuild the realtime subscription whenever the app-wide refreshKey bumps
  // (AuthContext bumps it after the WebSocket reconnects on tab-refocus). The
  // previous code listened for an `app-tab-restored` event that was never
  // dispatched anywhere, so the nav_config channel went stale after tab-away.
  const { refreshKey } = useAuth();

  // Fetch on mount + rebuild subscription on refreshKey change
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data, error } = await supabase
        .from('nav_config')
        .select('*')
        .limit(1)
        .single();
      if (!cancelled && !error && data) {
        setConfig(data.config || {});
        setRowId(data.id);
      } else if (!cancelled) {
        setConfig({});
      }
    }
    load();

    // Realtime subscription
    const channel = supabase
      .channel('nav_config_changes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'nav_config' }, (payload) => {
        setConfig(payload.new.config || {});
        setRowId(payload.new.id);
      })
      .subscribe();
    channelRef.current = channel;

    return () => {
      cancelled = true;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [refreshKey]);

  // Save config to DB
  const saveConfig = useCallback(async (newConfig, profileId) => {
    if (!rowId) return;
    setSaving(true);
    try {
      await supabase
        .from('nav_config')
        .update({ config: newConfig, updated_by: profileId, updated_at: new Date().toISOString() })
        .eq('id', rowId);
    } finally {
      setSaving(false);
    }
  }, [rowId]);

  /**
   * Merges DB config with hardcoded NAV_ITEMS.
   * Returns an ordered array of { type, key, label, icon, folderId, id, collapsed, adminOnly, children }
   * - Folders get type: 'folder' with children array
   * - Items get type: 'item'
   * - Items in config but not in code are skipped
   * - Items in code but not in config are appended at the end
   */
  const getResolvedNav = useCallback((navItems, isAdmin, isPartner, isFreelancer, profile, restrictedNavKeys) => {
    const restricted = restrictedNavKeys instanceof Set ? restrictedNavKeys : new Set();
    const isRestricted = (key) => restricted.has(key);
    // Freelancers get a locked sidebar
    if (isFreelancer) {
      const items = [
        { type: 'item', key: 'fl_dashboard', label: 'Dashboard' },
      ];
      if (profile?.assigned_drive_folder_id) {
        items.push({ type: 'item', key: 'fl_assignments', label: 'Assignments' });
      }
      items.push(
        { type: 'item', key: 'fl_submit', label: 'Submit' },
        { type: 'item', key: 'resources', label: 'Resources' },
        { type: 'item', key: 'assets', label: 'Assets Library' },
        { type: 'item', key: 'fl_documents', label: 'Documents' },
        { type: 'item', key: 'channels', label: 'Channels' },
        { type: 'item', key: 'messages', label: 'Messages' },
        { type: 'item', key: 'fl_profile', label: 'Profile' },
        { type: 'item', key: 'fl_notifications', label: 'Notifications' },
      );
      return items;
    }

    // Partners get a locked two-item sidebar
    if (isPartner) {
      return [
        { type: 'item', key: 'dashboard', label: 'Dashboard' },
        { type: 'item', key: 'business_dev', label: 'Business Dev' },
      ];
    }

    // If no config or empty, return hardcoded items as-is
    if (!config || !config.items || config.items.length === 0) {
      return navItems
        .filter(item => itemAllowedForUser(item, isAdmin, profile))
        .filter(item => !isRestricted(item.key))
        .map(item => ({ type: 'item', key: item.key, label: item.label, adminOnly: item.adminOnly }));
    }

    const codeKeys = new Set(navItems.map(i => i.key));
    const codeMap = {};
    navItems.forEach(item => { codeMap[item.key] = item; });

    const usedKeys = new Set();
    const result = [];

    for (const entry of config.items) {
      if (entry.type === 'folder') {
        result.push({
          type: 'folder',
          id: entry.id,
          label: entry.label || 'Folder',
          collapsed: entry.collapsed ?? false,
        });
      } else if (entry.type === 'item') {
        const codeItem = codeMap[entry.key];
        if (!codeItem) continue; // item removed from code
        if (!itemAllowedForUser(codeItem, isAdmin, profile)) continue;
        if (isRestricted(entry.key)) continue;
        usedKeys.add(entry.key);
        result.push({
          type: 'item',
          key: entry.key,
          label: entry.label || codeItem.label,
          folderId: entry.folderId || null,
          adminOnly: codeItem.adminOnly,
        });
      }
    }

    // Append items from code that aren't in config
    for (const item of navItems) {
      if (!usedKeys.has(item.key)) {
        if (!itemAllowedForUser(item, isAdmin, profile)) continue;
        if (isRestricted(item.key)) continue;
        result.push({ type: 'item', key: item.key, label: item.label, folderId: null, adminOnly: item.adminOnly });
      }
    }

    return result;
  }, [config]);

  return { config, getResolvedNav, saveConfig, saving, loading: config === null };
}
