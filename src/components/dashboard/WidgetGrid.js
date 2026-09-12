import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import {
  GRID_COLS, GRID_GAP, SIZES, SIZE_LABELS,
  WIDGET_BY_KEY, sizeForWidth, nextSize, packLayout, dropTarget, moveEntry,
} from '../../lib/dashboardWidgets';
import { colors, fontSizes, fontWeights, radii, spacing, transitions } from '../../lib/styleTokens';
import { buttonReset } from '../../lib/styleRecipes';

// Absolutely-positioned widget grid with iOS-style edit mode.
//
// Widgets keep their natural height, so the grid measures each one and packs
// them with the skyline algorithm rather than letting CSS lay them out. Drag is
// hand-rolled on pointer events: @hello-pangea/dnd reorders items in document
// flow and can't drive absolute positioning.

export default function WidgetGrid({
  entries,          // [{ k, x, w }] — visible, in packing order
  hiddenWidgets,    // catalog entries not currently placed
  renderWidget,     // (key) => ReactNode
  editing,
  onChange,         // (nextEntries) => void
  onAdd,            // (key) => void
  onRemove,         // (key) => void
}) {
  const wrapRef = useRef(null);
  const nodeRefs = useRef(new Map());
  const [heights, setHeights] = useState({});
  const [colWidth, setColWidth] = useState(0);
  const [drag, setDrag] = useState(null); // { key, w, dx, dy, px, py }
  const dragRef = useRef(null);
  // Heights start unknown, so the very first pack uses a placeholder for every
  // widget. Animating out of that reads as the page shuffling itself on load —
  // hold the transition back until real measurements have landed.
  const [settled, setSettled] = useState(false);

  // ── measure the column width ───────────────────────────────────────────────
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => {
      const total = el.clientWidth;
      setColWidth(Math.max(0, (total - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── measure widget heights ─────────────────────────────────────────────────
  // Content is live (announcements load, the sprint board fills in), so every
  // widget stays observed rather than being measured once on mount.
  const observeNode = useCallback((key, node) => {
    const map = nodeRefs.current;
    if (node) map.set(key, node); else map.delete(key);
  }, []);

  useEffect(() => {
    const ro = new ResizeObserver((records) => {
      setHeights(prev => {
        let changed = false;
        const next = { ...prev };
        for (const record of records) {
          const key = record.target.dataset.widgetKey;
          if (!key) continue;
          const h = record.target.offsetHeight;
          if (next[key] !== h) { next[key] = h; changed = true; }
        }
        return changed ? next : prev;
      });
      setSettled(true);
    });
    const nodes = [...nodeRefs.current.values()];
    for (const node of nodes) ro.observe(node);
    // Nothing to measure (every widget removed, or all of them render null) —
    // settle anyway so the grid isn't left permanently transparent.
    if (nodes.length === 0) setSettled(true);
    return () => ro.disconnect();
  }, [entries, editing]);

  const { placed, totalHeight } = packLayout(entries, heights, colWidth);

  // ── drag ───────────────────────────────────────────────────────────────────
  const startDrag = (e, entry) => {
    if (!editing) return;
    e.preventDefault();
    const wrap = wrapRef.current;
    const spot = placed.find(p => p.k === entry.k);
    if (!wrap || !spot) return;
    const rect = wrap.getBoundingClientRect();
    dragRef.current = {
      key: entry.k,
      w: entry.w,
      // Offset from the widget's own top-left, so it doesn't jump to the cursor.
      dx: e.clientX - rect.left - spot.left,
      dy: e.clientY - rect.top - spot.top,
      px: e.clientX - rect.left,
      py: e.clientY - rect.top,
    };
    setDrag(dragRef.current);

    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const r = wrapRef.current.getBoundingClientRect();
      const next = { ...d, px: ev.clientX - r.left, py: ev.clientY - r.top };
      dragRef.current = next;
      setDrag(next);
    };
    const onUp = () => {
      const d = dragRef.current;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.style.userSelect = '';
      dragRef.current = null;
      setDrag(null);
      if (!d) return;
      const target = dropTarget(placed, d.key, d.px - d.dx, d.py - d.dy, colWidth, d.w);
      onChange(moveEntry(entries, d.key, target.index, target.x, d.w));
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.body.style.userSelect = 'none';
  };

  // Live preview: pack as though the dragged widget were already dropped.
  let preview = placed;
  let previewTotal = totalHeight;
  if (drag) {
    const target = dropTarget(placed, drag.key, drag.px - drag.dx, drag.py - drag.dy, colWidth, drag.w);
    const reordered = moveEntry(entries, drag.key, target.index, target.x, drag.w);
    const packedPreview = packLayout(reordered, heights, colWidth);
    preview = packedPreview.placed;
    previewTotal = packedPreview.totalHeight;
  }

  const setSize = (key, size) => {
    const w = SIZES[size];
    const entry = entries.find(e => e.k === key);
    if (!entry || entry.w === w) return;
    const index = entries.findIndex(e => e.k === key);
    onChange(moveEntry(entries, key, index, Math.min(entry.x, GRID_COLS - w), w));
  };

  return (
    <>
      {editing && <style>{JIGGLE_KEYFRAMES}</style>}

      <div
        ref={wrapRef}
        style={{ ...styles.grid, height: previewTotal, opacity: settled ? 1 : 0 }}
      >
        {preview.map((spot) => {
          const spec = WIDGET_BY_KEY[spot.k];
          const isDragging = drag?.key === spot.k;
          const size = sizeForWidth(spot.w);

          // The dragged widget follows the cursor; everything else animates to
          // the position the drop would give it.
          const position = isDragging
            ? { left: drag.px - drag.dx, top: drag.py - drag.dy }
            : { left: spot.left, top: spot.top };

          return (
            <div
              key={spot.k}
              style={{
                ...styles.slot,
                ...position,
                width: spot.width,
                transition: (isDragging || !settled)
                  ? 'none'
                  : 'left 180ms ease, top 180ms ease, width 180ms ease',
                zIndex: isDragging ? 40 : 1,
                ...(isDragging ? styles.slotDragging : null),
              }}
            >
              <div
                data-widget-key={spot.k}
                ref={(node) => observeNode(spot.k, node)}
                style={{
                  ...(editing ? styles.widgetEditing : null),
                  ...(isDragging ? styles.widgetDragging : null),
                }}
              >
                {editing && (
                  <>
                    {/* Grab anywhere on the widget while editing — the overlay
                        also stops clicks reaching the live controls beneath. */}
                    <div
                      style={styles.dragOverlay}
                      onPointerDown={(e) => startDrag(e, { k: spot.k, w: spot.w })}
                    />
                    <button
                      type="button"
                      style={styles.removeBadge}
                      title={`Remove ${spec?.label || spot.k}`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => onRemove(spot.k)}
                    >
                      &minus;
                    </button>
                    {spec && spec.sizes.length > 1 && (
                      <button
                        type="button"
                        style={styles.sizeBtn}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => setSize(spot.k, nextSize(spec, size))}
                        title={`${SIZE_TITLES[size]} · click for ${SIZE_NAMES[nextSize(spec, size)]}`}
                      >
                        {SIZE_LABELS[size]}
                      </button>
                    )}
                  </>
                )}
                {renderWidget(spot.k)}
              </div>
            </div>
          );
        })}
      </div>

      {editing && (
        <div style={styles.tray}>
          <div style={styles.trayLabel}>
            {hiddenWidgets.length ? 'Hidden widgets — click to add' : 'Every widget is on your dashboard'}
          </div>
          {hiddenWidgets.length > 0 && (
            <div style={styles.trayRow}>
              {hiddenWidgets.map(w => (
                <button key={w.key} type="button" style={styles.trayChip} onClick={() => onAdd(w.key)}>
                  <span style={styles.trayPlus}>+</span>
                  <span>
                    <span style={styles.trayChipLabel}>{w.label}</span>
                    <span style={styles.trayChipCaption}>{w.caption}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

const SIZE_NAMES = { s: 'Small', m: 'Medium', l: 'Large' };
const SIZE_TITLES = { s: 'Small — 1 column', m: 'Medium — 2 columns', l: 'Large — full width' };

// Nudged rather than spun: a full iOS jiggle on cards this large reads as noise.
const JIGGLE_KEYFRAMES = `
@keyframes dash-jiggle {
  0%   { transform: rotate(-0.28deg) translateY(0); }
  50%  { transform: rotate(0.28deg)  translateY(-1px); }
  100% { transform: rotate(-0.28deg) translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  [data-widget-key] { animation: none !important; }
}
`;

const styles = {
  grid: {
    position: 'relative',
    width: '100%',
    transition: 'opacity 120ms ease',
  },
  slot: {
    position: 'absolute',
  },
  slotDragging: {
    cursor: 'grabbing',
  },
  widgetEditing: {
    position: 'relative',
    animation: 'dash-jiggle 0.9s ease-in-out infinite',
    transformOrigin: 'center',
    borderRadius: radii.lg,
    outline: `1px dashed ${colors.borderStrong}`,
    outlineOffset: 3,
  },
  widgetDragging: {
    animation: 'none',
    boxShadow: '0 20px 50px rgba(0,0,0,0.45)',
    outline: `1px solid ${colors.accentBorder}`,
  },
  // Sits over the widget so a drag never lands on a button inside it.
  dragOverlay: {
    position: 'absolute',
    inset: 0,
    zIndex: 20,
    cursor: 'grab',
    borderRadius: radii.lg,
  },
  removeBadge: {
    ...buttonReset,
    position: 'absolute',
    top: -8,
    left: -8,
    zIndex: 30,
    width: 22,
    height: 22,
    borderRadius: '50%',
    background: colors.bgHover,
    border: `1px solid ${colors.borderStrong}`,
    color: colors.text,
    fontSize: 15,
    lineHeight: 1,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
  },
  // One button showing the current size; each click advances to the next size
  // the widget allows and wraps at the end.
  sizeBtn: {
    ...buttonReset,
    position: 'absolute',
    bottom: -9,
    right: 10,
    zIndex: 30,
    width: 24,
    height: 22,
    borderRadius: radii.pill,
    background: colors.accent,
    border: `1px solid ${colors.accentDeep}`,
    color: '#fff',
    fontSize: fontSizes.xxs,
    fontWeight: fontWeights.bold,
    fontFamily: 'inherit',
    cursor: 'pointer',
    transition: transitions.fast,
    boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
  },
  tray: {
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderRadius: radii.lg,
    border: `1px dashed ${colors.borderStrong}`,
    background: colors.whiteA03,
  },
  trayLabel: {
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    color: colors.textDim,
    marginBottom: spacing.md,
  },
  trayRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  trayChip: {
    ...buttonReset,
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
    padding: `${spacing.sm}px ${spacing.md}px`,
    borderRadius: radii.md,
    border: `1px solid ${colors.border}`,
    background: colors.bgRaised,
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'inherit',
  },
  trayPlus: {
    fontSize: fontSizes.lg,
    color: colors.accentFg,
    lineHeight: 1,
  },
  trayChipLabel: {
    display: 'block',
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text,
  },
  trayChipCaption: {
    display: 'block',
    fontSize: fontSizes.xs,
    color: colors.textDim,
  },
};
