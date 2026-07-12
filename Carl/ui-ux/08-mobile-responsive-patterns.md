---
title: "Mobile & Responsive Patterns for Productivity Apps"
domain: ui-ux
tags: [mobile-ux, responsive-design, touch-targets, bottom-navigation, thumb-zone, data-tables, task-triage, companion-apps]
sources_reviewed: 12
last_updated: 2026-07-12
---

# Mobile & Responsive Patterns for Productivity Apps

## TL;DR

- **Mobile is a different job, not a smaller screen.** For ops/productivity tools, the winning mobile strategy is a *companion app* (Linear's model): triage, capture, approve, check status. Don't port the desktop; pick the 3-5 away-from-keyboard jobs and nail them.
- **Touch targets: 1cm × 1cm physical (≈44pt iOS / 48dp Android) minimum, ~8px gap between adjacent targets.** WCAG 2.2 AA's 24px is a legal floor, not a design target. Undersized targets have roughly 3x the error rate.
- **Design for one thumb.** ~49% of users operate one-handed, ~75% of all interactions are thumb-driven. Primary actions belong in the bottom third of the screen; destructive actions belong out of the natural thumb arc.
- **Bottom tab bar for 3-5 top destinations; never bury primary nav in a hamburger.** NN/g measured hidden nav: content discoverability drops >20%, mobile task time +15%, desktop +39%.
- **Data tables don't survive mobile intact.** Pick 2-3 identifying columns, convert rows to stacked cards or key-value lists, and push everything else behind a tap. Never solve it with horizontal scrolling or shrunken fonts.
- **Cut ruthlessly using the "one eyeball" test:** can a distracted user complete the core mobile task with one thumb in under 60 seconds? If a feature doesn't serve that, it stays desktop-only.
- **Breakpoints: 3 is usually enough** (~<768 phone, 768-1024 tablet, 1024+ desktop), mobile-first CSS, and use container queries (93%+ browser support) for components that live in both a sidebar and a main pane.
- **Swipe actions + snooze = mobile triage.** Swipe right = most common positive action (done/archive), swipe left = defer/snooze, long-press = more. Always provide a visible-button fallback for accessibility.

---

## 1. The core mental model: mobile is a different session type

The single most important decision for a productivity/ops tool is *what mobile is for*. Three viable postures:

| Posture | Description | When it's right |
|---|---|---|
| **Full parity** | Everything desktop does, reflowed | Almost never for data-dense ops tools; cost is enormous, result is usually a cramped mess |
| **Companion app** | Curated subset for away-from-keyboard jobs: notifications, triage, quick capture, approvals, status checks | The default answer for internal ops tools and B2B productivity apps |
| **Mobile-primary** | The phone IS the workstation | Field/frontline workers: coaches on a training floor, camera operators on a shoot, warehouse, delivery |

**Linear is the canonical companion-app case study.** Their mobile app is explicitly built around "away from keyboard" activities, native Swift/Kotlin, and four jobs: (1) Inbox triage — tap to act, swipe to delete, snooze for later; (2) quick capture — write issues/comments fast, screenshot-to-bug-report; (3) compact async reading of project updates and specs; (4) notification schedules the user controls. They deliberately *omit* complex desktop workflows and market the app as a "powerful sidekick," not a replacement. That framing — sidekick, not clone — is the pitch Carl should give any client agonizing over mobile scope.

**Session-length asymmetry.** Desktop sessions in an ops tool are long, seated, multi-window. Mobile sessions are 10-90 seconds, interrupted, one-handed, often while walking. Luke Wroblewski's formulation: the mobile user is **"one thumb, one eyeball"** — one hand on the device, partial attention. His concrete test (developed while building the Polar app): *can the user complete the core task with one thumb in under 60 seconds?* Every mobile screen in a productivity app should be auditioned against that test.

**Mobile-first as a focusing discipline (Wroblewski, *Mobile First*).** Even when the product is desktop-primary, designing the mobile layout first forces the 80/20 cut: mobile constraints "force you to focus and enable you to innovate." The features that survive the mobile cut are, almost by definition, the features that matter — which then tells you what deserves top billing on desktop too. Treat the constraint as a prioritization tool, not a limitation.

**Relevance note (small media co / training facility):** both archetypal users here are mobile-heavy — a creator checking sponsor deliverables between shoots, a coach on a facility floor logging an athlete session. The desktop app is for the producer/ops manager at a desk; the phone is for everyone in motion. Scope mobile to *their* jobs, not the admin's.

---

## 2. Ergonomics: grips, thumb zones, and where things go

### 2.1 How people actually hold phones (Hoober, 1,333 observations)

Steven Hoober's field study (public observation, 780 screen-interaction cases) remains the reference dataset:

- **One-handed: 49%** (of those, 67% right thumb, 33% left thumb)
- **Cradled (two hands hold, one touches): 36%** — of cradlers, 72% use the thumb, 28% a finger; 79% cradle in the left hand
- **Two-handed, both thumbs: 15%** (90% portrait, 10% landscape)
- Net: **thumbs drive ~75% of all interactions**
- Critical nuance Hoober himself stresses: **people switch grips constantly — sometimes every few seconds** — correlated with task switching. Don't design for one frozen grip; design so every grip works, and physically test in all three.

### 2.2 The Thumb Zone (Hoober; popularized by Josh Clark and Samantha Ingram)

Three regions on a phone held one-handed:

1. **Natural zone** — the arc at the bottom of the screen, biased toward the side opposite the thumb's hand. Effortless. Only about a third of the screen qualifies.
2. **Stretch zone** — middle of the screen and near edges; reachable with effort.
3. **Hard zone** — top corners (especially top-left for right-handed users). Requires re-gripping or a second hand.

**Placement rules that fall out of this:**

- Primary, frequent actions (create, complete, send, primary nav): **bottom third**. This is why bottom tab bars, FABs, and bottom sheets won.
- Destructive or irreversible actions (delete, sign out, discard): deliberately place in stretch/hard zones so they can't be fat-thumbed.
- Informational, read-only content: fine at the top — eyes go top-down even though thumbs go bottom-up.
- Modal close buttons in the top corner are an anti-pattern on mobile (Smashing cites Etsy as the counterexample); prefer bottom-anchored dismiss, swipe-down-to-dismiss, or full-width bottom buttons.
- Swipe gestures: users swipe from the edge toward the middle, diagonally downward; keep swipe-able rows at least ~45px tall and keep gesture start points inside the natural zone.
- As screens grew (6.1"+ standard now), the hard zone got *bigger*, not smaller — reachability matters more in 2026 than in 2013. OS-level crutches (iOS Reachability, Android one-handed mode) exist because apps keep failing at this.

### 2.3 Touch target sizes — the numbers table

Physical size is what matters (finger pads don't shrink with pixel density). Average fingertip width is 1.6-2cm; average thumb contact patch ~2.5cm.

| Standard | Minimum | Notes |
|---|---|---|
| **NN/g research recommendation** | **1cm × 1cm (0.4in)** physical | Based on Parhi/Karlson/Bederson research; explicitly a *minimum* |
| Apple HIG | 44 × 44 pt | ≈ the 1cm figure on typical iPhone densities |
| Material Design (Android) | 48 × 48 dp | Visual element can be smaller if the touch area is padded to 48 |
| Microsoft Fluent | 44 × 44 px | |
| WCAG 2.2 SC 2.5.8 (AA) | 24 × 24 CSS px | Compliance floor only — or equivalent spacing exemption |
| WCAG 2.5.5 (AAA) | 44 × 44 CSS px | The number to actually aim at on the web |

Supporting rules:

- **Spacing:** minimum ~2mm (≈8px) between adjacent targets. NN/g's phrasing: targets must *first* be big enough, *then* spaced well — spacing can't rescue an undersized target.
- **Error rates:** targets under ~44px show roughly **3x higher error rates** (University of Maryland touch research, 2023).
- **Go bigger when:** user is walking/moving, it's the primary CTA (Target's app uses 2cm × 2cm for scan/search), the audience skews older or gloved (relevant to a training facility — sweaty hands, athletes mid-workout), or the screen is large.
- **View-tap asymmetry (NN/g):** the classic desktop-port failure — text that's perfectly *readable* but whose links/controls are too small or dense to *tap*. Reading size and tapping size are different constraints; audit both.
- Practical CRA/React note: with inline styles, enforce a convention like `minHeight: 44, minWidth: 44` on every pressable, and pad hit areas beyond the visible glyph (icon 24px, tappable box 44-48px).

---

## 3. Mobile navigation for productivity apps

### 3.1 The decision tree

1. **3-5 top-level destinations → bottom tab bar.** Both Apple HIG and Material 3 converge here. Persistent, visible, thumb-reachable, teaches the app's structure for free.
2. **More than 5 → don't add a 6th tab.** Options in order of preference: (a) demote rarely-used sections into a "More"/profile tab; (b) restructure the IA — a productivity app with 8 equal top-level destinations has an IA problem, not a nav problem; (c) hamburger/drawer *only* for genuinely secondary areas.
3. **Tablet / medium widths (600-839dp) → navigation rail** on the leading edge (Material 3). **Large widths → rail or expanded drawer/sidebar.** The M3 adaptive pattern: bar on compact, rail on medium, drawer on expanded — same destinations, different chrome.
4. **Enterprise reality check:** hamburger menus persist in enterprise/PWA products with dozens of functional areas. Acceptable for the long tail; never for the daily-driver sections.

### 3.2 Why hidden navigation costs you (NN/g quantified it)

Study: 179 participants, 6 sites, phone + desktop, comparing hidden (hamburger), visible, and combo nav:

- Hidden nav **used** in only 57% of mobile cases vs 86% for combo; 27% vs ~50% on desktop.
- **Content discoverability dropped >20%** with hidden nav.
- **Task time: +15% on mobile, +39% on desktop** with hidden nav; users also rated tasks ~21% harder.
- NN/g's mobile recommendation: if you have ≤4 top-level links, show them; hide only beyond that.

Translation for Carl: every feature you bury behind a hamburger is a feature you've half-shipped. If adoption of a mobile feature is low, check where it lives in the nav before blaming the feature.

### 3.3 Bottom-bar craft details

- **Always label icons.** Icon-only bars test terribly except for universally understood glyphs (search, home). Material 3 and HIG both want labels.
- Badge counts on tabs are the cheapest triage signal you can ship (inbox count, overdue count).
- Reserve the center slot (or a docked FAB) for the app's #1 creation action — "new task," "log session," "capture."
- Don't hide the bar on scroll in a productivity app; predictability beats the extra 60px. (Hiding on scroll is a content/reading pattern, not a tool pattern.)
- Don't mix paradigms — tab bar *plus* hamburger *plus* top tabs on one screen reads as three competing apps. Mixed navigation is a documented usability failure mode.
- Respect OS gesture areas: keep interactive elements clear of the iOS home-indicator strip and Android gesture edges (safe-area insets); edge-swipe gestures in your app will collide with system back gestures.

---

## 4. Responsive strategy for data-dense desktop apps

### 4.1 Breakpoint doctrine (2025-26 consensus)

- **Mobile-first CSS:** base styles target the smallest screen; enhance upward with `min-width` queries. This is industry standard and produces the leanest mobile payloads.
- **3-5 breakpoints, content-driven:** start with ~320-767 (phone), 768-1023 (tablet), 1024+ (desktop); add more only where *your* layout actually breaks. Don't chase device models.
- **Fluid between breakpoints:** `clamp()`, `minmax()`, flex/grid, relative units. Breakpoints are for structural change; fluidity handles everything between.
- **Container queries are now default practice** (~94% browser support as of late 2025): a component responds to its *parent's* width, not the viewport. This is the killer tool for ops dashboards where the same widget appears in a wide main pane and a narrow side panel. Best-in-class dashboards use container queries to swap representations — a bar chart collapses into a big-number stat card at narrow widths; a table becomes a card stack.
- **The body must never scroll horizontally.** Any intrinsically wide element (table, Gantt, code) scrolls inside its own `overflow-x: auto` container.

### 4.2 Reflow, don't shrink: the pattern ladder for dense screens

When a desktop screen goes small, apply in order:

1. **Reprioritize** — decide the 1-2 things the mobile user actually came for on this screen (usually: status, and one action).
2. **Restack** — multi-column → single column, in priority order (not DOM order accidentally).
3. **Swap representations** — table → card list; Gantt → agenda list; multi-series chart → stat tiles + sparkline; kanban board → single-column with a lane switcher.
4. **Defer** — secondary data behind expanders, detail pages, bottom sheets ("progressive disclosure": accordions, tabs, drawers, modals for on-demand content).
5. **Relocate** — filters/bulk actions move from persistent toolbars into a bottom-sheet filter panel or an overflow menu.
6. **Remove** — some things genuinely don't belong on mobile (see §6).

### 4.3 Data tables on mobile — the pattern catalog

From UXmatters' dedicated treatment plus current practice:

**Avoid:**
- **Naked horizontal scroll** — dual-axis navigation confuses, and off-screen columns effectively don't exist.
- **Tiny-font "fit it all"** — creates the view-tap asymmetry problem and is unreadable in sunlight/motion.
- **Screenshot/image tables** — treats mobile users as second-class.
- **Blind "responsive table" transforms** that stack every cell — destroys column-scanning and makes batch operations meaningless. Reflowing without *prioritizing* is just a different mess.

**Use, by situation:**

| Pattern | Mechanics | Best for |
|---|---|---|
| **Card stack** | Each row → a card: title line, 2-3 key values, status chip, tap for detail | Task lists, deliverables, orders — anything where rows are "things" |
| **Key-value stacked list** | Row → label/value pairs, labels left-aligned, values consistent | Detail-heavy records viewed one at a time |
| **Column priority** | Keep 2-3 identifying + 1 status column; rest behind row expand/detail | When comparison across rows still matters |
| **Stacked/wrapped columns** | Multiple "virtual rows" inside one row with consistent alignment so each virtual column scans vertically | Medium density, no room for real columns |
| **Fixed first column + scroll region** | Identity column pinned, metrics scroll | Analytics tables where comparing metrics matters (last resort; signal the scroll with a fade/affordance) |

**Data-reduction moves:** abbreviate aggressively (Mon, 1.2k, Q3); replace Yes/No text with check icons; strip repeated units/labels from every row (put them in the header once); merge related fields into one denser datum (e.g., "12 kt NE", "3/5 done"); bold only the critical value, never the unit. Plain-language filter controls ("Show only…") instead of query-builder jargon.

**Charts on mobile:** don't shrink an 8-series line chart. Show the headline number + trend arrow + a single-series sparkline; full chart on tap or desktop-only. A number the user can read at a glance beats a chart they must study.

### 4.4 Separate mobile layout vs responsive single layout

For genuinely data-dense apps there's a legitimate fork:

- **One responsive codebase** — cheaper to maintain, risk: compromises both ends.
- **Distinct mobile shell** (separate `AppLayoutMobile`-style component tree rendering the same data with mobile-specific screens) — more code, but each layout is designed honestly for its context, and you can scope mobile to the companion-app feature set instead of contorting every desktop screen. Linear went further (fully native). For an internal tool, a separate mobile component layer within the same React app is usually the right cost/quality point — which is exactly the `AppLayout` / `AppLayoutMobile` split Mayday Studio already uses. The trap to warn about: the two shells drifting (features shipped desktop-only by default, sub-view state persisting on one and not the other). Institute a "mobile disposition" line item in every feature spec: *full / companion / hidden on mobile* — a conscious choice, recorded.

---

## 5. Mobile task triage patterns

The highest-value mobile surface in any productivity tool is the **inbox/triage screen**. Patterns that define state of the art (Linear, Todoist, Outlook mobile, Gmail):

- **One unified attention queue.** Notifications, assignments, mentions, approvals in one reverse-priority list — not five separate pages. The mobile session is "clear my queue," so give it one queue.
- **Swipe vocabulary:** swipe right = the most common positive action (done/archive/approve); swipe left = defer (snooze/reschedule) or secondary action; long swipe can escalate (e.g., delete). Keep it to ≤2 actions per direction; reveal colored backgrounds + icons during the drag so the outcome is predictable; require a threshold + haptic to prevent accidental triggers.
- **Snooze is non-negotiable.** "Deal with it later" (tonight / tomorrow / next week / pick date) is what makes zero-inbox possible on a phone; without it users abandon the queue.
- **Accessible fallback:** every swipe action needs a visible alternative (overflow menu or buttons on the row) — swipe-only actions fail switch/screen-reader users and are undiscoverable besides (this is the standard critique in accessibility literature, e.g. LogRocket's treatment of swipe-to-delete).
- **Quick capture in ≤2 taps from anywhere:** persistent + button → title field focused with keyboard up → smart defaults for everything else (project, assignee, date inferable or optional). Wroblewski's 60-second one-thumb test applies most literally here. Screenshot-to-report (Linear) is the power move for bug/issue capture.
- **Batch triage:** tap-and-hold to enter selection mode, then bulk complete/snooze. Field-service research emphasizes glanceable rows — each row must carry exactly the fields needed to *decide* (what, who/where, when, status) in one fixation; consistent icon language lets users triage without reading (heart=like, bubble=comment style consistency).
- **Notification discipline feeds triage:** per-category toggles and quiet-hours schedules (Linear ships user-configurable notification windows). A noisy notification firehose kills the triage loop because users stop trusting the queue.
- **Field/frontline variant** (training-facility relevant): the day's schedule in sequence, biggest tap targets of the whole app, offline tolerance, one-tap status transitions ("session started/complete"), and testing *with actual field users* — office-based testing systematically misses glare, gloves, urgency, and interruption.

---

## 6. What to cut on mobile (and what never to cut)

**Safe to cut / defer to desktop:**
- Bulk/batch admin operations beyond simple multi-select (mass reassignment, imports, exports)
- Complex creation & configuration: multi-step form builders, automation/rule editors, permission matrices, report builders
- Dense comparative analytics (multi-series charts, pivot tables) — replace with headline stats + trends
- Drag-and-drop-heavy manipulation (Gantt editing, board re-ordering across many lanes) — offer single-item "move to…" menus instead
- Long-form authoring (fine to *read* and comment; composing 2,000 words on a phone is nobody's real workflow)
- Rarely-used settings/admin panels — reachable but buried is fine here

**Never cut on mobile:**
- Reading/checking status of anything the user owns
- Completing, approving, commenting, reassigning — the *verbs* of triage
- Quick capture of new items
- Notifications and the ability to act on them
- Search — on mobile it substitutes for the navigation you removed; a good global search forgives a thin nav

**The test for each candidate:** does it happen away from a desk? Is it time-sensitive? Does it fit one thumb + partial attention? Two of three "yes" → keep on mobile. Also honor the cardinal rule: content parity ≠ feature parity. Users should be able to *see* their data everywhere (never strand someone who got a link on their phone); they don't need to be able to *administer* it everywhere.

**Anti-pattern: "desktop version" escape hatches as strategy.** If analytics show users pinch-zooming a desktop layout on phones, that's a triage-screen you failed to build, not evidence they "prefer the full site."

---

## 7. Playbook: mobilizing an existing data-dense web app

1. **Instrument first.** Which pages get mobile traffic today? Which actions are attempted (and abandoned) on small screens? Rage-tap/zoom signals mark the worst screens.
2. **Interview the moving users.** Find the 3-5 away-from-keyboard jobs (approve X, check today's Y, log Z, respond to @mention). These define the companion scope.
3. **Write the mobile charter:** one sentence — "On a phone, this product lets you ___ in under a minute." Everything ships against that.
4. **Build the spine:** bottom tab bar (3-5: e.g., Home/Today · Inbox · [+ Capture] · Search · Profile-More), safe-area aware, badge counts wired.
5. **Ship the triage screen first.** Unified queue, swipe actions + button fallbacks, snooze. This screen alone usually captures most mobile value.
6. **Convert the top 3 tables** to card stacks with the column-priority method (§4.3). Leave long-tail tables in overflow-scroll containers until data says they matter.
7. **Sweep ergonomics:** every pressable ≥44pt with ≥8px gaps; primary actions bottom-anchored; destructive actions out of the thumb arc; forms use correct input types (`inputmode`, autocomplete) and one field-group per screen.
8. **Performance budget:** interactive in <3s on a mid-tier phone on LTE; skeletons over spinners; optimistic UI on triage verbs (a triage tap that takes 2s round-trip breaks the flow-state loop).
9. **Test in-hand, in the field:** all three Hoober grips, outdoors, walking, one-handed, and with the actual frontline users. Run the one-thumb/60-second test on each core task.
10. **Govern drift:** every future feature spec declares its mobile disposition (full / companion / hidden). Review quarterly against mobile analytics.

**Definition of done for any mobile screen (checklist):**
- [ ] Core action reachable in bottom third, one thumb
- [ ] All targets ≥44pt/48dp physical with ≥8px separation
- [ ] No horizontal body scroll; wide elements in their own scroll containers
- [ ] Primary nav visible (no critical destination hamburger-only)
- [ ] Works one-handed in all three grips; nothing critical occluded by the holding hand
- [ ] Swipe/gesture actions have visible-button equivalents
- [ ] Text ≥16px body (also prevents iOS input auto-zoom on focus)
- [ ] Safe-area insets respected (notch, home indicator, gesture edges)
- [ ] Passes the 60-second one-thumb test for its core task

---

## 8. Common mistakes

1. **Porting the desktop and calling it responsive.** Shrinking a 12-column dashboard until it "fits" produces view-tap asymmetry: readable, untappable. The fix is representation-swapping and cutting, not scaling.
2. **Hamburger as primary nav.** Costs >20% discoverability and 15-39% task time (NN/g). Half-ships every feature inside it.
3. **Touch targets sized to WCAG's 24px floor.** Compliance ≠ usability; ~3x error rates below 44px. Icon is 24px, hit area is 44-48.
4. **Top-corner critical actions.** Save/close/submit in the hard zone forces regripping on every use. (Etsy's corner close button is the textbook example.)
5. **Swipe-only actions.** Undiscoverable and inaccessible without a visible fallback.
6. **Horizontal-scrolling tables as the "solution."** Off-screen columns are dead columns; dual-axis scrolling disorients.
7. **Feature-parity ideology.** Trying to ship the automation editor on a phone delays the triage screen that would deliver 80% of mobile value. (Corollary: content parity is still mandatory — never strand a deep link.)
8. **Mixing nav paradigms** — tab bar + hamburger + top tabs simultaneously; users can't build a mental model.
9. **Ignoring grip switching.** Designing for an idealized static right thumb; Hoober: grips change every few seconds. Test all three.
10. **Hiding the tab bar on scroll in a tool.** Fine for feeds; in a tool it makes navigation feel unreliable.
11. **Desktop-first CSS retrofits.** Max-width override stylesheets accumulate into unmaintainable specificity wars; mobile-first min-width layering stays clean.
12. **No mobile-disposition governance.** Without a per-feature ruling, everything defaults to desktop-only and the mobile app silently rots (the shell-drift problem).
13. **Testing at a desk.** Chrome DevTools' device mode catches layout, not sunlight, gloves, one-handedness, or urgency. Field users' feedback "differs dramatically from office-based testing."
14. **Notification firehose.** Un-curated push kills the triage loop; users mute the app and the mobile surface dies.

---

## 9. Questions Carl should ask

**Scoping**
- "When someone opens this on a phone, what are they actually trying to do in the next 60 seconds?" (If the client can't answer, instrument before building.)
- "Which of your users are away from a desk during work — and what do *they* need, versus what the admin at a desk needs?"
- "For your last five shipped features: what was each one's mobile story? Was that a decision or a default?"
- "Is mobile a companion (triage/capture/approve) or the primary workstation for someone? Different answers, different builds."

**Diagnosis**
- "Show me your mobile analytics: which screens get phone traffic, and where do sessions die?"
- "Open your app on your own phone right now and complete your #1 task one-handed. Time it." (Live one-thumb test — brutally revealing.)
- "Where does your primary navigation live on mobile — can I see the top 5 destinations without opening a menu?"
- "Pick your busiest table. On a phone, which 2-3 columns would let a user make their decision? Everything else is a candidate for the detail view."
- "What happens when a user taps a notification link on their phone — do they land somewhere usable, or on a pinch-zoom desktop page?"

**Craft audit**
- "Are your tap targets 44pt with real spacing, or are they whatever the desktop link size happened to be?"
- "Do your swipe gestures have visible-button fallbacks?"
- "Can a user snooze or defer from the mobile queue, or only complete/ignore?"
- "Have you watched a real field user (coach, editor, contractor) use this on-site — not in the office?"

**Governance**
- "Who owns the mobile experience? If the answer is 'the same PR that ships desktop,' expect drift."
- "What's your rule for when a new feature must work on mobile? Write one: full / companion / hidden, declared in the spec."

---

## Sources

- Nielsen Norman Group — Touch Targets on Touchscreens: https://www.nngroup.com/articles/touch-target-size/
- Nielsen Norman Group — Hamburger Menus and Hidden Navigation Hurt UX Metrics: https://www.nngroup.com/articles/hamburger-menus/
- Steven Hoober — How Do Users Really Hold Mobile Devices? (UXmatters): https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php
- Samantha Ingram — The Thumb Zone: Designing for Mobile Users (Smashing Magazine): https://www.smashingmagazine.com/2016/09/the-thumb-zone-designing-for-mobile-users/
- Steven Hoober — Designing Mobile Tables (UXmatters): https://www.uxmatters.com/mt/archives/2020/07/designing-mobile-tables.php
- Luke Wroblewski — Mobile First (book resource page): https://www.lukew.com/resources/mobile_first.asp
- Interaction Design Foundation — The One Thumb, One Eyeball Test for Good Mobile Design: https://ixdf.org/literature/article/using-mobile-apps-the-one-thumb-one-eyeball-test-for-good-mobile-design
- Linear — Linear Mobile product page: https://linear.app/mobile
- W3C — Understanding WCAG 2.2 SC 2.5.8 Target Size (Minimum): https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- LogRocket — All accessible touch target sizes: https://blog.logrocket.com/ux-design/all-accessible-touch-target-sizes/
- LogRocket — Designing swipe-to-delete and swipe-to-reveal interactions: https://blog.logrocket.com/ux-design/accessible-swipe-contextual-action-triggers/
- Material Design 3 — Navigation bar & Navigation rail guidelines: https://m3.material.io/components/navigation-bar/guidelines and https://m3.material.io/components/navigation-rail/guidelines
- LogRocket — Using CSS breakpoints for fluid, future-proof layouts: https://blog.logrocket.com/css-breakpoints-responsive-design/
- Team 400 — Mobile Apps for Field Service: Design Patterns: https://team400.ai/blog/2025-07-field-service-mobile-apps
