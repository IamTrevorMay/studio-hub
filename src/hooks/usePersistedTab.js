import { useState, useEffect } from 'react';

// Page-level sub-view state that survives a refresh. Drop-in for useState:
//   const [tab, setTab] = usePersistedTab('accounting-tab', 'overview', ['overview', 'transactions']);
// `validValues` (optional array) guards against stale stored values after a
// tab is renamed/removed — anything not in the list falls back to the default.
// A null/undefined value clears the stored entry (for "no tool open" states).
export default function usePersistedTab(storageKey, defaultValue, validValues) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(`tab:${storageKey}`);
      if (stored !== null && (!validValues || validValues.includes(stored))) return stored;
    } catch { /* storage unavailable (private mode) — fall through */ }
    return defaultValue;
  });

  useEffect(() => {
    try {
      if (value === null || value === undefined) localStorage.removeItem(`tab:${storageKey}`);
      else localStorage.setItem(`tab:${storageKey}`, value);
    } catch { /* ignore */ }
  }, [storageKey, value]);

  return [value, setValue];
}
