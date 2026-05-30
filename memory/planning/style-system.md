# Mayday Studio — Style System

Status: established 2026-05-29. Lives in `memory/planning/` so it travels across machines via git.

This is the single source of truth for visual rules. If anything in this doc conflicts with what's in a page file, the page file is wrong; fix it during the next touch.

---

## TL;DR for every new piece of UI

1. Import from `src/lib/styleTokens.js` for raw values (palette, spacing, radii, type, shadows, motion).
2. Import from `src/lib/styleRecipes.js` for shapes you'd otherwise rebuild (card, pill, button, input, modal, section header).
3. Do NOT hardcode hex codes, padding numbers, font sizes, or border radii. ESLint rule `mayday/no-style-magic-numbers` will catch most of these.
4. When you need a value that isn't in the tokens, **add it to tokens** (with a one-line rationale comment) rather than inlining it.

---

## 1. Palette

All from `colors` in `styleTokens.js`.

### Surfaces
- `colors.bg` (`#0f0f1a`) — page background. App-level only.
- `colors.bgRaised` (`rgba(white, 0.04)`) — cards, panels.
- `colors.bgHover` (`rgba(white, 0.06)`) — hover/active state on raised surfaces.
- `colors.bgInput` — text inputs, selects.
- `colors.bgOverlay` (`rgba(black, 0.6)`) — modal backdrop.
- `colors.bgModal` (`#15151f`) — modal body.

### Borders
- `colors.border` — default 1px subtle.
- `colors.borderStrong` — focus state, inputs.
- `colors.borderFocus` — accent ring on focused inputs.

### Text
Use alpha, not new colors:
- `colors.text` — primary
- `colors.textMuted` (70%) — secondary
- `colors.textSubtle` (50%) — tertiary
- `colors.textDim` (40%) — quaternary
- `colors.textPlaceholder` (30%) — placeholders, empty states

### Accent
- `colors.accent` (`#6366f1` indigo) — primary actions, links, focused chips.
- `colors.accentSoft` — tint background.
- `colors.accentFg` — text color when on top of an accent tint.
- `colors.accentBorder` — outline accent.

### Tones (semantic)
Each tone is an object with `bg / border / fg / fgSoft`. Use for badges, pills, status indicators.
- `colors.success` (green)
- `colors.warning` (amber)
- `colors.danger` (red)
- `colors.info` (sky blue)

**Rule:** never introduce a new hex outside this palette unless it's brand iconography (channel logos, etc.). New product UI uses tones, not new colors.

---

## 2. Spacing

Base 4 px. Use `spacing` from tokens.

| key   | px  | typical use                          |
|-------|-----|--------------------------------------|
| xs    | 4   | gap between siblings within a row    |
| sm    | 8   | small padding, gap between sections  |
| md    | 12  | default field/item padding           |
| lg    | 16  | card padding                         |
| xl    | 20  | section padding                      |
| xxl   | 24  | page padding (left/right)            |
| xxxl  | 32  | page top padding                     |
| huge  | 48  | landing/empty-state spacing          |

Do not pick 5, 7, 9, 11. If the design truly needs an off-scale value, add it here with a reason.

---

## 3. Radii

From `radii` in tokens.

| key   | px / value | use                       |
|-------|------------|---------------------------|
| xs    | 4          | tiny inline pills, dots   |
| sm    | 6          | inputs, small buttons     |
| md    | 8          | secondary cards           |
| lg    | 10         | primary cards             |
| xl    | 14         | modals, callout cards     |
| pill  | 999        | chips, badges             |
| circle| 50%        | avatars, dot indicators   |

---

## 4. Type ramp

Font: DM Sans (`fontFamily` token). Don't add other typefaces.

| key      | px | weight typically used      | use                          |
|----------|----|----------------------------|------------------------------|
| xxs      | 10 | bold                       | dot indicators, mini labels  |
| xs       | 11 | semibold                   | section labels, metadata     |
| sm       | 12 | regular / medium           | secondary copy               |
| md       | 13 | regular                    | body default                 |
| lg       | 14 | medium / semibold          | card titles, emphasized body |
| xl       | 16 | semibold                   | subsection headers           |
| xxl      | 18 | bold                       | page titles                  |
| display  | 22 | bold                       | hero/empty-state titles      |

Weights: regular 400, medium 500, semibold 600, bold 700. Don't introduce light/black.

---

## 5. Shadows & motion

- `shadows.sm` — subtle (cards in dense lists)
- `shadows.md` — default card lift
- `shadows.lg` — popovers, dropdowns
- `shadows.modal` — modal dialogs
- `shadows.inset` — inner highlight on dark cards

- `transitions.fast` (120ms) — button hover, chip state
- `transitions.normal` (200ms) — modal/card show
- `transitions.slow` (320ms) — page-level transitions

---

## 6. Recipes (use these instead of rebuilding)

All in `src/lib/styleRecipes.js`. Each is a function that returns a `style={}` object.

- `card(variant)` — default | muted | accent | success/warning/danger/info
- `pill(tone)` — default | success | warning | danger | info
- `badge(tone)` — count/status badge for nav, list rows
- `button({ variant, size, disabled })` — primary | secondary | ghost | danger × sm/md/lg
- `input({ size })` — sm | md | lg. Works for input, select, textarea.
- `sectionHeader(level)` — 1 / 2 / 3 (3 is the small uppercase label)
- `modal({ width })` + `modalOverlay()` — full modal scaffold

### Example

```js
import { card, pill, button } from '../lib/styleRecipes';
import { colors, spacing } from '../lib/styleTokens';

<div style={card('accent')}>
  <h3 style={sectionHeader(2)}>Mayday Video Workflow</h3>
  <span style={pill('success')}>Active</span>
  <button style={button({ variant: 'primary', size: 'sm' })}>Run</button>
</div>
```

Anything that needs to deviate (one-off layout, page-specific color block) goes in a `const styles = { ... }` at the bottom of the page file but still composes from the tokens (e.g. `padding: spacing.lg`).

---

## 7. What NOT to do

- ❌ Hardcoded hex colors anywhere except `styleTokens.js`.
- ❌ Magic spacing numbers (`padding: 14`, `marginBottom: 11`).
- ❌ Picking a new font size that isn't on the ramp.
- ❌ Re-defining card / pill / button / input shape per page.
- ❌ Adding a Tailwind class (we don't use Tailwind).
- ❌ `import './something.css'` for component styling. Inline `style={}` only.
- ❌ Adding a new accent color for "just this feature". Use tones.

---

## 8. Migration plan (in-flight)

- ✅ Tokens + recipes shipped (commit `<set on commit>`).
- 🚧 Top 3 high-traffic pages getting migrated opportunistically: Dashboard, MyTasks, Workflows.
- After that, remaining pages migrate when next touched. Never carry-over hardcoded values into a refactor.

When you migrate a page, do it in a self-contained commit named `Migrate <page> to style tokens` so visual regressions are easy to bisect.

---

## 9. Updating this doc

If you introduce a new token, recipe, or convention, **update this doc in the same commit**. Stale docs are worse than no docs.
