---
title: Information Architecture & Navigation Design
domain: ui-ux
tags:
  - information-architecture
  - navigation
  - card-sorting
  - tree-testing
  - wayfinding
  - sidebar-design
  - role-based-ux
sources_reviewed: 26
last_updated: 2026-07-12
---

# Information Architecture & Navigation Design

## TL;DR

- **IA is not navigation.** IA is the underlying structure and naming of content; navigation is the UI that exposes it. Fix the structure before touching the menu — a nav redesign on a broken IA just repaints a bad map (NN/g).
- **First click is destiny.** Across millions of tree-test responses, users whose first click was correct completed the task 70% of the time; a wrong first click dropped success to 24% (~3x). Spend disproportionate effort on top-level labels.
- **Prefer broad-and-shallow over deep, within reason.** Error rates climb steeply with depth (4% at one level → 34% deep in classic menu research). Cap primary nav at ~3 levels; if a section needs more, give it shortcuts (search, "most used," cross-links).
- **Labels carry the whole system.** Strong "information scent" — specific, jargon-free trigger words that describe what's on the other side — beats any structural cleverness. Generic labels ("Resources," "Tools," "More") are where IAs go to die.
- **Cheap tests exist; use them.** Open card sort (15+ users, 30–50 cards) to generate structure; tree test (~50 users, 8–10 tasks) to validate it before building. Benchmark: >80% tree-test success is very good, 61–80% good, <40% poor; aim for ≥75% directness.
- **Split a page when it has two audiences, two tasks, or two mental "objects"; merge when users always need both halves in one sitting.** Page count is not the metric — task completion without context-switching is.
- **For role-based apps, hide what a role can never use; disable (with explanation) what it could get.** Separate portals/modes only when the role's entire job is different, not just its permission level.
- **Every IA change needs a rollout plan.** Abby Covert's #1 failure mode is shipping a reorganization with no communication or transition support — regular users experience it as vandalism of their muscle memory.

---

## 1. Foundations: what IA actually is

### IA vs navigation (NN/g)

- **Information architecture** = the identification, definition, organization, structure, and naming of content and functionality — it lives in spreadsheets, sitemaps, and taxonomies, mostly invisible to users.
- **Navigation** = the UI components (menus, sidebars, tabs, breadcrumbs, links) that let users traverse the IA. Navigation is the visible tip of the iceberg.
- Practical consequence: **define IA before choosing navigation patterns.** Picking a nav pattern for aesthetics (e.g., committing to a slim top bar) before you know content volume and depth forces you to either restructure later or artificially compress content. Start every project with a content inventory, then grouping, then taxonomy, then pattern selection.

### The Polar Bear framework (Rosenfeld, Morville, Arango — *Information Architecture: For the Web and Beyond*)

The canonical decomposition of any IA into four systems. Use it as an audit checklist:

1. **Organization system** — how content is grouped.
   - *Exact schemes* (alphabetical, chronological, geographical): use when users know exactly what they're looking for (a person's name, a date, a location). Objective, zero-ambiguity, boring, effective.
   - *Subjective schemes* (by topic, by task, by audience, by metaphor): use for browsing and discovery. Topic ("Analytics," "Projects") and task ("Publish," "Review") are the workhorses; audience schemes ("For admins," "For freelancers") work when audiences genuinely don't overlap; metaphor schemes almost always age badly.
   - Most real products are **hybrids** — that's fine, but each menu should follow *one* scheme internally. Mixing task and topic items in the same list is the most common source of "where would this live?" confusion.
2. **Labeling system** — the words on the doors. Controlled vocabulary: one concept, one name, everywhere (nav, page title, button, docs, search synonyms).
3. **Navigation system** — global, local, contextual, supplemental (sitemaps, indexes, guides).
4. **Search system** — the escape hatch when browse fails; in complex apps it's often the primary path for power users (see §5, command palettes).

### Abby Covert's 10 IA heuristics

A fast scoring rubric for any structure — rate each 1–5 during an audit: **Findable, Accessible, Clear, Communicative** (does the system tell users what's happening, timely?), **Useful, Credible, Controllable, Valuable, Learnable, Delightful.** Findable + Clear + Learnable are the three that predict day-to-day tool satisfaction in internal apps.

### Information scent (Pirolli/Card foraging theory; Spool's applied research)

Users decide where to click by sniffing labels for "trigger words" — the words *they* use for their task. Findings worth quoting:

- Scent must **strengthen page-to-page**: each click should make users more confident. Weakening scent → backtracking or abandonment.
- Spool: links that accurately describe the destination, avoid jargon/marketing language, and run **7–12 words** were most likely to lead to success (that's for in-content links; nav labels stay short but must still use the user's vocabulary).
- Scent, berrypicking, and visual hierarchy affect real-world hierarchy usability **as much or more than** the depth/breadth ratio. A deep tree with excellent scent beats a shallow tree with vague labels.
- Diagnostic: mine site/app **search logs** — the queries are users' trigger words verbatim. If people search "payroll" and your nav says "Compensation Ops," you have a labeling bug, not a search bug.

---

## 2. IA research methods: the two-tool core kit

### Card sorting — *generates* structure (NN/g)

**What:** participants group labeled cards (content/feature names) the way that makes sense to them; groupings reveal mental models.

**Variants:**

| Variant | Use when |
|---|---|
| **Open** (users create + name groups) | Default. Discovering natural categories and users' own vocabulary |
| **Closed** (fixed categories) | Validating/placing new content into an existing structure |
| **Hybrid** | You're confident about 1–2 categories, exploring the rest |

**Numbers that matter:**
- **30–50 cards** per study. >50 causes fatigue and junk "miscellaneous" piles.
- **~15 participants** minimum for qualitative insight; **30–50+** for quantitative pattern stability.
- Have users label groups **after** sorting, not before (prevents category-first bias).
- Don't reuse identical words across card labels — participants will string-match instead of thinking.

**Analysis:** similarity matrix (how often each pair of cards co-grouped), dendrograms (hierarchical clusters), plus qualitative "why" from think-aloud. The clusters are input, not output — a human still designs the tree.

**Limits:** single-level, no information scent, no context. Card sorting tells you *how people group*, not *whether they can find*. Never ship a card-sort-derived IA untested.

### Tree testing — *validates* structure (NN/g, Optimal Workshop, Lyssna)

**What:** users navigate a bare text hierarchy (no visual design, no search) to complete find-tasks. Isolates the IA from everything else. Cheap, fast, runs unmoderated in tools (Treejack/Optimal, Lyssna, UserZoom).

**Setup playbook:**
1. Build the full tree (spreadsheet: level-1 in col A, children to the right) and import.
2. Write **8–10 tasks** covering the highest-value destinations. Scenario-based wording; **never repeat the category label in the task text** (priming invalidates the result).
3. Mark correct answer node(s) — note most tools only accept leaf nodes as correct.
4. Pilot with a few moderated sessions to catch confusing task wording, then run unmoderated at scale (~50 users gives stable numbers).
5. When comparing two trees, use **between-subjects** (different users per tree), or you're measuring learning, not IA.

**Metrics + benchmarks:**

- **Success rate** (found the right node). Albert & Tullis, from 98 studies (median 62%, IQR 37–83%):
  - <40% poor · 41–60% fair · **61–80% good · 80–90% very good · >90% excellent**
  - Mission-critical tasks should target >90%; informational tasks can tolerate less.
- **Directness** (reached answer without backtracking): aim **≥75%**.
- **First click**: strongest single predictor. Correct first click → 70% eventual success; wrong first click → 24% (Optimal Workshop, millions of responses; replicates Bailey & Wolfson 2009).
- **Time on task**: secondary, use for comparisons between trees rather than absolutes.

**Diagnosis table (memorize this):**

| Pattern | Meaning | Fix |
|---|---|---|
| High success, low directness | Right neighborhood, confusing streets | Differentiate sibling/subcategory labels |
| Low success, wrong first clicks | Wrong top-level mental model | Restructure top level or cross-list (polyhierarchy) |
| Low success, correct first clicks | Deeper labels overlap/ambiguous | Rewrite lower-level labels; reduce sibling overlap |
| First clicks split across 2+ categories | Item genuinely belongs in both | Cross-list it, or rethink the organization scheme |

### Method sequencing

Card sort → design tree → tree test → iterate tree → tree test again → build → first-click test on real UI → analytics + search-log monitoring post-launch. Card sorting **generates**, tree testing **evaluates** — teams that run only one of the two get half the picture (NN/g). For an existing product, you can skip straight to a tree test of the current IA to get a baseline number before proposing anything.

### Supplementary methods
- **First-click testing on real screens** — catches visual-hierarchy failures the tree test can't (nav is fine but users click a promo card instead).
- **Search-log + analytics review** — top queries = missing or mislabeled nav items; high pogo-sticking between two sections = overlapping categories.
- **IA heuristic review** (Covert's 10) — cheap desk audit when there's no research budget.

---

## 3. Depth vs breadth

### The research

- Classic hierarchical-menu research: **error rates rose from 4% to 34%** as hierarchy depth increased from one level to several. Getting lost compounds per level.
- Shallow/broad menus generally produce **faster acquisition and higher preference** than narrow/deep ones — with the caveat that breadth wins clearly for *structured/well-organized* option sets; for unstructured sets, breadth and depth perform about equally (in-vehicle menu modeling literature).
- NN/g's position: **no universal answer; both extremes backfire.** A flat mega-list of 32 undifferentiated items (their Tampa General hospital example) fails by overwhelming; a 3-levels-deep burial (their UF Health example: Home > Patient Care > Medical Care > Specialty Care) fails by hiding.

### Working rules

1. **≤3 levels for primary navigation.** Deeper content should exist, but reach it via search, in-page links, "most viewed" shortcuts, or object pages — not by forcing a level-4 menu.
2. **Breadth is limited by scannability, not a magic number.** A 16-item list with visual grouping (headed clusters within one panel) scans fine; 16 ungrouped items don't. Group visually **before** pushing items into subcategories — a labeled cluster inside one menu costs less than an extra click level.
3. **Depth is acceptable when intermediate pages add context** (the category landing page genuinely helps users choose) — and unacceptable when intermediate levels are just pass-through click-taxes with generic names.
4. **Deeper = more generic labels.** Fewer categories per level forces broader, vaguer names, which kills scent. This is the hidden cost of depth that the click-count argument misses.
5. **Deep hierarchies demand compensations:** breadcrumbs, visible local nav, sitemap/index, alphabetical or "most used" shortcuts, strong search.
6. For a small internal tool (≲25 pages), the answer is nearly always: **one flat sidebar with labeled groups, zero or one nesting level.** Depth debates are for content libraries, not ops apps.

---

## 4. Navigation anatomy for complex multi-page apps

### The layer stack

Keep these visually and spatially distinct; blending them is a top cause of disorientation:

1. **Global nav** — persistent, identical everywhere (sidebar or top bar). Never moves, never reorders itself.
2. **Local nav** — siblings within the current section (sub-sidebar, tab row, inverted-L). NN/g: it orients ("you are in this branch"), reveals nearby content, and cuts interaction cost to deeper tiers. Must stay **visually subordinate** to global nav — in NN/g's Generac example, local nav styled more prominently than global nav made users overlook the global options entirely and feel the site was smaller than it was.
3. **Contextual nav** — links embedded in content (related items, object links).
4. **Utility nav** — account, settings, notifications, help; corner-of-screen, small.
5. **Supplemental** — search/command palette, sitemap, recents/favorites.

### Sidebar patterns (the default for complex SaaS)

- **When:** many sections, nested modules, need room for labels + badges. Vertical sidebars scale; top bars cap out around 6–8 items.
- **Single expanded sidebar with group headers** — right answer for most apps under ~30 destinations. Groups = your organization scheme made visible.
- **Collapsible sidebar** — expanded by default for learnability; power users collapse for canvas space. Persist the user's choice.
- **Two-rail (icon rail + contextual panel)** — narrow icon rail for top-level sections; clicking loads a second column of that section's contents (Slack, many enterprise/design tools). Handles depth while keeping level-1 landmarks always visible. Cost: icons alone are low-scent; the rail needs tooltips and stable ordering.
- **Accordion nesting inside a sidebar** — fine for one level; two levels of accordion in a sidebar is a smell that your top level is wrong.
- **Mobile:** sidebar becomes bottom tab bar (≤5 items) or full-screen drawer; don't miniaturize a 20-item sidebar into a hamburger and call it done — re-prioritize for the mobile jobs.

### Tabs

- Tabs = **local nav for views of the same object/page**, not a dumping ground for unrelated features. If a tab could plausibly be a sidebar item, it probably should be.
- One row, no scrolling-tab carousels on desktop; if you exceed ~7 tabs the page is doing too many jobs (see §6, split vs merge).
- Persist tab selection across refresh/navigation for work tools — losing your sub-view on every reload is a paper-cut tax users pay dozens of times a day.

### Modes / workspaces

Mode-switching (e.g., "Work mode" vs "Admin mode," or per-team workspaces) is powerful and dangerous:

- **Use a mode when the user's entire *job context* changes** — different task set, different tempo, different mental hat. Not merely because a set of pages is permission-gated.
- Rules for survivable modes: (1) the switch is **always visible and labeled with the current mode** ("you are here" for modes); (2) a small set of **essential pages appears in both modes** (dashboard, tasks, messages) so the anchor points never vanish; (3) modes number **two, maybe three** — beyond that you've built a hierarchy and should render it as one; (4) users who lack a mode never see the switch.
- The failure mode: users can't find a page because it lives "in the other mode" and nothing on screen hints that another mode exists. Mitigate with global search/command palette that indexes across modes and *switches mode* on selection.

### Command palette (Cmd+K)

- Now table stakes in productivity SaaS (Linear, Figma, Notion, Slack, Superhuman, Stripe, Vercel, Retool). It converts search from content retrieval into **full navigation + action invocation**.
- Superhuman's data: teaching shortcuts through the palette (showing the key-combo beside each command every time) increased shortcut usage ~20% and feature adoption ~67% vs self-guided onboarding.
- Design notes: index pages, objects (project names, people), and actions; fuzzy match; show keyboard shortcuts inline; recent items first. For internal tools this is the cheapest fix for "sidebar is getting crowded" — power users stop navigating spatially at all.
- It is a **supplement, not an alibi**: a palette does not excuse a bad tree, because new users can't search for words they don't know yet.

### Wayfinding: keeping users oriented

Wayfinding = the user can always answer *where am I, what's nearby, how do I get back, how do I get where I'm going*. People operate in three modes — **locate** (known target), **explore** (bounded browsing), **meander** (open wandering) — and the nav must serve at least the first two.

Toolkit:
- **Highlight the current location** in global *and* local nav (the "you are here" pin). Absurdly common omission.
- **Breadcrumbs** for anything ≥3 levels deep or object-within-collection structures (Project > Task). Home/root first, current page last as plain text, links for everything between. In apps they double as fast "up one level."
- **Consistent page titles** matching the nav label exactly (label says "Business Dev," page header says "Business Dev" — not "BD Tracker").
- **Stable ordering** — nav items never reorder themselves by recency/frequency; muscle memory is a feature. Put adaptive content in a "Recents" block instead.
- **Back must be safe.** Deep links, browser back, and refresh should return users to the same view (persist sub-view state in the URL).

---

## 5. When to split vs merge pages

The perennial internal-tool question. Page count is not the goal; **completing a task without context-switching** is.

### Split a page when

1. **Two distinct audiences/roles** use different halves (admin config vs member consumption) — mixing forces both groups to visually filter noise.
2. **Two distinct tasks with different tempos** — e.g., a daily-check dashboard vs a deep monthly analysis. Different visit frequency = different pages.
3. **The page needs two navigation systems of its own** (two unrelated tab rows, or tabs whose contents share nothing).
4. **The primary object differs** — in OOUX terms, if the "nouns" on screen are different objects with different attributes and actions, they want separate templates.
5. **Findability suffers** — tree-test tasks for content on this page fail because its label can't honestly summarize the contents anymore.
6. Scale/perf: the page has grown so large it loads slowly or requires deep in-page scrolling to reach routine controls.

### Merge pages when

1. Users **routinely need both in one sitting** and currently ping-pong (analytics events show A→B→A→B loops).
2. Two pages are the **same object at different zoom levels** — merge into one page with a filter/toggle, not two nav items.
3. Each page alone is **too thin to justify a click** (a page with one card). Thin pages dilute nav scent and inflate the tree.
4. The distinction is **organizational, not user-facing** — pages split by which team built them or which table backs them ("org-chart IA," see mistakes).

### The middle options (try before splitting)

In order of increasing separation: section headings on one page → collapsible sections → **tabs (same URL family, persisted selection)** → sub-pages under a shared section landing → fully separate nav items. Move one notch at a time; each notch adds a click and a label to maintain.

### Relevance note (small media co / training facility ops apps)

Internal tools drift toward "one giant page per department" because adding a section is cheaper than adding a route. The tell that a page must split: its nav label has become a department name rather than a task or object name. Conversely, multi-phase/multi-program trackers usually should *not* split per program — one page, program-scoped cards/filters, keeps cross-program scanning possible.

---

## 6. Navigation for role-based apps

### Hide vs disable

- **Hide** items the role can **never** access and never needs to know about (admin panels from freelancers). Least-privilege UI: reduces noise, reduces attack surface signaling, matches least-privilege access design (Budibase/Frontegg RBAC guidance).
- **Disable-with-explanation** (or show read-only) when the capability is **attainable** — upgradeable plan, requestable permission, view-only collaborator. A disabled control with a tooltip ("Ask an admin for edit access") teaches the system's shape; a hidden one generates "the button disappeared" support tickets.
- Never rely on hiding for security — hidden ≠ unauthorized. Enforce server-side (RLS/policy); the UI gating is purely experiential.

### Structural options, in escalating order

1. **Conditional items in one shared nav** — same skeleton, some items filtered by role. Right for roles that are supersets (member ⊂ assistant ⊂ admin). Keeps one mental map, one codebase of routes.
2. **Role-scoped sections/modes** — shared essentials + a role-gated section or mode (e.g., an Admin Mode). Right when the privileged role has a large, coherent extra job.
3. **Separate portal** — locked, purpose-built nav, often no shared pages (contractor portal, agency read-only portal). Right when the external role's *entire relationship* to the product differs: different data scope, different vocabulary, no need to ever see the staff IA. External/partner roles almost always deserve portals; internal role tiers almost never do.

Decision test: *"Would this role ever benefit from seeing the rest of the map?"* If yes → shared nav with gating. If no → portal.

### Portal design rules

- Trim ruthlessly: a portal with 6 clear items beats the main app's 25 filtered to 12.
- Use the **role's vocabulary**, not internal jargon ("Submit work," not the internal pipeline stage name).
- Data exposure follows the nav: back the portal with trimmed views (no internal fields like pay rates, internal notes) so the IA boundary and the security boundary coincide.
- Onboarding tours pay off disproportionately for portals — users visit rarely, so learnability (Covert) trumps efficiency.

### Audience-scheme caution

Organizing the *main* nav by audience ("For admins / For editors / For freelancers") only works when audiences don't overlap. The moment one human holds two roles, audience schemes force them to guess which persona a feature was filed under. Prefer task/object schemes with role-based *filtering*.

---

## 7. Object-Oriented UX (OOUX) — the IA method for app (not content) design

Sophia Prater's method; the best fit for database-backed tools where "pages" are really views of records.

- **Core move:** design around **nouns (objects), not verbs (features/flows)**. Humans navigate the physical world objects-first; screens-first design fragments one object across disconnected screens.
- **ORCA process:** inventory **O**bjects → map **R**elationships (project *has many* tasks; sponsor *has many* deliverables) → attach **C**alls-to-action per object per role → define **A**ttributes. Do this before drawing screens.
- **IA payoff:** the object model *is* the IA. Each major object gets: a list/collection view, a detail view, and cross-links wherever it's referenced elsewhere (an object mentioned is an object linkable). Navigation falls out: top-level nav ≈ your 5–9 core objects + a dashboard; everything else is relationship traversal.
- **Diagnostic power:** most "should this be one page or two?" fights dissolve when you ask "one object or two?" And most confusing apps turn out to have **shapeshifting objects** — the same noun rendered with different names, attributes, and actions in different places. Fix the object, the nav fixes itself.

---

## 8. Playbooks

### A. Full IA redesign (existing product)

1. **Inventory** — spreadsheet every route/page/major view; owner, purpose, traffic, role access.
2. **Baseline tree test** the current IA (8–10 top-task scenarios, ~50 users or as many staff/users as you have). Record success/directness/first-click per task. This number is your before/after evidence.
3. **Mine analytics + search logs** — top queries, dead pages, pogo-stick loops.
4. **Open card sort** (30–50 cards from the inventory, 15+ representative users) → similarity matrix + dendrogram.
5. Draft **2 candidate trees**; label with users' vocabulary from the sort + search logs.
6. **Tree test both** (between-subjects). Iterate the winner until top tasks hit ≥80% success, ≥75% directness.
7. Map tree → navigation pattern (sidebar layout, groups, local nav) — only now.
8. **Rollout plan** (Covert's anti-failure list): announce ahead, "what moved where" note, redirects/aliases from old locations, keep old deep links working, monitor search logs for orphaned vocabulary for 30 days.

### B. "Where does this new feature go?" (weekly-cadence decision)

1. What **object** is it about? Existing object → it lives on that object's page (new tab/section at most).
2. New object? Which existing **group/scheme** does it belong to? Add inside a group before adding a top-level item.
3. Which **roles** see it? Gate, don't fork.
4. Would a user **searching** for it use this label? Sanity-check with 2–3 teammates: "where would you look for X?" (a 5-minute hallway tree test).
5. Top-level sidebar additions require a reason a group/tab can't serve. Budget: top level grows by ~1–2 items *per year*, not per sprint.

### C. Navigation audit checklist (quarterly, 30 min)

- [ ] Current location highlighted on every page (global + local)?
- [ ] Every nav label matches its page title verbatim?
- [ ] Any label that's a department/team name instead of a task/object?
- [ ] Any menu mixing organization schemes (tasks + topics + audiences in one list)?
- [ ] Any item ≥4 clicks from home that people use weekly?
- [ ] Any two labels a new hire couldn't distinguish? (siblings overlap test)
- [ ] Sub-view/tab state survives refresh and is deep-linkable?
- [ ] Search/palette indexes every page and major object?
- [ ] Orphan pages (reachable only by URL)?
- [ ] Role-gated items: hidden vs disabled decided deliberately, enforced server-side?

---

## 9. Case studies with numbers

- **Baileigh Industrial (Helio, ad-hoc B2B catalog):** first tree test of original IA scored 4.0/10 across eight tasks; revised IA re-tested at 7.4/10 on the same tasks — **+85% product findability** from label/structure changes alone, before any visual redesign.
- **New York Botanical Garden nav redesign:** card sort-in rate 48% → 70%; overall tree-test success 40% → 47%; the worst area (private events) went **0% → 60% direct success** — evidence that IA wins are often concentrated in a few catastrophically mislabeled branches.
- **UA Little Rock university site:** three iterative tree tests (A→B→C); only the third variant crossed their 80% success-rate goal. Lesson: budget for **2–3 test-iterate rounds**, not one.
- **SFG20 (Conversion Rate Experts):** navigation redesign produced +35% menu-link clicks and a 38% lift in demo requests — nav quality shows up in revenue metrics, not just usability ones.
- **Optimal Workshop dataset:** the 70%-vs-24% first-click finding above; also the practical implication that most failed journeys are decided in the first two seconds — invest in the top level.
- **Superhuman:** palette-based shortcut teaching → ~20% more shortcut usage, ~67% higher feature adoption vs self-guided onboarding.

---

## 10. Common mistakes

1. **Org-chart IA.** Nav mirrors internal team structure ("Marketing's stuff," "the tools Dave built") instead of user tasks/objects. Users don't know your org chart.
2. **Redesigning nav without touching IA.** New skin, same broken tree. If tree-test numbers wouldn't change, it's decoration.
3. **Junk-drawer categories.** "Resources," "Tools," "Other," "More" — zero scent. Every catch-all is a deferred decision users pay for. (Dan Brown: define a menu's *single* purpose before letting it serve several.)
4. **Overlapping siblings.** Two categories that could both plausibly hold the same item ("Documents" vs "Files"; "Analytics" vs "Reports"). The #1 cause of high-success/low-directness tree results.
5. **Priming your own tests.** Task text repeating the nav label; testing on teammates who built the tree; within-subjects comparison of two trees.
6. **Depth as tidiness.** Nesting to make the sidebar "clean" while adding click-tax and forcing generic parent labels. Visual grouping first, nesting last.
7. **Adaptive/reordering menus.** Frequency-sorted nav destroys spatial memory. Recents belong in a separate block.
8. **Local nav outshining global nav** (NN/g Generac case) — users lose the big map and think the product is smaller than it is.
9. **Shipping reorganizations silently** (Covert's top anti-pattern). No announcement, no redirects, no "what moved" note → trust damage exceeding the IA gain. Also: treating IA as a one-time project rather than a governed, ongoing practice; and ignoring the organically grown vocabulary already embedded in the org.
10. **New-user nav vs power-user nav conflation** (Dan Brown tradeoff #2). Onboarding scaffolding permanently occupying prime nav space, or conversely an expert-dense nav with no learnable labels. Decide who the *primary* nav serves; serve the other via search/palette/tours.
11. **Mode/portal sprawl.** Every new role or program gets its own mode until nobody knows where anything lives. Modes are for different jobs, not different permissions.
12. **Letting the security model and the IA disagree** — items visible that error on click ("you don't have access") — the worst of both hide and disable.

---

## 11. Questions Carl should ask a client

**Diagnosis**
1. "What are the 10 things people do most in this app? Walk me from login to done for the top 3 — count the clicks and the guesses."
2. "If I asked your newest team member where X lives, what would they say? Ask them; don't tell them."
3. "What do people search for (or ask in Slack) because they can't find it?" — searched/asked vocabulary vs nav labels is the fastest gap analysis.
4. "Which nav items exist because a team wanted a home, rather than because a user asked for a door?"
5. "Show me two menu items you couldn't confidently file a new feature under." (Sibling-overlap test.)

**Structure**
6. "What are the core *objects* in this business — the nouns people mention in standups? Does the nav's top level map to them?"
7. "How deep is the deepest weekly-used destination? Anything past 3 clicks that people hit daily?"
8. "For each role: is there a page they see but can't use, or need but can't see?"
9. "If we merged pages A and B tomorrow, who screams? If we split page C, who cheers?" (Ping-pong analytics answer this without opinions.)

**Process**
10. "When did you last test findability with anyone outside the building — even a 5-task tree test?"
11. "When nav last changed, how did users find out? What broke — bookmarks, muscle memory, links in docs?"
12. "Who owns naming? When two features want the same word, who decides?" (No answer = no controlled vocabulary = drift is inevitable.)
13. "What's the plan for the sidebar at 2x the current feature count?" (Forces the growth-budget conversation before it's a crisis.)

---

## Sources

- NN/g — Card Sorting: Uncover Users' Mental Models — https://www.nngroup.com/articles/card-sorting-definition/
- NN/g — Card Sorting vs. Tree Testing — https://www.nngroup.com/articles/card-sorting-tree-testing-differences/
- NN/g — Tree Testing: Fast, Iterative Evaluation of Menu Labels and Categories — https://www.nngroup.com/articles/tree-testing/
- NN/g — Tree Testing Part 2: Interpreting the Results — https://www.nngroup.com/articles/interpreting-tree-test-results/
- NN/g — Flat vs. Deep Website Hierarchies — https://www.nngroup.com/articles/flat-vs-deep-hierarchy/
- NN/g — The Difference Between Information Architecture (IA) and Navigation — https://www.nngroup.com/articles/ia-vs-navigation/
- NN/g — Local Navigation Is a Valuable Orientation and Wayfinding Aid — https://www.nngroup.com/articles/local-navigation/
- Optimal Workshop — Correct First Click Leads to 3X Higher Task Success — https://www.optimalworkshop.com/blog/correct-first-click-lead-to-3x-higher-task-success
- Dan Brown (EightShapes) — Four Tradeoffs When Designing Navigation Menus — https://medium.com/eightshapes-llc/four-tradeoffs-when-designing-navigation-menus-abbf787ae6e3
- Abby Covert — IA Heuristics — https://abbycovert.com/ia-tools/ia-heuristics/
- Abby Covert — How to Set IA Up to Fail — https://abbycovert.com/writing/how-to-set-ia-up-to-fail/
- Rosenfeld, Morville & Arango — *Information Architecture: For the Web and Beyond* (4th ed.), summarized via Archbee review — https://www.archbee.com/blog/book-review-information-architecture-for-the-web-and-beyond-by-louis-rosenfeld-peter-morville-and-jorge-arango
- OOUX / Sophia Prater — What is Object-Oriented UX — https://ooux.com/what-is-ooux
- UIE (Jared Spool et al.) — The Scent of Information — https://aycl.uie.com/virtual_seminars/the_scent_of_information_getting_users_to_their_content
- Step Two — Information scent: helping people find the content they want — https://www.steptwo.com.au/papers/kmc_informationscent/
- Human Factors International — Breadth vs. Depth (menu-depth error-rate research) — https://www.humanfactors.com/newsletters/breadth_vs_depth_we_revisit_this_question.asp
- ScienceDirect — Menu hierarchies for in-vehicle UIs: modelling the depth vs. breadth trade-off — https://www.sciencedirect.com/science/article/abs/pii/S0141938213000462
- Lyssna — Tree Testing Guide — https://www.lyssna.com/guides/tree-testing/
- Helio — Tree testing to validate navigation changes (Baileigh case) — https://helio.zurb.com/case-study/using-tree-testing-to-validate-navigation-changes-for-an-ad-management-company/
- Xavier Cuadrado — NYBG Navigation Redesign case study — https://medium.com/xavier-cuadrado/ux-case-study-nybg-navigation-redesign-dc5c7fe4afe0
- UA Little Rock — Tree Testing Results, university website redesign — https://ualr.edu/redesign/2022/06/30/tree-testing-results/
- Conversion Rate Experts — SFG20 navigation win report — https://conversion-rate-experts.com/sfg20-navigation-win-report/
- Superhuman — How to build a remarkable command palette — https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/
- Budibase — Role-Based Access Control: Ultimate Guide — https://budibase.com/blog/app-building/role-based-access-control/
- Eleken — UX navigation design: common patterns and best practices — https://www.eleken.co/blog-posts/ux-navigation-design
- UXmatters — Information Wayfinding, Part 3: Designing for Wayfinding — https://www.uxmatters.com/mt/archives/2014/03/information-wayfinding-part-3-designing-for-wayfinding-1.php
