---
title: Realtime & Notifications
last_updated: 2026-07-15
tags: [architecture, realtime, notifications, presence, freshness]
---

# Realtime & Notifications

How live updates, the notification bell, presence, and tab-refresh freshness
work. ~27 files across `pages/`, `components/`, `contexts/`, `hooks/` open
Supabase Realtime channels.

## Supabase Realtime primitives

Three ways channels get opened:

1. **`useRealtimeTable(channelName, opts)`** (`src/hooks/useRealtimeTable.js`) —
   the reusable one. Subscribes to `postgres_changes` for a single table with
   `onInsert/onUpdate/onDelete/onAny` callbacks, an optional `filter`
   (`'col=eq.val'`), and **exponential-backoff resubscribe** on `CHANNEL_ERROR`
   / `TIMED_OUT` (1s→30s cap, `:52-57`). Skips when `enabled:false`.
2. **Ad-hoc `supabase.channel('name').on('postgres_changes', ...).subscribe()`**
   — used directly inside pages that need multiple tables on one channel
   (e.g. Dashboard team-presence `Dashboard.js:529`, Deliverables
   `sponsors-changes`/`proposals-changes` `Deliverables.js:280,292`).
3. **Context-level channels** — one shared channel each in
   `NotificationContext` and `useNavConfig`.

Always `supabase.removeChannel(channel)` in the effect cleanup.

### The reconnect story (why channels don't go dead)

Browsers suspend WebSockets on backgrounded tabs; Supabase's heartbeat may not
recover fast enough, leaving subscriptions silently dead. Mitigation lives in
`AuthContext.js:388-442` + `supabaseClient.js:37-52`:

- On `visibilitychange` → visible after **>30s** away, `AuthContext` refreshes
  the token, calls `supabase.realtime.setAuth(token)`, then `reconnectRealtime()`
  (disconnect → backoff → connect a fresh socket).
- It then **bumps `refreshKey`** (from `useAuth()`). Any effect that opens a
  channel and lists `refreshKey` in its deps re-runs cleanup+setup, so channels
  re-subscribe on the live socket. `useNavConfig` and `NotificationContext` both
  depend on `refreshKey` for exactly this (`useNavConfig.js:66`,
  `NotificationContext.js:202`).

If you add a page-level channel that must survive long tab-aways, include
`refreshKey` in the effect deps.

## The notification system (`src/contexts/NotificationContext.js`)

One provider computes all badge counts and exposes them via `useNotifications()`.
Consumed heavily in `AppLayout.js:261`.

### Single-RPC badge summary

`refreshNotifications()` (`NotificationContext.js:26-50`) calls one RPC —
`get_notification_summary(p_user_id, p_role, p_dashboard_last_seen)` — returning
every count at once:
`unread_announcement_count`, `unread_notification_count`,
`pending_proposal_count`, `agency_unresolved_count`, `unsigned_doc_count`,
`stuck_comment_count`, `fl_comment_count`, `my_task_count`,
`new_assignment_count`. Definition is built up across migrations
(`20260618130000_notification_summary_add_fl_comment.sql`,
`20260709190000_agency_portal.sql`, and others — grep the migrations).

Two counts stay **client-side** because they depend on per-item localStorage
timestamps:
- **Channel mentions** (`fetchUnreadMentions`, `:53-76`): queries
  `channel_messages` where `mentions` contains the user id, compares each
  channel's latest mention to `localStorage['channel_seen_<id>']`.
- **Unread DMs** (`fetchUnreadDms`, `:79-90`): `get_unread_dm_count` RPC.

`markDashboardSeen` / `markChannelSeen` write the localStorage timestamps.

### Realtime + fallback poll (`NotificationContext.js:171-202`)

One channel `notification-changes` subscribes to INSERT/UPDATE/`*` on
`direct_messages`, `conversation_participants`, `announcements`,
`announcement_reads`, `channel_messages`, `notifications`, `ad_read_proposals`,
`agency_comments`, `freelancer_documents`, `freelancer_assignments`, `tasks` —
each mapped to the right refresh function. A **5-minute `setInterval`** fallback
poll re-runs all three refreshers in case the socket missed an event.

### Desktop + browser-tab notifications

- Browser tab title is prefixed with the combined unread count (DMs + mentions +
  bell) via a `document.title` effect (`:104-108`).
- Native OS notifications fire from realtime INSERTs when: user opted in
  (`profiles.desktop_notifications_enabled`), the row's category is enabled in
  `profiles.notification_prefs` (checked via `isTypeEnabled` in
  `src/lib/notificationPrefs.js`), browser permission is granted, and the tab is
  backgrounded (`fireDesktopNotification` `:116-131`, `fireDmDesktopNotification`
  `:137-168`). DMs don't create `notifications` rows (would flood the bell), so
  their desktop notification fires straight off the `direct_messages` stream;
  **mobile push** for DMs comes from a `forward_dm_to_push` DB trigger.

### The bell UI

`AppLayout.js` owns the panel: `fetchNotifications` reads the last 50
`notifications` rows for the user (`:451-468`), `markNotificationRead` /
`markAllNotificationsRead` flip `is_read` and call `refreshNotifications()`.
Clicking a notification with a `link_tab` calls `navigateTo(link_tab, link_target)`.

## Presence (`src/contexts/PresenceContext.js`)

Deliberately minimal — it only **writes** the current user's heartbeat:
- On mount + every **60s**, `UPDATE profiles SET status='active', last_seen_at=now()`.
- `beforeunload` → `status='offline'`.
- After a long tab-away, `AuthContext`'s reconnect handler re-pings `active`.

Consumers (e.g. Dashboard team roster, `Dashboard.js:529` `team-presence`
channel) subscribe to `profiles` UPDATEs to render everyone else's status. There
is no Supabase Presence-channel usage — presence is modeled as ordinary
`profiles` rows + `postgres_changes`.

## Freshness patterns (recap)

| Mechanism | Where | Trigger |
|-----------|-------|---------|
| `useVisibilityRefresh(onRefresh)` | per page (`src/hooks/useVisibilityRefresh.js`) | Once per blur→focus cycle; the standard "re-fetch on tab return". In-page clicks never fire it. |
| `refreshKey` bump | `AuthContext` → all `refreshKey`-dep effects | WebSocket reconnect after >30s away. |
| 5-min poll | `NotificationContext` | Fallback for missed realtime events. |
| Polling pages | e.g. `AgencyPortal.js:30` `POLL_MS=20000` | Portals whose rows sit outside the account's RLS read set can't get `postgres_changes`, so they poll every 20s (+ realtime on the tables they *can* read, like `agency_comments`). |
| 30s widget refresh | Dashboard "Do this more" | IG-story goal tracker. |

**Rule of thumb:** if the data is inside the user's RLS read set, prefer
`useRealtimeTable` + `useVisibilityRefresh`. If it's outside (agency/freelancer
portals reading trimmed views), fall back to short-interval polling.
