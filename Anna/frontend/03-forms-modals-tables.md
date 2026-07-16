---
title: Forms, Modals, Tables — reusable UI patterns
last_updated: 2026-07-15
tags: [frontend, modals, forms, tables, ui]
---

# Forms, modals, tables

Concrete, copy-pasteable UI idioms. The canonical reference implementation is
`src/components/MemberAssignmentModal.js` — it demonstrates the modal shell, every form-field
type, chip selectors, a searchable record list, empty states, and the footer button row in one
file. Read it alongside this doc.

## 1. The standard modal shell

A modal is a self-contained component: `open`/`onClose`/callback props, `if (!open) return null`,
overlay + card, backdrop-dismiss, stop-propagation on the card. Skeleton
(`MemberAssignmentModal.js:233-244, 384-396, 419-442`):

```js
export default function MyModal({ open, onClose, onCreated, showToast }) {
  // ...state, fetch, handlers...
  if (!open) return null;
  return (
    <div style={styles.overlay} {...backdropDismiss(onClose)}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <div>
            <h2 style={styles.h2}>Assign Member Task</h2>
            <p style={styles.subtitle}>Hand out a one-off task…</p>
          </div>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        <div style={styles.body}>{/* scrollable form */}</div>
        <div style={styles.footer}>
          <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={{ ...styles.assignBtn, opacity: canSave ? 1 : 0.45 }}
                  onClick={handleSave} disabled={!canSave}>
            {submitting ? 'Assigning…' : 'Assign'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

The shell styles (`:419-442`): overlay is `position:fixed; inset:0; rgba(0,0,0,0.6); flex
center; zIndex:1000`; the card is a **flex column** with `maxHeight:'90vh'` so header/footer
pin and only `body` scrolls (`body: { overflowY:'auto', flex:1 }`, `:438`). For new code, this
whole shell is available as recipes: `modalOverlay()` + `modal({ width })` (see doc 02) — but
new modals still need the flex-column + pinned-footer layout on top of `modal()`.

### Backdrop dismiss — always use the helper

`src/lib/backdropDismiss.js`. Spread it on the **overlay** div:

```js
import backdropDismiss from '../lib/backdropDismiss';
<div style={styles.overlay} {...backdropDismiss(onClose)}>
```

Why not `onClick={onClose}`: the browser fires a click on the common ancestor of mousedown and
mouseup, so selecting text inside the modal and releasing over the backdrop would slam it shut
and eat the user's work. `backdropDismiss` arms only when the **press started** on the backdrop
itself (`:20-27`). **44 files** import it (verified 2026-07-15). Prefer it for new modals.

**Known variance (not universal).** `Deliverables.js` — the largest page — does **not** import
the helper; it inlines the equivalent guard directly on the overlay:
```js
<div style={styles.modalOverlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
// Deliverables.js:1969, 2979
```
This is the same press-started-on-backdrop check, hand-rolled. Both are correct. When touching
an existing modal, keep whichever mechanism the file already uses; reach for `backdropDismiss`
in **new** modal components.

### Confirmation dialogs — `useConfirm()`, not `window.confirm`

```js
import { useConfirm } from '../contexts/ConfirmContext';
const confirm = useConfirm();
if (await confirm({ title: 'Delete brand?', body: '…', danger: true })) { /* delete */ }
```

Used across `Deliverables.js:6,39`, `FindAssetsModal.js:27`, etc. `ConfirmContext` itself uses
`backdropDismiss`.

## 2. Form field patterns

Fields are label + native control, stacked, styled via `styles`. All native form controls must
set `fontFamily: 'inherit'` and `boxSizing: 'border-box'` (otherwise UA font + width bugs). The
recurring pieces (`MemberAssignmentModal.js`):

### Field label (uppercase micro-label)
```js
// styles.fieldLabel (:448-451): 11px / weight 700 / rgba(255,255,255,0.45)
//   letterSpacing 0.4 / textTransform uppercase / flex align gap 6
<div style={styles.fieldLabel}>
  Due date {required && <span style={{ color: '#f87171', marginLeft: 6 }}>required</span>}
</div>
```
The inline `required` marker (`:265,297,327`) is a red-ish `#f87171` span appended to the label
when the field is empty. This is the standard "this is missing" affordance.

### Text / date / url input
```js
<input style={styles.input} value={title} onChange={e => setTitle(e.target.value)}
       placeholder="What needs doing?" autoFocus />
<input type="date" style={styles.input} value={dueDate} onChange={e => setDueDate(e.target.value)} />
<input type="url"  style={styles.input} value={link} onChange={e => setLink(e.target.value)} placeholder="https://…" />
// styles.input (:462-466): full-width, rgba(0,0,0,0.25) bg, 1px rgba(255,255,255,0.1) border,
//   radius 8, 13px, outline:none, boxSizing:border-box, fontFamily:inherit
```

### Textarea
```js
<textarea style={styles.textarea} rows={2} value={notes}
          onChange={e => setNotes(e.target.value)} />
// styles.textarea (:467-471): same as input + resize:'vertical'
```

### Select
```js
<select style={styles.input} value={template} onChange={e => onPickTemplate(e.target.value)}>
  <option value="">— Plain task —</option>
  {TASK_TEMPLATES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
</select>
```
Selects reuse `styles.input`. A leading `<option value="">— placeholder —</option>` is the
empty/default choice.

### Two-up grid for related fields
```js
// styles.formGrid (:461): display:grid; gridTemplateColumns:'1fr 2fr'; gap:12
<div style={styles.formGrid}>
  <div><div style={styles.fieldLabel}>Due date</div><input type="date" .../></div>
  <div><div style={styles.fieldLabel}>Link</div><input type="url" .../></div>
</div>
```

### Segmented toggle (mode switch)
```js
// styles.segmentRow / segmentBtn / segmentBtnOn (:299-310, 500-506)
<div style={styles.segmentRow}>
  <button type="button" style={{ ...styles.segmentBtn, ...(mode==='existing' ? styles.segmentBtnOn : {}) }}
          onClick={() => setMode('existing')}>Use existing</button>
  <button type="button" style={{ ...styles.segmentBtn, ...(mode==='new' ? styles.segmentBtnOn : {}) }}
          onClick={() => setMode('new')}>Create new</button>
</div>
```

### Multi-select chips (people, tags)
Extracted into a small subcomponent `PeopleChips` (`:399-417`) — a wrap of pill buttons that
toggle membership in a selected-id array, showing `✓ ` when on:
```js
{people.map(p => {
  const on = selected.includes(p.id);
  return <button key={p.id} onClick={() => onToggle(p.id)}
    style={{ ...styles.personChip, ...(on ? styles.personChipOn : {}) }}>
    {on ? '✓ ' : ''}{p.full_name || p.email}
  </button>;
})}
```
The toggle handler is the functional-update Set/array idiom from doc 01.

### Searchable record picker (typeahead over a fetched list)
Text input filters a memoized list; clicking a row selects it; a "picked" confirmation row with
a "change" button replaces the list (`:261-291`, list styles `:481-499`). `recordOptions` is a
`useMemo` that filters by the search string (`:126-131`), sliced to 50 for render safety
(`:277`). Reuse this shape any time you pick one record out of many.

## 3. Validation & submit gating

No form library. Compute a boolean `canSave`/`canAssign` from the field state and use it to
disable the submit button + dim it:
```js
const canAssign = title.trim() && assignees.length > 0
  && (!activeTemplate || isResearch || recordId) && researchReady && !submitting; // :229-231
<button disabled={!canAssign} style={{ ...styles.assignBtn, opacity: canAssign ? 1 : 0.45,
        cursor: canAssign ? 'pointer' : 'default' }}>…</button>
```
Guard again at the top of the handler (`if (!title.trim() || assignees.length === 0) return;`,
`:178`). Set a `submitting` flag around the async write and label the button `'Assigning…'`
while it runs (`:391`); reset in `finally`.

## 4. Writes: Supabase + edge functions

- **Direct table writes** for CRUD: `supabase.from('write_ideas').update({ position }).eq('id', id)`
  (`Ideas.js:108-111`). Batched drag-reorder builds an array of update promises
  (`Ideas.js:105-119`).
- **Edge functions** for privileged/multi-step ops: `supabase.functions.invoke('assign-task',
  { body: {...} })` (`MemberAssignmentModal.js:198`), or the raw-fetch helper `callEdgeFn(name,
  body)` from `src/lib/edgeFn.js` (attaches the bearer token, throws on `!res.ok`).
- On success: `showToast('Assigned to N people')`, `resetForm()`, `onCreated?.()`, `onClose?.()`
  (`:217-221`). On failure: `showToast('… failed: ' + err.message, 'error')`.

## 5. Tables & lists

There is **no shared Table component and no virtualization library**. Tables are hand-built with
CSS grid/flex "rows" and `.map()`. The dominant pattern is a **header row and data rows that
share one `gridTemplateColumns` string** so columns line up. Verified example — the Ideas
ratings table: header at `Ideas.js:858-859` and rows at `:864-865` share a
`'52px minmax(180px,1.2fr) …'` template; cells are `styles.cell` (`:882`, just
`{ minWidth: 0 }` so grid cells can shrink/ellipsize). `gridTemplateColumns` grid-tables appear
across `Deliverables.js` (4 sites), `Invoicing.js` (4), `Tracking.js` (2); `Payroll.js` uses
flex rows instead (0 grid tables) — so **match the file's existing row mechanism**.

Note that `Ideas.js` itself is primarily a **kanban of category columns** (one
`@hello-pangea/dnd` `Droppable` per category, `Ideas.js:2`, drag *between* columns), with the
grid-table only in its ratings sub-view. For drag-reorderable lists the repo standard is
`@hello-pangea/dnd` (`DragDropContext`/`Droppable`/`Draggable`) with local reindex-then-persist
on `onDragEnd` — Ideas reindexes both affected columns and fires a `Promise.all` of per-row
`update({ position, category })` writes (`Ideas.js:76-122`, see doc 01). `Production.js` uses
the same library for its folder/version tree.

Guidelines:
- Render a bounded slice for large option lists (`.slice(0, 50)`), not the whole array.
- Keep a stable `key` (row id), never the array index for reorderable rows.
- Pull only displayed columns in the `select()` string (doc 01 §3).

## 6. Empty states

Short muted sentence, one styled node — no illustration/empty-component. Phrasing:
`No <things> yet[.  <call to action>.]`

```js
{items.length === 0 && <p style={styles.emptyText}>No ideas yet</p>}          // Ideas.js:720-721
<p style={styles.emptyText}>No brands yet. Add one to get started.</p>        // Deliverables.js:2387
<div style={styles.emptyState}>Loading...</div>                               // Production.js:1762
```
`styles.emptyText` / `styles.emptyState` are typically `rgba(255,255,255,0.4)`, centered,
italic-ish. The record-picker has its own inline empty (`No active deliverables found`,
`:275-276`).

## 7. CSV import — `src/lib/csvImport.js`

`parseTransactionsCsv(text)` → `{ rows: [{date, description, amount}], errors: [string] }`
(`:51-80`). It ships a minimal RFC-4180 parser (quoted fields, escaped `""`, CRLF, `:6-34`) and
resolves columns by fuzzy header match (`DATE_HEADERS`/`DESC_HEADERS`/`AMOUNT_HEADERS`,
`:36-47`). Amount is stripped of `$`/`,` and parsed to a float; bad rows are skipped with a
per-row error message. Used by the Accounting import flow (rows go to the
`import-transactions` edge fn). The CSV-import modal (`tools/mailer/CsvImportModal.js`) is a
separate mailer-list importer. When Anna adds a CSV importer, reuse `parseTransactionsCsv`'s
shape: parse → normalize → collect `errors[]` → surface them in the modal, don't throw.

## 8. Notable reusable components in `src/components/`

- `MemberAssignmentModal.js` / `ContractorAssignmentModal.js` — task-assignment modals (the
  form/chip reference).
- `FindAssetsModal.js` — a large review modal with a side preview pane; example of a
  data-heavy modal with `cancelled` guards on effects (`:466,534`).
- `AgencyThread.js` — comment thread widget (uses tokens + recipes; a good tokenized example).
- `TaskEditModal.js`, `SprintRetroModal.js`, `ResearchScopeModal.js` — all follow the shell +
  `backdropDismiss` convention.
- `PageErrorBoundary.js` — the per-page error boundary.
- Mobile: `components/mobile/MobileDrawer.js`, `BottomSheet.js` — mobile overlay equivalents,
  also `backdropDismiss`-based.
