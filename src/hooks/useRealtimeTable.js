import { useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';

const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30000;

/**
 * Subscribe to Supabase Realtime postgres_changes for a single table.
 *
 * @param {string} channelName  Unique channel name
 * @param {object} opts
 * @param {string}   opts.table     Table to watch
 * @param {string}  [opts.filter]   e.g. 'assignee_id=eq.abc'
 * @param {string}  [opts.event]    '*' | 'INSERT' | 'UPDATE' | 'DELETE'
 * @param {function}[opts.onInsert] Called with new row payload
 * @param {function}[opts.onUpdate] Called with updated row payload
 * @param {function}[opts.onDelete] Called with old row payload
 * @param {function}[opts.onAny]    Called on any change (convenience refetch)
 * @param {boolean} [opts.enabled]  Skip subscription when false (default true)
 */
export default function useRealtimeTable(channelName, opts = {}) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const { table, filter, event = '*', enabled = true } = optsRef.current;
    if (!enabled || !table) return;

    let retryCount = 0;
    let retryTimer = null;
    let removed = false;
    let channel = null;

    function subscribe() {
      if (removed) return;

      const changeOpts = { event, schema: 'public', table };
      if (filter) changeOpts.filter = filter;

      channel = supabase
        .channel(channelName)
        .on('postgres_changes', changeOpts, (payload) => {
          const o = optsRef.current;
          if (o.onAny) o.onAny(payload);
          if (payload.eventType === 'INSERT' && o.onInsert) o.onInsert(payload.new);
          if (payload.eventType === 'UPDATE' && o.onUpdate) o.onUpdate(payload.new);
          if (payload.eventType === 'DELETE' && o.onDelete) o.onDelete(payload.old);
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            retryCount = 0;
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            const delay = Math.min(RETRY_BASE_MS * Math.pow(2, retryCount), RETRY_MAX_MS);
            retryCount++;
            supabase.removeChannel(channel);
            retryTimer = setTimeout(subscribe, delay);
          }
        });
    }

    subscribe();

    return () => {
      removed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (channel) supabase.removeChannel(channel);
    };
  }, [channelName, opts.table, opts.filter, opts.event, opts.enabled]);
}
