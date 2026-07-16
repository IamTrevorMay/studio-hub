---
title: Style System — tokens, recipes, and the inline-style convention
last_updated: 2026-07-15
tags: [frontend, styling, design-tokens, css-in-js]
---

# Style system

**This is the most important frontend doc.** Styling here is 100% inline `style={}` objects —
no Tailwind, no CSS modules, no styled-components. The dark theme, the token file, and the
recipe factories are the whole system. Get this right and everything looks native.

## The hard rule (standing user preference)

> **Use tokens (`src/lib/styleTokens.js`) and recipes (`src/lib/styleRecipes.js`). Never
> hardcode style values.**

`styleTokens.js:3-5` states it directly: *"New code MUST use these instead of hardcoded values."*
The objective check is the standalone `npm run lint:styles` script
(`scripts/lint-styles.js`) — **not** the `mayday/no-style-magic-numbers` ESLint
rule its header comment names, which is *not* wired into any eslint config on disk
(so it does nothing; style is otherwise review-enforced). When you write new UI, import from the
token/recipe files. **Do not invent hex colors, off-scale paddings, or new radii.** If a value
you need genuinely isn't in the tokens, add it to `styleTokens.js` with a comment — don't
inline it in a page.

### Reality check: adoption is partial

Grep truth (2026-07): ~39 files import the token/recipe files; the large legacy pages
(`Deliverables.js`, `Production.js`, `Ideas.js`, `Calendar.js`, `Dashboard.js`, most modals)
still hardcode `rgba(255,255,255,0.x)` and hex literals directly in their `const styles = {}`
blocks. The **newer** surfaces are the model to copy: `src/pages/analytics/viz/*`,
`src/pages/tools/**`, `src/pages/projects/UnifiedBoard.js`, `AgencyPortal.js`, and
`components/AgencyThread.js` all import tokens. So:

- **New code Anna writes → tokens/recipes, always.**
- **Editing a legacy hardcoded page →** match the surrounding literals so the diff stays small
  and visually consistent, *unless* asked to tokenize. The hardcoded values below map 1:1 to
  tokens, so you can recognize them.

## Tokens — `src/lib/styleTokens.js`

Import the named groups (`import { colors, spacing, radii, fontSizes, fontWeights, shadows,
transitions, zIndex, fontFamily } from '../lib/styleTokens'`) or the default `tokens` bag.

### colors (`:13-65`)

Surfaces are layered dark blues; text is `rgba(white, α)` where alpha = hierarchy; accent is
indigo `#6366f1`.

| Token | Value | Use |
|---|---|---|
| `colors.bg` | `#0f0f1a` | page base |
| `colors.bgRaised` | `rgba(255,255,255,0.04)` | cards |
| `colors.bgHover` | `rgba(255,255,255,0.06)` | hover/secondary btn |
| `colors.bgInput` | `rgba(255,255,255,0.04)` | inputs |
| `colors.bgOverlay` | `rgba(0,0,0,0.6)` | modal backdrop |
| `colors.bgModal` | `#15151f` | modal surface |
| `colors.border` | `rgba(255,255,255,0.06)` | default border |
| `colors.borderStrong` | `rgba(255,255,255,0.12)` | inputs, ghost btn |
| `colors.borderFocus` | `rgba(99,102,241,0.5)` | focus ring |
| `colors.text` | `#ffffff` | primary text |
| `colors.textMuted` | `rgba(255,255,255,0.7)` | secondary |
| `colors.textSubtle` | `rgba(255,255,255,0.5)` | labels |
| `colors.textDim` | `rgba(255,255,255,0.4)` | metadata |
| `colors.textPlaceholder` | `rgba(255,255,255,0.3)` | placeholders |
| `colors.accent` | `#6366f1` | primary accent (indigo) |
| `colors.accentSoft` | `rgba(99,102,241,0.15)` | accent fill |
| `colors.accentFg` | `#a5b4fc` | text-on-dark accent |
| `colors.accentBorder` | `rgba(99,102,241,0.35)` | accent border |

**Semantic tones** — each is a `{ bg, border, fg, fgSoft }` triple (`:41-64`), for badges/pills:
`colors.success` (green `#22c55e`), `colors.warning` (amber `#eab308`),
`colors.danger` (red `#ef4444`), `colors.info` (sky `#38bdf8`). Example:
`{ background: colors.success.bg, border: `1px solid ${colors.success.border}`, color: colors.success.fg }`.

### spacing (`:73-82`) — 4px base

`xs:4  sm:8  md:12  lg:16  xl:20  xxl:24  xxxl:32  huge:48`. Use for padding/margin/gap. Do not
pick 5/7/9/11 — if off-scale is truly needed, add it to the token file with a reason.

### radii (`:86-94`)

`xs:4  sm:6  md:8  lg:10  xl:14  pill:999  circle:'50%'`. Cards use `lg`, modals `xl`,
chips/badges `pill`.

### typography (`:98-116`)

- `fontSizes`: `xxs:10 xs:11 sm:12 md:13(body) lg:14 xl:16 xxl:18 display:22`
- `fontWeights`: `regular:400 medium:500 semibold:600 bold:700`
- `fontFamily`: `'"DM Sans", system-ui, -apple-system, sans-serif'` — DM Sans is loaded
  globally; you rarely set `fontFamily` except `fontFamily: 'inherit'` on inputs/buttons
  (native form elements otherwise fall back to the UA font — see form fields in doc 03).

### shadows (`:120-126`)

`sm` (subtle) · `md` (cards) · `lg` (popovers) · `modal` (`0 20px 60px rgba(0,0,0,0.6)`) ·
`inset` (top highlight line).

### transitions (`:130-134`)

`fast:'all 120ms ease-out'` · `normal:'all 200ms ease-out'` · `slow:'all 320ms ease-out'`.

### zIndex (`:138-144`)

`base:1  dropdown:100  popover:200  toast:900  modal:1000`. Modals sit at 1000 — match it.

## Recipes — `src/lib/styleRecipes.js`

Factories that return ready-to-spread style objects built from tokens. **Use these instead of
hand-rolling a card/pill/button/input/modal shape.** Import
`import { card, pill, badge, button, input, sectionHeader, modalOverlay, modal } from '../lib/styleRecipes'`
(or default `recipes`).

| Recipe | Signature | Returns / notes |
|---|---|---|
| `card(variantOrOpts)` | `'default'` \| `'muted'` \| `'accent'` \| `{ variant, tone }` | Raised card. `muted` = transparent/no shadow; `accent` = indigo glow; `tone: 'success'\|'warning'\|'danger'\|'info'` adds a 3px colored left border (`:34-67`). |
| `pill(tone)` | `'default'` \| tone name | Inline-flex chip, pill radius, semibold. Tone fills bg/border/fg from the tone triple (`:74-98`). |
| `badge(tone)` | `'accent'`(default) \| tone | Small count pill (min 18×18), bold, `xxs` font. Defaults to danger-red fill unless `accent`/tone given (`:100-119`). |
| `button({variant,size,disabled})` | variant `primary`(def)\|`secondary`\|`ghost`\|`danger`; size `sm`\|`md`(def)\|`lg` | Inline-flex button; handles disabled opacity/cursor (`:126-169`). |
| `input({size})` | `sm`\|`md`(def)\|`lg` | Full-width input shell: `bgInput`, `borderStrong`, `radii.sm`, `fontFamily:'inherit'`, `boxSizing:'border-box'` (`:173-192`). |
| `sectionHeader(level)` | `1` (xxl bold) \| `2` (xl semibold) \| `3` (xs uppercase subtle) | Heading style, `margin:0` (`:196-221`). |
| `modalOverlay()` | — | `position:fixed; inset:0; bgOverlay; flex center; zIndex:1000` (`:225-235`). |
| `modal({width})` | width default `480` | `bgModal`, `borderStrong`, `radii.xl`, `padding: spacing.xl`, `maxWidth:'90vw'`, `shadows.modal` (`:237-248`). |

### Recipe examples

```js
import { card, pill, button, modalOverlay, modal } from '../lib/styleRecipes';

<div style={card('default')}>…</div>
<div style={card({ variant: 'default', tone: 'warning' })}>… (amber left border)</div>
<span style={pill('success')}>Complete</span>
<button style={button({ variant: 'primary', size: 'md' })}>Save</button>
<button style={button({ variant: 'ghost', size: 'sm' })}>Cancel</button>

// Modal shell
<div style={modalOverlay()} {...backdropDismiss(onClose)}>
  <div style={modal({ width: 560 })} onClick={e => e.stopPropagation()}>…</div>
</div>
```

Recipes take an **inner tone**: `toneFor()` (`:18-24`) maps `success/positive`,
`warning/caution`, `danger/negative`, `info` to the tone triples, so `pill('negative')` ==
`pill('danger')`. If a recipe lacks a variant you need, **extend the recipe** — don't override
it inline in the page (`:2-4`).

## The inline-style-object convention

### 1. `const styles = {}` at the bottom of the file

156 files end with a module-level `const styles = { ... }` object; JSX references
`style={styles.foo}`. Canonical shape (`src/components/MemberAssignmentModal.js:419-508`):

```js
const styles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', /* ... */ },
  modal:   { background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', /* ... */ },
  fieldLabel: { fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.45)',
                letterSpacing: 0.4, textTransform: 'uppercase' },
  // ...
};
```

Because this object is module-level (defined once, not per render) it doubles as a cheap
render optimization — the style objects are stable references. **New files should build these
entries from tokens** rather than the hardcoded literals the legacy files use.

### 2. Composing / conditional styles — spread

Merge a base style with a conditional one via spread. Order matters — later wins:

```js
style={{ ...styles.personChip, ...(on ? styles.personChipOn : {}) }}   // MemberAssignmentModal.js:409
style={{ ...styles.segmentBtn, ...(researchMode === 'existing' ? styles.segmentBtnOn : {}) }} // :302
style={{ ...styles.assignBtn, opacity: canAssign ? 1 : 0.45, cursor: canAssign ? 'pointer' : 'default' }} // :387
```

### 3. One-off inline objects are fine for tiny per-item tweaks

For a value that depends on row data (e.g. a per-user color), an inline object literal is
idiomatic — don't force it into `styles`: `style={{ ...styles.creatorName, color: userColor(item.created_by) }}` (`Ideas.js:710`).

## Module-level `*_COLORS` constants

Status/category/type color maps are defined once at module scope and keyed by an enum value.
This is a pervasive pattern — grep `_COLORS =` finds 40+ (`Dashboard.js`, `Calendar.js`,
`Projects.js`, `BusinessDev.js`, `Ideas.js`, `Production.js`, …). Two shapes:

**Simple value map** (color per key):
```js
// Ideas.js:29
const RATING_COLORS = { 1: '#ef4444', 2: '#f97316', 3: '#facc15', 4: '#86efac', 5: '#22c55e' };
// Deliverables.js:18
const SPONSOR_STATUS_COLORS = { active: '#10b981', completed: '#6366f1', cancelled: '#ef4444' };
```

**Rich object map** (bg + color + label per key) — for pills/badges:
```js
// Deliverables.js:20-24
export const CHANNEL_COLORS = {
  mayday:  { bg: 'rgba(99,102,241,0.12)', color: '#a5b4fc',            label: 'Mayday' },
  tmb:     { bg: 'rgba(239,68,68,0.12)',  color: '#fca5a5',            label: 'TM Baseball' },
  socials: { bg: 'rgba(255,255,255,0.06)',color: 'rgba(255,255,255,0.4)', label: 'Social' },
};
```

**Categorical palettes** (array, hashed/indexed for stable per-entity color):
```js
// Ideas.js:34-40 — stable per-user color from a hash of the profile id
const USER_COLORS = ['#a5b4fc', '#86efac', '#fcd34d', /* ... */];
function userColor(userId) { /* hash id → USER_COLORS[h % len] */ }
```

When you add a new status/type map, follow this convention (module const, `SCREAMING_SNAKE`,
`export` if another file — desktop/mobile pair — needs it). For **new** maps, prefer wiring the
tone triples: `{ bg: colors.success.bg, color: colors.success.fg }` instead of raw rgba.

The analytics charts centralize their palette in `src/pages/analytics/viz/palette.js` (`viz`
object + `platformColor()` + `sequential()` ramp) — all built from `colors` tokens
(`palette.js:7,15-25`). Reuse `viz.positive/negative/accent/grid/axis` for any chart, never
ad-hoc chart hex.

## Before / after — hardcoded vs tokenized

```js
// ❌ Hardcoded (legacy style — what the big pages currently do)
const styles = {
  card:  { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)',
           borderRadius: 10, padding: 16, boxShadow: '0 4px 14px rgba(0,0,0,0.25)' },
  label: { fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.5)',
           textTransform: 'uppercase', letterSpacing: 0.5 },
  saveBtn:{ background: '#6366f1', color: '#fff', borderRadius: 6, padding: '8px 16px',
            fontWeight: 600, border: 'none', cursor: 'pointer' },
};

// ✅ Tokenized / recipe (what new code must do)
import { colors, spacing, radii, fontSizes, fontWeights, shadows } from '../lib/styleTokens';
import { card, button, sectionHeader } from '../lib/styleRecipes';

const styles = {
  card:  card('default'),
  label: sectionHeader(3),               // xs uppercase subtle heading
  // or, when a recipe doesn't fit, compose from tokens:
  label2:{ fontSize: fontSizes.xs, fontWeight: fontWeights.bold, color: colors.textSubtle,
           textTransform: 'uppercase', letterSpacing: 0.5 },
};
// button is a factory — call it at the render site (or memoize once):
<button style={button({ variant: 'primary' })}>Save</button>
```

Both render identically — the tokens *are* those literals. The win is that a palette change is
one edit in `styleTokens.js` instead of a repo-wide find/replace.

## Checklist for styling anything

1. Is there a **recipe** (`card`/`pill`/`button`/`input`/`modal`/`modalOverlay`/`badge`/`sectionHeader`)? Use it.
2. Otherwise build the style object from **tokens** (`colors`, `spacing`, `radii`, `fontSizes`, `fontWeights`, `shadows`, `transitions`, `zIndex`).
3. Status/type colors → a module-level `*_COLORS` map (tone triples for new code).
4. Put reusable style objects in the bottom-of-file `const styles = {}`; spread for conditionals.
5. Never introduce a raw hex/off-scale value in new code. If missing, add it to `styleTokens.js`.
6. Match `zIndex.modal` (1000) for overlays, `fontFamily: 'inherit'` on form controls.
