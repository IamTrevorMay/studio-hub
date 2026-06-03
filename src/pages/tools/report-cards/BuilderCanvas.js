import React, { useMemo, useRef } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights } from '../../../lib/styleTokens';

// Visual bounds-only canvas. Shows each Scene element as a positioned
// labeled box at scene-pixel-coordinates * fitScale. Clicking an
// element selects it; click+drag a selected element moves it. Resize
// handles for selected element on each corner.
//
// Real-pixel preview comes from a separate <PreviewPanel> that calls
// /api/imagine-render. Mixing edit + photoreal preview in the same
// surface gets messy; users toggle between them.

export default function BuilderCanvas({ scene, selectedId, onSelectId, onUpdateElement }) {
  const wrapRef = useRef(null);

  const fit = useMemo(() => {
    // Fit canvas to a target box ~min(800, viewport-ish). For the
    // purposes of this MVP we just scale to max 720 on the long side.
    const maxLong = 720;
    const longSide = Math.max(scene.width, scene.height);
    const scale = Math.min(1, maxLong / longSide);
    return { scale, w: Math.round(scene.width * scale), h: Math.round(scene.height * scale) };
  }, [scene.width, scene.height]);

  function handleCanvasMouseDown(e) {
    // Deselect when clicking on the empty canvas
    if (e.target === wrapRef.current || e.currentTarget === e.target) {
      onSelectId(null);
    }
  }

  function handleElementMouseDown(e, el) {
    e.stopPropagation();
    onSelectId(el.id);
    // Drag-to-move
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = el.x;
    const origY = el.y;
    function onMove(ev) {
      const dx = (ev.clientX - startX) / fit.scale;
      const dy = (ev.clientY - startY) / fit.scale;
      onUpdateElement(el.id, {
        x: Math.max(0, Math.round(origX + dx)),
        y: Math.max(0, Math.round(origY + dy)),
      });
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function handleResizeMouseDown(e, el, corner) {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const origW = el.width;
    const origH = el.height;
    const origX = el.x;
    const origY = el.y;
    function onMove(ev) {
      const dx = (ev.clientX - startX) / fit.scale;
      const dy = (ev.clientY - startY) / fit.scale;
      const next = { x: origX, y: origY, width: origW, height: origH };
      if (corner.includes('e')) next.width = Math.max(20, Math.round(origW + dx));
      if (corner.includes('s')) next.height = Math.max(20, Math.round(origH + dy));
      if (corner.includes('w')) {
        next.x = Math.round(origX + dx);
        next.width = Math.max(20, Math.round(origW - dx));
      }
      if (corner.includes('n')) {
        next.y = Math.round(origY + dy);
        next.height = Math.max(20, Math.round(origH - dy));
      }
      onUpdateElement(el.id, next);
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  return (
    <div style={styles.outer}>
      <div style={styles.toolbar}>
        <div style={styles.meta}>
          {scene.width} × {scene.height} · {(fit.scale * 100).toFixed(0)}%
        </div>
      </div>
      <div style={styles.scroller}>
        <div
          ref={wrapRef}
          onMouseDown={handleCanvasMouseDown}
          style={{
            ...styles.canvas,
            width: fit.w,
            height: fit.h,
            background: scene.background || '#000',
          }}
        >
          {(scene.elements || []).map((el) => {
            const isSelected = el.id === selectedId;
            return (
              <div
                key={el.id}
                onMouseDown={(e) => handleElementMouseDown(e, el)}
                style={{
                  position: 'absolute',
                  left: Math.round(el.x * fit.scale),
                  top: Math.round(el.y * fit.scale),
                  width: Math.round(el.width * fit.scale),
                  height: Math.round(el.height * fit.scale),
                  outline: isSelected
                    ? `2px solid ${colors.accent}`
                    : '1px dashed rgba(255,255,255,0.18)',
                  background: isSelected
                    ? 'rgba(99,102,241,0.08)'
                    : 'rgba(255,255,255,0.03)',
                  cursor: 'move',
                  boxSizing: 'border-box',
                  zIndex: (el.zIndex || 0) + (isSelected ? 100 : 0),
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  padding: 4,
                }}
              >
                <span style={styles.elTypeBadge}>{el.type}</span>
                {isSelected && ['nw', 'ne', 'sw', 'se'].map((c) => (
                  <span
                    key={c}
                    onMouseDown={(e) => handleResizeMouseDown(e, el, c)}
                    style={{
                      ...styles.handle,
                      ...(c === 'nw' ? { left: -4,  top: -4,  cursor: 'nwse-resize' } : {}),
                      ...(c === 'ne' ? { right: -4, top: -4,  cursor: 'nesw-resize' } : {}),
                      ...(c === 'sw' ? { left: -4,  bottom: -4, cursor: 'nesw-resize' } : {}),
                      ...(c === 'se' ? { right: -4, bottom: -4, cursor: 'nwse-resize' } : {}),
                    }}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const styles = {
  outer: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    background: colors.bg,
  },
  toolbar: {
    height: 40,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    padding: `0 ${spacing.lg}px`,
    borderBottom: `1px solid ${colors.border}`,
    background: colors.bgRaised,
  },
  meta: {
    marginLeft: 'auto',
    fontSize: fontSizes.xs,
    color: colors.textDim,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  scroller: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  canvas: {
    position: 'relative',
    border: `1px solid ${colors.borderStrong}`,
    borderRadius: radii.md,
    boxShadow: '0 12px 36px rgba(0,0,0,0.4)',
  },
  elTypeBadge: {
    padding: '1px 6px',
    fontSize: 10,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    color: colors.text,
    background: 'rgba(0,0,0,0.5)',
    borderRadius: radii.xs,
    pointerEvents: 'none',
  },
  handle: {
    position: 'absolute',
    width: 10,
    height: 10,
    background: colors.accent,
    border: `1px solid ${colors.text}`,
    borderRadius: radii.xs,
    pointerEvents: 'auto',
  },
};
