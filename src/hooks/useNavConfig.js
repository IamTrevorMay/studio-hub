import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';

/**
 * Hook to fetch, save, and subscribe to sidebar nav config from Supabase.
 * Merges DB config with hardcoded NAV_ITEMS so new code items appear automatically.
 */
export default function useNavConfig() {
  const [config, setConfig] = useState(null); // null = loading, {} = default
  const [rowId, setRowId] = useState(null);
  const [saving, setSaving] = useState(false);
  const channelRef = useRef(null);

  // Track tab-restored events to force subscription rebuild
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    const handler = () => setRefreshKey(k => k + 1);
    window.addEventListener('app-tab-restored', handler);
    return () => window.removeEventListener('app-tab-restored', handler);
  }, []);

  // Fetch on mount + rebuild subscription on tab restore
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
  const getResolvedNav = useCallback((navItems, isAdmin, isPartner, isFreelancer, isMobile) => {
    // Freelancers get a locked sidebar
    if (isFreelancer) {
      const items = [
        { type: 'item', key: 'fl_dashboard', label: 'Dashboard' },
        { type: 'item', key: 'resources', label: 'Resources' },
        { type: 'item', key: 'assets', label: 'Upload/Download' },
        { type: 'item', key: 'fl_documents', label: 'Documents' },
        { type: 'item', key: 'channels', label: 'Channels' },
        { type: 'item', key: 'messages', label: 'Messages' },
        { type: 'item', key: 'fl_profile', label: 'Profile' },
        { type: 'item', key: 'fl_notifications', label: 'Notifications' },
      ];
      if (isMobile) items.push({ type: 'item', key: 'ideas', label: 'Ideas' });
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
      const items = navItems
        .filter(item => !item.adminOnly || isAdmin)
        .map(item => ({ type: 'item', key: item.key, label: item.label, adminOnly: item.adminOnly }));
      if (isMobile) items.push({ type: 'item', key: 'ideas', label: 'Ideas' });
      return items;
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
        if (codeItem.adminOnly && !isAdmin) continue;
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
        if (item.adminOnly && !isAdmin) continue;
        result.push({ type: 'item', key: item.key, label: item.label, folderId: null, adminOnly: item.adminOnly });
      }
    }

    if (isMobile) result.push({ type: 'item', key: 'ideas', label: 'Ideas' });
    return result;
  }, [config]);

  return { config, getResolvedNav, saveConfig, saving, loading: config === null };
}
