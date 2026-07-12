---
title: "Usability Heuristics & Laws of UX"
domain: ui-ux
tags:
  - nielsen-heuristics
  - laws-of-ux
  - heuristic-evaluation
  - severity-ratings
  - response-times
  - cognitive-load
sources_reviewed: 12
last_updated: 2026-07-12
---

# Usability Heuristics & Laws of UX

## TL;DR

- **Nielsen's 10 heuristics (1994, refreshed 2020) are still the default inspection checklist.** They were distilled from factor analysis of 249 real usability problems and have not needed revision in 30+ years. Use them as the shared vocabulary for every design critique.
- **The three response-time limits are non-negotiable physics: 0.1s = feels instant, 1s = flow survives, 10s = attention is gone.** The Doherty Threshold adds a productivity target: keep system response under 400ms and users enter an "addictive" flow state.
- **A heuristic evaluation with 3–5 reviewers finds ~55–75% of usability problems in 1–2 hours each.** One reviewer alone finds only ~35%. It is the cheapest high-yield UX method that exists — Nielsen documented benefit:cost ratios of 48:1 to 62:1.
- **Rate every finding 0–4 (cosmetic → catastrophe) using frequency × impact × persistence.** Single-evaluator severity ratings are unreliable; average across at least 3 people before prioritizing.
- **Expect ~43% false positives from heuristic evaluation.** Experts flag things real users shrug off. Treat the output as hypotheses; confirm the expensive fixes with a 5-user test before building.
- **The highest-leverage laws for an ops tool or internal app: Jakob's Law (copy conventions), Tesler's Law (complexity goes somewhere — decide who eats it), Peak-End Rule (invest in the finish of every flow), Serial Position (put critical items first/last in menus).**
- **Design the empty/loading/error states first, not last.** Half the heuristics (status visibility, error prevention, error recovery, help) are about the moments teams skip.

---

## 1. Nielsen's 10 Usability Heuristics — the working reference

History: developed by Jakob Nielsen and Rolf Molich in 1990, refined by Nielsen in 1994 via factor analysis of 249 usability problems, language refreshed in 2020 with the heuristics themselves unchanged. "Heuristics" because they are broad rules of thumb, not specific guidelines — an interface can pass a checklist and still violate a heuristic.

### H1. Visibility of system status
The design keeps users informed about what is going on through appropriate feedback within a reasonable time.
- Every action gets an acknowledgment: button press states, spinners, progress bars, "Saved" toasts, upload percentages ("Uploading… 45%" in Google Drive is the canonical modern example).
- Communicate state *before* consequential actions, not just after ("You are editing the live schedule").
- Physical analog: the "You Are Here" dot on a mall map.
- **Failure smell:** user clicks twice because nothing happened the first time; user asks "did that save?"

### H2. Match between system and the real world
Speak the users' language — their words, their concepts, their mental model — never internal jargon.
- Database column names, developer abbreviations, and internal codenames leaking into the UI is the classic violation in home-grown tools.
- Order information the way the work happens, not the way the schema is organized. Stovetop analog: controls laid out to match the burners.
- Never assume your vocabulary matches users'; the fix is user research, not guessing.

### H3. User control and freedom
Users perform actions by mistake and need a clearly marked "emergency exit" — undo, redo, cancel — without a long process.
- Modern gold standards: Gmail's "Undo send" window; Figma's unlimited version history.
- Every destructive or multi-step flow needs a visible Cancel that actually aborts. Every save-ish action ideally gets undo rather than a confirmation dialog (undo is faster *and* safer — confirmations get blind-clicked).
- **Failure smell:** "be careful in that screen, there's no way back."

### H4. Consistency and standards
Users should never wonder whether different words, situations, or actions mean the same thing. Two kinds:
- **Internal consistency** — within your product/family. Same action = same label = same placement = same color everywhere. If blue means "primary action" on one screen it cannot mean "cancel" on another.
- **External consistency** — platform and industry conventions (this is Jakob's Law, below). Hotel analog: check-in counters are at the front because everyone expects them there.
- Internal tools rot here fastest: five screens built in five sprints, five different date pickers.

### H5. Error prevention
Good error messages matter, but the best designs prevent the problem entirely.
- Two error types with different cures: **slips** (right intention, wrong execution — cure with constraints, good defaults, forgiving formats) and **mistakes** (wrong mental model — cure with clearer signposting, previews, warnings).
- Prioritize preventing *high-cost* errors first (irreversible deletes, payments, published content) — guard rails on the cliff road, not everywhere.
- Practical toolkit: disable submit until required fields are valid, confirm only truly destructive actions, use date pickers over free-text dates, show a preview before publish.

### H6. Recognition rather than recall
Minimize memory load by making elements, actions, and options visible. Users should not have to remember information from one screen to use it on another.
- Easier to *recognize* that Lisbon is Portugal's capital than to *recall* it — same asymmetry drives menus beating command lines for novices.
- Show recently used items, keep context visible across steps (order summary during checkout), offer contextual inline help instead of a separate manual.
- **Failure smell:** users keep a sticky note or second tab open to complete a flow.

### H7. Flexibility and efficiency of use
Accelerators — invisible to novices — let experts move fast, so one design serves both.
- Keyboard shortcuts, bulk actions, saved filters/views, templates, personalization, "recent" lists, customizable defaults.
- This is the heuristic that distinguishes a tool people tolerate from a tool operators love. Daily-use internal software lives or dies here: a 5-click flow done 40×/day is 200 clicks; give the power user a 1-keystroke path.

### H8. Aesthetic and minimalist design
Interfaces should not contain information that is irrelevant or rarely needed — every extra unit of information competes with the relevant units and diminishes their relative visibility.
- This is about *signal-to-noise*, not about being pretty or flat. An ornate teapot whose fancy handle burns your hand is the analog.
- Dashboards are the chronic offender: every stakeholder's pet metric added, nothing ever removed. Ruthlessly ask "what decision does this element serve?"

### H9. Help users recognize, diagnose, and recover from errors
Error messages in plain language (no codes), precisely stating the problem, constructively suggesting a solution.
- Template: **what happened + why + what to do next + a shortcut to do it.** "Couldn't save — you were signed out. [Sign in again] (your changes are kept)."
- Use conventional error visuals (red, bold, near the field, not just a toast that vanishes).
- "Something went wrong" with no recourse fails this heuristic completely; so does a raw 500/stack trace.

### H10. Help and documentation
Best case: none needed. When needed: searchable, presented *in context* at the moment of need, concrete step-by-step instructions.
- Prefer just-in-time help (tooltips, empty-state guidance, inline examples of expected format) over a separate help center. Airport info-kiosk analog: help where and when the problem occurs.

**Frequency note for triage:** in most audits, the bulk of findings cluster under H1 (no feedback), H4 (inconsistency), H5/H9 (error handling), and H6 (memory burden). If you can only check four, check those.

---

## 2. Laws of UX — the cognitive laws behind the heuristics

Jon Yablonski's Laws of UX (lawsofux.com, and the O'Reilly book) collects the psychology the heuristics rest on. The six Carl reaches for most, then the supporting cast.

### Jakob's Law
"Users spend most of their time on other sites. This means users prefer your site to work the same way as all the other sites they already know."
- Consequence: your product inherits everyone else's conventions whether you like it or not. Logo top-left links home, cart top-right, search is a magnifying glass, settings is a gear.
- **Innovate on the value, standardize the chrome.** Novel navigation is a tax every user pays on every visit.
- When you *must* change a familiar pattern, let users keep the old way temporarily (transitional design) — mental models update slowly.
- For an internal app: mimic the tools the team already lives in (Notion, Trello, Gmail patterns) and training cost approaches zero.

### Miller's Law
"The average person can only keep 7 (±2) items in working memory" (George Miller, 1956).
- The real, defensible takeaway is **chunking**, not a magic number 7: organize content into meaningful groups (phone numbers, credit-card fields, grouped nav sections). Modern working-memory research puts the practical limit closer to ~4 chunks.
- Don't misuse it to cap menus at 7 items — a well-organized *visible* list of 15 beats 7 items hiding 8 more behind "More". Recognition (H6) doesn't tax working memory the way recall does.

### Tesler's Law (Conservation of Complexity)
Every application has an irreducible amount of complexity; the only question is **who deals with it — the user or the builder**.
- Larry Tesler's argument at Xerox: engineers should spend an extra week reducing complexity rather than making millions of users spend an extra minute each.
- Practical moves: smart defaults, auto-filled fields (infer card type from number), progressive disclosure, doing computation server-side instead of asking the user.
- The trap on both sides: dumping raw complexity on users, *or* over-simplifying to the point of abstraction that hides what people need (magic that can't be inspected or corrected).
- For a small team building its own tools: every shortcut you skip in the build becomes recurring labor for the operators. Complexity is conserved; interest compounds.

### Doherty Threshold
"Productivity soars when a computer and its users interact at a pace (<400ms) that ensures neither has to wait on the other." — Walter Doherty & Ahrvind Thadani, IBM Systems Journal, 1982, replacing the then-standard 2-second rule. Sub-400ms systems were described as "addicting"; associated research reported productivity gains in the 25–30% range as response time dropped.
- Takeaways from Yablonski: deliver feedback within 400ms; use perceived-performance tricks (optimistic UI, skeleton screens); use animation to occupy waits; progress bars make waits tolerable regardless of accuracy; occasionally an *intentional* delay increases perceived value/trust (e.g., a brief "scanning…" pause on a security check).

### Peak-End Rule
"People judge an experience largely by how they felt at its peak and at its end," not by the average or total (Kahneman, Fredrickson, Schreiber & Redelmeier, 1993 — "When More Pain Is Preferred to Less"). In the cold-water study, subjects preferred to repeat a *longer* trial (60s at 14°C + 30s at slightly warmer 15°C) over a shorter one, purely because it ended better.
- Design implications: identify the emotional peak (best or worst moment) and the final moment of every journey, and invest disproportionately there. Mailchimp's celebratory send-confirmation and Uber's wait-time transparency are the standard examples.
- Endings that are usually neglected: order confirmation, unsubscribe/cancel flow, support-ticket resolution, offboarding, error recovery. A great cancellation experience is remembered; it brings people back.
- Corollary: negative peaks are remembered more vividly than positive ones — kill the worst moment before polishing the best one.
- Physical-space relevance (retail, a training facility): the end of a session — checkout, goodbye, follow-up — shapes the whole visit's memory more than the middle.

### Serial Position Effect
"Users best remember the first and last items in a series" (primacy + recency; Ebbinghaus).
- Put the most important nav/menu items at the beginning and end; bury the least important in the middle.
- iOS tab bars: home first, profile/settings last, everything else between. Same logic for onboarding sequences, pitch decks, lists of plan features.

### Supporting laws worth keeping loaded

| Law | One-liner | Design use |
|---|---|---|
| **Hick's Law** | Decision time grows with the number and complexity of choices | Trim options at decision points; progressive disclosure; highlight a recommended choice |
| **Fitts's Law** | Time to hit a target = f(distance, size) | Big, close primary buttons; full-width mobile tap targets; screen edges/corners are "infinite" targets |
| **Aesthetic-Usability Effect** | Pretty interfaces are *perceived* as more usable | Visual polish buys forgiveness for minor issues — and masks them in testing; probe beyond first impressions |
| **Von Restorff Effect** | The item that differs gets remembered | Make the one primary CTA visually distinct; don't make *everything* distinct |
| **Zeigarnik Effect** | Unfinished tasks are remembered better than finished ones | Progress indicators, "complete your profile" meters, resume-where-you-left-off |
| **Goal-Gradient Effect** | Motivation accelerates near the goal | Pre-fill the first steps of a progress bar; show steps-remaining shrinking |
| **Postel's Law** | Be liberal in what you accept, conservative in what you send | Accept any phone/date format and normalize it; strict validation of *output*, forgiving *input* |
| **Choice Overload / Paradox of Choice** | Too many options suppress decisions | Curate plans/tiers to ~3; default one |
| **Pareto Principle** | ~80% of use comes from ~20% of features | Optimize the top tasks ruthlessly; demote the long tail |
| **Parkinson's Law** | Work expands to fill available time | Deadlines/timeboxes in flows (checkout hold timers) sharpen completion |
| **Paradox of the Active User** | Nobody reads the manual; they dive in | Design for exploration + in-context help, not upfront tutorials |

---

## 3. Response-time budgets (memorize this table)

Nielsen's three limits (from *Usability Engineering*, 1993; unchanged since — they're human constants, not hardware constants) plus the Doherty and input-latency layers:

| Latency | User perception | Required feedback |
|---|---|---|
| < 50ms | Real-time (typing, cursor, drag) | None — it just works |
| < 100ms | "Instantaneous"; direct manipulation illusion holds | None; just show the result |
| < 400ms | Doherty Threshold — flow state, "addicting", productivity peak | None needed; keep it here for high-frequency actions |
| < 1s | Delay noticed, but flow of thought uninterrupted | Minimal (cursor change ok). **Do not** flash a progress bar for sub-1s waits — it violates display inertia |
| 1–10s | Flow broken; user feels the computer working | Spinner/skeleton; keep user oriented |
| > 10s | Attention gone; users task-switch | **Percent-done indicator required**; visual bar beats numeric estimate; if total is unknown, stream running status (e.g., items processed); allow cancel/interruption |

Extra rules: systems can also respond *too fast* — tie animation to wall-clock time, not execution speed, so behavior is consistent across hardware. And optimistic UI (assume success, reconcile later) converts many 1–3s server operations into perceived <100ms interactions.

---

## 4. Running a heuristic evaluation — fast playbook

Heuristic evaluation is Nielsen's "discount usability engineering": experts inspect an interface against the heuristics, independently, then merge findings. No users required, days not weeks.

### The evaluator math (Nielsen & Landauer)
- Problem discovery follows `ProblemsFound(i) = N(1 − (1−λ)^i)`, with individual detection rates λ ranging 19–51%, averaging ~34%.
- **1 evaluator ≈ 35% of problems. 3 ≈ 55–60%. 5 ≈ 75%.** Diminishing returns beyond 5.
- Evaluator expertise matters: usability specialists outperform novices, and "double experts" (usability + the product's domain) find the most. If you can only get one specialist, pair them with domain-savvy teammates.
- Cost-benefit from Nielsen's case studies: one project cost $6,400 (4 evaluators) against an estimated $395,000 in benefits — **62:1**; another documented **48:1**. Even discounting the estimation method heavily, the method pays for itself absurdly fast.

### Step-by-step (fits in 2–4 working days)
1. **Scope narrowly.** One task flow, one section, one device type, one user group. "Audit the whole app" produces mush.
2. **Recruit 3–5 evaluators.** Independent is the operative word. Brief them on the 10 heuristics with example violations to calibrate; run a 15-minute practice round on some other product.
3. **Prepare a capture template.** Each finding records: location (screen + element, with screenshot), description, heuristic(s) violated, severity (leave blank for now), suggested fix.
4. **Independent passes, 1–2 hours each, two sweeps:** first pass to get the feel of the flow end-to-end; second pass element-by-element against the heuristics. No comparing notes mid-review — one confident voice anchors everyone else and you lose the whole point of multiple evaluators.
5. **Consolidate.** Merge lists, dedupe via affinity grouping, keep disagreement visible (a problem found by 4/5 evaluators is different evidence than 1/5).
6. **Severity-rate by questionnaire** (see §5): send the merged, deduped list with screenshots to every evaluator; each independently rates every problem (including ones they didn't find). ~30 minutes per person.
7. **Debrief + prioritize.** Rank by mean severity × business impact; split into fix-now / next-cycle / backlog; assign owners. Optionally brainstorm redesigns for the top items while everyone's context is hot.

### Solo/scrappy variant (for a team of one)
Honest version when you can't get 3 evaluators: expect ~35% coverage and inflated bias; still worth doing before any release. Do the two-pass walkthrough yourself with the 10-heuristic checklist, screenshot everything, self-rate severity next day (cold), and *label the output as a screening, not a verdict*. Better: recruit 2 teammates from outside the build (an operator, a support person) — different people find different problems even without UX training.

### When heuristic evaluation vs usability testing
- **HE:** early designs and prototypes, pre-launch screening, no budget/time for recruiting, sweeping up obvious violations before spending user-testing minutes on them.
- **Usability testing:** validating that flows work for real people, discovering problems experts can't predict, measuring success rates/time-on-task. Yen & Bakken's comparative work: experts detect general interface issues; end users surface the serious task-blocking obstacles.
- **Correct sequence:** HE first to clear the cheap/obvious problems, *then* test with ~5 users to find the deep ones. Never let HE substitute for user research — Nielsen's own guidance.

---

## 5. Severity ratings — Nielsen's 0–4 scale

| Rating | Label | Action rule |
|---|---|---|
| 0 | Not a usability problem | Drop (an evaluator disagreed with the finding) |
| 1 | Cosmetic | Fix only if spare time exists |
| 2 | Minor | Low priority |
| 3 | Major | High priority — important to fix |
| 4 | Catastrophe | **Imperative to fix before release** |

**Severity = frequency × impact × persistence** (+ market/brand impact as a tiebreaker):
- **Frequency:** how often is the problem encountered? (Every session vs edge case)
- **Impact:** how hard is it to overcome when hit? (Blocks the task vs slows it)
- **Persistence:** one-time learnable annoyance, or does it bite repeatedly?
- Market impact can promote an objectively minor issue: a trivial-to-fix embarrassment on the pricing page outranks a moderate glitch in an admin screen.

**Reliability rules (from Nielsen's data):**
- A single evaluator's severity ratings are *too unreliable to trust*.
- The **mean of ratings from 3 evaluators** is satisfactory for most purposes; quality improves further with more raters.
- Collect ratings *after* consolidation via questionnaire (evaluators rate all problems, not just their own finds) — during the evaluation itself, evaluators only see their fraction of the picture.
- Practical prioritization grid: plot mean severity against fix effort. Severity 3–4 / low effort = this week. Severity 3–4 / high effort = roadmap with a named owner. Severity 1–2 / high effort = usually never, and that's fine.

---

## 6. Known limitations — hold the method honestly

- **False positives are the big one: research pegs ~43% of heuristic-evaluation findings as problems real users never experience.** Causes: experts underestimating user adaptability, missing context of real use, "an extra click" flagged as critical when users don't care. Antidote: treat findings as hypotheses; verify anything expensive with a quick user test.
- **Evaluator effect:** different evaluators find substantially different problem sets and rate severity differently — which is why independence and averaging are structural requirements, not niceties. Solo evaluations quietly discard this safeguard.
- **Coverage gaps:** the heuristics were shaped by early-90s desktop software. They're thin on precision of feedback, scope of undo, what "minimalist" means, accessibility, and they predate conversational/multimodal/wearable paradigms. Supplement with Shneiderman's Eight Golden Rules or Tognazzini's First Principles when auditing modern surfaces.
- **Never formally validated:** there's no controlled evidence that heuristic compliance per se improves outcomes; the method's value is as a cheap defect-finder, not a science.
- **Measurement gap in practice:** teams fix findings and rarely re-measure satisfaction/completion afterward — close the loop or you can't tell signal from noise.

---

## 7. AI-era addendum (2023–2026)

- NN/g's position (Nielsen, "AI: First New UI Paradigm in 60 Years," 2023): generative AI shifts interaction from **command-based** (user specifies the steps) to **intent-based** (user states the outcome; system picks the path). The 10 heuristics still apply but strain in places.
- Heuristics under most pressure in AI interfaces: **H1 visibility** (what is the model doing/confident about?), **H3 control** (can I steer, edit, regenerate, roll back?), **H5/H9 errors** (hallucinations are a new error class needing design treatment — NN/g published hallucination-design guidance in 2025), plus a widely proposed new one: **transparency** about capabilities, limits, and data provenance. Microsoft's HAX Toolkit guidelines are the other standard reference here.
- Emerging practice: "synthetic heuristic evaluation" — LLMs running heuristic inspections. Early comparative studies (2025) show AI evaluators catch many surface violations quickly but share (and amplify) the false-positive problem; use as a cheap first pass feeding a human consolidation step, same pipeline as §4.

---

## 8. Common mistakes

1. **One evaluator, presented as truth.** ~35% coverage plus untrusted severity ratings; label solo audits as screenings.
2. **Comparing notes mid-evaluation.** Anchoring destroys independence — the entire statistical basis of the method.
3. **Shipping the raw findings list.** 43% false-positive rate means an unfiltered dump erodes the team's trust in UX input. Consolidate, rate, verify the expensive ones.
4. **Auditing everything at once.** Unscoped evaluations produce shallow, unactionable output. One flow at a time.
5. **Treating Miller's 7±2 as a menu-length law.** It's about working memory and chunking; visible organized lists don't tax working memory.
6. **Confirmation dialogs instead of undo.** Confirmations get blind-clicked (habituation); undo is both faster and safer (H3 + H5).
7. **Progress bars on sub-second operations** — violates display inertia and makes fast things feel slow; conversely, >10s operations *without* percent-done indicators.
8. **Polishing the peak while the ending rots.** Peak-End says the cancellation flow, the error recovery, and the confirmation screen shape memory more than the middle of the funnel.
9. **Consistency debt in internal tools.** Every screen built ad hoc; five date pickers, three words for the same object. Cheap fix: a one-page pattern glossary (this word, this component, this placement — always).
10. **Using aesthetic polish as evidence of usability.** The Aesthetic-Usability Effect means pretty products get benefit of the doubt in reviews *and* in user testing — probe task success, not vibes.
11. **Severity assigned by whoever shouts loudest.** Use the questionnaire method and the frequency/impact/persistence rubric or prioritization becomes politics.
12. **Fixing findings and never re-measuring.** Without a post-fix check (task success, support tickets, completion rate) you can't distinguish real improvements from expert taste.

---

## 9. Questions Carl should ask

**Diagnosing an interface (any product, any client):**
- "Walk me through your most frequent task. How many clicks/seconds? How many times a day does someone do it?" (H7 / Pareto — accelerate the top task first)
- "What happens on this screen when the network is slow, the list is empty, or the save fails?" (H1/H9 — the skipped states)
- "Show me something a user can't undo. Why can't they?" (H3/H5)
- "Do the same actions have the same names and locations everywhere in the product?" (H4 — ask them to prove it with two screens side by side)
- "What words in this UI would a brand-new hire not understand on day one?" (H2)
- "What does the user have to remember from a previous screen to finish this flow?" (H6)
- "Which interactions take longer than 400ms? Than 1 second? What feedback shows during them?" (§3)
- "What's the last thing a user sees at the end of this flow? Is it designed or is it a default?" (Peak-End)
- "What's the single worst moment in the whole journey?" (kill the negative peak first)

**Diagnosing the team's process:**
- "When did anyone last watch a real user complete a task in this product, start to finish?"
- "Who evaluated this design, and did they do it independently before comparing notes?"
- "How are you deciding fix order — severity rubric, or loudest stakeholder?"
- "Which of the current backlog's UX bugs are severity 3–4 by frequency/impact/persistence — and which are just expert taste?"
- "If I gave you two hours and two colleagues, could you run a scoped heuristic pass on [top revenue flow] this week?" (there is almost never a good reason not to)

**For a small media company / facility-type client specifically:**
- "Your internal tool is used by the same 5–10 people daily — where are the keyboard shortcuts, bulk actions, and saved views?" (H7 dominates when users are experts by week two)
- "Does your booking/checkout/signup match the conventions of the big platforms your customers already use?" (Jakob's Law: borrow Calendly's/Shopify's patterns, don't invent)
- "What does a member remember from their last visit or last support interaction — and did you design that ending on purpose?" (Peak-End applies to physical service experiences as much as screens)

---

## Sources

- Nielsen Norman Group — 10 Usability Heuristics for User Interface Design: https://www.nngroup.com/articles/ten-usability-heuristics/
- Nielsen Norman Group — How to Conduct a Heuristic Evaluation: https://www.nngroup.com/articles/how-to-conduct-a-heuristic-evaluation/
- Nielsen Norman Group — The Theory Behind Heuristic Evaluations (evaluator curve, cost-benefit): https://www.nngroup.com/articles/how-to-conduct-a-heuristic-evaluation/theory-heuristic-evaluations/
- Nielsen Norman Group — Severity Ratings for Usability Problems: https://www.nngroup.com/articles/how-to-rate-the-severity-of-usability-problems/
- Nielsen Norman Group — Response Times: The 3 Important Limits: https://www.nngroup.com/articles/response-times-3-important-limits/
- Laws of UX (Jon Yablonski) — full index: https://lawsofux.com/
- Laws of UX — Peak-End Rule (Kahneman et al. 1993 study detail): https://lawsofux.com/peak-end-rule/
- Laws of UX — Doherty Threshold (Doherty & Thadani 1982): https://lawsofux.com/doherty-threshold/
- UXPA Magazine — Nielsen's Heuristic Evaluation: Limitations in Principles and Practice: http://uxpamagazine.org/nielsens-heuristic-evaluation/
- UX Psychology — Heuristic evaluation vs. user testing (43% false-positive finding): https://uxpsychology.substack.com/p/heuristic-evaluation-vs-user-testing
- Maze — How to Conduct a Heuristic Evaluation (checklist/process): https://maze.co/guides/usability-testing/heuristic-evaluation/
- UX/UI Principles — Doherty Threshold: 400ms Response Time (productivity figures): https://uxuiprinciples.com/en/principles/doherty-threshold
