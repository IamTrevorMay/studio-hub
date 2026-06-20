// TEMPORARY hook for the front-end usage study (2026-06-20).
// Boots the clickstream tracker once and feeds it the current user/role.
// Teardown: delete this file + src/lib/usageTracker.js, remove the call in App.js.

import { useEffect } from 'react';
import { initUsageTracker, setUsageUser } from '../lib/usageTracker';

export function useUsageTracking(user, profile) {
  useEffect(() => {
    initUsageTracker();
  }, []);

  useEffect(() => {
    setUsageUser(user?.id || null, profile?.role || null);
  }, [user?.id, profile?.role]);
}
