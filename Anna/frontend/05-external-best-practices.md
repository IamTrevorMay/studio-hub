---
title: External Best Practices — the wider industry consensus, mapped to this repo
last_updated: 2026-07-15
tags: [frontend, external, best-practices]
---

# External best practices (2025–2026), applied to Mayday Studio

This doc is the **outside view**. The other four frontend docs (`01-react-patterns`,
`02-style-system`, `03-forms-modals-tables`, `04-perf-render`) describe *how this repo does it*.
This one describes *how the industry says it should be done* right now, cites the sources, and then
says honestly where Mayday Studio complies, where it diverges, and whether the divergence is
defensible. When the two disagree, the repo docs win for "what to match today" — but Anna should
know the gap and its cost, because that's what separates a change that fits from a change that
quietly accrues debt.

The one-line thesis: **most of this repo's frontend conventions are already aligned with 2025 best
practice** (state colocation via `useState`-per-concern, `useCallback`/`useMemo` used deliberately,
Realtime backoff, module-level style objects). The three real gaps are (1) Create React App is now
formally deprecated and unmaintained, (2) there is zero route-level code splitting, and (3) the
design-token system is half-adopted with a **non-existent** lint rule advertised as if it enforces
it. All three are defensible for an internal tool of this size today; all three have a rising cost.

---

## 1. React 18 patterns — memoization, colocation, re-render storms

### Best practice
The current consensus (post-React-Compiler-1.0, Oct 2025) is: **structure first, memoize second, and
only when profiling proves it.** State colocation — keeping state as close as possible to where it's
read — is more effective than reflexively wrapping things in `useMemo`/`useCallback`, and lifting or
splitting components to change *what* re-renders often removes the need to memoize at all
([Josh Comeau, "Understanding useMemo and useCallback"](https://www.joshwcomeau.com/react/usememo-and-usecallback/);
[DebugBear](https://www.debugbear.com/blog/react-usememo-usecallback)). The sharp rules:

- **`useCallback` does nothing for render perf on its own** — it only matters when the function is a
  dependency of an effect, or a prop to a `React.memo`'d child, or compared by reference elsewhere.
  A stable function passed to a plain (non-memoized) child buys nothing
  ([DebugBear](https://www.debugbear.com/blog/react-usememo-usecallback);
  [DEV: "What optimizations actually work"](https://dev.to/crit3cal/usememo-usecallback-reactmemo-what-optimizations-actually-work-gkp)).
- **`useMemo` earns its keep on genuinely expensive derivations or referentially-stable objects** —
  for cheap arithmetic it's net-negative (memory + complexity)
  ([oneuptime](https://oneuptime.com/blog/post/2026-01-15-optimize-react-rerenders-usememo-usecallback/view)).
- **`React.memo` only when DevTools shows a component re-rendering many times per interaction with
  rarely-changing props** — and only if you can guarantee stable props, or the shallow compare fails
  every render and you've added overhead for zero benefit
  ([Strapi, "React.memo 2025 guide"](https://strapi.io/blog/react-memo-optimize-functional-components-guide);
  [DEV](https://dev.to/crit3cal/usememo-usecallback-reactmemo-what-optimizations-actually-work-gkp)).
- **React Compiler 1.0 (Oct 2025)** now auto-inserts memoization, which is why the manual-memo
  discourse is cooling — but it requires a Babel/build plugin the repo does not run
  ([DebugBear](https://www.debugbear.com/blog/react-usememo-usecallback)).

### Applied to Mayday Studio
The repo is **already aligned in intent, misaligned in structure**. `useCallback` (471 uses) is
applied exactly where best practice says it should be — as a stable dep for
`useEffect`/`useVisibilityRefresh` on `fetch*` functions (`04-perf-render.md §3`) — which is the one
place a plain-child app genuinely needs it. `React.memo` at 0 uses is *not* a smell here; it's the
correct call given the giant-page architecture (memoizing a child inside a monolith that re-renders
wholesale on every keystroke buys nothing).

The divergence is **structural, and it's the real one**: the 100–200KB single-file pages
(`Deliverables.js` ~171KB, `BusinessDev.js` ~157KB) hold dozens of `useState` in one component, so
every keystroke re-renders the entire page tree — the exact "restructure instead of memoize"
situation the sources describe, except here restructuring is deferred (`audit_phase6_page_splits`).
State colocation *is* practiced at the small scale (`useState`-per-concern), but violated at the
large scale (all that state lives in one component). **Anna's takeaway:** the correct fix is the one
the repo already endorses — extract self-contained sections into child components so a widget's state
change renders in isolation (`04-perf-render §1`), not sprinkle `React.memo`. Consider proposing
React Compiler adoption *only after* a Vite migration (below), since it needs a build-plugin the CRA
config doesn't cleanly host.

---

## 2. Large-app performance on CRA/Craco — code splitting, bundling, the CRA sunset

### Best practice
Two hard facts define this space in 2026:

1. **Create React App is deprecated and unmaintained.** The React team formally sunset it on
   2025-02-14: no active maintainers, no new features, no security updates, and it "makes it
   difficult to build high-performance production applications." The official guidance is to move to
   a framework (Next.js, React Router) or, for SPA/custom setups, a build tool — **Vite, Parcel, or
   RSBuild**. React's own writeup calls out that CRA ships a single large bundle, lacks integrated
   code-splitting, and that even `React.lazy` in CRA causes network waterfalls because splitting
   isn't integrated with routing/data-loading
   ([React blog, "Sunsetting Create React App"](https://react.dev/blog/2025/02/14/sunsetting-create-react-app);
   [devclass](https://devclass.com/2025/02/18/react-team-formally-deprecates-create-react-app-following-perfect-storm-of-incompatibility/)).
   Vite's esbuild-based dev server is 10–100× faster to start than CRA's webpack setup
   ([Nandann migration guide](https://www.nandann.com/blog/vite-replaces-cra-react-migration-guide-2025)).

2. **Route-based code splitting is the highest-leverage bundle win.** Splitting a typical SPA by
   route commonly cuts the initial bundle **40–70%**. The pattern: `React.lazy` turns a static import
   into a promise-based chunk, `Suspense` shows a fallback while it resolves, and the boundary sits at
   a natural loading unit (route, panel, card) — not the leaf. Bundle-analysis targets: anything
   >30–50KB that doesn't render in the first viewport — authenticated dashboards, admin charts,
   WYSIWYG editors
   ([greatfrontend](https://www.greatfrontend.com/blog/code-splitting-and-lazy-loading-in-react);
   [oneuptime](https://oneuptime.com/blog/post/2026-01-15-react-code-splitting-lazy-loading/view)).

### Applied to Mayday Studio
This is where the repo diverges most sharply from current best practice, and the honest read is:
**defensible today, rising cost.**

- **CRA/Craco is unmaintained.** The repo runs CRA + Craco (`CLAUDE.md` stack, `architecture/07`).
  It works, and Craco lets it patch webpack (Tailwind scoped to the doc-editor), but it's on a dead
  runtime with no security updates. This is a strategic debt, not a bug. A Vite migration is the
  industry-endorsed exit; the friction to watch is `REACT_APP_*` → `VITE_*` env-var renames and
  `index.html` moving from `public/` to project root
  ([Nandann](https://www.nandann.com/blog/vite-replaces-cra-react-migration-guide-2025)).
- **Zero route-level splitting.** `App.js:19-24` lazy-loads only the desktop/mobile `AppLayout`
  shell + two public pages; inside a layout **every page is statically imported**
  (`AppLayout.js:11-40`), so the whole app bundle loads up front (`04-perf-render §1`). With
  ~40 pages several of which are 100–200KB, this is a textbook 40–70%-initial-bundle-reduction
  opportunity going unclaimed. **Is the divergence defensible?** Partially. This is an internal,
  authenticated, staff-facing tool — users log in once and keep a tab open for hours, so a large
  first-load matters far less than it would on a public marketing site, and the app already
  code-splits the biggest fork (desktop vs mobile layout). But the giant admin pages
  (`Deliverables`, `BusinessDev`, `Production`) are exactly the ">30–50KB, not in first viewport,
  admin-only" chunks the guidance says to lazy-load, and most users never open most of them. **Anna's
  recommendation:** the cheap, non-controversial win — even without a Vite migration — is converting
  the static page imports in `AppLayout.js` to `React.lazy` + `Suspense`, gated per `activeTab`. It's
  low-risk (the router is already tab-keyed), needs no framework change, and directly reclaims the
  initial-bundle cost. Do it before, and independently of, any CRA→Vite decision.

---

## 3. Inline-style / design-token systems — tiers, enforcement, and the phantom lint rule

### Best practice
Mature token systems are **three-tiered**: **primitive** (raw values — `#6366f1`, `4px` — the full
palette, no context), **semantic** (maps primitives to intent — `color.action.primary`,
`color.text.muted` — this is the theming layer), and optional **component** (per-component overrides).
The load-bearing rule: **application code consumes *semantic* tokens, not primitives** — primitives
are raw values without design intent and don't participate in theming; direct-primitive use is
reserved for genuine exceptions like data-viz palettes
([Design System Problems, "Token tier system"](https://designsystemproblems.com/token-management/token-tier-system/);
[Contentful, "Design token system"](https://www.contentful.com/blog/design-token-system/)).

Enforcement is what separates a token system that holds from one that erodes: build-time reference
validation plus **linters that flag direct primitive references in application code, demanding a
semantic token or an explicit override justification**
([Design System Problems](https://designsystemproblems.com/token-management/token-tier-system/)).
Without CI enforcement, a token system decays to a suggestion. The trade-off framing vs alternatives:
an inline-style token object is a lightweight CSS-in-JS variant — you keep co-located styles and
runtime theming but forgo the atomic-class dedup and build-time purge that Tailwind gives, and (unlike
a CSS-variable token layer) you get no free cascade-based theming.

### Applied to Mayday Studio
The repo has a **genuinely good token file with two real problems: partial adoption and a lie in the
header comment.**

- **Tiering.** `styleTokens.js` is effectively primitive+semantic collapsed into one layer:
  `colors.accent` (`#6366f1`) is a primitive, but `colors.textMuted`/`colors.borderFocus` and the
  `success/warning/danger/info` tone triples are semantic (`02-style-system §colors`). The recipes
  (`card`, `pill`, `button`, `modal`) are effectively the *component* tier. So the three tiers exist
  in spirit — this is better than most hand-rolled systems. What's missing is the discipline that
  app code reference *semantic* names: the token file still exposes raw primitives (`colors.accent`)
  that pages reach for directly, and there's no separation preventing it.
- **Partial adoption (~39 files).** The newer surfaces (`analytics/viz/*`, `tools/**`,
  `UnifiedBoard.js`, `AgencyPortal.js`, `AgencyThread.js`) import tokens; the big legacy pages
  hardcode `rgba(255,255,255,0.x)` and hex literals in their `const styles = {}` blocks
  (`02-style-system §"adoption is partial"`). Per best practice this is exactly the erosion that
  happens without enforcement.
- **The phantom lint rule — a real defect Anna should call out.** `styleTokens.js:4` names a lint
  rule **`mayday/no-style-magic-numbers`** as backing the tokens-only rule, **but that ESLint rule
  is not wired into any eslint config on disk** (confirmed in `review/03-style-compliance.md` and
  the README audit list). The real check is the standalone `npm run lint:styles` script
  (`scripts/lint-styles.js`) — so style is *script- + review-enforced, not ESLint/CI-enforced.* This is the single clearest divergence from
  the 2025 token-enforcement consensus: the system advertises enforcement it doesn't have. **Anna's
  takeaway:** treat the tokens-only rule as a human-review gate, not a guaranteed invariant — and
  the highest-value token improvement isn't more tokenizing, it's *making the advertised lint rule
  real* (or deleting the false claim). A simple custom ESLint rule flagging raw hex / `rgba(` / off-
  scale px literals inside `style={}` and `const styles` objects would convert the convention from
  aspiration to guarantee, which is precisely the enforcement layer the sources say a token system
  needs to survive.

**Defensible?** The inline-style-object choice itself is fine and coherent for this app (co-located,
runtime-themeable, no build step). The partial adoption is defensible *as a migration state* — new
code uses tokens, legacy is left alone unless touched. The phantom lint rule is **not** defensible;
it's a documentation defect that misrepresents the system's guarantees.

---

## 4. Realtime UI hygiene — lifecycle, backoff, optimistic updates, leaks

### Best practice
For Supabase Realtime specifically, the 2025–2026 production guidance is unusually clear:

- **Do not hand-roll reconnection.** The client already does exponential backoff (1s → 2s → 4s → …
  capped ~30s). Rolling your own retry on top of it schedules *two* competing retries — a common
  cause of duplicate events and reconnect storms. Use the four channel status values
  (`SUBSCRIBED`/`CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED`) to drive **UI state** (a "reconnecting"
  indicator), not to trigger reconnect code
  ([BetterLink, "Supabase Realtime in Practice"](https://eastondev.com/blog/en/posts/dev/20260512-supabase-realtime-practice/);
  [Supabase Realtime troubleshooting](https://supabase.com/docs/guides/realtime/troubleshooting)).
- **Leaks come from uncleaned timers and non-unique channel names** — the latter causes races and
  duplicate events; the former keeps firing setters on unmounted trees
  ([BetterLink](https://eastondev.com/blog/en/posts/dev/20260512-supabase-realtime-practice/)).
- **Match the mechanism to the data.** Broadcast for high-frequency ephemera (cursors, typing,
  >10 events/s/user); Postgres Changes for durable data where 50–200ms latency is fine because the
  write already committed
  ([agilesoftlabs](https://www.agilesoftlabs.com/blog/2026/05/supabase-realtime-in-production-what)).
- **Optimistic updates**: apply locally, reconcile on the server echo; because the Postgres-Changes
  event only fires *after* a durable write, it's a natural reconciliation point.

### Applied to Mayday Studio
This is the area where the repo is **most fully aligned** — arguably ahead of the median Supabase
app. `useRealtimeTable.js` already implements the recommended shape (`04-perf-render §4`): teardown
on unmount, an `enabled` gate, opts-in-a-ref so changing callbacks don't tear down the channel, and
**exponential-backoff resubscribe (1s→30s cap) on `CHANNEL_ERROR`/`TIMED_OUT`**. The one nuance
worth flagging against the source guidance: the sources warn that custom retry can *conflict* with
the client's built-in backoff — so Anna should confirm `useRealtimeTable`'s resubscribe fires only
on the terminal states after the client has given up, not in parallel with the SDK's own retry, to
avoid the double-schedule bug. Channel-teardown discipline is tracked (32 `channel(` ↔ 36
`removeChannel` sites), and the repo already does the "match mechanism to RLS reality" move
(Agency portal polls every 20s because deliverable rows are outside its RLS read set and thus emit no
`postgres_changes`). The `refreshKey` re-subscribe-after-reconnect pattern (`AuthContext.js:437`)
correctly handles the socket-flap-after-tab-away case that the sources call out as a silent-dead-
channel trap. **Verdict: compliant; the only follow-up is verifying no double-retry against the SDK's
own backoff.**

---

## 5. Accessibility + dark-theme contrast for data-dense internal tools

### Best practice
- **WCAG 2.2 is the normative floor**: 4.5:1 for normal text, 3:1 for large text and UI components,
  and the new **SC 2.4.11 Focus Appearance** requires focus indicators at ≥3:1 against adjacent
  colors. APCA is *not* yet normative — it's a proposal, so compliance still means WCAG 2.2
  ([WebAIM contrast](https://webaim.org/articles/contrast/);
  [accessibilityassistant WCAG 2.2](https://accessibilityassistant.com/blog/accessibility-insights/how-to-apply-wcag-22-colour-contrast-accessibility/)).
- **Dark mode is not an inversion of light mode.** Bright, saturated text on near-black backgrounds
  can *pass* WCAG ratios yet cause **halation** (text bleeding/glowing) and eye strain. The
  guidance: soften the off-white text, reduce saturation, and slightly *elevate* the background tone
  above pure black — and sanity-check body text and key controls with APCA even when they pass WCAG,
  because thin fonts, anti-aliasing, and translucent overlays make "compliant" ratios feel weaker in
  practice ([Humbl Design, "Color & Contrast: WCAG 2.2 and APCA"](https://humbldesign.io/blog-posts/color-accessibility-guide-wcag);
  [Primer color considerations](https://primer.style/accessibility/design-guidance/color-considerations/)).
- For **data-dense** UIs specifically: treat WCAG minimums as a floor, aim above it for body text,
  and be wary of translucent overlays layered over data.

### Applied to Mayday Studio
The dark palette is thoughtfully built for exactly the halation problem the sources warn about, and
**mostly complies**, with two areas to watch:

- **Background is elevated, not pure black.** `colors.bg` is `#0f0f1a` (not `#000`) with raised
  surfaces at `rgba(255,255,255,0.04)` (`02-style-system §colors`) — this is precisely the
  "slightly elevated background tone" the guidance recommends to reduce halation. Primary text is
  pure `#fff`, which on `#0f0f1a` is a very high ratio — arguably *too* high per APCA's halation
  caution, but defensible.
- **The alpha-tiered muted-text scale is the risk.** Text hierarchy is `rgba(255,255,255,α)` with
  α = 0.7 / 0.5 / 0.4 / 0.3 / (placeholder) 0.3. Against `#0f0f1a`, `textDim` (0.4) and
  `textPlaceholder` (0.3) will **fail WCAG 4.5:1 for normal body text** — they're fine for large or
  decorative metadata but must not carry meaning at small sizes. Anna should verify any *small,
  meaningful* text (labels, metadata that a user must read) uses `textMuted`/`textSubtle`, not
  `textDim`/`textPlaceholder`. This is the most likely real accessibility gap in the palette.
- **Focus appearance (SC 2.4.11).** `colors.borderFocus` (`rgba(99,102,241,0.5)`) exists, but the
  spec requires ≥3:1 against *adjacent* colors — against the near-black inputs this indigo is likely
  fine, but it's worth an explicit check, and Anna should ensure interactive controls actually render
  a visible focus indicator (inline-style apps easily drop the browser default `:focus` ring without
  re-adding one). Keyboard focus visibility is the most commonly-missed criterion in internal tools.

**Defensible?** For an internal staff tool the bar is lower than a public product, and the palette's
foundations (elevated bg, alpha-tiered hierarchy) are sound. The two concrete things to enforce in
review: (1) small meaningful text never uses `textDim`/`textPlaceholder`, and (2) every interactive
control has a visible focus state meeting 3:1.

---

## Where the repo is ahead, where it's behind (one-screen summary)

| Area | Industry best practice (2025–26) | Repo status | Defensible? |
|---|---|---|---|
| Memoization | Structure first; memo when profiled | `useCallback` used correctly; `React.memo` avoided | ✅ Yes — matches guidance |
| Component structure | Colocate/split to reduce re-render scope | Giant single-file pages re-render wholesale | ⚠️ Migration in progress (`audit_phase6`) |
| Build tool | CRA deprecated → Vite/Next | CRA + Craco (unmaintained) | ⚠️ Works, but dead runtime, no security updates |
| Code splitting | Route-split for 40–70% initial-bundle cut | Zero route splitting; all pages static-imported | ⚠️ Internal tool softens it; still a cheap win left on table |
| Token tiers | Primitive→semantic→component, semantic-only in app | Tiers exist; primitives exposed; ~39/all files adopted | ⚠️ Defensible as migration state |
| Token enforcement | Lint/CI flags primitive use | **Advertised rule doesn't exist** — review-only | ❌ Documentation defect |
| Realtime | SDK backoff, no hand-rolled retry, teardown | `useRealtimeTable` does all of this | ✅ Fully aligned |
| Dark contrast | Elevated bg, softened text, WCAG 2.2 floor | Elevated bg ✅; low-alpha text risks failing 4.5:1 | ⚠️ Guard small meaningful text + focus rings |

**Top 3 concrete frontend improvements** (in leverage order):
1. **Lazy-load pages in `AppLayout.js`** (`React.lazy` + `Suspense`, gated per `activeTab`) — a
   low-risk 40–70% initial-bundle reduction that needs no framework change.
2. **Make `mayday/no-style-magic-numbers` real** (a custom ESLint rule flagging raw hex/`rgba(`/off-
   scale px in `style={}`), or delete the false claim — convert the token system from aspiration to
   guaranteed invariant.
3. **Audit low-alpha text + focus visibility** against WCAG 2.2 — ensure `textDim`/`textPlaceholder`
   never carry small meaningful text and every control has a ≥3:1 visible focus state.

Longer-horizon strategic item, not urgent: **plan a CRA→Vite migration** to get off the unmaintained
build tool (and unlock React Compiler). Track it, don't rush it.

---

## Sources

React patterns & memoization:
- Josh W. Comeau — *Understanding useMemo and useCallback* — https://www.joshwcomeau.com/react/usememo-and-usecallback/
- DebugBear — *Improve React Performance With useMemo And useCallback* — https://www.debugbear.com/blog/react-usememo-usecallback
- DEV (crit3cal) — *useMemo, useCallback, React.memo — What Optimizations Actually Work* — https://dev.to/crit3cal/usememo-usecallback-reactmemo-what-optimizations-actually-work-gkp
- Strapi — *React.memo: Your 2025 Performance Optimization Guide* — https://strapi.io/blog/react-memo-optimize-functional-components-guide
- oneuptime — *How to Optimize React Re-Renders with useMemo and useCallback* — https://oneuptime.com/blog/post/2026-01-15-optimize-react-rerenders-usememo-usecallback/view

CRA sunset, Vite, code splitting:
- React blog — *Sunsetting Create React App* — https://react.dev/blog/2025/02/14/sunsetting-create-react-app
- devclass — *React team formally deprecates Create React App* — https://devclass.com/2025/02/18/react-team-formally-deprecates-create-react-app-following-perfect-storm-of-incompatibility/
- Nandann — *Why Vite Replaced CRA: The 2025 React Migration Guide* — https://www.nandann.com/blog/vite-replaces-cra-react-migration-guide-2025
- greatfrontend — *Implementing Code Splitting and Lazy Loading in React* — https://www.greatfrontend.com/blog/code-splitting-and-lazy-loading-in-react
- oneuptime — *How to Implement Code Splitting and Lazy Loading in React* — https://oneuptime.com/blog/post/2026-01-15-react-code-splitting-lazy-loading/view

Design tokens & enforcement:
- Design System Problems — *Token Tier System Architecture* — https://designsystemproblems.com/token-management/token-tier-system/
- Contentful — *Design tokens explained (and how to build a design token system)* — https://www.contentful.com/blog/design-token-system/

Realtime hygiene:
- BetterLink Blog — *Supabase Realtime in Practice: WebSocket Connection Management and Reconnection Strategies* — https://eastondev.com/blog/en/posts/dev/20260512-supabase-realtime-practice/
- Supabase Docs — *Realtime Troubleshooting* — https://supabase.com/docs/guides/realtime/troubleshooting
- AgileSoftLabs — *Supabase Realtime in Production: What Nobody Tells You* — https://www.agilesoftlabs.com/blog/2026/05/supabase-realtime-in-production-what

Accessibility & dark-theme contrast:
- WebAIM — *Contrast and Color Accessibility* — https://webaim.org/articles/contrast/
- accessibilityassistant — *How to apply WCAG 2.2 colour-contrast accessibility* — https://accessibilityassistant.com/blog/accessibility-insights/how-to-apply-wcag-22-colour-contrast-accessibility/
- Humbl Design — *The 2026 Engineering Guide to Color & Contrast: Systems, WCAG 2.2, and APCA* — https://humbldesign.io/blog-posts/color-accessibility-guide-wcag
- GitHub Primer — *Color considerations* — https://primer.style/accessibility/design-guidance/color-considerations/
