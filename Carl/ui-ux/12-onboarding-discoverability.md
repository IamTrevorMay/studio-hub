---
title: "Onboarding, Feature Discoverability & Empty States"
domain: ui-ux
tags:
  - onboarding
  - empty-states
  - feature-adoption
  - product-tours
  - contextual-help
  - internal-tools
  - portals
sources_reviewed: 14
last_updated: 2026-07-12
---

# Onboarding, Feature Discoverability & Empty States

Scope: onboarding for internal and multi-role tools — product tours (the narrow cases where they work), empty states as the primary teaching surface, contextual hints vs. documentation, feature-adoption tactics, and onboarding freelancers/external partners into a portal. Generic reference; applies directly to any small team running an internal ops app plus external-facing portals (contractors, agencies, clients of a training facility).

## TL;DR

- **Default to no tour.** NN/G's research is blunt: tutorials interrupt users, don't improve task performance, and are forgotten. The empty state + a good first-run default beats a 7-step tour almost every time. Build tours only for genuinely novel interaction paradigms or when a specific observed failure justifies one.
- **If you must tour: ≤3 steps, user-triggered, with a progress indicator.** 3-step tours complete at ~72%; 5 steps ~34%; 7 steps ~16%. Self-serve/user-triggered tours complete ~123% higher than auto-fired ones. Progress indicators add ~12% completion.
- **Every empty state is a wasted onboarding slot until it does three jobs:** (1) says the system isn't broken, (2) teaches what will live here and how it gets here, (3) offers one direct action that fills the container. That's NN/G's three guidelines and the copy+visual+action anatomy in one pattern.
- **Prefer pull over push.** Contextual help that appears when the user enters the relevant flow ("pull revelation") is remembered and used; help pushed at login is dismissed — ~76% of static tooltips are dismissed within 3 seconds. Anchor hints to the moment of need, not the session start.
- **Feature adoption is a funnel, not an announcement:** Exposed → Activated → Used → Used Again. In-app contextual prompts drive 3–5x more adoption than email/banner announcements. A launch-day modal is exposure; only repeat use is adoption.
- **Checklists are the highest-leverage onboarding pattern.** Tours launched from a checklist item hit ~67% completion vs ~23% for auto-triggered — the checklist pre-qualifies intent. Keep it 3–5 items, each an action (not "watch a video"), with visible progress.
- **For external-partner portals, the onboarding is mostly upstream of the UI:** pre-provisioned access, one link, pre-filled context, and a first screen that shows *their* work waiting for them. If adding a partner takes staff more than ~2 minutes of setup, the setup won't happen and the partner gets a degraded experience.
- **Internal tools don't have an activation-to-revenue funnel — they have time-to-competence and interruption cost.** Measure "first successful task without asking a human" instead of activation rate, and treat every Slack question about "where do I…" as an onboarding bug.

---

## 1. The core mental model

### 1.1 Onboarding is gap-crossing, not feature-showing (Samuel Hulick)

Hulick (*The Elements of User Onboarding*, useronboard.com teardowns) reframes onboarding: people don't want your product, they want a **better version of themselves** — his famous sketch is Mario + fire flower = fire-throwing Mario. You're not selling the flower; you're selling throwing fireballs. Onboarding is "increasing the likelihood that users are successful when trying your product and sustaining that success over time," and it starts *before* first login — at the moment someone decides the tool might fix something in their life.

Practical consequences:

- Design backwards from the user's desired outcome, not forwards from your feature list.
- User attention at signup is "like air leaking out of a space suit" — every unnecessary field, vague label, or point of confusion vents it. Hulick's most common teardown findings: asking for unneeded info, vagueness, and introduced confusion.
- He watches three moments hardest: **first signup** (what did they hope for? what triggered them *today*?), **conversion**, and **cancellation**. For an internal tool the analogs are: first login, first unaided task, and silent abandonment (they went back to the spreadsheet).

### 1.2 Push vs. pull revelations (NN/G)

The single most useful distinction in this whole domain:

- **Push revelations**: help pushed at the user regardless of their current goal — launch-time tours, "what's new" overlays, deck-of-cards intro slides. Generic, interruptive, frequently skipped, poorly retained.
- **Pull revelations**: help triggered by a signal that the user needs it *now* — a tooltip near the control they're hovering, a hint that appears the first time they enter a flow, an empty state explaining the container they just opened.

NN/G's finding: tutorials (push) "don't result in better task performance." The mechanism is the **paradox of the active user** — new users refuse to invest in preparatory learning; they want to act immediately, so anything taught out of context isn't retained to the moment of need. Pull revelations don't have this problem because the context *is* the moment of need.

Rule of thumb: every piece of proactive help you're tempted to push at login, ask "what user action could trigger this instead?" There almost always is one.

### 1.3 Proactive vs. reactive help (NN/G heuristic #10)

- **Proactive help** (before problems): tours, tips, tooltips, empty-state education. Should be dominated by pull revelations.
- **Reactive help** (user seeks it): docs, FAQs, videos, training. Must be searchable, task-focused, chunked/scannable, comprehensive (not just the basics), with graphics/video as secondary support, categorized by task or experience level.

Best systems chain them: the pull-revelation hint carries a "Learn more" link into the specific reactive doc — never to a docs homepage.

### 1.4 The three components of onboarding (NN/G taxonomy)

1. **Feature promotion** — justified only for genuinely novel capability or newly shipped features to existing users. Repeatedly promoting an existing underused feature creates notification fatigue. Don't front-load at first launch: people arrived on purpose.
2. **Customization** — *content* customization (role, interests, defaults that tailor the experience) is worth 1–2 questions max at the start, with a stated reason. *Visual* customization (themes, layouts) should never be in onboarding — users can't have preferences about an interface they haven't used; move it to settings.
3. **Instructions** — deck-of-cards intros (avoid; they make the product look harder than it is), instructional overlays/coach marks (fine when unobtrusive and shown at first encounter with the specific feature), interactive walkthroughs (best form: user practices the real action in a low-stakes scenario; reserve for genuinely novel interactions).

NN/G's meta-guidance: onboarding is only justified when users need account setup, tailoring info, or education on a workflow that genuinely differs from convention. Otherwise **spend the effort on making the UI self-evident.** Test whether users struggle without onboarding before building any.

---

## 2. Benchmarks worth memorizing

From Chameleon's analysis of 15M product-tour interactions, Userpilot's 2025 benchmark (188 companies), Amplitude's 2024 behavioral analysis (1,247 B2B apps), and aggregated industry stats. Treat all vendor numbers as directional, not gospel — the vendors sell onboarding tools — but the *ordering* of effects replicates across sources.

| Metric | Number | Source/context |
|---|---|---|
| Avg. product tour completion | ~61% | Chameleon 15M interactions |
| 3-step tour completion | ~72% | Chameleon |
| 5-step tour completion | ~34% | Chameleon |
| 7-step tour completion | ~16% | Chameleon (each step past 3 costs 15–20 pts) |
| Self-serve vs auto-triggered tours | +123% completion | Chameleon |
| User-triggered vs session-start tours | 2–3x completion/engagement | Chameleon patterns report |
| Tour launched from checklist item | ~67% vs ~23% auto-triggered | Chameleon |
| Progress indicator effect | +12% completion, −20% dismissal | Chameleon |
| Checklist-driven flows vs monolithic tour | +21% completion | Chameleon |
| Static tooltips dismissed <3s | ~76% | Amplitude 2024 |
| Avg. checklist completion | 19.2% mean / 10.1% median | Userpilot 2025 |
| Welcome modal (well-timed) | ~47% completion; wrongly timed: 38% dismissed <4s | Chameleon |
| Embedded/inline patterns vs pop-ups | up to 1.5x more actions | Chameleon |
| Tour-highlighted features used in first 30 days | ~18% (vs ~22% for naturally-discoverable un-highlighted features) | industry analysis — tours can *underperform* plain discoverability |
| B2B SaaS activation rate | ~37.5% avg (30–40% typical band) | 62-company benchmark |
| Time-to-value, self-serve B2B | <5 min excellent; 5–20 min acceptable; >60 min needs assisted onboarding | 2026 TTV framework |
| Users churning without seeing value in week 1 | ~90% | UserGuiding stats roundup |
| Contextual help buttons | −40% support queries | UserGuiding stats roundup |
| In-app contextual prompts vs email announcements | 3–5x feature adoption | Appcues/aggregate |

The one to internalize: **the tour-highlighted-features number (18% vs 22%)**. Features pushed via tour got *less* 30-day usage than features left to natural discovery. Exposure ≠ adoption; forced exposure can even inoculate against it.

---

## 3. Product tours: the narrow case where they work

### When a tour is justified

1. **Novel interaction paradigm** — the UI genuinely departs from convention (canvas tools, gesture-driven UIs, AR). NN/G found walkthroughs useful exactly here and almost nowhere else.
2. **Observed failure** — you've watched real users fail at a specific step. The tour targets that step only.
3. **Re-onboarding after a major redesign** — existing users' spatial memory is now wrong; a short "here's what moved" tour is a courtesy.
4. **Compliance/irreversibility** — the first action has real consequences (payroll run, publishing to a client) and you need the user to see the guardrails once.

### The spec for a tour that won't get skipped

- **≤3 steps.** Hard limit 5. Every step past 3 costs 15–20 points of completion.
- **User-triggered or checklist-launched**, not auto-fired on first login. If it must auto-fire, fire it when the user *enters the relevant area*, not at session start.
- **Progress indicator** ("2 of 3"). +12% completion, −20% dismissal.
- **Each step demands an action in the real UI**, not "Next." Interactive walkthroughs where the user performs the task beat narrated pointing.
- **Skippable, with a recovery path.** The most expensive failure mode is a skippable tour with no way back for the user who skipped and then got stuck. Park it behind a persistent "?" or help menu entry ("Replay intro").
- **Ends at value**, not at the end of the feature list. Last step should leave the user having *done* the core thing once.

### When to kill an existing tour

Skip rate >70%, or completion doesn't correlate with better retention/task success, or users who skip perform the same as users who finish. All three are common. Replace with empty states + contextual hints and measure again.

---

## 4. Empty states: the highest-ROI onboarding surface

An empty state is any container currently showing no content: first use, user-cleared, no search results, filtered-to-nothing, error, and (rarely) celebratory zero (inbox zero). In an internal tool with many list/table/board views, empty states are the majority of a new user's first-session screens — they *are* the onboarding whether you designed them or not.

### NN/G's three guidelines (complex applications)

1. **Communicate system status.** An empty table with no message is ambiguous: loading? error? actually empty? Say it: "No records for the selected date range." Anti-pattern: showing "No records" and then populating two seconds later — it torches trust. Never render the empty message before the query resolves; show a loading state first.
2. **Provide learning cues.** The empty state is a pull revelation by definition — the user just opened this container, so this is the moment they'll retain "Star your favorites to list them here" (DataDog's example). Teach what populates the space and how.
3. **Provide direct pathways.** Don't just describe; include the button. Loggly's pattern is the gold standard: two paths — *add your real data* or *explore demo data*. The demo-data path matters for tools where real data takes days to accumulate (analytics, metrics dashboards).

### Anatomy (Pencil & Paper)

Three parts, in order of importance:

1. **Informative copy** — what should/will live here, one or two sentences, written to the user's goal not the system's schema. ("Assignments your team sends you will appear here" beats "No rows found.")
2. **Action** — one primary CTA that fills the container; optionally one secondary "Learn more" to the specific doc.
3. **Informative visual** — optional; a small illustration or a ghost/skeleton preview of what a populated state looks like. Ghost content doubles as teaching: users see the shape of future data.

### Type-specific behavior

- **First-use empty**: full treatment (copy + action + optional visual). This is onboarding real estate.
- **No search results**: never a dead end — offer spelling suggestions, broader-scope search, or links to adjacent resources/FAQ. Frustrated searchers should be redirected, not stonewalled.
- **Filtered-to-nothing**: say *which filters* caused it and offer one-click "Clear filters." (Users routinely think the app lost their data when an old filter hides everything.)
- **User-cleared / done**: celebrate lightly (inbox-zero pattern) — it's success feedback, not a gap.
- **Error-empty**: distinct visual from "legitimately empty"; include retry.

### Starter content beats explanation

Dropbox pre-loaded new accounts with a PDF (which was also the getting-started guide) so the first screen was never empty and the value prop (file from any device) was demonstrable immediately. Pinterest asks interests at signup and pre-populates the feed. For internal tools the equivalent: seed a sample project/board/report, or pre-assign the new person one real, tiny task so their "My Tasks" view has something in it on day one. **A pre-filled first screen outperforms any tour explaining an empty one.**

---

## 5. Contextual hints vs. documentation

### The decision framework

| Question | If yes → | If no → |
|---|---|---|
| Is the confusion predictable at a specific moment/element? | Pull-revelation hint at that moment (tooltip, inline note, coach mark on first encounter) | |
| Is it needed *during* the task, in <15 words? | Inline microcopy / placeholder / helper text under the field | Link to doc |
| Is it long, branching, or rarely needed? | | Reactive documentation, linked from the exact relevant spot |
| Is it a convention any web user knows? | Delete the hint. NN/G: don't explain obvious design conventions | |

Layered model (cheapest first):

1. **Self-evident UI** — good labels, defaults, information scent. Always the first fix; onboarding is a tax you pay for UI debt.
2. **Inline microcopy** — helper text, placeholders, unit labels. Zero interaction cost.
3. **On-demand tooltips** ("?" icons, hover) — for genuine ambiguity only; a tooltip on a clearly-labeled button is clutter.
4. **First-encounter coach marks** — one element, one time, at first entry into the flow. Focus on a *single interaction*, not a UI census.
5. **Empty states** — see §4.
6. **Linked-from-context documentation** — inline hint links to the *specific, current* article, not the docs home. Contextual help buttons cut support queries ~40%.
7. **Human help** — for internal tools this is Slack/shoulder-tap; every recurring question here is a signal to add a layer 1–6 fix.

### Documentation that actually gets used

- Task-focused titles ("Submit your hours for the pay period"), not feature-focused ("Hours module").
- Chunked, scannable, front-loaded steps; screenshots/video secondary to text (text is searchable and skimmable).
- Comprehensive — NN/G warns against docs that only cover the basics; the person opening docs already exhausted the basics.
- Freshness is credibility: one stale screenshot and users stop trusting all of it. For small teams, fewer docs kept current beats broad stale coverage.
- Surface the top 5 most-read articles; the distribution is always brutally skewed.

---

## 6. Feature adoption: the funnel and the tactics

### The four-stage funnel (Appcues)

**Exposed → Activated (first try) → Used (accomplished something) → Used Again (true adoption).** Most teams measure only exposure ("we announced it") and wonder why usage is flat. Diagnose which stage leaks:

- Exposed but not activated → the pathway from awareness to action has friction; put the entry point where the announcement is.
- Activated but not used → the feature failed its first audition; that's a product problem, not a comms problem.
- Used but not again → no recurring trigger; add contextual re-surfacing at the recurring moment of need.

### Metrics

- **Adoption rate** = users of feature / total (or eligible) users. Benchmarks are contextual: core-workflow features 80–90%; power-user features 15–20% is fine. Track trend, not absolutes.
- **Breadth** (features per user — correlates with stickiness), **depth** (frequency/intensity), **time-to-adopt** (exposure → regular use; long = friction), **feature retention**.

### Tactics, ranked by evidence

1. **Contextual, trigger-based surfacing** — show the feature at the moment it solves the user's active problem (user just did the manual workaround → hint the automated way). In-app contextual beats email announcement 3–5x. This is the whole game.
2. **Segmented announcements** — only to users for whom it's relevant; blasting everyone trains people to ignore all your messages. For multi-role tools: announce admin features to admins only, freelancer features in the freelancer portal only.
3. **Persistent discovery surface** — a "What's new" / changelog reachable on demand (pull, not push). Catches the users who dismissed the announcement.
4. **Embedded > pop-up** — inline banners/cards in the relevant page get up to 1.5x more actions than modal announcements.
5. **Adoption is not a launch-day event** — re-surface contextually for weeks; one-time announcements and long docs rarely produce sustained adoption. 36% of SaaS companies have *no* intentional in-app guidance; and 77% of IT leaders have found high-value features in their stack they never knew existed — dark features are the norm, not the exception.
6. **Watch, don't just ship** — pair adoption data with "why not?" feedback (1-question survey or just asking, at small scale).

### Small-team corollary

In a team of 5–20, the cheapest adoption tactic is unavailable to big SaaS: **tell people directly, once, in the channel where they work, then back it with a contextual hint in-app.** But the failure mode is identical — the builder announces once in Slack, nobody adopts, the feature dies dark. The in-app contextual hint is still needed because the Slack message scrolls away and new/returning users never saw it.

---

## 7. Onboarding for internal & multi-role tools

Internal tools differ from consumer SaaS in ways that change the playbook:

- **Captive users, no signup funnel** — nobody churns to a competitor, they churn to *the old spreadsheet* or to interrupting a colleague. The metrics that matter: **time-to-competence** (first unaided completion of the role's core task), **question rate** (how often they ask a human), and **workaround rate** (shadow spreadsheets = silent churn).
- **The builder is in the room** — which tempts teams to skip onboarding entirely ("I'll just show them"). That works for user #2 and breaks at user #6, and it means every new contractor costs an hour of a founder's time. The bar isn't "no human help ever," it's "the human help is a bonus, not a requirement."
- **Roles need different first-runs.** Role-based onboarding = the checklist, visible nav, and first screen adapt to role. An admin's first-run (configure, invite, review) is a different product from a member's (find my tasks, do them, log output) and a freelancer's (see assignment, submit work, get paid). One generic tour serves nobody. Enterprise onboarding platforms treat "can it model distinct paths per role" as the primary selection criterion — do the same in-app: gate onboarding content by role exactly like you gate features.
- **Low usage frequency = perpetual re-onboarding.** A payroll page used twice a month is met by a user who has forgotten it every time. Design those pages for the *returning-amnesiac*, not the expert: more inline labels, visible state ("period: July 1–15"), and no reliance on remembered steps. Frequency of use, not user seniority, determines how much contextual scaffolding a page needs.
- **The empty state problem is worse** — internal tools launch with no data in most modules, and value depends on *other people* having entered data. Seed aggressively (sample rows, a first assigned task) and make cross-user dependencies explicit ("Your dashboard fills in when your manager assigns work — nothing for you to do yet").
- **Measure with what you have.** No analytics suite needed: log first-login → first-completed-task timestamps, count "how do I" questions per new user, and interview user #3. NN/G's "test whether they struggle before building onboarding" is nearly free at internal-tool scale.

### The multi-role onboarding checklist (per role)

1. Define the role's **one core loop** (freelancer: see assignment → do → submit → log hours).
2. First screen after first login shows **that loop with real or seeded content** — never a generic dashboard of empty widgets.
3. A **3–5 item role-scoped checklist**, all actions ("Submit your first file"), persistent until done, dismissible.
4. First-encounter hints only on the role's genuinely non-obvious steps (identified from real questions asked).
5. One **"help" pull surface** per role: short task-titled doc set + who to contact.
6. Instrument: did they complete the loop unaided within the first session/day/week?

---

## 8. Onboarding freelancers & external partners into a portal

External partners are the hardest onboarding audience: low frequency, zero loyalty, no org-chart obligation to learn your tool, and they judge your whole company by the portal. Principles from client-portal practice plus the general research:

### Before first login (where most portal onboarding is won or lost)

- **One link, minimal ceremony.** Invitation → account creation → landing on their work should be one continuous flow. Every additional email, credential, or "check your other inbox" step loses partners. Best practice: contract signed → portal opens, no separate login link hunting.
- **Pre-provision everything.** Role, folder access, payment details, and first assignment are set *before* they arrive, carried by the invitation. The partner should never see a configuration screen.
- **The 2-minute rule (staff side):** if adding a partner takes staff more than ~2 minutes, staff will skip or botch the setup and the partner inherits a degraded experience. Automate provisioning off the invite.
- **Ask for the minimum.** Hulick's rule applies doubly: every signup field must earn its place. Payment info can be a first-week checklist item, not a signup gate.

### First session

- **Land them on their work, not a welcome page.** The strongest possible onboarding is "here is your assignment, due Friday, click to start." Purpose-built empty states for everything else ("Documents to sign will appear here").
- **A short role-scoped tour is defensible here** — this is one of the rare tour-justified audiences (one-shot users of an unfamiliar tool, no colleague to ask, and you can't afford them getting lost). Keep it ≤7 stops only if each stop is a nav item, not a lesson; better: 3–5 stops mapped to their core loop (dashboard → assignments → submit → hours/payment). Make it re-launchable from the help menu, and track `tour_completed_at` so it fires exactly once.
- **State the loop explicitly**: "Each period: check assignments → upload deliverables → log hours by the 15th → get paid." Partners tolerate — even prefer — being told the process bluntly.

### Ongoing

- **Deadline-driven re-onboarding.** Low-frequency users forget; notifications ("hours due in 2 days") aren't nagging, they're the onboarding for this visit. Type-distinguished notifications (payment vs. assignment vs. document) let them triage.
- **Locked-down nav is a feature.** Show partners only their 5–7 pages. Discoverability of things they can't use is negative value and a security smell.
- **Respect channel preference.** Some partners (and industries — legal, older clients) live in email; forcing the portal on a portal-hater damages the relationship. Mirror critical events (new assignment, payment sent) to email with deep links back in.
- **Escape hatch to a human**, visibly. Partners who can't find the answer in 60 seconds will either interrupt someone anyway or silently do the wrong thing; make the sanctioned interrupt path obvious.

*(Relevance note: this section maps 1:1 to a contractor portal with tour + checklist + hours cycle, an agency read-only deliverables portal, and — for a training facility — a future client/parent portal for scheduling and progress. Same playbook, different loop per audience.)*

---

## 9. Checklist playbook (the pattern that wins)

Why it wins: a checklist converts push into pull. The user *chooses* the next item, so any tour or flow launched from it inherits intent — that's the mechanism behind the 67%-vs-23% completion gap. Also: 60% of users who engage a checklist go on to multiple tasks in-session.

Spec:

1. **3–5 items.** Longer checklists complete less (mean completion is only 19.2% even at this length — median 10.1% — so every extra item is expensive).
2. **Every item is an action in the product** that moves the user toward their first value, not consumption ("Invite a teammate," not "Watch overview video").
3. **First item pre-checked or trivially completable** — endowed progress; momentum is real.
4. **Persistent but dismissible** widget; reopenable from a stable spot.
5. **Ordered by the value path**, not by feature area.
6. **Role-scoped** (see §7) — one checklist per persona.
7. **Ends with a completion moment** — small celebration, then it disappears forever. A checklist that lingers after completion is clutter.

---

## 10. Common mistakes

1. **Auto-firing a tour at first login, before the user has context or intent.** The dominant failure. Wrongly-timed welcome modals get dismissed in <4s by 38% of users; ~70% of tours get skipped overall.
2. **Tour as feature census** — 7+ steps pointing at every nav item. Completion craters to ~16%; cognitive load blows working-memory limits in the first minute; retention of the content is ~nil.
3. **Skippable tour with no recovery path.** The user who skipped and later needs it has nothing. Always park a replay in help.
4. **Explaining conventions** — tooltips on obviously-labeled buttons, "click here to search" on a search box. Pure clutter that trains users to ignore your real hints.
5. **Empty containers with no message** — the user can't tell empty from broken from loading, refreshes repeatedly, and files a bug (or worse, assumes data loss when a filter is hiding rows).
6. **"No records" flashing before data loads** — trust damage that outlasts the session.
7. **Onboarding as substitute for usability** — building a tour to explain a confusing screen instead of fixing the screen. NN/G's core position: invest in the UI first; onboarding is interaction cost.
8. **Launch-day-only adoption strategy** — announce once, never re-surface contextually, feature goes dark. Exposure ≠ adoption (tour-highlighted features: 18% 30-day usage vs 22% for naturally discoverable ones).
9. **Unsegmented announcements** — showing every role every message trains universal dismissal.
10. **Asking for information you don't need yet** at signup — Hulick's #1 teardown finding; attention leaks with every field.
11. **Visual-preference questions during onboarding** (theme, layout) — users can't answer them yet and stick with defaults anyway.
12. **Front-loading video/deck-of-cards intros** — makes the product look more complicated than it is and gets skipped.
13. **Checklist items that are homework, not actions** ("Read the guide") — completion collapses.
14. **Stale docs and screenshots** — one wrong screenshot and users distrust all reactive help; small teams should keep fewer docs current rather than many stale.
15. **For internal tools: assuming the hallway demo scales** — works for user 2, silently fails at user 6; the new contractor three months from now gets nothing.
16. **For portals: heavy staff-side setup per partner** — >2 minutes of manual provisioning means it gets skipped and the partner lands in a broken account.

---

## 11. Questions Carl should ask

**Diagnosis**
1. "What are the last five 'how do I…' questions new users actually asked a human?" (Each is a missing pull revelation — and the only onboarding backlog you need.)
2. "Watch the next new hire's first 20 minutes without helping. Where do they stall?" (NN/G: validate the struggle before building anything.)
3. "What's your time-to-first-unaided-task per role? Do you even record first-login and first-task timestamps?"
4. "Which screens does a brand-new user see empty in session one — and what does each currently say?" (Usually: nothing.)
5. "Is anyone maintaining a shadow spreadsheet or asking a colleague instead of using the tool? That's your churn."

**Tours & hints**
6. "For each tour/hint that exists: what user action triggers it? If the answer is 'login,' why?"
7. "What's the skip rate on your tour, and do completers actually perform better than skippers?" (If you can't answer, the tour is faith-based.)
8. "If a user skips the tour and gets stuck an hour later, how do they get it back?"

**Empty states & first-run**
9. "Could you seed real or sample content so the first screen is never empty?" (Dropbox-PDF test.)
10. "Does each empty state say (a) not broken, (b) what fills this, (c) one button to fill it?"
11. "Can a filtered-to-empty view be told apart from a truly-empty view? Is there a one-click clear-filters?"

**Feature adoption**
12. "Name a feature you shipped that nobody uses. Where does it leak: never exposed, tried-once, or no repeat trigger?"
13. "When someone does the manual workaround, does anything in-app point them at the feature that automates it?"
14. "Are announcements segmented by role, or does everyone see everything?"

**Multi-role & portals**
15. "Walk me through a freelancer's path from invite email to first submitted deliverable. How many steps, screens, and credentials?"
16. "How long does *staff-side* setup take per new partner? Anything over ~2 minutes will get skipped."
17. "For pages used twice a month (payroll, invoicing): are they designed for someone who has forgotten everything since last time?"
18. "Which role's onboarding have you never actually tested with a real member of that role?"

---

## Sources

- Nielsen Norman Group — Onboarding Tutorials vs. Contextual Help: https://www.nngroup.com/articles/onboarding-tutorials/
- Nielsen Norman Group — Designing Empty States in Complex Applications: 3 Guidelines: https://www.nngroup.com/articles/empty-state-interface-design/
- Nielsen Norman Group — Mobile-App Onboarding: An Analysis of Components and Techniques: https://www.nngroup.com/articles/mobile-app-onboarding/
- Nielsen Norman Group — Help and Documentation (Usability Heuristic #10): https://www.nngroup.com/articles/help-and-documentation/
- Nielsen Norman Group — Instructional Overlays and Coach Marks for Mobile Apps: https://www.nngroup.com/articles/mobile-instructional-overlay/
- Chameleon — What We Learned Analyzing 15 Million Product Tour Interactions: https://www.chameleon.io/blog/product-tour-benchmarks-highlights
- Chameleon — Onboarding UX Patterns: A Data-Backed Guide: https://www.chameleon.io/blog/onboarding-ux-patterns
- Pencil & Paper — Empty State UX Examples & Best Practices: https://www.pencilandpaper.io/articles/empty-states
- UserOnboard (Samuel Hulick) — Onboarding UX Patterns: Empty States: https://www.useronboard.com/onboarding-ux-patterns/empty-states/
- Appcues — Onboarding New Users: An Interview with Samuel Hulick: https://www.appcues.com/blog/onboarding-new-users-an-interview-with-samuel-hulick
- Appcues — Feature Adoption Guide: Metrics, Funnel & How to Improve: https://www.appcues.com/blog/a-guide-to-feature-adoption
- UserGuiding — 100+ User Onboarding Statistics: https://userguiding.com/blog/user-onboarding-statistics
- Userpilot — Why Product Tours Get Skipped (+ benchmark data): https://userpilot.com/blog/product-tour-examples/
- WeWeb — Best Client Portals: Buying Guide (portal onboarding friction, 2-minute rule, channel preference): https://www.weweb.io/blog/client-portals-buying-guide
- Digital Applied — Time to Value: SaaS Onboarding Metrics Framework (TTV and activation benchmarks): https://www.digitalapplied.com/blog/customer-onboarding-time-to-value-2026-saas-metrics-framework
