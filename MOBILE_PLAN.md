# Mobile Optimization Plan

Living plan for the responsive-mobile pass on Mayday Studio. Owner: Trevor.

## Foundation

| Decision | Choice |
|---|---|
| Approach | Responsive web (same React app, same Vercel deploy). No native, no PWA. |
| Detection | `useIsMobile()` hook reading `window.innerWidth <= 640`. |
| Code structure | Separate `*Mobile.js` components per page, co-located. Each page file picks one based on the hook. |
| Bundle | `React.lazy()` chooses desktop vs. mobile **layout chunk** once at app boot based on width. Cross-breakpoint resize requires a reload. |
| Breakpoint | 640px (phones only — tablets stay on desktop UI) |
| Tap target | 44×44pt minimum |
| Base font | 16px (prevents iOS input auto-zoom) |
| Shell | Top bar (hamburger + title + bell) + slide-in drawer with full sidebar. No bottom tab bar. |
| Modals | Bottom sheets for short content (confirms, quick edits). Full-screen sheets for long content (detail views, multi-field forms). |
| Read-only behavior | Add/edit/delete controls simply not rendered on mobile. No banner. |
| Excluded pages | Hidden from sidebar on mobile. Direct URL hits show "Best viewed on desktop" screen with back button. |

## Per-page treatment

### Full mobile redesign (10)
- AuthPage — single-column form, large taps, keyboard-friendly
- Dashboard — stacked widgets in priority order, collapsible sections
- MyBoard — single-column tasks, swipe-to-complete, sticky add-task
- Production (Beat Sheet) — vertical beat list, swipe to reorder, tap to edit
- Ideation — quick-capture sticky input, idea list, swipe actions
- Calendar — default to **agenda view**, toggle to compact month grid
- Research — thumb-scroll article list, swipe read/save, trends section on top
- Messages — thread list → conversation, sticky composer
- AdminPanel — stacked sections, mobile forms
- FreelancerDashboard — stacked widgets

### Mobile-only condensed view (3)
- Projects — active-only by default, status filter chips, full-screen detail sheets
- Channels — top KPIs only; deep charts/tables hidden
- Analytics — headline KPIs + a couple of key charts; deep tables hidden

### Read-only on mobile (4)
- Goals
- BusinessDev (all 4 tabs viewable; no add/edit)
- Resources
- Invoicing

### Do not include on mobile (16) — show "Best viewed on desktop" screen
- Reviews, Assets, Write, Tools, Screenwriter
- Freelancers, FreelancerHours, FreelancerNotifications, FreelancerProfile
- DocEditor, Whiteboard, Storyboard, StickyBoard
- PostShow, Teleprompter, Telestration, Organize

## Implementation phases

### Phase 1 — Foundation (no page redesigns yet)
1. `useIsMobile()` hook
2. Mobile design tokens (`src/utils/mobileTokens.js`)
3. Per-page mobile support config (`src/config/mobileNavConfig.js`)
4. Mobile primitives:
   - `MobileTopBar`
   - `MobileDrawer` (full sidebar in a slide-in)
   - `BottomSheet`
   - `FullScreenSheet`
   - `DesktopOnlyScreen`
5. `useReadOnlyOnMobile()` helper (returns boolean for hiding action controls)
6. `AppLayoutMobile` shell — top bar + drawer + page routing, falls back to desktop page components for now
7. Lazy-load wiring in `App.js` — pick AppLayout vs AppLayoutMobile at boot

### Phase 2 — Daily drivers (full redesigns, in order)
1. Dashboard
2. MyBoard
3. Messages
4. Calendar (agenda view)
5. Projects (condensed)
6. AuthPage
7. Notifications bottom sheet

### Phase 3 — The rest
- Full redesigns: Production, Ideation, Research, AdminPanel, FreelancerDashboard
- Condensed views: Channels, Analytics
- Read-only treatments: Goals, BusinessDev, Resources, Invoicing (using the read-only hook)
- Excluded routes wired to `DesktopOnlyScreen`
