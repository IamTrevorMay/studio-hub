// React hook that subscribes a producer console to the live state of a
// session. Returns:
//   session  — latest broadcast_sessions row (auto-updates via Realtime)
//   assets   — broadcast_assets rows for the project
//   scenes   — broadcast_scenes rows
//   sceneAssets — broadcast_scene_assets join rows
//   refresh  — force a manual reload
//   visibleAssetIds — Set derived from session.active_state.visibleAssets
//   slideshowIndexes — record derived from session.active_state.slideshowIndexes

import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '../../../supabaseClient';
import { listAssets, listScenes, listSceneAssets, getSession } from './api';

export function useBroadcastState({ project, session }) {
  const [latestSession, setLatestSession] = useState(session);
  const [assets, setAssets] = useState([]);
  const [scenes, setScenes] = useState([]);
  const [sceneAssets, setSceneAssets] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [a, s, sa] = await Promise.all([
        listAssets(project.id),
        listScenes(project.id),
        listSceneAssets({ project_id: project.id }),
      ]);
      setAssets(a.assets || []);
      setScenes(s.scenes || []);
      setSceneAssets(sa.sceneAssets || []);
      setError(null);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, [project.id]);

  useEffect(() => { refresh(); }, [refresh]);

  // Subscribe to session row updates via Supabase Realtime
  useEffect(() => {
    const channel = supabase
      .channel(`broadcast-session-${session.id}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public',
        table: 'broadcast_sessions', filter: `id=eq.${session.id}`,
      }, (payload) => {
        if (payload && payload.new) setLatestSession(payload.new);
      })
      .subscribe();
    return () => {
      channel.unsubscribe().catch(() => null);
      supabase.removeChannel(channel);
    };
  }, [session.id]);

  // Initial fetch of session (in case it was stale)
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { session: fresh } = await getSession(session.id);
        if (active && fresh) setLatestSession(fresh);
      } catch { /* ignore */ }
    })();
    return () => { active = false; };
  }, [session.id]);

  const visibleAssetIds = useMemo(() => {
    const v = (latestSession && latestSession.active_state && latestSession.active_state.visibleAssets) || [];
    return new Set(v);
  }, [latestSession]);

  const slideshowIndexes = useMemo(
    () => (latestSession && latestSession.active_state && latestSession.active_state.slideshowIndexes) || {},
    [latestSession]
  );

  return {
    session: latestSession,
    assets, scenes, sceneAssets,
    visibleAssetIds, slideshowIndexes,
    loading, error,
    refresh,
  };
}
