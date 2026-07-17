---
title: Page Catalog
last_updated: 2026-07-15
tags: [architecture, pages, map]
---

# Page Catalog (`src/pages/`)

> ⚠️ **These are enormous single-file components — 100–200KB each.** Do NOT read
> a whole page file. Grep for the symbol/section you need, or read a specific
> line range. The `styles` object is at the bottom; module-level color
> constants are at the top; the main component is in between. Most pages have a
> `Mobile` twin (`XMobile.js`) that must be edited alongside the desktop file.

Page **keys** (route + `activeTab`) often differ from their **display labels**
(nav aliases in `AppLayout.js:61-94`). Both are noted below. **Sizes below are
real on-disk bytes as of 2026-07-15** (from `ls -la src/pages`), rounded to KB.

## Core work pages

| Key | Component | Label | ~Size | Purpose |
|-----|-----------|-------|-------|---------|
| `dashboard` | `Dashboard.js` | Dashboard | 115KB | Home. Aggregates My Tasks, announcements, admin widgets ("Do this more" IG-story goal tracker), activity. Takes `onNavigate`. Uses `useSupabaseQuery` (rare). |
| `projects` | `Projects.js` | Projects | 74KB | Concept→published pipeline; project board/list. Subcomponent `projects/UnifiedBoard.js` (74KB, fully tokenized). Takes `onNavigate`. Uses `useSupabaseQuery`. |
| `production` | `Production.js` | **Beat Sheet** | 132KB | Beat-sheet authoring for videos; version tree, `@hello-pangea/dnd` beat reorder, `FindAssetsModal`. Feeds Timeline/AAF export. `initialSheetId`/`onSheetOpened` deep-link. **List is grouped by `beat_sheets.type` (fixed taxonomy: mayday / tm_baseball / podcast / short_form / ad_read; NULL = "Unassigned" section) with a collapsed Archive section — the old dynamic `beat_sheet_folders` grouping + drag-drop was removed 2026-07-17 (table kept, unused). Row right-click `ctxMenu` (change type / duplicate / edit title / archive / delete), editor Type `<select>`. `folder` column kept for safety but no longer read. Note: the Google-Drive folder browser in the editor (push target) is a SEPARATE thing and stays.** |
| `deliverables` | `Deliverables.js` | Deliverables | **167KB** | Sponsor deliverables / ad reads / "Brands" (UI alias for campaign — verified `brand`-named state throughout). Review-status pipeline, ad-copy, briefs (link/file/text), `AgencyThread` comment target. **Largest page in repo.** ⚠️ **Prop-name bug:** `AppLayout.js:860` passes `initialCampaignId`/`onCampaignOpened`, but the component destructures `initialBrandId`/`onBrandOpened` (`Deliverables.js:37`, used `:168-172`) — the deep-link auto-expand currently never fires. |
| `calendar` | `Calendar.js` | Calendar | 130KB | Content + event calendar, Google Calendar sync, read slots/beat sheets. `STATUS_COLORS`/`NETWORK_COLORS`/`EVENT_TYPE_COLORS` module consts (`:10,18,34`). Takes `onNavigate`. |
| `channels` | `Channels.js` | Channels | 92KB | Team chat channels (Slack-like), mentions, pins. `initialChannelName` deep-link. Heaviest realtime page (15 `useEffect`). |
| `messages` | `Messages.js` | Messages | 54KB | 1:1 / group direct messages. `onNavigate`. |
| `mytasks` | `MyTasks.js` | (in Dashboard) | 58KB | Personal task list + workflow-step tasks (`getStepAction`/`getWorkflowModal`). Clones beat-sheet templates like Production (`cloneBeatsFresh`). |
| `ideas` | `Ideas.js` | Ideas | 37KB | Idea capture in 4 fixed category columns (`write_ideas` table), drag-reorder across columns, potential-titles + 1-5 ratings (admins/directors only, `idea_ratings`). The canonical small-page reference. |
| `ideation` | `Ideation.js` | (concept dev) | 46KB | Concept development — concepts hold docs of type whiteboard/stickyboard/document/storyboard/screenwriter (mounts the editors). `initialConceptId`/`onConceptOpened` deep-link. |
| `reviews` | `Reviews.js` | Reviews | 58KB | Content review with YouTube-timestamped comments; ingests `.docx` (mammoth) + markdown (marked+DOMPurify). |
| `research` | `Research.js` | **News** | 89KB | 6-section reader: inbox / briefs / cards / news / trends / daily (`usePersistedTab`). Briefs+cards read from **Triton** (`tritonClient`); news = RSS + Claude trends (`generate-trends`). |
| `research_docs` | `ResearchDocs.js` | **Research** | 32KB | Baseball-stats research docs via Triton MCP (`checkHealth`, preset stat queries → table results). |
| `resources` | `Resources.js` | Resources | 22KB | Google-Drive-backed resource library (`google-drive-resources` fn) + root-level `CanvasBoard` canvases. |
| `assets` | `Assets.js` | Assets Library | 22KB | NAS/cloud asset browser (`assets.maydaystudio.net` API); video/audio/images/projects datasets, live NAS status. |
| `screenwriter` | `Screenwriter.js` | Screenwriter | 15KB | Thin wrapper (with its own `ScreenplayErrorBoundary`) around `editors/screenplay-editor/.../ScriptEditor`. `initialScriptId`. |

## Admin-mode pages (`ADMIN_PAGE_KEYS`, gated `isAdmin`)

| Key | Component | Label | ~Size | Purpose |
|-----|-----------|-------|-------|---------|
| `analytics` | `analytics/Analytics.js` | Analytics | 51KB | Cross-platform analytics hub. **The only page split into a proper folder** — `analytics/{components/, viz/, constants.js, styles.js, utils.js}`. Imports `styles`/`L` from `./styles` (not a bottom-of-file `styles` const). Mounts `YouTubeStudioAdvanced` + `ContentHealthDashboard`. Ashley-in-Analytics read lives here. |
| `tracking` | `Tracking.js` | Tracking | 37KB | Admin per-month view of every published post, grouped by source (TikTok/More Mayday/TMB/IG/FB/Substack — account IDs hardcoded at `:14-21`). Hover popover of thumbnail+metrics. Embeds `YearlyGoalsSection` + `ProgressKanban`. |
| `accounting` | `Accounting.js` | Accounting | 54KB | Tiller-sync ledger (`revenue_transactions`) + app-side categorization. Tabbed (`Bank/Transactions/MonthlyReports` in `components/accounting/`). `useMemo`-heavy (31 memos). `initialTab` deep-link. |
| `invoicing` | `Invoicing.js` | Invoicing | 75KB | Inbound/outbound invoice generation + tracking; PDF export via `jsPDF`. |
| `payroll` | `Payroll.js` | Payroll | 39KB | Semi-monthly pay-period (1–14 / 15–end) + contractor payroll. PT-date-aware (`ptDateToUtcISO`). Keeps raw `full_name` (legal context). |
| `business_dev` | `BusinessDev.js` | **Roadmap** (`/roadmap`) | 153KB | Business Dev multi-phase program tracker (`bd_*` tables). Phases/Timeline/Calendar/My Stuff tabs. `useMemo`-heavy (10). Also visible to `partner`. |
| `freelancers` | `Freelancers.js` | **Contractors** | 96KB | Contractor management, invites (`invite-user`), assignments. `initialAssignmentId`. |
| `workflows` | `Workflows.js` | Workflows | 69KB | Workflows \| Automations tab switcher (`automations` table + `run-automations`). Subtree `workflows/` (`KanbanPanel.js`, `ShortcutsCanvas.js`, `modals/`). |
| `jobs` | `Jobs.js` | Jobs | 64KB | Job postings + applicant review; reuses `public/PublicCareers` structured-description components. Public `/careers` board feeds it. `initialApplicationId`. |
| `ops` | `Ops.js` | Ops | 16KB | Sync-health dashboard (`platform_accounts` status derived from `consecutive_failures`/`last_success_at`; relative+absolute time cells). |
| `admin` | `AdminPanel.js` | Admin Settings | 37KB | Nav config, integrations (Google), user/role admin, freelancer-title + event-type config. `usePersistedTab`. `initialTab`. |

## Locked portals

| Role | Component | ~Size | Purpose |
|------|-----------|-------|---------|
| `agency` | `AgencyPortal.js` | 32KB | Read-only deliverables portal for the ad-agency partner. Early-returned before the shell. |
| `freelancer` | `FreelancerDashboard.js` | 56KB | Contractor home: assignments, status, hours, blockers. **The only page using `useRealtimeTable`.** |
| — | `FreelancerHours.js` | 12KB | Bi-weekly hour tracking. |
| — | `FreelancerDocuments.js` | 11KB | Document signing + reference docs. |
| — | `FreelancerProfile.js` | 15KB | Payment method, contact, avatar, Morty toggle. |
| — | `FreelancerNotifications.js` | 7KB | Contractor alerts. |
| `partner` | (uses `BusinessDev.js`) | — | Two-item sidebar: Dashboard + Roadmap. |

## Editors (`src/pages/editors/`)

Rich creative surfaces, generally desktop-only (excluded on mobile).

- `doc-editor/` — Tiptap-based rich-text document editor (the **only** place
  Tailwind runs; see `craco.config.js`). Entry `DocEditor.js`.
- `screenplay-editor/` — screenplay/script editor (backs Screenwriter).
- `Whiteboard.js` (11KB), `CanvasBoard.js` (28KB), `StickyBoard.js` (14KB),
  `Storyboard.js` (52KB) + `storyboardAssets.js` — freeform visual boards
  (fabric.js / @xyflow).

## Tools (`src/pages/tools/`)

Focused single-purpose utilities, opened as full-screen pages with an
`onBack` prop. `_ToolScaffold.js` is the shared shell.

- `Teleprompter.js` — teleprompter.
- `PostShow.js` — **Clipping Tool** (clip published videos).
- `Telestration.js` — **Telestrator** (video annotation).
- `PitchVideos.js` — **Asset Search** (`pitch_videos` key).
- `Timeline.js` — beat sheet → AAF for Premiere (beta; admin/beta-owner).
- `Broadcast.js` — OBS/Stream Deck broadcast control (beta; `BROADCAST_TIER_ROLES`).
- `Mailer.js` — email campaign tool (beta; `mailer-*` edge functions).
- `Graphics.js` — daily graphics tool (beta).
- `Organize.js` — asset auto-tagging/organization.
- `ShadeAssets.js` — shade/asset search (`shade-search` fn).

## Analytics deep-dives (standalone components)

- `ContentHealthDashboard.js` (43KB) — Stability vs Growth scoring per YT video
  (0–100 indices vs trailing-20-video median; breakout gate). Reads `yt_video_daily`
  + `yt_video_dim_*`. Mounted inside Analytics.
- `YouTubeStudioAdvanced.js` (67KB) — a replica of YT Studio Advanced analytics,
  cross-channel aggregation over `yt_dim_*`/`yt_video_dim_*` (see `yt_studio_advanced`
  project memory). Mounted inside Analytics.

## Auth + public

- `AuthPage.js` / `AuthPageMobile.js` — login / setup / forgot / reset. Reads
  `invitations` for setup flow. Rendered by the auth gate in `App.js`.
- `public/PublicCareers.js` — public `/careers` board (no auth).
- `public/PublicBrief.js` — public `/brief/:slug` one-pager (no auth).

## Desktop ↔ Mobile twin pairing (complete, verified 2026-07-15)

There are **22 `*Mobile.js` files** (all top-level in `src/pages/`; none in subdirs).
Verified via `find src/pages -name '*Mobile.js'`. A UI change to a desktop page with a
twin **usually needs the same change to the twin.** The 22 pairs:

| Desktop | Mobile twin |
|---------|-------------|
| `AdminPanel.js` | `AdminPanelMobile.js` |
| `analytics/Analytics.js` | `AnalyticsMobile.js` ⚠️ *desktop lives in the `analytics/` subfolder; twin does not* |
| `AppLayout.js` | `AppLayoutMobile.js` (the shell, not a page) |
| `AuthPage.js` | `AuthPageMobile.js` |
| `BusinessDev.js` | `BusinessDevMobile.js` |
| `Calendar.js` | `CalendarMobile.js` |
| `Channels.js` | `ChannelsMobile.js` |
| `Dashboard.js` | `DashboardMobile.js` |
| `Deliverables.js` | `DeliverablesMobile.js` |
| `FreelancerDashboard.js` | `FreelancerDashboardMobile.js` |
| `Freelancers.js` | `FreelancersMobile.js` |
| `Ideas.js` | `IdeasMobile.js` |
| `Ideation.js` | `IdeationMobile.js` |
| `Invoicing.js` | `InvoicingMobile.js` |
| `Messages.js` | `MessagesMobile.js` |
| `Ops.js` | `OpsMobile.js` |
| `Production.js` | `ProductionMobile.js` |
| `Projects.js` | `ProjectsMobile.js` |
| `Research.js` | `ResearchMobile.js` |
| `Resources.js` | `ResourcesMobile.js` |
| `Tracking.js` | `TrackingMobile.js` |
| `Workflows.js` | `WorkflowsMobile.js` |

**Desktop pages with NO mobile twin.** The mobile `renderActiveTab` switch
(`AppLayoutMobile.js:382-444`) has no `case` for these — its `default` falls through to
`<Dashboard>`, so on a phone they're simply unreachable (not in mobile nav): `Accounting`,
`Assets`, `ContentHealthDashboard`, `Jobs`, `MyTasks`, `Payroll`, `ResearchDocs`, `Reviews`,
`Screenwriter`, `YouTubeStudioAdvanced`, `Tools`, every `Freelancer*` sub-page except the
dashboard (`FreelancerDocuments`, `FreelancerHours`, `FreelancerNotifications`,
`FreelancerProfile`), and all `editors/*` and `tools/*`. `AgencyPortal` is imported directly
(`AppLayoutMobile.js:38`) — same file both platforms, so no separate twin to sync. Before
"finishing" a change on any page **not** in this no-twin list, edit the twin.

**Deep-link props are NOT mirrored on mobile.** Desktop passes `initial*` deep-link props
(e.g. `Production initialSheetId`), and mobile mirrors *some* (`Production`, `Ideation`,
`Channels`) but **not** `Deliverables` — mobile renders `<Deliverables />` with no props
(`AppLayoutMobile.js:~415`). (Desktop's `Deliverables` deep-link is itself broken; see the
Deliverables row above.)

**Mobile twins with NO exact desktop-name match:** `AnalyticsMobile.js` (desktop is
`analytics/Analytics.js`) — grep by feature name, not by path, when hunting the twin.

## Notes

- The desktop render wall is `AppLayout.js:~855-898`; the mobile one is
  `AppLayoutMobile.js` `renderActiveTab` (`:382`). A new page must be wired in
  **both**, plus added to `NAV_ITEMS` in both files.
- Analytics is the only page split into a proper folder
  (`analytics/{Analytics.js, components/, viz/, constants.js, styles.js,
  utils.js}`) — the model for the page-splitting audit (see `audit_phase6`
  project memory). Most other 100KB+ pages remain monolithic.
