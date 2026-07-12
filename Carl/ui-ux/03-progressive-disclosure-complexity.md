---
title: "Progressive Disclosure & Managing Complexity"
domain: ui-ux
tags:
  - progressive-disclosure
  - defaults
  - feature-bloat
  - complexity-budget
  - expert-vs-novice
  - internal-tools
  - staged-ui
sources_reviewed: 14
last_updated: 2026-07-12
---

# Progressive Disclosure & Managing Complexity

## TL;DR

- **Complexity never disappears; it only moves** (Tesler's Law). The only real design decision is *who pays*: the user, the interface, the engineer, or ops. Default to making the team pay, not the user.
- **Two disclosure levels, maximum.** NN/g's research is blunt: designs beyond 2 levels of progressive disclosure "typically have low usability" — users get lost between layers. If you need 3+, the feature set itself needs restructuring, not more hiding.
- **Defaults are the highest-leverage design decision you'll make.** ~90%+ of users never change defaults (organ-donation research: 99% consent under opt-out vs ~12% under opt-in). Every default is a decision you're making *for* the user — make it the correct one, and audit them like code.
- **Design for the perpetual intermediate** (Alan Cooper). Skill follows a bell curve; most users stay intermediate forever. Optimize the primary UI for them; add invisible accelerators for experts and just-in-time hints for novices. Avoid explicit "beginner/expert mode" toggles — they force users to self-classify and split your testing surface.
- **The feature-bloat math is brutal:** Pendo found 12% of features drive 80% of daily usage; ~80% of features are rarely or never used; median feature adoption is 6.4%. Assume any feature you ship has a supermajority chance of becoming maintenance debt.
- **Hide vs remove is a real decision with different criteria.** Hide when the feature is low-frequency but high-value-when-needed. Remove when usage is near-zero AND maintenance/cognitive cost is real. Never silently rip out a feature — telemetry first, communicate, migrate, then delete.
- **Internal tools want density, not whitespace** — but density with hierarchy. A dense operator screen with strict grids and clear typographic tiers beats a "clean" one that hides working data behind clicks.
- **Run a complexity budget:** every new visible control on a core screen must be "paid for" by removing, demoting, or merging something else. Roadmaps need a sunset column, not just a build column.

---

## 1. The physics: Tesler's Law and where complexity goes

**Tesler's Law (Law of Conservation of Complexity):** every application has an irreducible amount of complexity. It cannot be removed — only moved between the user and the system/team. Larry Tesler formulated it at Xerox PARC in the mid-1980s and used it at Apple to argue for standardized interaction: *"If a million users each waste a minute a day dealing with complexity that an engineer could have eliminated in a week... you are penalizing the user to make the engineer's job easier."*

Practical corollaries:

1. **Complexity accounting.** When someone says "let's simplify the UI," ask where the complexity went. If the UI doesn't ask for it, the back end must infer it; if the back end can't, ops absorbs it through support tickets, Slack messages, and apologies. "Simplification" that just relocates work to humans downstream is a net loss.
2. **The team should absorb complexity, not the user.** Pre-filled forms, inferred values, address inheritance, one-click payment — all are cases where engineering effort buys user simplicity. That trade is almost always worth it for high-frequency flows.
3. **Beware complexity bias** — humans (especially technical founders) associate complexity with sophistication and prefer adding intricate solutions. The impressive-looking screen is usually the badly designed one.
4. **Design for the active user paradox:** users start doing, they don't read manuals. Contextual guidance (tooltips, inline hints, empty-state instructions) beats documentation every time.

**Relevance note:** an internal ops app (like a studio hub for a small media team) is exactly the setting where Tesler's Law bites — a tiny team means every minute of user-side complexity is paid by the same 5–10 people every day, but there's also no dedicated design staff to absorb it. The compromise: spend absorption effort only on daily-frequency flows; let rare flows stay ugly-but-explicit.

---

## 2. Progressive disclosure: the canonical framework (Nielsen)

Jakob Nielsen's definition: **defer advanced or rarely used features to a secondary screen, making applications easier to learn and less error-prone.** Show a few of the most important options; offer the larger set of specialized options on explicit request.

It improves all three of the usability trifecta simultaneously:
- **Learnability** — novices' attention lands only on features that matter.
- **Efficiency** — experienced users don't scan past options they never use.
- **Error rate** — fewer visible options = fewer wrong ones picked.

Counterintuitive finding from NN/g: users **understand a system better when you help them prioritize features** — hiding the advanced stuff doesn't just declutter, it teaches the model of what the tool is *for*.

### Progressive vs. staged disclosure — don't conflate them

| | Progressive disclosure | Staged disclosure |
|---|---|---|
| Initial display | Core/frequent features | Whatever comes first in the task sequence |
| Secondary display | Optional; most users never open it | Mandatory; everyone passes through unless they abandon |
| Navigation model | Hierarchical — open, act, return | Linear — step 1 → 2 → 3 (wizard) |
| Best for | Feature-rich tools with a usage core | Tasks that decompose into independent steps |
| Fails when | The hidden things are actually frequent | Steps are interdependent and users must bounce between them |

Staged disclosure (wizards) breaks down when users need to alternate between steps — e.g., NN/g's hotel-reservation test: a single screen was better for comparison shopping but caused errors by demanding payment details prematurely; a two-screen compromise beat both extremes. Rule of thumb: **wizard only when steps are truly sequential and independent; otherwise one screen with sections.**

### The two hard requirements (where most implementations fail)

1. **Split correctly.** Everything users *frequently* need must be up front — if people constantly open the "advanced" panel, you drew the line wrong, and you've made the tool slower, not simpler. Determine the split with frequency-of-use analytics + task analysis + observational testing (analytics alone can't distinguish intentional visits from mistaken ones).
2. **Make progression obvious and labeled.** The affordance to reveal more must be mechanically trivial and its label must set accurate expectations ("Advanced options," "More filters," count badges like "+4 more"). A hidden feature with no signifier is a removed feature that you still pay to maintain.

### The 2-level rule

**Do not exceed two disclosure levels.** Primary display → one secondary display is the ceiling; users get lost beyond that. Multiple *parallel* secondary panels are fine (each independently opened); multiple *chained* levels are not. If your feature set seems to demand 3+ levels, the fix is restructuring — card-sort the advanced features into logical chunks, or cut.

Canonical example: the print dialog. Initial screen: copies, printer, page range (what ~95% of print jobs need). "Advanced" button: scaling, reverse order, duplex. Everyone's mental model of progressive disclosure done right.

---

## 3. Pattern catalog: the mechanics of hiding well

Each pattern is a different answer to "where does the complexity wait?"

| Pattern | Use when | Watch out for |
|---|---|---|
| **Accordion / expander** | Selective reading: FAQs, specs, long detail sections; "Completed" sections in trackers | Don't auto-collapse things users need to compare side-by-side |
| **Tabs** | Distinct content categories on one entity (details / activity / settings) | Users can't see two tabs at once; don't tab-split data that gets cross-referenced |
| **"Show more" / truncation** | Lists and text where the head matters most | Show a count ("Show 12 more") so users can judge whether to expand |
| **Overflow menu (⋯ / kebab)** | Per-row rare actions (rename, duplicate, delete) | Keep the 1–2 most frequent actions as visible icons; overflow only the tail |
| **Tooltips / popovers** | Contextual explanation without leaving the task | Hover-only = invisible on touch; pair with tap/click affordance |
| **Conditional form fields** | Fields relevant only after a prior answer ("Business" reveals company fields) | Fields appearing/disappearing mid-form can disorient; animate and insert below the trigger |
| **Multi-step wizard** | Sequential, independent steps (checkout, onboarding, invite flow) | See staged-disclosure failure mode above; always show progress + allow back |
| **Dropdown/select** | Long enumerations (countries, statuses) | For ≤5 options, radio/segmented control is faster and more scannable |
| **Command palette (⌘K)** | Expert access to everything without cluttering anything | It's an accelerator, not a substitute for navigation — novices won't find it unprompted |
| **Lazy loading / above-the-fold priority** | Data-dense dashboards | Most important content above the fold, always |
| **Hover-revealed controls** | Dense tables/rows where per-row buttons would be noise | Must have a visible fallback for touch and accessibility |

### When NOT to use progressive disclosure

- Users need everything visible **for comparison** (pricing tiers, side-by-side specs, dense monitoring dashboards).
- Hiding the info is a **safety/correctness risk** (destructive-action consequences, billing amounts, permissions summaries).
- The extra click/expansion creates more friction than the visible complexity would (high-frequency operator screens — see §7).
- **Navigation itself.** Hamburger-menu research is consistent: fully hidden navigation reduces discoverability and feature usage — "out of sight, out of mind." On desktop especially, keep primary nav visible.

### Consistency is part of the pattern

An anti-pattern from multi-team products: disclosure mechanics diverge — one panel expands on click, another on hover; one modal dismisses on outside-click, another needs an explicit close. Users then never form a reliable model of *how hiding works* in your product, and every disclosure interaction becomes a small gamble. Standardize the disclosure grammar product-wide (one expander style, one modal-dismiss rule, one overflow-menu convention).

---

## 4. Defaults are design decisions users never see

Defaults are the strongest lever in choice architecture, full stop.

**The evidence:**
- Organ donation (Johnson & Goldstein's classic data): opt-out countries (Austria) see >99% consent; culturally similar opt-in countries (Germany) sit near 12%. An online experiment flipping opt-in→opt-out nearly doubled agreement (42%→82%) with identical stakes. ~90% of people simply take the national default.
- Search behavior (NN/g "Power of Defaults"): 42% of users click the first result. When researchers *swapped* results #1 and #2, the top position still got 34% of clicks — most users followed position, not relevance. Only a minority adjusted.
- Product settings: users rarely change app defaults even when customization exists. Treat your settings screen as write-only for most of your base.

**Design rules that follow:**

1. **Every default is a recommendation.** Pre-select the choice that's correct for the *most common* case, not the one that's easiest to implement or best for the vendor. Deliberately expensive/self-serving defaults measurably damage trust.
2. **Defaults are just-in-time instruction.** A pre-filled field shows the expected format and typical value ("what does a normal answer look like here?"). This reduces both effort and error.
3. **Smart defaults > static defaults.** Infer from context: default the date to today, the owner to the current user, the project to the one just viewed, the country to the event's location. Each inference is Tesler's Law in action — complexity absorbed by the system.
4. **Default state = default behavior.** "Hide Done: on by default" is a policy decision about what work is visible daily. Filter defaults, sort defaults, notification defaults, collapsed-vs-expanded defaults — these silently define how the whole team works, because almost nobody flips them.
5. **Audit defaults like code.** Keep an inventory: every toggle/filter/pre-selection, its default, and the justification. When behavior problems appear ("nobody notices overdue items"), check the defaults before adding features.
6. **Ethics line:** make opting out exactly as easy as opting in. Defaults that empower vs. defaults that exploit is the whole difference between good UX and a dark pattern — and internal tools have their own version (defaults that serve the admin's reporting needs at the cost of the operator's workflow).

---

## 5. Novices, experts, and the perpetual intermediate

### Cooper's bell curve

Alan Cooper (*About Face*): user skill distributes as a bell curve, and most users are — and remain — **perpetual intermediates**. Two forces pin them there: beginners hate feeling incompetent and quickly climb out of the novice stage; experts regress toward intermediate after any time away. (Larry Constantine called them "improving intermediates"; Cooper's correction — *perpetual* — is the important insight: they seldom become experts.)

**Design consequence:** optimize the primary interface for intermediates. They:
- don't need the tool's purpose explained (skip the hand-holding),
- have a stable working set of frequent functions that must be front-and-center, easy to find, easy to *remember*,
- need to know advanced features *exist* without being forced through them,
- reach for reference help occasionally (good tooltips, searchable help) but never tutorials.

Cooper: "Good software shortens the beginner passage without bringing attention to it." Onboarding should be a ramp you barely notice, not a stage you live in. Shneiderman's mantra is the intermediate-friendly information architecture: **overview first, zoom and filter, then details on demand.**

### Serving experts: accelerators, not modes

Nielsen's Heuristic #7 (Flexibility and efficiency of use): **accelerators — unseen by the novice — speed up interaction for the expert, so the interface serves both.** The key property: accelerators are *additional, alternate* paths. Novices never need to discover them; nothing breaks if they don't.

Accelerator toolbox (NN/g):
- **Keyboard shortcuts** (Ctrl+C/V; app-specific like Slack/Linear's ⌘K quick switcher)
- **Gestures** (swipe-to-delete, double-tap react, right-click, drag-drop)
- **History/recency defaults** (recent items, last-used values pre-filled)
- **Type-ahead / autocomplete**
- **Redundant paths** — same action reachable from menu, context menu, shortcut, palette
- **Macros/batch operations** for repeated multi-step work

Accelerator design guidelines:
- Attach them to the **highest-frequency actions first** (frequency × user count = payoff).
- **Teach them gradually and contextually**: show the shortcut inline in the menu next to the command; surface a hint after a user does the slow path repeatedly; keep a searchable cheat sheet in help. Don't dump them in onboarding.
- **Never override platform-standard shortcuts** (copy/paste/print).
- Give **visible feedback** on execution and always support **undo** — accelerators are fast, so mis-fires are fast too.

### Why explicit "novice mode / expert mode" toggles usually fail

- Users must self-classify, and they're bad at it (and it feels insulting either way).
- Skills are per-feature, not global — someone is expert at the calendar and novice at the report builder. A global mode switch can't represent that.
- Two modes = two UIs to design, test, document, and keep consistent — a complexity *doubling* for a team, not a reduction.
- The Fuzzy Math framing is the right substitute: **guided pathway, hidden shortcut** — one visible, learnable path plus invisible parallel accelerators (Slack: visible sidebar for learning, ⌘K for speed). Layer complexity within one interface rather than forking it.

Exception that works: **role-based** (not skill-based) variants — admin vs. member vs. contractor views gated by actual permissions/responsibilities. That's not an expert mode; it's showing each role only their job. This is the correct pattern for internal tools: an "Admin Mode" that adds admin pages is role disclosure, not skill disclosure, and it doesn't have the self-classification problem.

---

## 6. Feature bloat: the numbers, causes, and case studies

### Vocabulary (they're not synonyms)

- **Scope creep** — process: project requirements expand mid-project without added resources.
- **Feature creep** — process: features accumulate across the product's life without adequate scrutiny.
- **Feature bloat** — *state*: the accumulated complexity now costs users and the business more than the features are worth. Bloat is what you're left with when creep goes unmanaged.

### The benchmark numbers (memorize these)

| Stat | Source |
|---|---|
| **12%** of features generate **80%** of daily usage; **~80%** of features rarely/never used (consistent across company sizes) | Pendo 2019 Feature Adoption Report (615 subscriptions, 1yr+ tenure) |
| Median feature adoption rate: **6.4%**; top-decile products: **15.6%** (~2.5×) | Pendo benchmarking (later data) |
| Smaller companies (<200 employees) average **7.4%** adoption — leaner feature sets adopt better | Pendo benchmarking |
| **64%** of enterprise-software features rarely or never used | Standish Group CHAOS (2002) |
| **<30%** of SaaS features see active use | Capterra research |
| Est. **$29.5B** spent by public cloud companies on rarely/never-used features; a $50M-revenue software co. burns ~**$8.4M/yr** on them | Pendo 2019 |
| ~**80%** of maintenance budget services minority-used features (implication of the above) | featurebloat.com synthesis |

Adoption should be measured on four axes, not one: **breadth** (how many users touched it), **depth** (frequency per role), **time-to-adopt** (uptake speed post-launch), **duration** (does usage sustain). A feature can score high on breadth (everyone tried it once) and be dead on duration.

### Why bloat happens (structural, not stupidity)

1. **Addition bias** — Leidy Klotz's research: humans systematically default to adding rather than subtracting when solving problems, even when subtraction is objectively better. People literally don't *generate* subtractive options.
2. **Incentive asymmetry** — engineers and PMs get recognized for shipping, never for deleting. Launch a feature → hero. Kill a feature → firefighter handling angry emails. Roadmaps have a "build" column and no "sunset" column.
3. **Feature factory** (Marty Cagan's term) — org measures output (features shipped) instead of outcomes (user/business results).
4. **Sales-driven one-offs** — "we'll close the deal if we add X" produces features with exactly one user.
5. **Loudest-customer bias** — vocal power users request edge-case features; the silent majority pays the complexity tax.
6. **Nobody owns subtraction** — usage telemetry exists but no ritual reviews it with removal authority.

### Case studies

- **Microsoft Word**: ~1,500 commands. The Ribbon (2007) was a discoverability fix for bloat, not a bloat fix — the complexity was reorganized, not reduced. Lesson: navigation redesign can't rescue an over-scoped feature set.
- **Evernote**: expanded into marketplaces and adjacent products, cycled CEOs, ended in a 2023 acquisition — canonical "lost the core job" story.
- **Zoom**: expanded into Mail, Calendar, Whiteboard, Docs chasing platform status — textbook competitive-parity creep.
- **iOS Settings**: 40+ top-level categories; Apple adding *search* to Settings is the tacit admission that the hierarchy stopped being navigable. (Search-as-bandage is a bloat smell in any product.)
- **Notion / Slack**: flexibility itself as bloat — infinite configurability creates per-user cognitive load; Slack's Huddles = adding a Zoom competitor inside a chat tool.
- **Healthy removals**: Grammarly discontinued desktop apps; Spotify sunset Spotify Live; Medium removed Profiles/Themes features; Airbnb paused Experiences to refocus on core. Successful companies remove things *proactively and publicly*.

### The real cost of a kept feature

Every retained feature costs, forever: codebase complexity slowing all future work; maintenance/refactoring/support; QA surface; documentation; onboarding length; and the quiet one — **team cognitive load** ("one more thing that must be discussed and considered and take up space in our minds day-to-day" — Ant Murphy). Plus opportunity cost: the high-impact work not done.

---

## 7. Hide vs. remove: the decision framework

Progressive disclosure and feature removal are neighbors — hiding is often deployed as a coward's removal. Distinguish them deliberately:

**HIDE (progressive disclosure) when:**
- Low frequency but high value *when needed* (year-end export, bulk reassignment, advanced print options).
- A meaningful minority depends on it regularly.
- It's essential to specific roles → hide by role/permission, not behind a generic "advanced" flap.
- Removal would break trust or workflows even if usage is low (safety valves, undo/history, data export — some features are insurance, and insurance has low "usage" by design).

**REMOVE when:**
- Breadth AND depth AND duration are near-zero after a fair adoption window (and you've ruled out "nobody could find it" — check whether it was ever discoverable/announced before condemning it on usage).
- It duplicates another feature (merge, then remove).
- Its maintenance cost is nonzero and its strategic relevance is gone (built for a customer who churned, an experiment that didn't win, a platform that died).
- It actively confuses users about what the product is for.

**Removal playbook (never rip silently):**
1. **Instrument first.** Get real telemetry: who uses it, how often, in what flows. Identify the specific users.
2. **Calculate revenue/workflow risk.** For internal tools: which person's weekly routine breaks?
3. **Communicate with lead time.** In-app notice targeted at actual users, not a blast. Name the removal date. (UserGuiding's rule: never tear a feature out without messaging the people who use it, giving prep time, and offering an alternative.)
4. **Offer the migration path** — alternative feature, export, or documented workaround.
5. **Soft-remove** (hide behind a flag / de-emphasize) for one cycle if risk is uncertain; watch for screams.
6. **Hard-delete the code.** A hidden feature that's never deleted is bloat with extra steps — you keep the maintenance cost and gain nothing.
7. **Log it.** A "sunset log" makes removal a normal, celebrated act and builds the institutional muscle.

**Anti-pattern: the junk drawer.** An "Advanced" or "More" menu that becomes the dumping ground for every feature nobody wanted to argue about. If the secondary display grows unboundedly, you're not doing progressive disclosure — you're doing deferred removal.

---

## 8. Complexity budgets in dense internal tools

Internal/operator tools (admin panels, ops hubs, production trackers) have different physics than consumer apps:

- **Users are captive and daily.** Learnability matters less; efficiency and error-rate matter more. A one-time 20-minute learning cost is fine; a 3-extra-clicks-per-task cost is not.
- **Density beats whitespace.** Enterprise-UX practice: consumer "whitespace" aesthetics fail when operators need lots of data on one screen. The goal is **density with clarity** — strict grids, tight typographic hierarchy, logical clustering — packing information without visual chaos. Don't "simplify" an operator screen by hiding working data; you'll trade one glance for five clicks.
- **But density has a ceiling** — and that's where the budget comes in.

### Running a complexity budget

Treat visible complexity on each core screen as a finite budget, like a performance budget:

1. **Set the budget per screen**: roughly, the number of always-visible interactive controls + distinct information clusters a screen may carry. (No universal number; the discipline is having *a* number and a gatekeeper.)
2. **One-in, one-out on core screens**: a new visible control must be paid for by demoting (into disclosure), merging, or removing something. New features default to the *secondary* layer; they must earn primary placement with demonstrated frequency.
3. **Primary = frequency, not recency or politics.** The screen's top layer belongs to what's used daily by the main role, decided by telemetry — not to whatever shipped last or whoever asked loudest.
4. **Quarterly subtraction review**: walk the usage data; every feature below an adoption floor gets an explicit verdict — promote (make discoverable / announce), hide (demote a level), or sunset. Silence is not a verdict.
5. **Budget the disclosure layer too.** The 2-level rule caps depth; cap breadth as well (an overflow menu with 15 items has failed — regroup or cut).
6. **Consistency spend**: one modal grammar, one expander style, one filter-bar pattern reused everywhere. Every novel disclosure mechanism you introduce spends budget across the whole product, because users must learn it as a new rule.

**Relevance note (small-team ops apps):** with 5–15 users you can literally interview 100% of your user base, so "usage data" can be a conversation. The failure mode is the opposite of enterprise: because building is cheap and the builder is a user, features accrete weekly and nothing ever sunsets. A small internal tool needs the sunset ritual *more* than a SaaS product does, because no market pressure will ever force the cleanup. The same applies to a training facility's client-facing screens (booking, programs, progress dashboards): athletes/parents are novices forever — default everything, wizard the signup, and keep coach-facing density on separate role-gated screens.

---

## 9. Playbooks

### A. Designing a progressive-disclosure split (new or existing feature area)

1. List every option/action in the feature area.
2. Get frequency data (analytics or direct observation; for internal tools, ask the users).
3. Draw the line: frequent + core → primary display; the rest → ONE secondary layer.
4. Verify the split: if usability testing shows most users opening the secondary layer routinely, redraw.
5. Label the reveal control so it sets accurate expectations ("Advanced options", "More filters (4)").
6. Keep the reveal mechanically trivial (one click, inline expansion preferred over navigation).
7. Cap at two levels. If pressure for a third appears, restructure via card-sorting instead.
8. Re-check quarterly: yesterday's advanced option may be today's daily driver (and vice versa).

### B. Shipping a new feature without adding bloat

Ask before building (10-question style, condensed):
- What outcome (not output) does this serve? How will we measure adoption (breadth/depth/duration)?
- Who asked — how many users does this actually represent?
- Can an existing feature be extended instead? (Subtractive/mergeable option generated on purpose — countering addition bias.)
- What is its complexity cost: visible controls added, settings added, docs, QA surface?
- What gets demoted/removed to pay for it on the target screen?
- What's the sunset criterion? (Define the kill condition *at ship time*: "if <N users use this monthly by date X, we remove it.")
- Where does it live in the disclosure hierarchy on day one? (Default: secondary.)

### C. Defaults audit (run twice a year)

1. Inventory every default: pre-selections, filter states, sort orders, toggles, notification settings, collapsed/expanded states.
2. For each: what % of users ever changed it? (Expect ~10% or less.)
3. Is the default the correct choice for the most common case and the safest choice for the worst case?
4. Are any defaults serving the builder/admin at the user's expense?
5. Do any defaults hide information that's causing recurring "I didn't see it" incidents? Fix the default, don't write the memo.

### D. De-bloating an existing product

1. Pull feature-level usage; rank by breadth × depth.
2. Expect a power law (12/80). Split the tail into: undiscovered-but-valuable (promote), rare-but-critical (hide well), duplicate (merge), dead (sunset).
3. Run the removal playbook (§7) on the dead list — batch communications.
4. Rebuild the primary screens around the head of the distribution.
5. Institute the complexity budget going forward so you don't do this again in two years.

---

## 10. 2024–2026: progressive disclosure in AI-era interfaces

- Progressive disclosure has become the load-bearing pattern for AI products: chat/prompt UIs present a minimal initial state and reveal capability progressively through interaction — the user's input drives what gets disclosed, and the system absorbs the complexity (Tesler's Law at maximum: the model *is* the absorbed complexity).
- AI-generated/adaptive interfaces increasingly tailor disclosure dynamically to user behavior rather than using a fixed novice→expert ramp. Promise: personalized complexity. Risk: inconsistent disclosure breaks the user's mental model (the same product behaving differently per session violates the consistency rule in §3) — and adaptive hiding can strand power users.
- Known trade-offs called out in current practice: pure-chat interfaces under-disclose capability (users can't discover what the system can do — the hamburger-menu problem in new clothes); good AI UX now pairs open input with suggested actions, visible affordances, and expandable detail on outputs (show the answer, disclose the reasoning/sources on demand).
- The same pattern is being applied to agent/tool APIs ("progressive disclosure for MCPs" — expose minimal tool surface first, expand on demand) — evidence the concept has jumped from UI into system design.

---

## Common mistakes

1. **Hiding frequent features.** The #1 failure. If users constantly open the secondary layer, you made the product slower and called it simpler. Split by measured frequency, not by what looks tidy.
2. **Three or more disclosure levels.** Users get lost; usability collapses. Restructure instead.
3. **Hiding with no signifier.** A feature reachable only by tribal knowledge is functionally removed but still costs maintenance. Every hidden layer needs a labeled, visible entry point.
4. **Treating hiding as removal.** The junk-drawer "Advanced" menu grows forever; the code never dies. Hide deliberately or delete completely.
5. **Removing silently.** Ripping a feature without telemetry, targeted notice, and a migration path burns trust far beyond the feature's worth.
6. **Wizard-izing interdependent tasks.** Forcing linear steps on users who need to bounce between them (comparison, cross-referencing) creates errors and rage. Wizards only for truly sequential, independent steps.
7. **Global expert/novice mode toggles.** Self-classification fails, skill is per-feature, and you've doubled your UI surface. Use one interface with accelerators; use *role*-based views only where permissions genuinely differ.
8. **Careless defaults.** Shipping whatever the framework pre-selected, or defaults that serve the builder. ~90% of users will live with whatever you pre-selected forever.
9. **Whitespace-washing an operator tool.** Applying consumer minimalism to a daily-use dense tool trades glances for clicks. Density with hierarchy is the goal.
10. **Inconsistent disclosure grammar.** Different expand/dismiss/overflow behaviors across screens (classic multi-team symptom) — users never learn how hiding works in your product.
11. **No sunset column.** Roadmaps that only add. Addition bias + shipping incentives guarantee bloat unless subtraction is an explicit, scheduled, owned activity.
12. **Judging a feature dead on usage alone.** First rule out discoverability failure (was it ever announced/findable?) and insurance value (export, undo, audit features are *supposed* to be rarely used).
13. **Answering complexity with search.** Adding search to settings/menus instead of fixing the hierarchy (the iOS Settings move) treats the symptom; fine as a bandage, damning as a strategy.

---

## Questions Carl should ask

**Diagnosing the current state**
- "Which 10 features drive 80% of your daily usage — do you actually know, or are you guessing?" (Expect they don't know; the answer is measurable.)
- "When did you last remove a feature? What happened?" (If the answer is 'never,' bloat is accumulating by default.)
- "What percentage of your settings/defaults have users ever changed?" (Reveals whether defaults are doing the design work or fighting it.)
- "Show me your most-used screen. How many controls are always visible? How many did you use in the last week?"
- "Where do users constantly click 'more/advanced/expand'? " (That's a mis-drawn disclosure line.)
- "What features exist because one specific person/customer asked?"

**Testing the disclosure design**
- "Can a new team member complete the core daily task without opening any secondary panel?" (If no, the primary layer is wrong.)
- "How many levels deep is your deepest hidden feature?" (>2 = restructure.)
- "Do your expanders/modals/menus all behave the same way everywhere?"
- "For each hidden feature: how does a user who needs it *find* it?"

**Testing the process**
- "Does your roadmap have a sunset column? Who has authority to kill a feature?"
- "When you shipped your last feature, what was the pre-agreed kill condition? What got demoted to make room for it?"
- "Who reviews usage telemetry, how often, and what decisions has that review actually produced?"

**For an internal tool specifically**
- "Your team is small enough to interview everyone — when did you last watch someone use this screen?"
- "Which parts of this tool exist because building was fun that week?" (Builder-as-user creep.)
- "If you deleted the bottom 30% of features tonight, who would notice by Friday?"

**For novice-facing surfaces (clients, contractors, partners)**
- "What does a first-time user see — the intermediate view or a defaulted, staged one?"
- "Are external roles (contractor, agency, client) seeing role-scoped views, or your internal UI with things hidden?" (Role gating should be structural, not cosmetic — RLS-level, not display-level, when data is sensitive.)

---

## Sources

- Nielsen Norman Group — Progressive Disclosure (Jakob Nielsen): https://www.nngroup.com/articles/progressive-disclosure/
- Nielsen Norman Group — The Power of Defaults: https://www.nngroup.com/articles/the-power-of-defaults/
- Nielsen Norman Group — Accelerators Maximize Efficiency in User Interfaces: https://www.nngroup.com/articles/ui-accelerators/
- Nielsen Norman Group — 10 Usability Heuristics for User Interface Design: https://www.nngroup.com/articles/ten-usability-heuristics/
- Laws of UX — Tesler's Law (Jon Yablonski): https://lawsofux.com/articles/2024/teslers-law/
- featurebloat.com — Feature Bloat: Causes, Case Studies, and How to Cut It: https://featurebloat.com/
- Pendo — The 2019 Feature Adoption Report: https://www.pendo.io/resources/the-2019-feature-adoption-report/
- Pendo — Why feature adoption may be your biggest weakness—or strength (benchmarking): https://www.pendo.io/pendo-blog/feature-adoption-benchmarking/
- Ant Murphy — When Did You Last Remove a Feature?: https://www.antmurphy.me/newsletter/why-you-should-remove-features
- UXPin — What Is Progressive Disclosure? Definition, Examples & Best Practices: https://www.uxpin.com/studio/blog/what-is-progressive-disclosure/
- Fuzzy Math — How to Design for Novices and Experts Alike: https://fuzzymath.com/blog/designing-efficient-approachable-products-for-novices-and-experts/
- The Designer's Field Guide — Most users are intermediate users (on Cooper's perpetual intermediates): https://thedesignersfieldguide.substack.com/p/most-users-are-intermediate-users
- Yu-kai Chou — Default Effect (Johnson & Goldstein organ-donation data): https://yukaichou.com/gamification-analysis/default-effect-johnson-goldstein-organ-donation-opt-in-opt-out/
- AI Design Patterns — Progressive Disclosure in AI: https://www.aiuxdesign.guide/patterns/progressive-disclosure
- Indulge — Progressive Disclosure is The Design Pattern for AI-Generated Interfaces: https://indulge.digital/intelligence/articles/progressive-disclosure-design-pattern-ai-generated-interfaces
- UserGuiding — What Is Feature Bloat and How Can You Effectively Get Rid of It: https://userguiding.com/blog/feature-bloat
