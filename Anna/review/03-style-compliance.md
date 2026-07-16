---
title: Style-System & Convention Compliance (Mayday Studio)
last_updated: 2026-07-15
tags: [review, style, conventions, tokens]
---

# Style-System & Convention Compliance

Enforces standing user preferences. These are LOW severity for *correctness* but are a hard reject on the user's explicit instruction: **use tokens + recipes from `src/lib/styleTokens.js` / `src/lib/styleRecipes.js`, never hardcode style values.** Anna flags every violation but frames them as convention fixes, not bugs.

---

## The style system

**All styling is inline `style={}` objects. No Tailwind classes in JSX.** (Project convention; CLAUDE.md.) Colors and shapes come from tokens/recipes.

### `styleTokens.js` — what's available
- `colors` — surfaces (`bg` `#0f0f1a`, `bgRaised`, `bgHover`, `bgInput`, `bgModal`, `bgOverlay`), borders (`border`, `borderStrong`, `borderFocus`), text (`text` `#fff`, `textMuted` .7, `textSubtle` .5, `textDim` .4, `textPlaceholder` .3), accent indigo (`accent` `#6366f1`, `accentSoft`, `accentFg`, `accentBorder`), and semantic tones `success`/`warning`/`danger`/`info` each as `{bg,border,fg,fgSoft}`.
- `spacing` — 4px scale: `xs:4 sm:8 md:12 lg:16 xl:20 xxl:24 xxxl:32 huge:48`. Don't pick 5/7/9/etc.
- `radii` — `xs:4 sm:6 md:8 lg:10 xl:14 pill:999 circle:'50%'`.
- `fontSizes` — `xxs:10 xs:11 sm:12 md:13 lg:14 xl:16 xxl:18 display:22`.
- `fontWeights` — `regular:400 medium:500 semibold:600 bold:700`.
- `fontFamily` — `"DM Sans", system-ui, …`.
- `shadows`, `transitions` (`fast:120ms normal:200ms slow:320ms`), `zIndex` (`dropdown:100 popover:200 toast:900 modal:1000`).

### `styleRecipes.js` — factories (prefer over hand-rolling)
`card(variant|opts)` (`default`/`muted`/`accent`/tone) · `pill(tone)` · `badge(tone)` · `button({variant,size,disabled})` (variants `primary`/`secondary`/`ghost`/`danger`; sizes `sm`/`md`/`lg`) · `input({size})` · `sectionHeader(level)` · `modalOverlay()` · `modal({width})`. If a variant is missing, **extend the recipe here**, don't override in the page.

> Note: the `styleTokens.js` header references an ESLint rule `mayday/no-style-magic-numbers` and `memory/planning/style-system.md`. That lint rule is **not actually wired up in this repo** (no root eslint config enforces it), so compliance is review-enforced, not machine-enforced. Don't cite the rule as if CI catches it.

---

## Compliance checklist — "smell → fix"

### 1. Hardcoded values that should be a token
- [ ] **Hex color literal** in a style object → map to `colors.*`. Smell: `color: '#6366f1'` → **fix:** `color: colors.accent`. `background: '#0f0f1a'` → `colors.bg`. `#15151f` → `colors.bgModal`. `rgba(255,255,255,0.7)` → `colors.textMuted`.
- [ ] **Off-scale px** for padding/margin/gap/radius → nearest `spacing.*` / `radii.*`. Smell: `padding: 7` or `gap: 15` → **fix:** `spacing.sm`/`spacing.lg`. `borderRadius: 12` → `radii.xl`? No — 12 isn't on the ramp; pick the intended token (`radii.lg`=10 or `radii.xl`=14) or add it to `radii` with a reason.
- [ ] **Raw font-size / weight** → `fontSizes.*` / `fontWeights.*`. `fontSize: 13` → `fontSizes.md`; `fontWeight: 600` → `fontWeights.semibold`.
- [ ] **Inline transition/shadow/zIndex literal** → `transitions.*` / `shadows.*` / `zIndex.*`. `zIndex: 1000` on a modal → `zIndex.modal`.

**Reject if:** a diff introduces a new hex, off-4px-grid spacing, or raw font size/weight where an existing token covers it.

### 2. Tailwind className usage — forbidden
- [ ] **No Tailwind utility classes in JSX.** Smell: `className="flex items-center gap-2 text-white"` → **fix:** inline `style={{ display:'flex', alignItems:'center', gap: spacing.sm, color: colors.text }}`. (`className` for a plain semantic hook or a global CSS class that already exists is fine; Tailwind *utility* strings are not.)

**Reject if:** any Tailwind utility className appears in a changed JSX file.

### 3. Missing use of an existing recipe
- [ ] Hand-rolled card/pill/button/input/modal shape that duplicates a recipe → call the recipe. Smell: a `{background: colors.bgRaised, border: '1px solid '+colors.border, borderRadius: radii.lg, padding: spacing.lg, boxShadow: shadows.md}` object → **fix:** `card('default')`. A pill built inline → `pill(tone)`. A modal overlay div → `modalOverlay()` + `modal({width})`.
- [ ] Recipe needs a new variant → extend `styleRecipes.js`, don't spread-override in the page (`{...button(), background:'purple'}` is a smell).

### 4. Color constants not using the `*_COLORS` pattern
- [ ] Status/type→color maps live as **module-level objects** named `*_COLORS` (`STATUS_COLORS`, `EVENT_TYPE_COLORS`, etc.), defined at the top of the page file; the `styles` object lives at the bottom. A per-render inline `switch(status){case ...}` returning colors, or a color map declared inside the component body, is a smell → hoist to a module-level `const STATUS_COLORS = {...}` built from `colors.*` tones.

### 5. displayName usage (social vs admin)
- [ ] **Social/communication context** (chat, DMs, posts, comments, channel rosters, mentions, header user widget) must render `getDisplayName(profile)` / `getDisplayInitial(profile)` from `src/lib/displayName.js` — so a user's `nickname` shows. Smell: `profile.full_name` (or `.full_name.split(' ')[0]`) in a chat/comment/mention → **fix:** `getDisplayName(profile)`.
- [ ] **Admin context** (Payroll, Assignments, Workflows, Business Dev, invoices, legal) intentionally keeps `profile.full_name` — that's the legal name. Do **not** "fix" those to `getDisplayName`. If unsure which context, that's the judgment call to flag, not auto-change.
- [ ] Bonus: `getDisplayName` null-guards `profile`/`full_name` — replacing a raw `.full_name.split()` also removes a crash on missing profile.

### 6. Commit hygiene
- [ ] **`node_modules/` changes must NOT be committed.** They show up in `git status` as local package drift and are normal — but staging/committing them is a reject. Smell: a diff touching `node_modules/**` or `.package-lock.json` under node_modules → **fix:** unstage; only `package.json` + root `package-lock.json` intentional changes belong in a commit.
- [ ] **Never auto-commit or auto-push.** Standing instruction: wait for the user to explicitly ask. A review should never end by committing. Feature branches use `claude/*` prefix when automated.
- [ ] **No `.env` / secrets** in the commit (see `02-security-review.md` Layer 3).

---

## "Reject if" quick rules
- Introduces a hex/px/font literal that an existing token covers.
- Uses a Tailwind utility `className` in JSX.
- Hand-rolls a shape that `card`/`pill`/`button`/`input`/`modal` already provides.
- Declares a status→color map inline instead of a module-level `*_COLORS` const.
- Uses `profile.full_name` in a social context instead of `getDisplayName`.
- Stages `node_modules/**` changes, or commits/pushes without an explicit request.
- Adds a token-worthy value to a page instead of extending `styleTokens.js`/`styleRecipes.js`.

Frame all of these as convention fixes (LOW), listed after any correctness/security findings from docs 01 and 02.
